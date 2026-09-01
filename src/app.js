/* ---------------------------------------------------------------
   app.js — screens, state, and event wiring.

   One render function rebuilds the active screen from STATE. The
   only deliberate exception is the shot-entry distance field: it
   updates STATE and re-evaluates the Save button in place, without
   a re-render, so typing never steals focus or dismisses the phone
   keyboard mid-number.
--------------------------------------------------------------- */

import {
  LIE_LABELS,
  CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_SHORT,
  MISS_GRID,
  MISS_LABELS,
  CLUBS,
  classifyShot,
  unitForLie,
  tracksMiss,
} from './baseline.js';

import {
  newRound,
  newShot,
  lieAfter,
  shotSG,
  holeTotals,
  roundTotals,
  holeScore,
  roundScore,
  roundPar,
  roundToPar,
  playedHoles,
  sgRounds,
  isScoreOnly,
  isRoundComplete,
  nextUnplayedHole,
  relinkHole,
  approachBuckets,
  puttingBuckets,
  teeOutcomes,
  greensInRegulation,
  trendSeries,
  personalBests,
  playerSummary,
  nemesisHoles,
  clubDistances,
  distanceHistogram,
  clubGapping,
  holeRecords,
  missTally,
} from './model.js';

import {
  roundBrief,
  careerBrief,
  shotsCsv,
  roundFilename,
  careerFilename,
} from './brief.js';

import * as store from './storage.js';
import * as sync from './sync.js';
import { missingSeeds, cloneSeed } from './seed.js';
import { EXTRACTION_PROMPT, parseCourseText, describeCourse } from './import.js';
import {
  handicapProfile, fmtHandicap, fmtHandicapShort, upsideFor,
  handicapForTotal, handicapForCategory,
} from './handicap.js';

import {
  newCourse,
  listCourses,
  upsertCourse,
  playOptions,
  findPlayOption,
  buildRoundHoles,
  totalYards,
  totalPar,
  ninePar,
  nineYardage,
  validateNine,
  findDuplicate,
  repairCourse,
  isIncomplete,
  validateCourse,
  addTee,
  removeTee,
  addNine,
  newCombo,
} from './courses.js';

const STATE = {
  screen: 'login',
  player: null,
  round: null,
  holeIdx: 0,
  draft: {},           // in-progress shot entry
  courseDraft: null,   // course being edited
  courseTeeIdx: 0,
  courseNineIdx: 0,
  comboDraft: null,
  setupCourseId: null, // course chosen, awaiting a tee and layout
  setupTee: null,
  setupMode: 'full',
  viewRoundId: null,
  loginDraft: '',
  importText: '',
  importPreview: null,
  importCourse: null,
  historyScope: 'mine',
  holePicker: false,
  openHole: null,
  trendKey: 'total',
  archive: null,
  editShotIdx: null,
  syncBusy: false,
  syncStatus: null,
  // Export confirmations render next to the button pressed rather
  // than at the top of the screen — the detail and stats screens have
  // no notice slot, and a message six cards away is easy to miss.
  exportStatus: null,
  notice: null,
  error: null,
};

/* --- Formatting -------------------------------------------------- */

function fmtSG(v) {
  const rounded = Math.round(v * 100) / 100;
  const s = Math.abs(rounded).toFixed(2);
  if (rounded > 0) return '+' + s;
  if (rounded < 0) return '−' + s;
  return '0.00';
}

function sgClass(v) {
  const rounded = Math.round(v * 100) / 100;
  if (rounded > 0) return 'sg-pos';
  if (rounded < 0) return 'sg-neg';
  return 'sg-zero';
}

function fmtToPar(diff) {
  if (diff === 0) return 'E';
  return diff > 0 ? '+' + diff : String(diff);
}

function fmtDist(dist, unit) {
  if (dist == null) return '';
  return Math.round(dist) + (unit === 'ft' ? 'ft' : 'y');
}

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

/** True when running from a home-screen icon rather than a browser tab. */
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

/* --- Shell ------------------------------------------------------- */

function topbar(sub) {
  return `<header class="topbar">
    <div class="brand">Ledger<span>.</span></div>
    <div class="sub">${esc(sub || 'Strokes Gained')}</div>
  </header>`;
}

function notices() {
  let html = '';
  if (STATE.error) html += `<div class="err-box">${esc(STATE.error)}</div>`;
  if (STATE.notice) html += `<div class="ok-box">${esc(STATE.notice)}</div>`;
  return html;
}

const NAV = [
  { key: 'home', label: 'Play' },
  { key: 'history', label: 'Rounds' },
  { key: 'stats', label: 'Stats' },
  { key: 'clubhouse', label: 'Clubhouse' },
  { key: 'courses', label: 'Courses' },
];

const NAV_GROUPS = {
  home: ['home', 'setup', 'play', 'scorecard', 'summary'],
  history: ['history', 'detail', 'settings'],
  stats: ['stats'],
  clubhouse: ['clubhouse'],
  courses: ['courses', 'courseEdit', 'courseImport'],
};

function renderNav() {
  if (STATE.screen === 'login') return '';
  return NAV.map((tab) => {
    const active = NAV_GROUPS[tab.key].includes(STATE.screen);
    return `<button class="navbtn ${active ? 'active' : ''}" data-nav="${tab.key}">
      <span class="dot"></span>${tab.label}
    </button>`;
  }).join('');
}

/* --- Screens ----------------------------------------------------- */

function screenLogin() {
  const locked = sync.needsPassphrase();

  return `${topbar('Sign in')}
    <div class="card">
      <h2>Ledger</h2>
      <p class="muted">${locked
        ? 'This device is not unlocked yet. Enter the passphrase and your name.'
        : 'Enter your name to continue.'}</p>
      ${STATE.error ? `<div class="err-box">${esc(STATE.error)}</div>` : ''}

      ${locked ? `
        <label>Passphrase</label>
        <input type="password" id="loginPass" placeholder="Passphrase" autocapitalize="off"
               autocorrect="off" spellcheck="false" value="${esc(STATE.passDraft || '')}">
      ` : ''}

      <label>Name</label>
      <input type="text" id="loginName" placeholder="Name" autocapitalize="words"
             autocorrect="off" spellcheck="false" value="${esc(STATE.loginDraft || '')}">

      <button class="btn-primary" style="margin-top:12px" data-action="sign-in" ${STATE.syncBusy ? 'disabled' : ''}>
        ${STATE.syncBusy ? 'Checking…' : 'Sign In'}
      </button>

      ${locked ? `<p class="tiny">The passphrase is checked against the sheet, so a wrong one reaches no data at all. It is asked for once per device.</p>` : ''}
      ${!sync.hasUrl() ? `<p class="tiny">No sheet is connected on this device, so rounds stay local until one is set up in Settings.</p>` : ''}
    </div>

    ${locked && isStandalone() === false ? `
      <div class="card">
        <h2>Add to your home screen first</h2>
        <p class="muted">On a phone, the home screen version keeps its own separate data from the browser tab. Add it <em>before</em> signing in and you only have to do this once.</p>
        <p class="tiny">iPhone: Share, then Add to Home Screen. Android: the browser menu, then Install or Add to Home screen. Then open it from the icon and sign in there.</p>
      </div>` : ''}`;
}

function screenHome() {
  const round = STATE.round;
  const resumable = round && !isRoundComplete(round);
  const rounds = playerRounds();
  const last = rounds[0];

  return `${topbar(STATE.player)}
    ${notices()}
    ${resumable ? `
      <div class="card">
        <h2>Round in progress</h2>
        <p class="muted">${esc(round.courseName)} &mdash; ${esc(round.teeName)} tees<br>
        Through ${playedHoles(round).length} holes, ${fmtToPar(roundToPar(round))}</p>
        <div class="fairway-divider"></div>
        <button class="btn-flag" data-action="resume">Continue &mdash; Hole ${STATE.holeIdx + 1}</button>
        <div class="btn-row">
          <button class="btn-danger" data-action="discard-round">Discard Round</button>
        </div>
      </div>` : `
      <div class="card">
        <h2>Start a round</h2>
        <p class="muted">Pick a course you have saved, or add a new scorecard.</p>
        <button class="btn-primary" data-action="goto-setup">New Round</button>
      </div>`}

    ${last ? `
      <div class="card">
        <h2>Last round</h2>
        <button class="row" data-action="view-round" data-id="${esc(last.id)}">
          <div class="badge">${fmtToPar(roundToPar(last))}</div>
          <div class="row-meta">
            <div class="rname">${esc(last.courseName)}</div>
            <div class="rsub">${fmtDate(last.date)} &middot; ${esc(last.teeName)}</div>
          </div>
          <div class="row-val ${sgClass(roundTotals(last).total)}">${fmtSG(roundTotals(last).total)}</div>
        </button>
      </div>` : ''}

    <div class="card">
      <h2>How this works</h2>
      <p class="muted">Every shot is measured against the strokes a tour player would expect to need from the same lie and distance. Beat that number and you gain; fall short and you lose. Totals break down into tee shots, approaches, short game and putting &mdash; so you can see which part of the round actually cost you.</p>
    </div>`;
}

function screenSetup() {
  const courses = listCourses();
  return `${topbar('New Round')}
    ${notices()}
    <div class="card">
      <h2>Choose a course</h2>
      ${courses.length === 0 ? `
        <div class="empty">
          <div class="glyph">&#9971;</div>
          <div>No courses saved yet. Add a scorecard once and it is there for good.</div>
        </div>
        <button class="btn-primary" data-action="new-course">Add a Course</button>
      ` : `
        ${courses.map((c) => `
          <button class="row" data-action="pick-course" data-id="${esc(c.id)}">
            <div class="badge">${c.nines.length * 9}</div>
            <div class="row-meta">
              <div class="rname">${esc(c.name)}</div>
              <div class="rsub">${esc(c.teeNames.join(' · '))}</div>
            </div>
            <div class="row-val">&rsaquo;</div>
          </button>
        `).join('')}
        <div class="btn-row">
          <button class="btn-ghost" data-action="new-course">Add a Course</button>
        </div>
      `}
    </div>`;
}

function screenPickTee() {
  const course = safeCourse(STATE.setupCourseId);
  if (!course) return screenSetup();

  const tee = STATE.setupTee || course.teeNames[0];
  const options = playOptions(course);
  const nines = options.filter((o) => o.holeCount === 9);
  const eighteens = options.filter((o) => o.holeCount === 18);

  const optionRow = (option) => `
    <button class="row" data-action="start-round" data-option="${esc(option.key)}">
      <div class="badge">${totalPar(course, option, tee)}</div>
      <div class="row-meta">
        <div class="rname">${esc(option.label)}</div>
        <div class="rsub">${option.holeCount} holes &middot; ${totalYards(course, option, tee).toLocaleString()}y from ${esc(tee)}</div>
      </div>
      <div class="row-val">&rsaquo;</div>
    </button>`;

  const mode = STATE.setupMode || 'full';

  return `${topbar(course.name)}
    ${notices()}
    <div class="card">
      <h2>Tees</h2>
      <div class="chip-grid">
        ${course.teeNames.map((name) => `
          <button class="chip ${name === tee ? 'active' : ''}" data-setup-tee="${esc(name)}">${esc(name)}</button>
        `).join('')}
      </div>

      <label>What are you tracking?</label>
      <div class="chip-grid g2">
        <button class="chip ${mode === 'full' ? 'active' : ''}" data-setup-mode="full">Every shot</button>
        <button class="chip ${mode === 'score' ? 'active' : ''}" data-setup-mode="score">Score only</button>
      </div>
      <p class="tiny">${mode === 'score'
        ? 'Just the number on each hole. Counts for scoring, the trend and the head-to-head, but sits out of strokes gained &mdash; there are no shots to measure.'
        : 'Shot by shot, which is what strokes gained needs.'}</p>
    </div>

    ${eighteens.length ? `
      <div class="card">
        <h2>Eighteen</h2>
        ${eighteens.map(optionRow).join('')}
      </div>` : ''}

    <div class="card">
      <h2>Nine</h2>
      <p class="muted">A nine after work counts as its own round, not half of one.</p>
      ${nines.map(optionRow).join('')}
    </div>

    <button class="btn-ghost" data-action="edit-course" data-id="${esc(course.id)}">Edit Scorecard</button>`;
}

/**
 * Score-only entry: the whole card on one screen.
 *
 * Every hole starts at par, so the taps go on the holes that were not
 * pars — which is most of them, but rarely by much. Faster than
 * walking hole by hole, and this is entered after the round from a
 * paper card rather than out on the course.
 */
function screenScoreCard() {
  const round = STATE.round;
  if (!round) return screenHome();
  const holes = round.holes;
  const scored = holes.filter((h) => h.score != null);
  const total = scored.reduce((sum, h) => sum + h.score, 0);
  // Only the holes with a score count toward par, so the running
  // total reads correctly part way through rather than showing the
  // whole card's par against nothing.
  const par = scored.reduce((sum, h) => sum + h.par, 0);
  const entered = scored.length;

  return `${topbar(`${round.courseName} · ${round.teeName}`)}
    ${notices()}
    <div class="card">
      <div class="split">
        <h2>Score only</h2>
        <span class="tiny">${entered}/${holes.length} holes</span>
      </div>
      <p class="muted">Scores just for the card. No shots, so this round sits out of every strokes-gained figure &mdash; it still counts for scoring, the trend and the head-to-head.</p>
      <div class="stat-grid">
        <div class="stat-box"><div class="val">${entered ? total : '&ndash;'}</div><div class="lbl">Total</div></div>
        <div class="stat-box"><div class="val">${entered ? fmtToPar(total - par) : '&ndash;'}</div><div class="lbl">To par</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-editor">
        <div class="hdr" style="grid-template-columns:26px 1fr 118px">
          <span>#</span><span>Par</span><span style="text-align:center">Score</span>
        </div>
        ${holes.map((h, i) => {
          const score = h.score;
          const diff = score == null ? null : score - h.par;
          const colour = diff == null ? 'var(--ink-faint)'
            : diff < 0 ? 'var(--green-mid)' : diff > 0 ? 'var(--flag)' : 'var(--ink)';
          return `<div class="line" style="grid-template-columns:26px 1fr 118px">
            <span class="hno">${h.hole}</span>
            <span class="tiny">par ${h.par} &middot; ${h.yards}y</span>
            <span style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
              <button class="chip" data-score-step="-1" data-hole="${i}"
                      style="min-height:36px;width:36px;padding:0;font-size:18px">&minus;</button>
              <span class="mono" style="min-width:26px;text-align:center;font-size:17px;font-weight:700;color:${colour}">${
                score == null ? '&ndash;' : score
              }</span>
              <button class="chip" data-score-step="1" data-hole="${i}"
                      style="min-height:36px;width:36px;padding:0;font-size:18px">+</button>
            </span>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="card">
      <button class="btn-flag" data-action="save-score-round" ${entered ? '' : 'disabled'}>
        Save Round${entered && entered < holes.length ? ` (${entered} holes)` : ''}
      </button>
      <div class="btn-row">
        <button class="btn-ghost" data-action="fill-par">Fill Blanks with Par</button>
        <button class="btn-danger" data-action="discard-round">Discard</button>
      </div>
    </div>`;
}

function screenPlay() {
  const round = STATE.round;
  if (!round) return screenHome();
  const hole = round.holes[STATE.holeIdx];
  const editing = STATE.editShotIdx != null && hole.shots[STATE.editShotIdx];
  const played = playedHoles(round).length;
  const pct = Math.round((played / round.holes.length) * 100);

  // When editing, the form describes the shot being changed rather
  // than the next one to be played.
  const start = editing
    ? {
      lie: hole.shots[STATE.editShotIdx].startLie,
      dist: hole.shots[STATE.editShotIdx].startDist,
      unit: hole.shots[STATE.editShotIdx].startUnit,
    }
    : lieAfter(hole);

  const shotNum = editing ? STATE.editShotIdx + 1 : hole.shots.length + 1;
  const category = classifyShot({
    shotNum,
    par: hole.par,
    startLie: start.lie,
    startDist: start.dist,
    startUnit: start.unit,
  });

  return `${topbar(`${round.courseName} · ${round.teeName}`)}
    ${notices()}
    <div class="card">
      <div class="progress">
        <button class="mono muted" data-action="toggle-hole-picker"
                style="background:none;border:none;padding:0;min-height:0;text-decoration:underline;font-size:13px">Hole ${hole.hole}/${round.holes.length}</button>
        <div class="track"><div class="fill" style="width:${pct}%"></div></div>
        <span class="mono muted">${fmtToPar(roundToPar(round))}</span>
      </div>
      ${hole.sourceNine && hole.sourceHole !== hole.hole
        ? `<p class="tiny" style="margin:-4px 0 8px">${esc(hole.sourceNine)} hole ${hole.sourceHole}</p>` : ''}
      <div class="stat-grid g4">
        <div class="stat-box"><div class="val">${hole.par}</div><div class="lbl">Par</div></div>
        <div class="stat-box"><div class="val">${hole.yards}</div><div class="lbl">Yards</div></div>
        <div class="stat-box"><div class="val">${holeScore(hole)}</div><div class="lbl">Strokes</div></div>
        <div class="stat-box"><div class="val ${sgClass(holeTotals(hole).total)}">${fmtSG(holeTotals(hole).total)}</div><div class="lbl">SG</div></div>
      </div>
    </div>

    ${STATE.holePicker ? renderHolePicker(round) : ''}

    ${hole.shots.length ? `
      <div class="card">
        <div class="split"><h3>Shots</h3>
          <button class="chip" data-action="undo-shot" style="min-height:36px;padding:6px 12px">Undo last</button>
        </div>
        <p class="tiny">Tap a shot to change or remove it. Everything after it re-links itself.</p>
        ${hole.shots.map((s, i) => renderShotLine(s, hole, i)).join('')}
      </div>` : ''}

    ${STATE.editShotIdx != null
      ? renderShotForm(hole, start, category, shotNum)
      : hole.done ? renderHoleComplete(hole) : renderShotForm(hole, start, category, shotNum)}

    ${played > 0 && !hole.done ? `
      <button class="btn-ghost" data-action="end-round">End Round Here</button>` : ''}`;
}

function renderShotLine(shot, hole, index) {
  const { category, sg } = shotSG(shot, hole.par);
  const from = `${LIE_LABELS[shot.startLie]} ${fmtDist(shot.startDist, shot.startUnit)}`;
  const to = shot.holed
    ? 'holed'
    : `${LIE_LABELS[shot.endLie]} ${fmtDist(shot.endDist, shot.endUnit)}`;
  const extras = [];
  if (shot.miss && shot.miss !== 'target') extras.push(MISS_LABELS[shot.miss]);
  if (shot.penalty) extras.push(`+${shot.penalty} pen`);
  const editing = STATE.editShotIdx === index;

  return `<button class="shot-line" data-edit-shot="${index}"
    style="width:100%;border:none;border-radius:0;background:${editing ? 'var(--cream)' : 'none'};text-align:left;min-height:0">
    <span class="desc">
      <strong class="mono">${shot.n}</strong>&nbsp; ${esc(from)} &rarr; ${esc(to)}
      <span class="tiny">${CATEGORY_SHORT[category]}${extras.length ? ' &middot; ' + esc(extras.join(' · ')) : ''}</span>
    </span>
    <span class="mono ${sgClass(sg)}">${fmtSG(sg)}</span>
  </button>`;
}

/**
 * Jump to any hole, finished or not. Getting back to a hole you
 * mis-entered was previously impossible without unwinding everything
 * after it.
 */
function renderHolePicker(round) {
  return `<div class="card">
    <div class="split">
      <h3>Jump to a hole</h3>
      <button class="chip" data-action="toggle-hole-picker" style="min-height:36px;padding:6px 12px">Close</button>
    </div>
    <div class="chip-grid" style="grid-template-columns:repeat(6,1fr)">
      ${round.holes.map((h, i) => {
        const score = holeScore(h);
        const played = h.shots.length > 0;
        return `<button class="chip ${i === STATE.holeIdx ? 'active' : ''}" data-goto-hole="${i}"
          style="flex-direction:column;gap:0;padding:6px 2px">
          ${h.hole}
          <span class="tiny" style="${i === STATE.holeIdx ? 'color:var(--cream)' : ''}">${
            played ? fmtToPar(score - h.par) : '·'
          }</span>
        </button>`;
      }).join('')}
    </div>
  </div>`;
}

/** Common yardages and putt lengths, for entry without a keypad. */
const YARD_PRESETS = [
  [20, 30, 40, 50, 60, 70],
  [80, 90, 100, 110, 120, 130],
  [140, 150, 160, 170, 180, 190],
  [200, 215, 230, 250, 275, 300],
];
const FOOT_PRESETS = [
  [1, 2, 3, 4, 5, 6],
  [8, 10, 12, 15, 18, 20],
  [25, 30, 35, 40, 50, 60],
];

function renderPresets(unit, current) {
  const rows = unit === 'ft' ? FOOT_PRESETS : YARD_PRESETS;
  return `<div class="chip-grid" style="grid-template-columns:repeat(6,1fr);gap:6px">
    ${rows.flat().map((value) => `
      <button class="chip ${String(current) === String(value) ? 'active' : ''}"
              data-preset="${value}" style="padding:8px 0;font-size:13px;min-height:40px">${value}</button>
    `).join('')}
  </div>`;
}

function renderShotForm(hole, start, category, shotNum) {
  const draft = STATE.draft;
  const editing = STATE.editShotIdx != null;
  const endLie = draft.endLie;
  const unit = endLie && endLie !== 'holed' ? unitForLie(endLie) : null;
  const needsDist = endLie && endLie !== 'holed';
  const ready = endLie && (!needsDist || isValidDist(draft.endDist));

  const startLabel = `${LIE_LABELS[start.lie]}, ${fmtDist(start.dist, start.unit)} out`;

  return `<div class="card">
    <div class="split">
      <h2>${editing ? `Edit shot ${shotNum}` : `Shot ${shotNum}`}</h2>
      <span class="tiny">${CATEGORY_LABELS[category]}</span>
    </div>
    <p class="muted">From ${esc(startLabel)}.</p>
    ${editing ? `<p class="tiny">Changing this re-links every later shot on the hole.</p>` : ''}

    <label>Where did it finish?</label>
    <div class="chip-grid">
      ${['fairway', 'rough', 'sand', 'green', 'recovery'].map((lie) => `
        <button class="chip ${endLie === lie ? 'active' : ''}" data-lie="${lie}">${LIE_LABELS[lie]}</button>
      `).join('')}
      <button class="chip flag ${endLie === 'holed' ? 'active' : ''}" data-lie="holed">Holed</button>
    </div>

    ${needsDist ? `
      <label>Distance left to the hole (${unit === 'ft' ? 'feet' : 'yards'})</label>
      <input type="number" inputmode="decimal" id="distInput" class="big-number-input"
             placeholder="${unit === 'ft' ? '18' : '120'}" value="${draft.endDist == null ? '' : esc(draft.endDist)}">
      ${store.usePresets() ? renderPresets(unit, draft.endDist) : ''}
    ` : ''}

    ${store.trackClubs() && category === 'app' ? `
      <label>Club <span class="tiny" style="text-transform:none;letter-spacing:0">optional</span></label>
      <div class="chip-grid" style="grid-template-columns:repeat(5,1fr);gap:6px">
        ${CLUBS.map((club) => `
          <button class="chip ${draft.club === club ? 'active' : ''}" data-club="${club}"
                  style="padding:8px 0;font-size:12px;min-height:40px">${club}</button>
        `).join('')}
      </div>
    ` : ''}

    ${tracksMiss(category) ? `
      <label>Where did you miss? <span class="tiny" style="text-transform:none;letter-spacing:0">optional</span></label>
      <div class="miss-grid">
        ${MISS_GRID.flat().map((dir) => `
          <button class="miss-cell ${dir === 'target' ? 'center' : ''} ${draft.miss === dir ? 'active' : ''}"
                  data-miss="${dir}">${dir === 'target' ? 'Hit it' : MISS_LABELS[dir]}</button>
        `).join('')}
      </div>` : ''}

    <label>Penalty strokes</label>
    <div class="chip-grid">
      ${[0, 1, 2].map((n) => `
        <button class="chip ${(draft.penalty || 0) === n ? 'active' : ''}" data-penalty="${n}">${n === 0 ? 'None' : '+' + n}</button>
      `).join('')}
    </div>

    <button class="btn-flag" style="margin-top:14px" id="saveShot" data-action="save-shot" ${ready ? '' : 'disabled'}>
      ${editing ? 'Update Shot' : 'Save Shot'}
    </button>
    ${editing ? `
      <div class="btn-row">
        <button class="btn-ghost" data-action="cancel-edit">Cancel</button>
        <button class="btn-danger" data-action="delete-shot">Delete Shot</button>
      </div>` : ''}
  </div>`;
}

function renderHoleComplete(hole) {
  const totals = holeTotals(hole);
  const score = holeScore(hole);
  const last = STATE.holeIdx >= STATE.round.holes.length - 1;
  return `<div class="card">
    <h2>Hole ${hole.hole} &mdash; ${score} (${fmtToPar(score - hole.par)})</h2>
    <div class="stat-grid g4">
      ${CATEGORIES.map((c) => `
        <div class="stat-box">
          <div class="val ${sgClass(totals[c])}">${fmtSG(totals[c])}</div>
          <div class="lbl">${CATEGORY_SHORT[c]}</div>
        </div>`).join('')}
    </div>
    <button class="btn-primary" style="margin-top:14px" data-action="next-hole">
      ${last ? 'Finish Round' : `Hole ${hole.hole + 1} →`}
    </button>
    <div class="btn-row">
      <button class="btn-ghost" data-action="undo-shot">Undo Last Shot</button>
    </div>
  </div>`;
}

function screenSummary() {
  const round = STATE.round || store.getRound(STATE.viewRoundId);
  if (!round) return screenHome();
  return `${topbar('Round Complete')}
    ${roundReport(round)}
    ${exportCard(round)}
    <button class="btn-primary" data-action="goto-history">Done</button>`;
}

function roundReport(round) {
  const totals = roundTotals(round);
  const score = roundScore(round);
  const holes = playedHoles(round);
  return `<div class="card">
      <h2>${esc(round.courseName)}</h2>
      <p class="muted">${fmtDate(round.date)} &middot; ${esc(round.teeName)} tees &middot; ${esc(round.player)}<br>
        ${holes.length} holes &middot; ${score} strokes (${fmtToPar(roundToPar(round))})</p>
      <div class="fairway-divider"></div>
      ${isScoreOnly(round) ? `
        <div class="stat-grid">
          <div class="stat-box"><div class="val">${score}</div><div class="lbl">Score</div></div>
          <div class="stat-box"><div class="val">${fmtToPar(roundToPar(round))}</div><div class="lbl">To par</div></div>
        </div>
        <p class="tiny" style="margin-top:10px">Score only &mdash; no shots were logged, so this round has no strokes gained and is left out of every average. It still counts for scoring and the trend.</p>
      ` : `
        <div class="stat-grid g4">
          ${CATEGORIES.map((c) => `
            <div class="stat-box">
              <div class="val ${sgClass(totals[c])}">${fmtSG(totals[c])}</div>
              <div class="lbl">${CATEGORY_SHORT[c]}</div>
            </div>`).join('')}
        </div>
        <div style="text-align:center;margin-top:14px">
          <div class="muted">Total strokes gained</div>
          <div class="display ${sgClass(totals.total)}" style="font-size:32px">${fmtSG(totals.total)}</div>
          <div class="tiny">vs. tour baseline</div>
        </div>
      `}
    </div>
    ${isScoreOnly(round) ? '' : renderRoundBreakdown(round)}

    <div class="card">
      <h2>Hole by hole</h2>
      <p class="muted">${isScoreOnly(round) ? 'Scores as entered.' : 'Tap a hole to see the shots.'}</p>
      ${holes.map((h) => {
        const t = holeTotals(h);
        const s = holeScore(h);
        const open = STATE.openHole === h.hole;
        return `<button class="row" data-open-hole="${h.hole}" style="border-radius:0;background:${open ? 'var(--cream)' : 'none'}">
            <div class="badge">${h.hole}</div>
            <div class="row-meta">
              <div class="rname">${s} on par ${h.par} <span class="tiny">(${fmtToPar(s - h.par)})</span></div>
              <div class="rsub">${h.yards}y &middot; ${h.shots.length} shots${
                h.sourceNine && h.sourceHole !== h.hole ? ` &middot; ${esc(h.sourceNine)} ${h.sourceHole}` : ''
              }</div>
            </div>
            <div class="row-val ${sgClass(t.total)}">${fmtSG(t.total)}</div>
          </button>
          ${open ? `<div style="padding:4px 0 12px 52px">
            ${h.shots.map((s2) => {
              const { category, sg } = shotSG(s2, h.par);
              const to = s2.holed ? 'holed' : `${LIE_LABELS[s2.endLie]} ${fmtDist(s2.endDist, s2.endUnit)}`;
              return `<div class="shot-line" style="padding:5px 0">
                <span class="desc tiny">${s2.n}. ${LIE_LABELS[s2.startLie]} ${fmtDist(s2.startDist, s2.startUnit)} &rarr; ${esc(to)}
                  ${s2.miss && s2.miss !== 'target' ? `&middot; ${esc(MISS_LABELS[s2.miss])}` : ''}
                  ${s2.penalty ? `&middot; +${s2.penalty} pen` : ''}</span>
                <span class="mono ${sgClass(sg)}" style="font-size:12px">${CATEGORY_SHORT[category]} ${fmtSG(sg)}</span>
              </div>`;
            }).join('')}
          </div>` : ''}`;
      }).join('')}
    </div>`;
}

/**
 * The same analysis the Stats tab gives, scoped to one round. Useful
 * for "where did this one go wrong" rather than "what is my game".
 */
function renderRoundBreakdown(round) {
  const rounds = [round];
  const holes = playedHoles(round);
  const holeCount = holes.length || 1;
  const gir = greensInRegulation(rounds);
  const tee = teeOutcomes(rounds);
  const putts = puttingBuckets(rounds);
  const buckets = approachBuckets(rounds);
  const totalPutts = putts.reduce((s, b) => s + b.putts, 0);
  const totals = roundTotals(round);

  // Which hole cost the most, and which part of the game it was.
  const worstHole = holes.reduce((worst, h) => {
    const t = holeTotals(h).total;
    return worst === null || t < holeTotals(worst).total ? h : worst;
  }, null);
  const worstCategory = CATEGORIES.reduce((a, b) => (totals[a] <= totals[b] ? a : b));

  // The same handicap read as the Stats tab, but for this round only.
  // Scaled to 18 holes so a nine is comparable, and captioned to say
  // plainly that one round is a thin sample for it.
  const scale = 18 / holeCount;
  const per18 = { total: totals.total * scale };
  CATEGORIES.forEach((c) => { per18[c] = totals[c] * scale; });
  const profile = handicapProfile(per18);

  return `${renderHandicapCard(profile, {
      subtitle: `This round on its own, scaled to 18 holes${holeCount !== 18 ? ` from ${holeCount}` : ''}.`,
      caveat: 'One round is a small sample — a hot putter or two lost balls will move these more than the Stats tab, where it averages out. Useful for reading the round; use Stats for reading the game.',
    })}

    <div class="card">
      <h2>This round</h2>
      <div class="stat-grid g4">
        <div class="stat-box"><div class="val">${gir.pct}%</div><div class="lbl">Greens</div></div>
        <div class="stat-box"><div class="val">${tee.fairwayPct}%</div><div class="lbl">Fairways</div></div>
        <div class="stat-box"><div class="val">${totalPutts}</div><div class="lbl">Putts</div></div>
        <div class="stat-box"><div class="val">${holes.length}</div><div class="lbl">Holes</div></div>
      </div>
      <p class="tiny" style="margin-top:10px">
        ${CATEGORY_LABELS[worstCategory]} cost the most at ${fmtSG(totals[worstCategory])}${
          worstHole ? `, and hole ${worstHole.hole} was the single worst at ${fmtSG(holeTotals(worstHole).total)}` : ''
        }.
      </p>
    </div>

    ${renderTeeCard(tee)}
    ${renderApproachCard(buckets)}
    ${renderPuttingCard(putts)}
    ${renderMissCard('Tee shot misses', missTally(rounds, 'ott'))}
    ${renderMissCard('Approach misses', missTally(rounds, 'app'))}`;
}

function screenHistory() {
  const everyone = STATE.historyScope === 'all';
  const rounds = everyone ? store.getRounds() : playerRounds();
  const pending = store.unsynced().length;

  return `${topbar(`${STATE.player} · Rounds`)}
    ${notices()}
    <div class="card">
      <div class="chip-grid g2">
        <button class="chip ${everyone ? '' : 'active'}" data-scope="mine">Mine</button>
        <button class="chip ${everyone ? 'active' : ''}" data-scope="all">Everyone</button>
      </div>
      ${rounds.length === 0 ? `
        <div class="empty">
          <div class="glyph">&#9971;</div>
          <div>${everyone ? 'No rounds on this device yet.' : 'No rounds logged yet.'}</div>
        </div>` : rounds.map((r) => `
        <button class="row" data-action="view-round" data-id="${esc(r.id)}">
          <div class="badge">${fmtToPar(roundToPar(r))}</div>
          <div class="row-meta">
            <div class="rname">${esc(r.courseName)}${everyone ? ` <span class="tiny">${esc(r.player)}</span>` : ''}</div>
            <div class="rsub">${fmtDate(r.date)} &middot; ${esc(r.teeName)} &middot; ${roundScore(r)} strokes${
              isScoreOnly(r) ? ' &middot; score only' : ''
            }</div>
          </div>
          <div class="row-val ${isScoreOnly(r) ? '' : sgClass(roundTotals(r).total)}">${
            isScoreOnly(r) ? '<span class="tiny">no SG</span>' : fmtSG(roundTotals(r).total)
          }</div>
        </button>`).join('')}
    </div>

    <div class="card">
      <div class="split">
        <h2>Sync</h2>
        <span class="tiny">${sync.isConfigured() ? 'connected to sheet' : 'not set up'}</span>
      </div>
      <p class="muted">
        ${sync.isConfigured()
          ? (pending
            ? `${pending} round${pending === 1 ? '' : 's'} waiting to upload.`
            : 'Everything on this device is on the sheet.')
          : 'Rounds are saved on this phone only. Connect a Google Sheet to share them.'}
      </p>
      ${STATE.syncStatus ? `<div class="${STATE.syncStatus.bad ? 'err-box' : 'ok-box'}">${esc(STATE.syncStatus.text)}</div>` : ''}
      <div class="btn-row">
        <button class="btn-ghost" data-action="goto-settings">Settings</button>
        <button class="btn-primary" data-action="sync-now" ${sync.isConfigured() && !STATE.syncBusy ? '' : 'disabled'}>
          ${STATE.syncBusy ? 'Syncing…' : 'Sync Now'}
        </button>
      </div>
      <div class="btn-row">
        <button class="btn-ghost" data-action="export">Export Backup</button>
      </div>
    </div>`;
}

function screenSettings() {
  const config = sync.getConfig();
  const pending = store.unsynced().length;

  return `${topbar('Settings')}
    ${notices()}
    <div class="card">
      <h2>Google Sheet backend</h2>
      <p class="muted">Paste the Web App URL from your Apps Script deployment and the shared secret you set on it. Setup steps are in <span class="mono">apps-script/README.md</span>.</p>

      <label>Web App URL</label>
      <input type="text" id="syncUrl" value="${esc(config.url)}" placeholder="https://script.google.com/macros/s/.../exec" autocapitalize="off" autocorrect="off" spellcheck="false">

      <label>Shared secret</label>
      <input type="password" id="syncSecret" value="${esc(config.secret)}" placeholder="the value of LEDGER_SECRET" autocapitalize="off" autocorrect="off" spellcheck="false">

      <p class="tiny">This is stored on this device only, never in the repo. It stops strangers who find the URL from reading or writing your rounds. It does not stop each other &mdash; anyone with it can post as any player.</p>

      ${sync.repointOffer() ? `
        <div class="err-box">
          A setup link opened pointing at a different sheet than this phone uses. That usually means a redeploy issued a new address and this device was left behind.
          <div class="btn-row">
            <button class="btn-ghost" data-action="accept-repoint">Use the new one</button>
            <button class="btn-ghost" data-action="dismiss-repoint">Keep this one</button>
          </div>
        </div>` : ''}

      <button class="btn-primary" style="margin-top:8px" data-action="save-sync-config">Save</button>
      <div class="btn-row">
        <button class="btn-ghost" data-action="test-sync" ${STATE.syncBusy ? 'disabled' : ''}>Test Connection</button>
        <button class="btn-ghost" data-action="setup-sheets" ${STATE.syncBusy ? 'disabled' : ''}>Create Tabs</button>
      </div>
      <div class="btn-row">
        <button class="btn-ghost" data-action="probe-backend" ${sync.hasUrl() && !STATE.syncBusy ? '' : 'disabled'}>Check Which Version</button>
        <button class="btn-ghost" data-action="cleanup-sheet" ${sync.isConfigured() && !STATE.syncBusy ? '' : 'disabled'}>Clean Up Sheet</button>
      </div>
      <p class="tiny">Clean Up Sheet removes duplicated rows and any round still sitting in the live tabs after being deleted. Safe to run any time; it reports what it found.</p>
      <p class="tiny">Check Which Version asks the URL what it is serving, without needing the passphrase. Use it when two phones disagree &mdash; if they report different contract numbers, one is pointed at an older deployment.</p>
      ${STATE.syncStatus ? `<div class="${STATE.syncStatus.bad ? 'err-box' : 'ok-box'}">${esc(STATE.syncStatus.text)}</div>` : ''}
    </div>

    <div class="card">
      <h2>This device</h2>
      <div class="stat-grid">
        <div class="stat-box"><div class="val">${store.getRounds().length}</div><div class="lbl">Rounds</div></div>
        <div class="stat-box"><div class="val">${pending}</div><div class="lbl">Unsynced</div></div>
      </div>
      <div class="btn-row">
        <button class="btn-ghost" data-action="full-pull" ${sync.isConfigured() && !STATE.syncBusy ? '' : 'disabled'}>Pull Everything</button>
        <button class="btn-ghost" data-action="push-all" ${sync.isConfigured() && !STATE.syncBusy ? '' : 'disabled'}>Push Everything</button>
      </div>
      <p class="tiny">Pull re-reads the whole sheet rather than only what changed &mdash; use it on a new phone. Push re-sends every round on this phone, which is what to reach for if a round is missing from the sheet or was written before a format change.</p>
      ${store.pendingDeletions().length ? `
        <p class="tiny sg-neg">${store.pendingDeletions().length} deleted round${store.pendingDeletions().length === 1 ? '' : 's'} still to be removed from the sheet &mdash; they go on the next sync.</p>` : ''}
    </div>

    ${sync.hasUrl() ? `
      <div class="card">
        <h2>Add another phone</h2>
        <p class="muted">Send this link to whoever is joining. Opening it points their phone at the sheet, so all they have to type is their name and the passphrase.</p>
        <button class="btn-ghost" data-action="copy-setup-link">Copy Setup Link</button>
        <p class="tiny">The link carries the sheet address only &mdash; never the passphrase. Tell them that separately, and not in the same message.</p>
      </div>` : ''}

    <div class="card">
      <h2>Appearance</h2>
      <div class="chip-grid">
        ${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([key, label]) => `
          <button class="chip ${store.getTheme() === key ? 'active' : ''}" data-set-theme="${key}">${label}</button>
        `).join('')}
      </div>
      <p class="tiny">Auto follows your phone's setting.</p>

      <label>Distance entry</label>
      <div class="chip-grid g2">
        <button class="chip ${store.usePresets() ? '' : 'active'}" data-presets="off">Keypad</button>
        <button class="chip ${store.usePresets() ? 'active' : ''}" data-presets="on">Buttons</button>
      </div>
      <p class="tiny">Buttons add common yardages and putt lengths under the keypad, for when you are pacing off a sprinkler head rather than reading a rangefinder. The keypad stays either way.</p>

      <label>Club on approaches</label>
      <div class="chip-grid g2">
        <button class="chip ${store.trackClubs() ? '' : 'active'}" data-clubs="off">Off</button>
        <button class="chip ${store.trackClubs() ? 'active' : ''}" data-clubs="on">Track</button>
      </div>
      <p class="tiny">Adds one optional tap on approach shots only &mdash; not tee shots, chips or putts. Enough to learn what each iron really goes without tripling the taps for answers you already know.</p>
    </div>

    ${sync.isConfigured() ? `
      <div class="card">
        <div class="split">
          <h2>Deleted rounds</h2>
          <span class="tiny">kept on the sheet</span>
        </div>
        <p class="muted">Deleting moves a round out of the way rather than destroying it. Anything here can come back.</p>
        ${STATE.archive === null ? `
          <button class="btn-ghost" data-action="load-archive" ${STATE.syncBusy ? 'disabled' : ''}>Show Deleted Rounds</button>
        ` : STATE.archive.length === 0 ? `
          <div class="empty" style="padding:18px"><div>Nothing deleted.</div></div>
        ` : STATE.archive.map((r) => `
          <div class="row">
            <div class="badge">${fmtToPar(r.toPar)}</div>
            <div class="row-meta">
              <div class="rname">${esc(r.courseName)} <span class="tiny">${esc(r.player)}</span></div>
              <div class="rsub">${fmtDate(r.date)} &middot; ${r.score} strokes${r.mode === 'score' ? ' &middot; score only' : ''}</div>
            </div>
            <button class="chip" data-action="restore-round" data-id="${esc(r.id)}"
                    style="min-height:38px;padding:0 14px">Restore</button>
          </div>`).join('')}
      </div>` : ''}

    <div class="card">
      <h2>Who can sign in</h2>
      <p class="muted">One name per line. Anyone on this list can sign in on this device by typing their name.</p>
      <textarea id="rosterBox" rows="${Math.max(4, store.getRoster().length + 1)}"
        style="width:100%;padding:12px;border-radius:9px;border:1.5px solid var(--green-line);background:var(--paper);font-family:inherit;font-size:16px;color:var(--ink)">${esc(store.getRoster().join('\n'))}</textarea>
      <button class="btn-ghost" style="margin-top:10px" data-action="save-roster">Save Names</button>
      <p class="tiny">This list lives on this phone, so adding a name here does not add it on anyone else's. It is identity, not a lock &mdash; what actually keeps strangers out of the data is the sheet secret above.</p>
    </div>

    <div class="card">
      <h2>Player</h2>
      <p class="muted">Signed in as ${esc(STATE.player)}.</p>
      <button class="btn-ghost" data-action="sign-out">Sign Out</button>
      ${sync.isConfigured() ? `
        <div class="btn-row">
          <button class="btn-danger" data-action="lock-device">Forget Passphrase</button>
        </div>
        <p class="tiny">Sign Out just switches player. Forget Passphrase re-locks this phone &mdash; use it if you lose it or lend it out.</p>
      ` : ''}
    </div>

    <button class="btn-ghost" data-action="goto-history">&larr; Back</button>`;
}

function screenCourseImport() {
  const preview = STATE.importPreview;

  return `${topbar('Import a Card')}
    ${notices()}
    <div class="card">
      <h2>From a photo</h2>
      <p class="muted">Photograph the scorecard, hand it to any chat along with the prompt below, and paste back what it gives you. Nothing is saved until you have looked at it.</p>
      <button class="btn-ghost" data-action="copy-prompt">Copy the Prompt</button>
    </div>

    <div class="card">
      <label>Paste the result</label>
      <textarea id="importBox" rows="8" placeholder='{ "name": "...", "tees": [...], "nines": [...] }'
        style="width:100%;padding:12px;border-radius:9px;border:1.5px solid var(--green-line);background:var(--paper);font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--ink)">${esc(STATE.importText || '')}</textarea>
      <button class="btn-primary" style="margin-top:10px" data-action="preview-import">Check It</button>
    </div>

    ${preview ? `
      <div class="card">
        <div class="split">
          <h2>${esc(preview.name)}</h2>
          <span class="tiny">${esc(preview.city || '')}</span>
        </div>
        ${preview.nines.map((nine) => `
          <div class="row">
            <div class="badge">${nine.par}</div>
            <div class="row-meta">
              <div class="rname">${esc(nine.name)}</div>
              <div class="rsub">${nine.totals.map((t) => `${esc(t.tee)} ${t.yards}y`).join(' &middot; ')}</div>
            </div>
          </div>`).join('')}
        ${preview.combos.length ? `<p class="tiny" style="margin-top:8px">Pairings: ${esc(preview.combos.join(', '))}</p>` : ''}
        <p class="tiny">Check these totals against the card before saving. It will be marked unverified until you do.</p>
        <button class="btn-primary" style="margin-top:10px" data-action="commit-import">Save This Course</button>
      </div>` : ''}

    <button class="btn-ghost" data-action="goto-courses">&larr; Back</button>`;
}

function screenDetail() {
  const round = store.getRound(STATE.viewRoundId);
  if (!round) return screenHistory();
  return `${topbar('Round Detail')}
    ${roundReport(round)}
    ${exportCard(round)}
    <div class="btn-row">
      <button class="btn-ghost" data-action="goto-history">&larr; Back</button>
      <button class="btn-danger" data-action="delete-round" data-id="${esc(round.id)}">Delete</button>
    </div>`;
}

function screenStats() {
  const allRounds = playerRounds();
  // Everything strokes-gained is computed from rounds that actually
  // carry shots. A score-only round has none, so including it would
  // dilute every average toward zero.
  const rounds = sgRounds(allRounds);
  const scoreOnlyCount = allRounds.length - rounds.length;

  if (allRounds.length === 0) {
    return `${topbar(`${STATE.player} · Stats`)}
      <div class="card">
        <div class="empty">
          <div class="glyph">&#128200;</div>
          <div>Play a round and the patterns show up here.</div>
        </div>
      </div>`;
  }

  if (rounds.length === 0) {
    return `${topbar(`${STATE.player} · Stats`)}
      ${renderTrendCard(trendSeries(allRounds), 'toPar')}
      <div class="card">
        <h2>No shot data yet</h2>
        <p class="muted">All ${allRounds.length} of your rounds are score only, so there is nothing to measure against the baseline. Track one round shot by shot and the rest of this page fills in.</p>
      </div>`;
  }

  // Normalised per 18 holes, otherwise a weekday nine would drag the
  // average toward zero purely for being short.
  const holesPlayed = rounds.reduce((sum, r) => sum + playedHoles(r).length, 0) || 1;
  const avg = {};
  CATEGORIES.forEach((c) => {
    const total = rounds.reduce((sum, r) => sum + roundTotals(r)[c], 0);
    avg[c] = (total / holesPlayed) * 18;
  });
  const avgTotal = CATEGORIES.reduce((sum, c) => sum + avg[c], 0);
  const nineCount = rounds.filter((r) => playedHoles(r).length <= 9).length;
  const buckets = approachBuckets(rounds);
  const teeMiss = missTally(rounds, 'ott');
  const appMiss = missTally(rounds, 'app');

  const profile = handicapProfile({ ...avg, total: avgTotal });
  const gir = greensInRegulation(rounds);
  const tee = teeOutcomes(rounds);
  const putts = puttingBuckets(rounds);

  return `${topbar(`${STATE.player} · Stats`)}
    ${renderHandicapCard(profile, {
      subtitle: `Across ${rounds.length} round${rounds.length === 1 ? '' : 's'}, ${holesPlayed} holes. Each part of your game translated to the handicap that normally plays it that well.`,
    })}

    ${renderTrendCard(trendSeries(allRounds))}

    <div class="card">
      <h2>The basics</h2>
      <div class="stat-grid g4">
        <div class="stat-box"><div class="val">${gir.pct}%</div><div class="lbl">Greens</div></div>
        <div class="stat-box"><div class="val">${tee.fairwayPct}%</div><div class="lbl">Fairways</div></div>
        <div class="stat-box"><div class="val">${(rounds.reduce((s, r) => s + roundScore(r), 0) / rounds.length).toFixed(1)}</div><div class="lbl">Avg score</div></div>
        <div class="stat-box"><div class="val">${(putts.reduce((s, b) => s + b.putts, 0) / holesPlayed * 18).toFixed(1)}</div><div class="lbl">Putts/18</div></div>
      </div>
      ${gir.byPar.length > 1 ? `
        <label>Greens in regulation by par</label>
        <div class="stat-grid" style="grid-template-columns:repeat(${gir.byPar.length},1fr)">
          ${gir.byPar.map((row) => `
            <div class="stat-box">
              <div class="val" style="font-size:17px">${row.pct}%</div>
              <div class="lbl">Par ${row.par}</div>
              <div class="tiny">${row.greens}/${row.holes}</div>
            </div>`).join('')}
        </div>
        ${(() => {
          // Say what these numbers actually are, then let the player's
          // own data name the strong and weak hole type. Which par is
          // hardest genuinely varies by golfer — better players tend to
          // find par 5s easiest, since the shot that has to hold the
          // green is a wedge, while a par 3 is one mid-iron with no
          // chance to recover. Asserting a general rule here was wrong.
          const ranked = gir.byPar.filter((r) => r.holes >= 3).slice().sort((a, b) => b.pct - a.pct);
          if (ranked.length < 2) {
            return `<p class="tiny" style="margin-top:6px">On in one on a par 3, two on a par 4, three on a par 5.</p>`;
          }
          const best = ranked[0];
          const worst = ranked[ranked.length - 1];
          return `<p class="tiny" style="margin-top:6px">On in one on a par 3, two on a par 4, three on a par 5.
            ${best.pct === worst.pct
              ? 'Yours are even across the three so far.'
              : `Your strongest is <strong>par ${best.par}</strong> at ${best.pct}% and your weakest <strong>par ${worst.par}</strong> at ${worst.pct}%.`}</p>`;
        })()}
      ` : ''}
    </div>

    ${renderTeeCard(tee)}
    ${renderPuttingCard(putts)}

    <div class="card">
      <h2>Average per 18 holes</h2>
      <p class="muted">Across ${rounds.length} round${rounds.length === 1 ? '' : 's'}${nineCount ? ` (${nineCount} of them nine holes)` : ''}, ${holesPlayed} holes in all.</p>
      <div class="stat-grid g4">
        ${CATEGORIES.map((c) => `
          <div class="stat-box">
            <div class="val ${sgClass(avg[c])}">${fmtSG(avg[c])}</div>
            <div class="lbl">${CATEGORY_SHORT[c]}</div>
          </div>`).join('')}
      </div>
      <div style="text-align:center;margin-top:12px">
        <span class="muted">Total </span>
        <span class="mono ${sgClass(avgTotal)}" style="font-size:18px;font-weight:700">${fmtSG(avgTotal)}</span>
      </div>
      <p class="tiny" style="margin-top:10px">Measured against a tour baseline, so negatives are expected. What matters is which column is furthest from the others.</p>
    </div>

    ${renderApproachCard(buckets)}

    ${renderMissCard('Tee shot misses', teeMiss)}
    ${renderMissCard('Approach misses', appMiss)}
    ${(() => { const cd = clubDistances(rounds); return renderClubCard(cd) + renderGappingCard(cd); })()}
    ${renderNemesisCard(rounds)}
    ${renderBestsCard(personalBests(rounds), allRounds)}
    ${renderComparison()}

    <div class="card">
      <h2>Talk your game over</h2>
      <p class="muted">Everything on this screen as one file: where the game stands, approach and putting by distance, miss patterns, club distances, the holes with a grudge, and every round you have logged. Hand it to a chat and ask what to go and practise.</p>
      <div class="btn-row">
        <button class="btn-primary" data-action="copy-career-brief">Copy for Chat</button>
        <button class="btn-ghost" data-action="export-career-brief">Save as File</button>
      </div>
      <div class="btn-row">
        <button class="btn-ghost" data-action="export-career-csv">Save Every Shot as CSV</button>
      </div>
      <p class="tiny" style="margin-top:8px">A single round exports in more detail from its own page &mdash; shot by shot, with the holes that cost the most.</p>
      ${exportStatus()}
    </div>`;
}

/**
 * Everyone's numbers side by side. Normalised per 18 holes so a
 * weekday nine compares honestly against a full Saturday round.
 */
function renderComparison() {
  const everyone = sgRounds(store.getRounds());
  const players = [...new Set(everyone.map((r) => r.player))].filter(Boolean);
  if (players.length < 2) return '';

  const rows = players.map((player) => {
    const theirs = everyone.filter((r) => r.player === player);
    const holes = theirs.reduce((sum, r) => sum + playedHoles(r).length, 0) || 1;
    const totals = {};
    CATEGORIES.forEach((c) => {
      totals[c] = (theirs.reduce((sum, r) => sum + roundTotals(r)[c], 0) / holes) * 18;
    });
    totals.total = CATEGORIES.reduce((sum, c) => sum + totals[c], 0);
    return { player, rounds: theirs.length, holes, totals };
  }).sort((a, b) => b.totals.total - a.totals.total);

  // Who is best in each category, so the strengths stand out.
  const best = {};
  CATEGORIES.forEach((c) => {
    best[c] = rows.reduce((top, row) => (row.totals[c] > top.totals[c] ? row : top), rows[0]).player;
  });

  return `<div class="card">
    <h2>Head to head</h2>
    <p class="muted">Strokes gained per 18 holes. The leader in each part of the game is marked.</p>
    <div class="card-editor">
      <div class="hdr" style="grid-template-columns:1fr repeat(4,44px) 52px">
        <span>Player</span>
        ${CATEGORIES.map((c) => `<span style="text-align:center">${CATEGORY_SHORT[c]}</span>`).join('')}
        <span style="text-align:center">Tot</span>
      </div>
      ${rows.map((row) => `
        <div class="line" style="grid-template-columns:1fr repeat(4,44px) 52px">
          <span>
            <strong>${esc(row.player)}</strong>
            <span class="tiny">${row.rounds} round${row.rounds === 1 ? '' : 's'}</span>
          </span>
          ${CATEGORIES.map((c) => `
            <span class="mono ${sgClass(row.totals[c])}" style="text-align:center;font-size:12px">
              ${fmtSG(row.totals[c])}${best[c] === row.player ? '<br><span class="tiny sg-pos">best</span>' : ''}
            </span>`).join('')}
          <span class="mono ${sgClass(row.totals.total)}" style="text-align:center;font-size:12px;font-weight:700">
            ${fmtSG(row.totals.total)}
          </span>
        </div>`).join('')}
    </div>
    <p class="tiny" style="margin-top:8px">Everyone is measured against the same tour baseline, so these compare directly even off different tees.</p>
  </div>`;
}

/**
 * Strokes gained per 18, one point per round, oldest to newest.
 *
 * Drawn as inline SVG rather than pulling in a charting library: it
 * is one line and a zero rule, it inherits the theme through CSS
 * variables, and it keeps the app dependency-free and offline.
 */
function renderTrendCard(allSeries, forcedKey) {
  const key = forcedKey || STATE.trendKey || 'total';
  // Score is the one measure a score-only round can contribute to.
  const series = key === 'toPar' ? allSeries : allSeries.filter((p) => !p.scoreOnly);
  const excluded = allSeries.length - series.length;

  if (series.length < 2) {
    return series.length === 1 || allSeries.length ? `<div class="card">
      <h2>Trend</h2>
      <p class="muted">${series.length === 1
        ? 'One round in. A second will start the line.'
        : 'No rounds with shot data yet — switch to Score to include score-only rounds.'}</p>
      ${allSeries.length > 1 ? `<div class="chip-grid" style="grid-template-columns:repeat(6,1fr);gap:6px">
        ${[['toPar', 'Score'], ['total', 'Total'], ...CATEGORIES.map((c) => [c, CATEGORY_SHORT[c]])].map(([k, label]) => `
          <button class="chip ${key === k ? 'active' : ''}" data-trend="${k}"
                  style="padding:7px 0;font-size:11px;min-height:36px">${label}</button>`).join('')}
      </div>` : ''}
    </div>` : '';
  }

  const values = series.map((p) => p[key]);
  const W = 320;
  const H = 132;
  const padL = 30;
  const padR = 8;
  const padT = 12;
  const padB = 22;

  let min = Math.min(...values, 0);
  let max = Math.max(...values, 0);
  if (max - min < 1) { min -= 0.5; max += 0.5; } // keep a flat line off the axis
  const pad = (max - min) * 0.12;
  min -= pad;
  max += pad;

  const x = (i) => padL + (i / (series.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const area = `${line} L${x(series.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;
  const zeroY = y(0).toFixed(1);

  const first = values[0];
  const last = values[values.length - 1];
  const change = last - first;
  const best = Math.max(...values);

  return `<div class="card">
    <div class="split">
      <h2>Trend</h2>
      <span class="tiny">${series.length} rounds</span>
    </div>
    <div class="chip-grid" style="grid-template-columns:repeat(6,1fr);gap:6px">
      ${[['toPar', 'Score'], ['total', 'Total'], ...CATEGORIES.map((c) => [c, CATEGORY_SHORT[c]])].map(([k, label]) => `
        <button class="chip ${key === k ? 'active' : ''}" data-trend="${k}"
                style="padding:7px 0;font-size:11px;min-height:36px">${label}</button>
      `).join('')}
    </div>

    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;margin-top:6px"
         role="img" aria-label="Strokes gained per 18 holes by round">
      <path d="${area}" fill="var(--green-mid)" opacity="0.12"></path>
      <line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}"
            stroke="var(--green-line)" stroke-width="1" stroke-dasharray="3 3"></line>
      <text x="${padL - 4}" y="${zeroY}" text-anchor="end" dominant-baseline="middle"
            font-size="9" fill="var(--ink-faint)" font-family="IBM Plex Mono, monospace">0</text>
      ${/* Skip an end label that would sit on top of the zero rule. */ ''}
      ${Math.abs(y(max) - y(0)) > 11 ? `<text x="${padL - 4}" y="${padT + 4}" text-anchor="end"
            font-size="9" fill="var(--ink-faint)" font-family="IBM Plex Mono, monospace">${max.toFixed(0)}</text>` : ''}
      ${Math.abs(y(min) - y(0)) > 11 ? `<text x="${padL - 4}" y="${H - padB}" text-anchor="end"
            font-size="9" fill="var(--ink-faint)" font-family="IBM Plex Mono, monospace">${min.toFixed(0)}</text>` : ''}
      <path d="${line}" fill="none" stroke="var(--flag)" stroke-width="2"
            stroke-linejoin="round" stroke-linecap="round"></path>
      ${series.map((p, i) => `
        <circle cx="${x(i).toFixed(1)}" cy="${y(p[key]).toFixed(1)}" r="3.5"
                fill="var(--paper)" stroke="var(--flag)" stroke-width="2"></circle>
      `).join('')}
      <text x="${padL}" y="${H - 6}" font-size="9" fill="var(--ink-faint)">${fmtShortDate(series[0].date)}</text>
      <text x="${W - padR}" y="${H - 6}" text-anchor="end" font-size="9" fill="var(--ink-faint)">${fmtShortDate(series[series.length - 1].date)}</text>
    </svg>

    <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="stat-box">
        <div class="val ${sgClass(last)}" style="font-size:16px">${fmtSG(last)}</div>
        <div class="lbl">Latest</div>
      </div>
      <div class="stat-box">
        <div class="val ${sgClass(best)}" style="font-size:16px">${fmtSG(best)}</div>
        <div class="lbl">Best</div>
      </div>
      <div class="stat-box">
        <div class="val ${sgClass(change)}" style="font-size:16px">${fmtSG(change)}</div>
        <div class="lbl">Since first</div>
      </div>
    </div>
    <p class="tiny" style="margin-top:8px">Per 18 holes, so nines sit on the same scale. Higher is better; the dashed line is ${
      key === 'toPar' ? 'level par (shown inverted, so up is still better)' : 'tour average'
    }.${excluded ? ` ${excluded} score-only round${excluded === 1 ? '' : 's'} left out — switch to Score to include ${excluded === 1 ? 'it' : 'them'}.` : ''}</p>
  </div>`;
}

function fmtShortDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* --- Shared stat cards -------------------------------------------
   These take an already-computed result rather than a set of rounds,
   so the same card serves the career view on Stats and the single
   round view on a round's detail page.
------------------------------------------------------------------ */

function renderTeeCard(tee) {
  if (!tee.total) return '';
  return `<div class="card">
    <h2>Off the tee</h2>
    <p class="muted">Where tee shots on par 4s and 5s finished, and what each outcome cost.</p>
    ${tee.rows.map((row) => `
      <div class="row" style="${thinStyle(row.count)}">
        <div class="badge" style="font-size:12px">${Math.round((row.count / tee.total) * 100)}%</div>
        <div class="row-meta">
          <div class="rname">${LIE_LABELS[row.lie] || esc(row.lie)}${thinMark(row.count)}</div>
          <div class="rsub">${row.count} of ${tee.total} tee shots</div>
        </div>
        <div class="row-val ${sgClass(row.sg / row.count)}">${fmtSG(row.sg / row.count)}</div>
      </div>`).join('')}
    <p class="tiny" style="margin-top:8px">Per-shot average. A miss that costs little is not the miss to fix.</p>
  </div>`;
}

function renderPuttingCard(putts) {
  if (!putts.length) return '';
  return `<div class="card">
    <h2>Putting</h2>
    <p class="muted">Make rate and strokes gained by distance.</p>
    ${putts.map((b) => `
      <div class="row" style="${thinStyle(b.putts)}">
        <div class="badge" style="font-size:11px">${esc(b.label)}</div>
        <div class="row-meta">
          <div class="rname">${b.putts} putt${b.putts === 1 ? '' : 's'} &middot; ${Math.round((b.holed / b.putts) * 100)}% holed${thinMark(b.putts)}</div>
          <div class="rsub">${b.threePutts ? `${b.threePutts} three-putt${b.threePutts === 1 ? '' : 's'} from here` : 'no three-putts from here'}</div>
        </div>
        <div class="row-val ${sgClass(b.sg / b.putts)}">${fmtSG(b.sg / b.putts)}</div>
      </div>`).join('')}
  </div>`;
}

/**
 * Each part of the game as the handicap that normally plays it that
 * well, with what closing the gap on the weakest one is worth.
 *
 * `caveat` carries whatever warning the calling screen needs — a
 * single round is a much smaller sample than a career, and the card
 * should say so where that applies.
 */
function renderHandicapCard(profile, { subtitle, caveat } = {}) {
  return `<div class="card">
    <h2>${profile.overall <= 0.5 ? 'You play like scratch' : `You play like a ${fmtHandicap(profile.overall)}`}</h2>
    ${subtitle ? `<p class="muted">${subtitle}</p>` : ''}
    <div class="card-editor">
      <div class="hdr" style="grid-template-columns:1fr 56px 62px 58px">
        <span>Part of the game</span>
        <span style="text-align:center">SG/18</span>
        <span style="text-align:center">Plays like</span>
        <span style="text-align:center">Upside</span>
      </div>
      ${profile.rows.map((row) => `
        <div class="line" style="grid-template-columns:1fr 56px 62px 58px">
          <span>
            <strong>${CATEGORY_LABELS[row.category]}</strong>
            <span class="tiny">${
              row.gapToOverall < -1 ? 'holding you back'
              : row.gapToOverall > 1 ? 'ahead of the rest'
              : 'in line with the rest'
            }</span>
          </span>
          <span class="mono ${sgClass(row.sg)}" style="text-align:center;font-size:12px">${fmtSG(row.sg)}</span>
          <span class="mono" style="text-align:center;font-size:13px;font-weight:700;color:${
            row.gapToOverall < -1 ? 'var(--flag)' : row.gapToOverall > 1 ? 'var(--green-mid)' : 'var(--ink-soft)'
          }">${fmtHandicap(row.handicap)}</span>
          <span class="mono tiny" style="text-align:center">${
            upsideFor(row) >= 0.1 ? '−' + upsideFor(row).toFixed(1) : '—'
          }</span>
        </div>`).join('')}
    </div>
    <p class="tiny" style="margin-top:10px">
      <strong>Upside</strong> is the strokes per 18 saved by lifting that part of the game to the level of the rest &mdash; not to scratch, just to your own standard.
      ${profile.weakest && profile.weakest.gapToOverall < -1
        ? ` Here that is <strong>${CATEGORY_LABELS[profile.weakest.category]}</strong>, worth about ${upsideFor(profile.weakest).toFixed(1)} shots.`
        : ' Fairly even across the board.'}
    </p>
    <p class="tiny">${caveat || 'The handicap conversion is a model, not a measurement. It is anchored on scoring, which is solid; the split between categories is approximate. Good for spotting the weak spot, not for arguing over a decimal.'}</p>
  </div>`;
}

/**
 * Each club's distances as a distribution, on one shared scale.
 *
 * Min and max alone say almost nothing — a club with one thin shot
 * looks identical to one that is genuinely inconsistent. The shape
 * says where the ball usually finishes and how far the tails run,
 * which is the number you actually club off.
 */
function renderClubCard(clubs) {
  if (!clubs.length) return '';

  const floor = Math.min(...clubs.map((c) => c.shortest));
  const ceiling = Math.max(...clubs.map((c) => c.longest));
  const span = Math.max(ceiling - floor, 1);
  const pos = (yards) => ((yards - floor) / span) * 100;

  return `<div class="card">
    <h2>Your clubs</h2>
    <p class="muted">Where each club actually finishes. Taller means more shots landed there; the band is the middle half, and the line is your typical.</p>

    ${clubs.map((c) => {
      const { bins, peak } = distanceHistogram(c.distances, 5);
      const bandLeft = pos(c.lowerQuartile);
      const bandWidth = Math.max(pos(c.upperQuartile) - bandLeft, 1);

      return `<div class="row" style="${thinStyle(c.shots)};align-items:flex-start">
        <div class="badge" style="font-size:12px;margin-top:6px">${esc(c.club)}</div>
        <div class="row-meta">
          <div class="split">
            <span class="rname">${Math.round(c.typical)}y typical${thinMark(c.shots)}</span>
            <span class="tiny mono">${Math.round(c.lowerQuartile)}&ndash;${Math.round(c.upperQuartile)}y &middot; ${c.shots}</span>
          </div>
          <div style="position:relative;height:26px;margin-top:3px">
            <div style="position:absolute;left:${bandLeft}%;width:${bandWidth}%;top:0;bottom:5px;
                        background:var(--green-line);opacity:0.35;border-radius:3px"></div>
            ${bins.filter((b) => b.count).map((b) => {
              const left = pos(b.from);
              const width = Math.max(pos(b.to) - left, 2);
              const height = Math.max((b.count / peak) * 20, 4);
              return `<div title="${b.from}-${b.to}y: ${b.count} shots"
                style="position:absolute;left:${left}%;width:${width}%;bottom:5px;height:${height}px;
                       background:var(--green-mid);border-radius:2px 2px 0 0;opacity:${(0.45 + (b.count / peak) * 0.55).toFixed(2)}"></div>`;
            }).join('')}
            <div style="position:absolute;left:calc(${pos(c.typical)}% - 1px);top:0;bottom:3px;width:2px;background:var(--flag)"></div>
            <div style="position:absolute;left:0;right:0;bottom:4px;height:1px;background:var(--green-line);opacity:0.6"></div>
          </div>
        </div>
      </div>`;
    }).join('')}

    <div class="split tiny" style="margin-top:4px;padding:0 2px">
      <span>${Math.round(floor)}y</span>
      <span>${Math.round(floor + span / 2)}y</span>
      <span>${Math.round(ceiling)}y</span>
    </div>
    <p class="tiny" style="margin-top:8px">All clubs share one scale, so the rows line up against each other. The figures on the right are the middle half of your shots. Typical is the middle shot rather than the average &mdash; one thinned 7-iron should not shorten the club.</p>
  </div>`;
}

/** Where the set overlaps itself, and where it leaves a hole. */
function renderGappingCard(clubs) {
  const { gaps, clubs: usable } = clubGapping(clubs, { minShots: 3 });
  if (!gaps.length) {
    return usable.length || clubs.length ? `<div class="card">
      <h2>Gapping</h2>
      <p class="muted">Once three or more shots are logged with each of two clubs, the gap between them shows up here.</p>
    </div>` : '';
  }

  const problems = gaps.filter((g) => g.verdict !== 'ok');

  return `<div class="card">
    <h2>Gapping</h2>
    <p class="muted">The step down from each club to the next, using typical distances.</p>
    ${gaps.map((g) => `
      <div class="row">
        <div class="badge" style="font-size:11px;background:${
          g.verdict === 'ok' ? 'var(--green-mid)' : 'var(--flag)'
        };color:#fff">${Math.round(g.gap)}y</div>
        <div class="row-meta">
          <div class="rname">${esc(g.longer)} to ${esc(g.shorter)}</div>
          <div class="rsub">${
            g.verdict === 'overlap' ? 'Overlapping — two clubs doing one job'
            : g.verdict === 'wide' ? 'A wide step — this distance has to be forced or eased'
            : 'A clean step'
          }</div>
        </div>
      </div>`).join('')}
    <p class="tiny" style="margin-top:8px">${problems.length
      ? `${problems.length} step${problems.length === 1 ? '' : 's'} worth a look. Lofts vary between manufacturers, so what the number on the sole says matters less than where the ball lands.`
      : 'Even steps the whole way down, which is what you want.'}</p>
  </div>`;
}

/** Holes that keep costing, and holes that keep giving. */
function renderNemesisCard(rounds) {
  const { worst, best, considered } = nemesisHoles(rounds, { minPlays: 2, count: 3 });
  if (!worst.length) {
    return considered === 0 && rounds.length ? `<div class="card">
      <h2>Hole by hole</h2>
      <p class="muted">Play the same course twice and the holes that keep costing you will show up here.</p>
    </div>` : '';
  }

  const row = (record, tone) => `
    <div class="row">
      <div class="badge" style="background:${tone === 'bad' ? 'var(--flag)' : 'var(--green-mid)'};color:#fff">
        ${record.hole}
      </div>
      <div class="row-meta">
        <div class="rname">${esc(record.courseName)}${record.nine ? ` <span class="tiny">${esc(record.nine)}</span>` : ''}</div>
        <div class="rsub">par ${record.par} &middot; ${record.plays} plays &middot; averaging ${record.avgScore.toFixed(1)}${
          tone === 'bad' ? ` &middot; mostly ${CATEGORY_LABELS[record.worstCategory].toLowerCase()}` : ''
        }</div>
      </div>
      <div class="row-val ${sgClass(record.avgSG)}">${fmtSG(record.avgSG)}</div>
    </div>`;

  return `<div class="card">
    <h2>Holes that cost you</h2>
    <p class="muted">Strokes gained per play, for holes played at least twice. The same ground counts once however many times a round visits it.</p>
    ${worst.map((r) => row(r, 'bad')).join('')}
    ${best.length && best[0].avgSG > worst[0].avgSG ? `
      <label>And holes you own</label>
      ${best.map((r) => row(r, 'good')).join('')}` : ''}
    <p class="tiny" style="margin-top:8px">${worst[0].avgSG < -0.4
      ? `${esc(worst[0].courseName)} ${worst[0].hole} is the one worth a plan &mdash; ${fmtSG(worst[0].avgSG)} a play, mostly ${CATEGORY_LABELS[worst[0].worstCategory].toLowerCase()}.`
      : 'No single hole is doing real damage, which is its own kind of good news.'}</p>
  </div>`;
}

/** Below this, a per-shot average is noise rather than a signal. */
const THIN_SAMPLE = 5;

function thinMark(count) {
  return count < THIN_SAMPLE
    ? ` <span class="tiny" style="color:var(--ink-faint)">thin</span>`
    : '';
}

function thinStyle(count) {
  return count < THIN_SAMPLE ? 'opacity:0.55' : '';
}

function renderApproachCard(buckets) {
  if (!buckets.length) return '';
  const thin = buckets.filter((b) => b.shots < THIN_SAMPLE).length;
  return `<div class="card">
    <h2>Approach play</h2>
    <p class="muted">Strokes gained and average proximity by distance. Approach starts at 30 yards &mdash; anything closer counts as short game.</p>
    ${buckets.map((b) => `
      <div class="row" style="${thinStyle(b.shots)}">
        <div class="badge" style="font-size:11px">${esc(b.label)}</div>
        <div class="row-meta">
          <div class="rname">${b.shots} shot${b.shots === 1 ? '' : 's'}${thinMark(b.shots)}</div>
          <div class="rsub">${b.proximityCount
            ? 'Avg ' + Math.round(b.proximitySum / b.proximityCount) + 'ft when on'
            : 'never finished on the green'}</div>
        </div>
        <div class="row-val ${sgClass(b.sg / b.shots)}">${fmtSG(b.sg / b.shots)}</div>
      </div>`).join('')}
    <p class="tiny" style="margin-top:8px">Per-shot average. The bucket costing most per swing is where practice pays${
      thin ? `, but ${thin === 1 ? 'the faded row has' : 'faded rows have'} under ${THIN_SAMPLE} shots &mdash; not enough to trust yet` : ''
    }.</p>
  </div>`;
}

function renderBestsCard(bests, allRounds) {
  const items = [];
  const when = (b) => `${esc(b.course)} &middot; hole ${b.hole}`;

  // Best round is about scoring, so a score-only round is eligible
  // even though it can contribute to nothing else here.
  const scoringBest = personalBests(allRounds || []).bestRound;
  if (scoringBest && (!bests.bestRound || scoringBest.toPar < bests.bestRound.toPar)) {
    bests = { ...bests, bestRound: scoringBest };
  }

  if (bests.longestDrive) {
    items.push([`${bests.longestDrive.yards}y`, 'Longest drive in play',
      `${when(bests.longestDrive)} &middot; ${LIE_LABELS[bests.longestDrive.endLie].toLowerCase()}`]);
  }
  // Only worth a second row when the longest one missed the fairway,
  // which is the whole point of the long-drive competition rule.
  if (bests.longestFairwayDrive
    && (!bests.longestDrive || bests.longestFairwayDrive.yards !== bests.longestDrive.yards)) {
    items.push([`${bests.longestFairwayDrive.yards}y`, 'Longest, fairway only',
      `${when(bests.longestFairwayDrive)} &middot; the long-drive rule`]);
  }
  if (bests.closestApproach) {
    items.push([`${Math.round(bests.closestApproach.feet)}ft`, 'Closest approach',
      `from ${bests.closestApproach.from}y &middot; ${esc(bests.closestApproach.course)}`]);
  }
  if (bests.longestPutt) {
    items.push([`${Math.round(bests.longestPutt.feet)}ft`, 'Longest putt holed', when(bests.longestPutt)]);
  }
  if (bests.longestHoleOut) {
    items.push([`${bests.longestHoleOut.yards}y`, 'Holed from off the green', when(bests.longestHoleOut)]);
  }
  if (bests.bestRound) {
    items.push([fmtToPar(bests.bestRound.toPar), 'Best round',
      `${bests.bestRound.score} at ${esc(bests.bestRound.course)}`]);
  }
  if (bests.bestSG) {
    items.push([fmtSG(bests.bestSG.sg), 'Best strokes gained',
      `${esc(bests.bestSG.course)} &middot; ${fmtShortDate(bests.bestSG.date)}`]);
  }
  if (!items.length) return '';

  return `<div class="card">
    <h2>Career bests</h2>
    ${items.map(([value, label, sub]) => `
      <div class="row">
        <div class="row-meta">
          <div class="rname">${label}</div>
          <div class="rsub">${sub}</div>
        </div>
        <div class="row-val" style="font-size:17px;color:var(--green-mid)">${value}</div>
      </div>`).join('')}
  </div>`;
}

/**
 * The miss grid, with the read-out beside it rather than empty space.
 * The grid answers "where does it go"; the panel answers "does it
 * matter", which is the part strokes gained can actually settle.
 */
function renderMissCard(title, stats) {
  const { tally, total } = stats;
  if (!total) return '';

  const cells = MISS_GRID.flat().map((dir) => {
    const count = tally[dir] || 0;
    const share = total ? Math.round((count / total) * 100) : 0;
    const strength = count ? Math.min(0.14 + (count / total) * 1.1, 1) : 0;
    const style = count
      ? `background:rgba(62,107,87,${strength.toFixed(2)});border-color:var(--green-mid)`
      : '';
    return `<div class="miss-cell ${dir === 'target' ? 'center' : ''}" style="${style}"
      title="${esc(MISS_LABELS[dir])}">
      ${count ? `<span><strong class="mono">${count}</strong><br><span class="tiny">${share}%</span></span>` : '&middot;'}
    </div>`;
  }).join('');

  const bias = (a, b, aLabel, bLabel) => {
    if (!a && !b) return null;
    if (a === b) return `even ${aLabel}/${bLabel}`;
    const total2 = a + b;
    const dominant = a > b ? aLabel : bLabel;
    const pct = Math.round((Math.max(a, b) / total2) * 100);
    return pct >= 70 ? `${pct}% ${dominant}` : `${pct}% ${dominant}, two-way`;
  };

  const sideways = bias(stats.leftCount, stats.rightCount, 'left', 'right');
  const depth = bias(stats.shortCount, stats.longCount, 'short', 'long');

  return `<div class="card">
    <h2>${esc(title)}</h2>
    <p class="muted">${total} logged. Centre is on target; darker means more often.</p>
    <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
      <div class="miss-grid" style="flex:0 0 auto;margin:0;width:190px">${cells}</div>
      <div style="flex:1 1 150px;min-width:140px">
        <div class="shot-line" style="padding:6px 0">
          <span class="desc tiny">On target</span>
          <span class="mono" style="font-size:13px;font-weight:700">${stats.onTargetPct}%</span>
        </div>
        ${sideways ? `<div class="shot-line" style="padding:6px 0">
          <span class="desc tiny">Side miss</span>
          <span class="tiny" style="font-weight:600">${esc(sideways)}</span>
        </div>` : ''}
        ${depth ? `<div class="shot-line" style="padding:6px 0">
          <span class="desc tiny">Distance</span>
          <span class="tiny" style="font-weight:600">${esc(depth)}</span>
        </div>` : ''}
        ${stats.avgOnTarget != null ? `<div class="shot-line" style="padding:6px 0">
          <span class="desc tiny">On target costs</span>
          <span class="mono ${sgClass(stats.avgOnTarget)}" style="font-size:12px">${fmtSG(stats.avgOnTarget)}</span>
        </div>` : ''}
        ${stats.avgMiss != null ? `<div class="shot-line" style="padding:6px 0">
          <span class="desc tiny">A miss costs</span>
          <span class="mono ${sgClass(stats.avgMiss)}" style="font-size:12px">${fmtSG(stats.avgMiss)}</span>
        </div>` : ''}
        ${stats.worst && stats.worstAvg != null ? `<div class="shot-line" style="padding:6px 0;border-bottom:none">
          <span class="desc tiny">Worst: ${esc(MISS_LABELS[stats.worst])}</span>
          <span class="mono ${sgClass(stats.worstAvg)}" style="font-size:12px">${fmtSG(stats.worstAvg)}</span>
        </div>` : ''}
      </div>
    </div>
    ${stats.avgOnTarget != null && stats.avgMiss != null ? `
      <p class="tiny" style="margin-top:8px">Missing costs you ${Math.abs(stats.avgOnTarget - stats.avgMiss).toFixed(2)} shots more than finding the target${
        sideways && sideways.includes('two-way') ? ', and the side miss goes both ways — that is a swing pattern rather than an aim adjustment' : ''
      }.</p>` : ''}
  </div>`;
}

/* --- Clubhouse ----------------------------------------------------
   Everyone side by side. Each row is one measure across all players,
   with the leader marked, because a column of numbers only means
   something next to somebody else's column.
------------------------------------------------------------------ */

/**
 * `better` says which direction wins, so scoring metrics (lower is
 * better) and gained metrics (higher is better) can share one table.
 */
const COMPARE_SECTIONS = [
  {
    title: 'Scoring',
    note: 'Per 18 holes, so a weekday nine compares honestly with a full round.',
    metrics: [
      { label: 'Rounds', get: (s) => s.rounds, fmt: (v) => String(v), better: null },
      { label: 'To par', get: (s) => s.toParPer18, fmt: (v) => fmtToPar(Math.round(v)), better: 'lower' },
      { label: 'Best round', get: (s) => (s.bests.bestRound ? s.bests.bestRound.toPar : null), fmt: (v) => fmtToPar(v), better: 'lower' },
    ],
  },
  {
    title: 'Strokes gained',
    note: 'Per 18 holes against the tour baseline. Score-only rounds sit this out.',
    metrics: [
      { label: 'Total', get: (s) => (s.sg ? s.sg.total : null), fmt: fmtSG, better: 'higher', strong: true },
      { label: 'Off the tee', get: (s) => (s.sg ? s.sg.ott : null), fmt: fmtSG, better: 'higher' },
      { label: 'Approach', get: (s) => (s.sg ? s.sg.app : null), fmt: fmtSG, better: 'higher' },
      { label: 'Short game', get: (s) => (s.sg ? s.sg.arg : null), fmt: fmtSG, better: 'higher' },
      { label: 'Putting', get: (s) => (s.sg ? s.sg.putt : null), fmt: fmtSG, better: 'higher' },
    ],
  },
  {
    // The same figures as above, translated to the scale golfers
    // actually think in. "My putting is a 14 and his is a 7" lands in
    // a way that "-5.01 against -5.39" does not.
    title: 'Plays like',
    note: 'Each part of the game as the handicap that normally plays it that well. Lower is better.',
    metrics: [
      { label: 'Overall', get: (s) => (s.sg ? handicapForTotal(s.sg.total) : null), fmt: fmtHandicap, better: 'lower', strong: true },
      { label: 'Off the tee', get: (s) => (s.sg ? handicapForCategory('ott', s.sg.ott) : null), fmt: fmtHandicap, better: 'lower' },
      { label: 'Approach', get: (s) => (s.sg ? handicapForCategory('app', s.sg.app) : null), fmt: fmtHandicap, better: 'lower' },
      { label: 'Short game', get: (s) => (s.sg ? handicapForCategory('arg', s.sg.arg) : null), fmt: fmtHandicap, better: 'lower' },
      { label: 'Putting', get: (s) => (s.sg ? handicapForCategory('putt', s.sg.putt) : null), fmt: fmtHandicap, better: 'lower' },
    ],
  },
  {
    title: 'The basics',
    metrics: [
      { label: 'Greens', get: (s) => s.girPct, fmt: (v) => `${v}%`, better: 'higher' },
      { label: 'Fairways', get: (s) => s.fairwayPct, fmt: (v) => `${v}%`, better: 'higher' },
      { label: 'Putts / 18', get: (s) => s.puttsPer18, fmt: (v) => v.toFixed(1), better: 'lower' },
    ],
  },
  {
    title: 'Career bests',
    metrics: [
      { label: 'Longest drive', get: (s) => (s.bests.longestDrive ? s.bests.longestDrive.yards : null), fmt: (v) => `${v}y`, better: 'higher' },
      { label: 'Closest approach', get: (s) => (s.bests.closestApproach ? s.bests.closestApproach.feet : null), fmt: (v) => `${Math.round(v)}ft`, better: 'lower' },
      { label: 'Longest putt', get: (s) => (s.bests.longestPutt ? s.bests.longestPutt.feet : null), fmt: (v) => `${Math.round(v)}ft`, better: 'higher' },
    ],
  },
];

function screenClubhouse() {
  const all = store.getRounds();
  const players = [...new Set(all.map((r) => r.player))].filter(Boolean).sort();

  if (players.length === 0) {
    return `${topbar('Clubhouse')}
      <div class="card"><div class="empty">
        <div class="glyph">&#127948;</div>
        <div>Nobody has logged a round yet.</div>
      </div></div>`;
  }

  const summaries = players.map((p) => playerSummary(p, all));
  const cols = `minmax(96px,1.3fr) repeat(${players.length}, minmax(58px,1fr))`;

  const leaderOf = (metric) => {
    if (!metric.better) return null;
    let best = null;
    summaries.forEach((s) => {
      const v = metric.get(s);
      if (v == null) return;
      if (best === null) { best = { player: s.player, v }; return; }
      const wins = metric.better === 'higher' ? v > best.v : v < best.v;
      if (wins) best = { player: s.player, v };
    });
    // A leader nobody is competing with is not a leader.
    const contenders = summaries.filter((s) => metric.get(s) != null).length;
    return contenders > 1 && best ? best.player : null;
  };

  return `${topbar('Clubhouse')}
    ${notices()}
    <div class="card">
      <h2>Everyone</h2>
      <p class="muted">${players.length} player${players.length === 1 ? '' : 's'}, ${all.length} round${all.length === 1 ? '' : 's'} between them. The leader in each row is marked.</p>
      <div style="overflow-x:auto">
        <div style="min-width:${100 + players.length * 62}px">
          <div class="card-editor">
            <div class="hdr" style="grid-template-columns:${cols}">
              <span></span>
              ${summaries.map((s) => `<span style="text-align:center">${esc(s.player)}</span>`).join('')}
            </div>
            ${COMPARE_SECTIONS.map((section) => `
              <div class="line" style="grid-template-columns:1fr;border-bottom:none;padding-top:12px">
                <span><strong style="font-size:13px">${section.title}</strong>
                  ${section.note ? `<span class="tiny">${section.note}</span>` : ''}</span>
              </div>
              ${section.metrics.map((metric) => {
                const leader = leaderOf(metric);
                return `<div class="line" style="grid-template-columns:${cols}">
                  <span class="tiny" style="font-weight:600">${metric.label}</span>
                  ${summaries.map((s) => {
                    const v = metric.get(s);
                    const isLeader = leader === s.player;
                    return `<span class="mono" style="text-align:center;font-size:${metric.strong ? '13px' : '12px'};font-weight:${isLeader || metric.strong ? 700 : 500};color:${
                      v == null ? 'var(--ink-faint)'
                        : isLeader ? 'var(--green-mid)'
                        : 'var(--ink)'
                    }">${v == null ? '&ndash;' : metric.fmt(v)}</span>`;
                  }).join('')}
                </div>`;
              }).join('')}
            `).join('')}
          </div>
        </div>
      </div>
    </div>

    ${renderClubhouseNotes(summaries)}
    ${renderSharedHoles(all, players)}`;
}

/**
 * The hole that beats each player, and any hole that beats everyone.
 *
 * A hole nobody handles is a different thing from a hole one person
 * struggles with, and the second is the one worth ribbing somebody
 * about.
 */
function renderSharedHoles(allRounds, players) {
  const perPlayer = players.map((player) => {
    const theirs = allRounds.filter((r) => r.player === player);
    const { worst } = nemesisHoles(theirs, { minPlays: 2, count: 1 });
    return { player, hole: worst[0] || null };
  }).filter((row) => row.hole);

  // Holes at least two people have played more than once.
  const shared = holeRecords(allRounds)
    .filter((r) => r.plays >= 3)
    .sort((a, b) => a.avgSG - b.avgSG)
    .slice(0, 3);

  if (!perPlayer.length && !shared.length) return '';

  return `<div class="card">
    <h2>Holes with a grudge</h2>
    ${perPlayer.length ? `
      <p class="muted">Each player's worst hole, from those they have played at least twice.</p>
      ${perPlayer.map(({ player, hole }) => `
        <div class="row">
          <div class="badge" style="background:var(--flag);color:#fff">${hole.hole}</div>
          <div class="row-meta">
            <div class="rname">${esc(player)} &mdash; ${esc(hole.courseName)}${hole.nine ? ` <span class="tiny">${esc(hole.nine)}</span>` : ''}</div>
            <div class="rsub">par ${hole.par} &middot; averaging ${hole.avgScore.toFixed(1)} over ${hole.plays} plays &middot; mostly ${CATEGORY_LABELS[hole.worstCategory].toLowerCase()}</div>
          </div>
          <div class="row-val ${sgClass(hole.avgSG)}">${fmtSG(hole.avgSG)}</div>
        </div>`).join('')}` : ''}

    ${shared.length ? `
      <label>Hardest between everyone</label>
      ${shared.map((r) => `
        <div class="row">
          <div class="badge">${r.hole}</div>
          <div class="row-meta">
            <div class="rname">${esc(r.courseName)}${r.nine ? ` <span class="tiny">${esc(r.nine)}</span>` : ''}</div>
            <div class="rsub">par ${r.par} &middot; ${r.plays} plays across the group</div>
          </div>
          <div class="row-val ${sgClass(r.avgSG)}">${fmtSG(r.avgSG)}</div>
        </div>`).join('')}` : ''}
  </div>`;
}

/** A plain-language read of who is doing what well. */
function renderClubhouseNotes(summaries) {
  const withSG = summaries.filter((s) => s.sg);
  if (withSG.length < 2) {
    return `<div class="card">
      <p class="muted">Once a second player logs a round with shots in it, this fills in with who is strongest where.</p>
    </div>`;
  }

  const lines = withSG.map((s) => {
    // Each player's own best and worst part of the game, relative to
    // the rest of their game rather than to the other players.
    const profile = handicapProfile({ ...s.sg });
    const strong = profile.strongest;
    const weak = profile.weakest;
    return `<div class="row">
      <div class="badge">${fmtHandicapShort(profile.overall)}</div>
      <div class="row-meta">
        <div class="rname">${esc(s.player)}</div>
        <div class="rsub">Strongest ${CATEGORY_LABELS[strong.category].toLowerCase()} at ${fmtHandicap(strong.handicap)}, weakest ${CATEGORY_LABELS[weak.category].toLowerCase()} at ${fmtHandicap(weak.handicap)}</div>
      </div>
      <div class="row-val ${sgClass(s.sg.total)}">${fmtSG(s.sg.total)}</div>
    </div>`;
  }).join('');

  return `<div class="card">
    <h2>Where each game stands</h2>
    <p class="muted">Each player's handicap level, and the part of their own game that is furthest ahead and furthest behind.</p>
    ${lines}
    <p class="tiny" style="margin-top:8px">Strongest and weakest are measured against that player's own standard, not against each other &mdash; a 20 handicap can have a better short game than a 5 relative to the rest of what they do.</p>
  </div>`;
}

/* --- Course management ------------------------------------------- */

function screenCourses() {
  const courses = listCourses();
  const pendingSeeds = missingSeeds(courses);
  return `${topbar('Courses')}
    ${notices()}
    <div class="card">
      <h2>Saved scorecards</h2>
      <p class="muted">Enter a course once, from every tee, and it is ready for good.</p>
      ${courses.length === 0 ? `
        <div class="empty"><div class="glyph">&#128220;</div><div>Nothing saved yet.</div></div>
      ` : courses.map((c) => `
        <button class="row" data-action="edit-course" data-id="${esc(c.id)}">
          <div class="badge">${c.nines.length * 9}</div>
          <div class="row-meta">
            <div class="rname">${esc(c.name)} ${
              isIncomplete(c) ? '<span class="tiny sg-neg">needs fixing</span>'
              : c.verified ? '<span class="tiny sg-pos">verified</span>' : ''
            }</div>
            <div class="rsub">${c.city ? esc(c.city) + ' &middot; ' : ''}${c.nines.map((n) => esc(n.name)).join(' / ')} &middot; ${esc(c.teeNames.join(', '))}</div>
          </div>
          <div class="row-val">&rsaquo;</div>
        </button>`).join('')}
      <button class="btn-primary" style="margin-top:12px" data-action="new-course">Add a Course by Hand</button>
      <div class="btn-row">
        <button class="btn-ghost" data-action="goto-import">Import from a Photo</button>
      </div>
      ${pendingSeeds.length ? `
        <div class="btn-row">
          <button class="btn-ghost" data-action="load-seeds">
            Load ${pendingSeeds.length} Saved Card${pendingSeeds.length === 1 ? '' : 's'}
          </button>
        </div>
        <p class="tiny">${esc(pendingSeeds.map((c) => c.name).join(', '))} &mdash; transcribed from the paper scorecard.</p>
      ` : ''}
    </div>`;
}

function screenCourseEdit() {
  const course = STATE.courseDraft;
  if (!course) return screenCourses();

  const nine = course.nines[STATE.courseNineIdx] || course.nines[0];
  const tee = course.teeNames[STATE.courseTeeIdx] || course.teeNames[0];
  const problems = validateNine(nine, tee);

  return `${topbar('Scorecard')}
    ${notices()}
    <div class="card">
      <label>Course name</label>
      <input type="text" id="courseName" value="${esc(course.name)}" placeholder="Gardner Golf Course">
      <label>Town</label>
      <input type="text" id="courseCity" value="${esc(course.city || '')}" placeholder="Gardner, KS">
    </div>

    <div class="card">
      <div class="split">
        <h2>Nines</h2>
        <span class="tiny">${course.nines.length * 9} holes total</span>
      </div>
      <p class="muted">One nine for a course played twice round, two for a standard eighteen, three or more for a facility like Sykes.</p>
      <div class="tee-tabs">
        ${course.nines.map((n, i) => `
          <button class="chip ${i === STATE.courseNineIdx ? 'active' : ''}" data-nine-idx="${i}">${esc(n.name)}</button>
        `).join('')}
        <button class="chip" data-action="add-nine">+ Nine</button>
      </div>
      <label>Name of this nine</label>
      <input type="text" id="nineName" value="${esc(nine.name)}" placeholder="West Links">
    </div>

    <div class="card">
      <div class="split">
        <h2>Tees</h2>
        <span class="tiny">enter one tee at a time</span>
      </div>
      <div class="tee-tabs">
        ${course.teeNames.map((name, i) => `
          <button class="chip ${i === STATE.courseTeeIdx ? 'active' : ''}" data-tee-idx="${i}">${esc(name)}</button>
        `).join('')}
        <button class="chip" data-action="add-tee">+ Tee</button>
      </div>
      <label>Name of this tee</label>
      <div class="split">
        <input type="text" id="teeName" value="${esc(tee)}" placeholder="Blue">
        ${course.teeNames.length > 1
          ? `<button class="chip" data-action="remove-tee" data-tee="${esc(tee)}" style="flex-shrink:0;padding:0 14px">Remove</button>`
          : ''}
      </div>
    </div>

    <div class="card">
      <div class="split">
        <h2>${esc(nine.name)} &middot; ${esc(tee)}</h2>
        <span class="tiny mono">par ${ninePar(nine)} &middot; ${nineYardage(nine, tee)}y</span>
      </div>
      <div class="card-editor">
        <div class="hdr"><span>#</span><span>Par</span><span>Yards</span></div>
        ${nine.holes.map((hole, i) => `
          <div class="line">
            <span class="hno">${hole.hole}</span>
            <span class="par-toggle">
              ${[3, 4, 5].map((p) => `
                <button class="${Number(hole.par) === p ? 'active' : ''}" data-par="${p}" data-hole="${i}">${p}</button>
              `).join('')}
            </span>
            <input type="number" inputmode="numeric" data-yards="${i}" value="${esc(hole.yards[tee] == null ? '' : hole.yards[tee])}">
          </div>`).join('')}
      </div>
      <p class="tiny" style="margin-top:8px">Par is shared across every tee. Yardages are per tee &mdash; switch tabs above to enter the next one.</p>
    </div>

    ${course.nines.length > 1 ? renderCombos(course) : ''}

    ${problems.length ? `<div class="err-box">${problems.slice(0, 3).map(esc).join('<br>')}</div>` : ''}

    <div class="card">
      <h2>Checked against the card?</h2>
      <p class="muted">Marks whether a person has actually compared these numbers to the paper scorecard. Anything imported from a photo starts off unchecked.</p>
      <div class="chip-grid g2">
        <button class="chip ${course.verified ? '' : 'active'}" data-verified="no">Not yet</button>
        <button class="chip ${course.verified ? 'active' : ''}" data-verified="yes">Checked</button>
      </div>
      ${course.verified ? '' : `<p class="tiny">Worth doing before you rely on the numbers &mdash; Gardner's published yardages were wrong on all nine holes.</p>`}
    </div>

    <div class="card">
      <button class="btn-primary" data-action="save-course">Save Course</button>
      <div class="btn-row">
        <button class="btn-ghost" data-action="goto-courses">Cancel</button>
        ${course.persisted ? `<button class="btn-danger" data-action="delete-course" data-id="${esc(course.id)}">Delete</button>` : ''}
      </div>
    </div>`;
}

function renderCombos(course) {
  const draft = STATE.comboDraft || {};
  return `<div class="card">
    <h2>Eighteen-hole pairings</h2>
    <p class="muted">Which nines get played together. Sykes has three of these; most courses have one.</p>
    ${course.combos.length ? course.combos.map((combo) => `
      <div class="row">
        <div class="badge">18</div>
        <div class="row-meta"><div class="rname">${esc(combo.name)}</div></div>
        <button class="chip" data-action="remove-combo" data-id="${esc(combo.id)}" style="padding:0 14px;min-height:38px">Remove</button>
      </div>`).join('') : '<p class="tiny">None yet.</p>'}

    <label>Add a pairing</label>
    <div class="chip-grid g2">
      <select id="comboFirst">
        ${course.nines.map((n) => `<option value="${esc(n.id)}" ${draft.first === n.id ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}
      </select>
      <select id="comboSecond">
        ${course.nines.map((n) => `<option value="${esc(n.id)}" ${draft.second === n.id ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}
      </select>
    </div>
    <button class="btn-ghost" data-action="add-combo">Add Pairing</button>
  </div>`;
}

/* --- Render ------------------------------------------------------ */

const SCREENS = {
  login: screenLogin,
  home: screenHome,
  setup: () => (STATE.setupCourseId ? screenPickTee() : screenSetup()),
  play: screenPlay,
  scorecard: screenScoreCard,
  summary: screenSummary,
  history: screenHistory,
  detail: screenDetail,
  settings: screenSettings,
  stats: screenStats,
  clubhouse: screenClubhouse,
  courses: screenCourses,
  courseImport: screenCourseImport,
  courseEdit: screenCourseEdit,
};

let lastScreen = null;

function render() {
  const view = SCREENS[STATE.screen] || screenHome;
  document.getElementById('app').innerHTML = view();
  document.getElementById('navbar').innerHTML = renderNav();
  bindLiveInputs();
  if (lastScreen !== STATE.screen) {
    window.scrollTo(0, 0);
    lastScreen = STATE.screen;
  }
}

/**
 * Inputs that must not trigger a re-render on every keystroke.
 * The distance field updates STATE and re-evaluates the Save button
 * directly; re-rendering here would drop focus and close the keyboard.
 */
function bindLiveInputs() {
  const dist = document.getElementById('distInput');
  if (dist) {
    dist.oninput = (e) => {
      STATE.draft.endDist = e.target.value;
      const save = document.getElementById('saveShot');
      if (save) save.disabled = !isValidDist(e.target.value);
    };
  }

  const courseName = document.getElementById('courseName');
  if (courseName) {
    courseName.oninput = (e) => { STATE.courseDraft.name = e.target.value; };
  }

  const loginPass = document.getElementById('loginPass');
  if (loginPass) {
    loginPass.oninput = (e) => { STATE.passDraft = e.target.value; };
  }

  const loginName = document.getElementById('loginName');
  if (loginName) {
    loginName.oninput = (e) => { STATE.loginDraft = e.target.value; };
    // The name is the last field either way, so Enter submits.
    loginName.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); ACTIONS['sign-in'](); }
    };
    if (!loginPass || STATE.passDraft) loginName.focus();
    else loginPass.focus();
  }

  const importBox = document.getElementById('importBox');
  if (importBox) {
    importBox.oninput = (e) => { STATE.importText = e.target.value; };
  }

  const courseCity = document.getElementById('courseCity');
  if (courseCity) {
    courseCity.oninput = (e) => { STATE.courseDraft.city = e.target.value; };
  }

  // Renames apply on blur rather than per keystroke: a tee rename has
  // to migrate its yardage key across every nine, and doing that on
  // each character would shred the data halfway through a word.
  const nineName = document.getElementById('nineName');
  if (nineName) {
    nineName.onchange = (e) => {
      const name = e.target.value.trim();
      if (name) STATE.courseDraft.nines[STATE.courseNineIdx].name = name;
      render();
    };
  }

  const teeName = document.getElementById('teeName');
  if (teeName) {
    teeName.onchange = (e) => {
      renameTee(STATE.courseDraft, STATE.courseTeeIdx, e.target.value.trim());
      render();
    };
  }

  const comboFirst = document.getElementById('comboFirst');
  if (comboFirst) {
    comboFirst.onchange = (e) => {
      STATE.comboDraft = { ...(STATE.comboDraft || {}), first: e.target.value };
    };
  }

  const comboSecond = document.getElementById('comboSecond');
  if (comboSecond) {
    comboSecond.onchange = (e) => {
      STATE.comboDraft = { ...(STATE.comboDraft || {}), second: e.target.value };
    };
  }

  const syncUrl = document.getElementById('syncUrl');
  if (syncUrl) {
    syncUrl.oninput = (e) => { STATE.syncDraft = { ...syncDraft(), url: e.target.value.trim() }; };
  }

  const syncSecret = document.getElementById('syncSecret');
  if (syncSecret) {
    syncSecret.oninput = (e) => { STATE.syncDraft = { ...syncDraft(), secret: e.target.value.trim() }; };
  }

  document.querySelectorAll('[data-yards]').forEach((input) => {
    input.oninput = (e) => {
      const idx = Number(input.getAttribute('data-yards'));
      const tee = STATE.courseDraft.teeNames[STATE.courseTeeIdx];
      STATE.courseDraft.nines[STATE.courseNineIdx].holes[idx].yards[tee] = e.target.value;
    };
  });
}

/** Rename a tee everywhere at once, carrying its yardages with it. */
function renameTee(course, teeIdx, nextName) {
  const previous = course.teeNames[teeIdx];
  const name = nextName.trim();
  if (!name || name === previous || course.teeNames.includes(name)) return;

  course.teeNames[teeIdx] = name;
  course.nines.forEach((nine) => {
    nine.holes.forEach((hole) => {
      hole.yards[name] = hole.yards[previous];
      delete hole.yards[previous];
    });
  });
}

function syncDraft() {
  return STATE.syncDraft || sync.getConfig();
}

function isValidDist(value) {
  if (value === '' || value == null) return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

/* --- Actions ----------------------------------------------------- */

/** A course from storage, padded into a shape the screens can render. */
function safeCourse(id) {
  const course = store.getCourse(id);
  return course ? repairCourse(course) : null;
}

/** Where an in-progress round should resume: shot entry or the card. */
function activeScreen() {
  if (!STATE.round || isRoundComplete(STATE.round)) return 'home';
  return isScoreOnly(STATE.round) ? 'scorecard' : 'play';
}

function playerRounds() {
  return store.getRounds().filter((r) => r.player === STATE.player);
}

function go(screen, extra = {}) {
  STATE.error = null;
  STATE.notice = null;
  STATE.exportStatus = null;
  Object.assign(STATE, extra, { screen });
  render();
}

function saveShot() {
  const hole = STATE.round.holes[STATE.holeIdx];
  const editIdx = STATE.editShotIdx;
  const editing = editIdx != null;
  const start = editing
    ? { lie: hole.shots[editIdx].startLie, dist: hole.shots[editIdx].startDist }
    : lieAfter(hole);
  const draft = STATE.draft;
  const holed = draft.endLie === 'holed';

  const shot = newShot({
    shotNum: editing ? editIdx + 1 : hole.shots.length + 1,
    startLie: start.lie,
    startDist: Number(start.dist),
    endLie: holed ? null : draft.endLie,
    endDist: holed ? null : Number(draft.endDist),
    holed,
    penalty: Number(draft.penalty || 0),
    miss: draft.miss || null,
    club: draft.club || null,
  });

  if (editing) {
    hole.shots[editIdx] = shot;
    // Holing out mid-hole ends it; anything logged after is void.
    if (holed) hole.shots.length = editIdx + 1;
    STATE.editShotIdx = null;
  } else {
    hole.shots.push(shot);
  }

  relinkHole(hole);
  STATE.draft = {};
  store.saveActiveRound(STATE.round);
  render();
}

function deleteShot() {
  const hole = STATE.round.holes[STATE.holeIdx];
  const idx = STATE.editShotIdx;
  if (idx == null) return;
  hole.shots.splice(idx, 1);
  relinkHole(hole);
  STATE.editShotIdx = null;
  STATE.draft = {};
  store.saveActiveRound(STATE.round);
  render();
}

/** Load an existing shot back into the form for editing. */
function beginEditShot(index) {
  const hole = STATE.round.holes[STATE.holeIdx];
  const shot = hole.shots[index];
  if (!shot) return;
  STATE.editShotIdx = index;
  STATE.draft = {
    endLie: shot.holed ? 'holed' : shot.endLie,
    endDist: shot.holed ? null : shot.endDist,
    penalty: shot.penalty || 0,
    miss: shot.miss || null,
    club: shot.club || null,
  };
  render();
}

function undoShot() {
  const hole = STATE.round.holes[STATE.holeIdx];
  if (!hole.shots.length) return;
  hole.shots.pop();
  hole.done = false;
  STATE.draft = {};
  store.saveActiveRound(STATE.round);
  render();
}

function nextHole() {
  if (STATE.holeIdx >= STATE.round.holes.length - 1) return finishRound();
  STATE.holeIdx += 1;
  STATE.draft = {};
  store.saveActiveRound(STATE.round);
  render();
}

function finishRound() {
  const round = STATE.round;
  round.finishedAt = new Date().toISOString();
  store.saveRound(round);
  store.clearActiveRound();
  STATE.viewRoundId = round.id;
  STATE.round = null;
  go('summary', { viewRoundId: round.id });
  // The round is already saved locally; this just tries to get it
  // onto the sheet while the phone probably has signal again.
  sync.syncInBackground(null, { force: true });
}

function startRound(optionKey) {
  const course = safeCourse(STATE.setupCourseId);
  const option = findPlayOption(course, optionKey);
  const tee = STATE.setupTee || course.teeNames[0];
  if (!option) {
    STATE.error = 'That layout is no longer on the scorecard.';
    render();
    return;
  }

  // Only validate the nines actually being played — a half-filled
  // third nine should not block a round on the other two.
  const problems = [];
  option.nineIds.forEach((id) => {
    const nine = course.nines.find((n) => n.id === id);
    if (nine) problems.push(...validateNine(nine, tee));
  });
  if (problems.length) {
    STATE.error = problems[0] + ' Fix the scorecard before starting.';
    render();
    return;
  }

  const mode = STATE.setupMode || 'full';
  STATE.round = newRound({
    player: STATE.player,
    courseId: course.id,
    courseName: course.name,
    teeName: tee,
    layout: option.label,
    holes: buildRoundHoles(course, option, tee),
    mode,
  });
  STATE.holeIdx = 0;
  STATE.draft = {};
  STATE.setupCourseId = null;
  store.saveActiveRound(STATE.round);
  go(mode === 'score' ? 'scorecard' : 'play');
}

function saveCourseDraft() {
  const course = STATE.courseDraft;

  course.nines.forEach((nine) => {
    nine.holes.forEach((hole) => {
      hole.par = Number(hole.par);
      course.teeNames.forEach((tee) => {
        const value = hole.yards[tee];
        hole.yards[tee] = value === '' || value == null ? '' : Number(value);
      });
    });
  });

  if (!course.name || !course.name.trim()) {
    STATE.error = 'Give the course a name first.';
    return render();
  }

  // Only the tee on screen has to be complete. Saving a card one tee
  // at a time is the whole point — the rest can be filled in later.
  const problems = [];
  const tee = course.teeNames[STATE.courseTeeIdx];
  course.nines.forEach((nine) => problems.push(...validateNine(nine, tee)));
  if (problems.length) {
    STATE.error = problems[0];
    return render();
  }

  // findDuplicate excludes the course's own id, so editing an existing
  // card never trips this — only a genuinely second copy does.
  const clash = findDuplicate(course);
  if (clash && clash.kind === 'identical' && !STATE.courseForce) {
    STATE.courseForce = true;
    STATE.error = `Every hole matches ${clash.course.name}, which is already saved. Press Save again if you really want a second copy.`;
    return render();
  }

  course.persisted = true;
  upsertCourse(course);
  go('courses', {
    courseDraft: null,
    courseForce: false,
    notice: `Saved ${course.name}. ${tee} tees are complete.`,
  });
  // Get it onto the sheet now. Without this a new course sat on one
  // phone until something unrelated happened to trigger a sync.
  sync.syncInBackground(null, { force: true });
}

/** Hands the browser a file it did not fetch from anywhere. */
function download(text, filename, type) {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportData() {
  download(
    JSON.stringify(store.exportAll(), null, 2),
    `ledger-backup-${new Date().toISOString().slice(0, 10)}.json`,
    'application/json',
  );
}

/**
 * Builds an export and either saves it or puts it on the clipboard.
 *
 * Both routes exist because the two devices want different things.
 * On a desktop a file is the point — it gets dragged into a chat. On
 * a phone, saving to Files and then finding it again is three screens
 * of detour when the destination is a text box one app away, so Copy
 * is the faster path and is offered first.
 */
function runExport(build, { copy = false } = {}) {
  const done = (text, bad = false) => { STATE.exportStatus = { text, bad }; render(); };
  try {
    const { text, filename, type } = build();
    if (!copy) {
      download(text, filename, type);
      return done(`Saved ${filename}.`);
    }
    navigator.clipboard.writeText(text).then(
      () => done('Copied. Paste it into a chat and start asking questions.'),
      () => {
        // Clipboard access is refused in plenty of contexts, and a
        // failure there is no reason to lose the export.
        download(text, filename, type);
        done(`Could not copy, so it was saved as ${filename} instead.`);
      },
    );
  } catch (err) {
    done(err.message, true);
  }
}

/** The result of the last export, shown beside the buttons. */
function exportStatus() {
  if (!STATE.exportStatus) return '';
  const { text, bad } = STATE.exportStatus;
  return `<div class="${bad ? 'err-box' : 'ok-box'}" style="margin-top:10px">${esc(text)}</div>`;
}

/**
 * The round being exported, whether it is the one on screen or one
 * being reopened from history.
 */
function roundById(id) {
  const round = (STATE.round && STATE.round.id === id) ? STATE.round : store.getRound(id);
  if (!round) throw new Error('That round is no longer on this device.');
  return round;
}

function exportOneRound(id, options = {}) {
  runExport(() => {
    const round = roundById(id);
    return {
      text: roundBrief(round, { history: store.getRounds().filter((r) => r.player === round.player) }),
      filename: roundFilename(round, 'md'),
      type: 'text/markdown',
    };
  }, options);
}

function exportCareer(options = {}) {
  runExport(() => ({
    text: careerBrief(STATE.player, playerRounds()),
    filename: careerFilename(STATE.player, 'md'),
    type: 'text/markdown',
  }), options);
}

/**
 * The card that gets a round out of the app and into a conversation.
 *
 * The app can say approach play cost four shots. It cannot answer
 * "why did 14 fall apart" or "what am I playing to without the two
 * blow-ups", because that is a conversation. This packs the round up
 * with its conventions written down so the conversation starts from
 * the real numbers instead of guesses.
 */
function exportCard(round) {
  const scoreOnly = isScoreOnly(round);
  return `<div class="card">
    <h2>Talk this round over</h2>
    <p class="muted">Writes the whole round out as a briefing &mdash; every shot, what each one cost, the holes that did the damage, and what the round looks like without them. Hand it to any chat and ask it questions.</p>
    <div class="btn-row">
      <button class="btn-primary" data-action="copy-round-brief" data-id="${esc(round.id)}">Copy for Chat</button>
      <button class="btn-ghost" data-action="export-round-brief" data-id="${esc(round.id)}">Save as File</button>
    </div>
    ${scoreOnly ? `<p class="tiny" style="margin-top:8px">This round is score only, so the briefing carries the card and nothing else. There are no shots to break down.</p>`
      : `<div class="btn-row">
      <button class="btn-ghost" data-action="export-round-csv" data-id="${esc(round.id)}">Save Shots as CSV</button>
    </div>
    <p class="tiny" style="margin-top:8px">The briefing is written to be read. The CSV is one row per shot for a spreadsheet, or for anything that would rather count than read.</p>`}
    ${exportStatus()}
  </div>`;
}

/**
 * Runs a sync operation with the button disabled and the outcome
 * reported inline. Nothing here is on a path the user has to wait
 * for — the data is already safe locally before any of it runs.
 */
async function runSync(label, operation) {
  STATE.syncBusy = true;
  STATE.syncStatus = null;
  // Clear any leftover save confirmation so the result is the only
  // message on screen.
  STATE.notice = null;
  STATE.error = null;
  render();
  try {
    const message = await operation();
    STATE.syncStatus = { text: message, bad: false };
  } catch (err) {
    STATE.syncStatus = { text: `${label} failed. ${err.message}`, bad: true };
  } finally {
    STATE.syncBusy = false;
    render();
  }
}

const ACTIONS = {
  'goto-settings': () => go('settings', { syncDraft: null, archive: null }),

  'save-sync-config': () => {
    const draft = syncDraft();
    if (!draft.url || !draft.secret) {
      STATE.error = 'Both the URL and the secret are needed.';
      return render();
    }
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(draft.url)) {
      STATE.error = 'That does not look like a deployed Web App URL. It should end in /exec.';
      return render();
    }
    sync.setConfig({ url: draft.url, secret: draft.secret });
    go('settings', { syncDraft: null, notice: 'Saved. Test the connection next.' });
  },

  'test-sync': () => runSync('Connection test', async () => {
    await sync.ping();
    return 'Connected. The backend answered.';
  }),

  'setup-sheets': () => runSync('Tab setup', async () => {
    const result = await sync.setupSheets();
    return `Ready. Tabs: ${result.sheets.join(', ')}.`;
  }),

  'sync-now': () => runSync('Sync', async () => {
    const result = await sync.syncAll();
    if (result.errors.length) throw new Error(result.errors.join(' '));
    const bits = [`pushed ${result.pushed}`, `pulled ${result.pulled}`];
    if (result.deleted) bits.push(`removed ${result.deleted}`);
    return bits.join(', ') + ` round${result.pulled === 1 && result.pushed === 1 ? '' : 's'}.`;
  }),

  'probe-backend': () => runSync('Version check', async () => {
    const info = await sync.probe();
    return `Contract ${info.contract || 'unknown'} — ${(info.actions || []).length} actions. Compare this number with the other phones.`;
  }),

  'accept-repoint': () => {
    sync.acceptRepoint();
    go('settings', { syncDraft: null, notice: 'Pointed at the new sheet. Enter the passphrase to unlock it.' });
  },

  'dismiss-repoint': () => {
    sync.dismissRepoint();
    go('settings', { syncDraft: null });
  },

  'load-archive': () => runSync('Loading deleted rounds', async () => {
    STATE.archive = await sync.listArchive();
    return STATE.archive.length
      ? `${STATE.archive.length} deleted round${STATE.archive.length === 1 ? '' : 's'} on the sheet.`
      : 'Nothing has been deleted.';
  }),

  'restore-round': (el) => {
    const id = el.getAttribute('data-id');
    runSync('Restore', async () => {
      await sync.restoreRound(id);
      STATE.archive = await sync.listArchive();
      return 'Round restored.';
    });
  },

  'push-all': () => runSync('Push', async () => {
    const result = await sync.pushAll();
    return `Re-sent ${result.pushed} round${result.pushed === 1 ? '' : 's'} to the sheet.`;
  }),

  'full-pull': () => runSync('Pull', async () => {
    // Deletions first, or a full pull hands back the very rounds this
    // phone has just deleted.
    await sync.pushDeletions();
    await sync.pullCourses();
    const result = await sync.pullRounds({ full: true });
    return `Pulled ${result.added} new round${result.added === 1 ? '' : 's'} of ${result.seen} on the sheet.`;
  }),

  'cleanup-sheet': () => runSync('Clean up', async () => {
    const r = await sync.cleanup();
    const fixed = (r.duplicateRounds || 0) + (r.duplicateShots || 0) + (r.unarchivedGhosts || 0);
    if (!fixed) return `Nothing to fix. ${r.rounds} rounds, ${r.shots} shot rows.`;
    const bits = [];
    if (r.unarchivedGhosts) bits.push(`${r.unarchivedGhosts} deleted round${r.unarchivedGhosts === 1 ? '' : 's'} still showing as live`);
    if (r.duplicateRounds) bits.push(`${r.duplicateRounds} duplicate round${r.duplicateRounds === 1 ? '' : 's'}`);
    if (r.duplicateShots) bits.push(`${r.duplicateShots} duplicate shot row${r.duplicateShots === 1 ? '' : 's'}`);
    return `Removed ${bits.join(', ')}. Now ${r.rounds} rounds, ${r.shots} shot rows.`;
  }),

  'sign-out': () => {
    store.clearPlayer();
    STATE.player = null;
    STATE.round = null;
    go('login');
  },

  'sign-in': async () => {
    const typed = (document.getElementById('loginName') || {}).value || STATE.loginDraft;
    const matched = store.matchPlayer(typed);
    if (!matched) {
      STATE.loginDraft = typed;
      STATE.error = 'That name is not set up on this device.';
      return render();
    }

    // Check the passphrase before letting anyone in, when one is due.
    if (sync.needsPassphrase()) {
      const pass = (document.getElementById('loginPass') || {}).value || STATE.passDraft;
      if (!pass) {
        STATE.loginDraft = typed;
        STATE.error = 'The passphrase is needed to unlock this device.';
        return render();
      }
      STATE.loginDraft = typed;
      STATE.passDraft = pass;
      STATE.syncBusy = true;
      STATE.error = null;
      render();
      try {
        await sync.unlock(pass);
      } catch (err) {
        STATE.syncBusy = false;
        STATE.passDraft = '';
        STATE.error = `Not unlocked. ${err.message}`;
        return render();
      }
      STATE.syncBusy = false;
    }

    STATE.player = matched;
    STATE.loginDraft = '';
    STATE.passDraft = '';
    store.setPlayer(matched);
    loadActiveRound();
    go(activeScreen());
    sync.clearSetupParam();
    sync.syncInBackground(refreshIfIdle, { force: true });
  },

  'copy-setup-link': async () => {
    const link = sync.setupLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      go('settings', { notice: 'Setup link copied. Send the passphrase separately.' });
    } catch (err) {
      go('settings', { notice: `Copy this: ${link}` });
    }
  },

  'lock-device': () => {
    if (!confirm('Forget the passphrase on this phone? You will need it again to sign in.')) return;
    sync.lock();
    store.clearPlayer();
    STATE.player = null;
    STATE.round = null;
    go('login', { notice: null });
  },
  resume: () => go(activeScreen()),
  'discard-round': () => {
    if (!confirm('Discard the round in progress? This cannot be undone.')) return;
    store.clearActiveRound();
    STATE.round = null;
    go('home');
  },
  'goto-setup': () => go('setup', { setupCourseId: null }),
  'goto-history': () => go('history'),
  'goto-courses': () => go('courses', { courseDraft: null }),
  'pick-course': (el) => go('setup', {
    setupCourseId: el.getAttribute('data-id'), setupTee: null,
  }),
  'start-round': (el) => startRound(el.getAttribute('data-option')),
  'fill-par': () => {
    STATE.round.holes.forEach((h) => { if (h.score == null) h.score = h.par; });
    store.saveActiveRound(STATE.round);
    render();
  },

  'save-score-round': () => {
    const played = STATE.round.holes.filter((h) => h.score != null).length;
    if (!played) return;
    if (played < STATE.round.holes.length
      && !confirm(`Only ${played} holes have a score. Save it as a ${played}-hole round?`)) return;
    finishRound();
  },

  'save-shot': saveShot,
  'delete-shot': deleteShot,
  'cancel-edit': () => { STATE.editShotIdx = null; STATE.draft = {}; render(); },
  'toggle-hole-picker': () => { STATE.holePicker = !STATE.holePicker; render(); },
  'undo-shot': undoShot,
  'next-hole': nextHole,
  'end-round': () => {
    if (!confirm('End the round here and save it?')) return;
    finishRound();
  },
  'view-round': (el) => go('detail', { viewRoundId: el.getAttribute('data-id') }),
  'delete-round': (el) => {
    if (!confirm('Delete this round permanently?')) return;
    store.deleteRound(el.getAttribute('data-id'));
    go('history');
  },
  'goto-import': () => go('courseImport', { importText: '', importPreview: null, importForce: false }),

  /*
   * Exports. The briefing is built against the player's other rounds
   * so it can say whether this was a bad round or a bad round *for
   * them*, which is the more useful sentence and the one the app on
   * its own never gets to make.
   */
  'copy-round-brief': (el) => exportOneRound(el.getAttribute('data-id'), { copy: true }),
  'export-round-brief': (el) => exportOneRound(el.getAttribute('data-id')),

  'export-round-csv': (el) => {
    const round = roundById(el.getAttribute('data-id'));
    runExport(() => ({
      text: shotsCsv([round]),
      filename: roundFilename(round, 'csv'),
      type: 'text/csv',
    }));
  },

  'copy-career-brief': () => exportCareer({ copy: true }),
  'export-career-brief': () => exportCareer(),

  'export-career-csv': () => {
    const player = STATE.player;
    runExport(() => ({
      text: shotsCsv(playerRounds()),
      filename: careerFilename(player, 'csv'),
      type: 'text/csv',
    }));
  },

  'copy-prompt': async () => {
    try {
      await navigator.clipboard.writeText(EXTRACTION_PROMPT);
      go('courseImport', { notice: 'Prompt copied. Paste it into a chat with your photo.' });
    } catch (err) {
      // Clipboard access is blocked in some contexts; show it instead
      // so the prompt is still reachable.
      STATE.importText = EXTRACTION_PROMPT;
      STATE.error = 'Could not copy automatically — the prompt is in the box below, copy it from there.';
      render();
    }
  },

  'preview-import': () => {
    const text = (document.getElementById('importBox') || {}).value || STATE.importText;
    STATE.importText = text;
    try {
      const course = parseCourseText(text);
      STATE.importCourse = course;
      STATE.importPreview = describeCourse(course);
      STATE.error = null;
      STATE.notice = null;
    } catch (err) {
      STATE.importCourse = null;
      STATE.importPreview = null;
      STATE.error = err.message;
    }
    render();
  },

  'commit-import': () => {
    if (!STATE.importCourse) return;
    const course = STATE.importCourse;

    // Two phones both importing the same card would otherwise give you
    // two entries in the picker and split the stats between them.
    const clash = findDuplicate(course);
    if (clash && !STATE.importForce) {
      STATE.importForce = true;
      STATE.error = clash.kind === 'identical'
        ? `Every hole matches ${clash.course.name}, which is already saved. Save again only if you meant to.`
        : `A course called ${clash.course.name} is already saved, but the numbers differ. Save as a second course, or go and fix that one instead.`;
      return render();
    }

    upsertCourse(course);
    go('courses', {
      importText: '', importPreview: null, importCourse: null, importForce: false,
      notice: `Saved ${course.name}. Open it and mark it checked once you have compared it to the card.`,
    });
    sync.syncInBackground(null, { force: true });
  },

  'save-roster': () => {
    const box = document.getElementById('rosterBox');
    if (!box) return;
    const names = box.value.split('\n');
    store.setRoster(names);
    go('settings', { notice: `Names saved: ${store.getRoster().join(', ')}.` });
  },

  'load-seeds': () => {
    const pending = missingSeeds(listCourses());
    pending.forEach((course) => upsertCourse(cloneSeed(course)));
    go('courses', {
      notice: `Loaded ${pending.map((c) => c.name).join(', ')}.`,
    });
  },

  'new-course': () => go('courseEdit', {
    courseDraft: newCourse(''), courseTeeIdx: 0, courseNineIdx: 0, comboDraft: null,
  }),

  'edit-course': (el) => {
    const course = safeCourse(el.getAttribute("data-id"));
    if (!course) return;
    go('courseEdit', {
      courseDraft: JSON.parse(JSON.stringify({ ...course, persisted: true })),
      courseTeeIdx: 0,
      courseNineIdx: 0,
      comboDraft: null,
    });
  },

  'add-tee': () => {
    const name = prompt('Name of the tee (Blue, White, Red, Forward…)');
    if (!name) return;
    if (STATE.courseDraft.teeNames.includes(name.trim())) {
      STATE.error = `There is already a ${name.trim()} tee.`;
      return render();
    }
    addTee(STATE.courseDraft, name);
    STATE.courseTeeIdx = STATE.courseDraft.teeNames.length - 1;
    render();
  },

  'remove-tee': (el) => {
    const tee = el.getAttribute('data-tee');
    if (!confirm(`Remove the ${tee} tee and its yardages?`)) return;
    removeTee(STATE.courseDraft, tee);
    STATE.courseTeeIdx = 0;
    render();
  },

  'add-nine': () => {
    const name = prompt('Name of the nine (West Links, Back…)');
    if (!name) return;
    addNine(STATE.courseDraft, name.trim());
    STATE.courseNineIdx = STATE.courseDraft.nines.length - 1;
    render();
  },

  'add-combo': () => {
    const course = STATE.courseDraft;
    const draft = STATE.comboDraft || {};
    const first = draft.first || course.nines[0].id;
    const second = draft.second || course.nines[0].id;
    const combo = newCombo(course, first, second);
    if (course.combos.some((c) => c.nineIds.join() === combo.nineIds.join())) {
      STATE.error = 'That pairing is already listed.';
      return render();
    }
    course.combos.push(combo);
    go('courseEdit', { comboDraft: null });
  },

  'remove-combo': (el) => {
    const id = el.getAttribute('data-id');
    STATE.courseDraft.combos = STATE.courseDraft.combos.filter((c) => c.id !== id);
    render();
  },
  'save-course': saveCourseDraft,
  'delete-course': (el) => {
    if (!confirm('Delete this course? Saved rounds are not affected.')) return;
    store.deleteCourse(el.getAttribute('data-id'));
    go('courses', { courseDraft: null });
  },
  export: exportData,
};

function onClick(event) {
  const target = event.target.closest('[data-action],[data-nav],[data-lie],[data-miss],[data-penalty],[data-tee-idx],[data-nine-idx],[data-setup-tee],[data-par],[data-scope],[data-verified],[data-edit-shot],[data-goto-hole],[data-preset],[data-club],[data-set-theme],[data-presets],[data-clubs],[data-open-hole],[data-trend],[data-setup-mode],[data-score-step]');
  if (!target) return;

  const verified = target.getAttribute('data-verified');
  if (verified !== null) {
    STATE.courseDraft.verified = verified === 'yes';
    return render();
  }

  const trend = target.getAttribute('data-trend');
  if (trend) { STATE.trendKey = trend; return render(); }

  const openHole = target.getAttribute('data-open-hole');
  if (openHole !== null) {
    const n = Number(openHole);
    STATE.openHole = STATE.openHole === n ? null : n;
    return render();
  }

  const editShot = target.getAttribute('data-edit-shot');
  if (editShot !== null) return beginEditShot(Number(editShot));

  const gotoHole = target.getAttribute('data-goto-hole');
  if (gotoHole !== null) {
    STATE.holeIdx = Number(gotoHole);
    STATE.holePicker = false;
    STATE.editShotIdx = null;
    STATE.draft = {};
    store.saveActiveRound(STATE.round);
    return render();
  }

  const club = target.getAttribute('data-club');
  if (club) {
    STATE.draft.club = STATE.draft.club === club ? null : club;
    return render();
  }

  const preset = target.getAttribute('data-preset');
  if (preset !== null) {
    STATE.draft.endDist = preset;
    return render();
  }

  const theme = target.getAttribute('data-set-theme');
  if (theme) { store.setPref('theme', theme); applyTheme(); return render(); }

  const clubsPref = target.getAttribute('data-clubs');
  if (clubsPref) { store.setPref('clubs', clubsPref === 'on'); return render(); }

  const presets = target.getAttribute('data-presets');
  if (presets) { store.setPref('presets', presets === 'on'); return render(); }

  const scope = target.getAttribute('data-scope');
  if (scope) {
    STATE.historyScope = scope;
    return render();
  }

  const nav = target.getAttribute('data-nav');
  if (nav) {
    // Tapping Play during a round returns you to the hole you are on,
    // rather than the start-a-round screen.
    if (nav === 'home' && STATE.round && !isRoundComplete(STATE.round)) return go(activeScreen());
    return go(nav);
  }

  const lie = target.getAttribute('data-lie');
  if (lie) {
    // Changing lie can change the unit (green is feet, everything else
    // yards). Carrying the old number across would silently reinterpret
    // 140 yards as 140 feet, so drop it whenever the unit shifts.
    const prev = STATE.draft.endLie;
    const unitChanged = prev && prev !== 'holed' && lie !== 'holed'
      && unitForLie(prev) !== unitForLie(lie);
    STATE.draft.endLie = lie;
    if (lie === 'holed' || unitChanged) STATE.draft.endDist = null;
    return render();
  }

  const miss = target.getAttribute('data-miss');
  if (miss) {
    STATE.draft.miss = STATE.draft.miss === miss ? null : miss;
    return render();
  }

  const penalty = target.getAttribute('data-penalty');
  if (penalty !== null) {
    STATE.draft.penalty = Number(penalty);
    return render();
  }

  const setupMode = target.getAttribute('data-setup-mode');
  if (setupMode) {
    STATE.setupMode = setupMode;
    return render();
  }

  const scoreStep = target.getAttribute('data-score-step');
  if (scoreStep !== null) {
    const hole = STATE.round.holes[Number(target.getAttribute('data-hole'))];
    // First tap on an untouched hole lands on par, then adjusts from there.
    const current = hole.score == null ? hole.par : hole.score + Number(scoreStep);
    hole.score = Math.max(1, Math.min(20, current));
    store.saveActiveRound(STATE.round);
    return render();
  }

  const setupTee = target.getAttribute('data-setup-tee');
  if (setupTee) {
    STATE.setupTee = setupTee;
    return render();
  }

  const teeIdx = target.getAttribute('data-tee-idx');
  if (teeIdx !== null) {
    STATE.courseTeeIdx = Number(teeIdx);
    return render();
  }

  const nineIdx = target.getAttribute('data-nine-idx');
  if (nineIdx !== null) {
    STATE.courseNineIdx = Number(nineIdx);
    return render();
  }

  const par = target.getAttribute('data-par');
  if (par !== null) {
    const holeIdx = Number(target.getAttribute('data-hole'));
    STATE.courseDraft.nines[STATE.courseNineIdx].holes[holeIdx].par = Number(par);
    return render();
  }

  const action = target.getAttribute('data-action');
  if (action && ACTIONS[action]) ACTIONS[action](target);
}

/* --- Boot -------------------------------------------------------- */

function loadActiveRound() {
  const active = store.getActiveRound();
  if (active && active.player === STATE.player) {
    STATE.round = active;
    const next = nextUnplayedHole(active);
    STATE.holeIdx = next === null ? active.holes.length - 1 : next;
  } else {
    STATE.round = null;
    STATE.holeIdx = 0;
  }
}

/** Paint the chosen theme, or follow the phone when set to auto. */
function applyTheme() {
  const choice = store.getTheme();
  const dark = choice === 'dark'
    || (choice === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0e1412' : '#173b2e');
}

function init() {
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (store.getTheme() === 'auto') applyTheme();
  });

  document.body.addEventListener('click', onClick);

  // A setup link points this device at the sheet before anything else
  // runs, so the first login already knows to ask for the passphrase.
  sync.applySetupLink();

  STATE.player = store.getPlayer();
  if (STATE.player) {
    loadActiveRound();
    STATE.screen = activeScreen();
  } else {
    STATE.screen = 'login';
  }
  render();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Opportunistic catch-up. Reopening the app is the important one:
  // without it, somebody else's round only turned up on the next
  // sign-in, which meant waiting a long time to see it.
  sync.syncInBackground(refreshIfIdle, { force: true });
  window.addEventListener('online', () => sync.syncInBackground(refreshIfIdle, { force: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync.syncInBackground(refreshIfIdle);
  });
}

/** Re-render after a background sync, but never mid shot-entry. */
function refreshIfIdle(result) {
  if (!result || (!result.pulled && !result.pushed)) return;
  if (STATE.screen === 'play' || STATE.screen === 'courseEdit') return;
  render();
}

init();
