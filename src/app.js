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
  isRoundComplete,
  nextUnplayedHole,
  relinkHole,
  approachBuckets,
  puttingBuckets,
  teeOutcomes,
  greensInRegulation,
  missTally,
} from './model.js';

import * as store from './storage.js';
import * as sync from './sync.js';
import { missingSeeds, cloneSeed } from './seed.js';
import { EXTRACTION_PROMPT, parseCourseText, describeCourse } from './import.js';
import { handicapProfile, fmtHandicap, upsideFor } from './handicap.js';

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
  viewRoundId: null,
  loginDraft: '',
  importText: '',
  importPreview: null,
  importCourse: null,
  historyScope: 'mine',
  holePicker: false,
  openHole: null,
  editShotIdx: null,
  syncBusy: false,
  syncStatus: null,
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
  { key: 'courses', label: 'Courses' },
];

const NAV_GROUPS = {
  home: ['home', 'setup', 'play', 'summary'],
  history: ['history', 'detail', 'settings'],
  stats: ['stats'],
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

  return `${topbar(course.name)}
    ${notices()}
    <div class="card">
      <h2>Tees</h2>
      <div class="chip-grid">
        ${course.teeNames.map((name) => `
          <button class="chip ${name === tee ? 'active' : ''}" data-setup-tee="${esc(name)}">${esc(name)}</button>
        `).join('')}
      </div>
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
    </div>
    ${renderRoundBreakdown(round)}

    <div class="card">
      <h2>Hole by hole</h2>
      <p class="muted">Tap a hole to see the shots.</p>
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

  return `<div class="card">
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
            <div class="rsub">${fmtDate(r.date)} &middot; ${esc(r.teeName)} &middot; ${roundScore(r)} strokes</div>
          </div>
          <div class="row-val ${sgClass(roundTotals(r).total)}">${fmtSG(roundTotals(r).total)}</div>
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

      <button class="btn-primary" style="margin-top:8px" data-action="save-sync-config">Save</button>
      <div class="btn-row">
        <button class="btn-ghost" data-action="test-sync" ${STATE.syncBusy ? 'disabled' : ''}>Test Connection</button>
        <button class="btn-ghost" data-action="setup-sheets" ${STATE.syncBusy ? 'disabled' : ''}>Create Tabs</button>
      </div>
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
      </div>
      <p class="tiny">Pull Everything re-reads the whole sheet, rather than only what changed since the last sync. Use it on a new phone.</p>
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
    </div>

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
    <div class="btn-row">
      <button class="btn-ghost" data-action="goto-history">&larr; Back</button>
      <button class="btn-danger" data-action="delete-round" data-id="${esc(round.id)}">Delete</button>
    </div>`;
}

function screenStats() {
  const rounds = playerRounds();
  if (rounds.length === 0) {
    return `${topbar(`${STATE.player} · Stats`)}
      <div class="card">
        <div class="empty">
          <div class="glyph">&#128200;</div>
          <div>Play a round and the patterns show up here.</div>
        </div>
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
    <div class="card">
      <h2>You play like a ${fmtHandicap(profile.overall)}</h2>
      <p class="muted">Across ${rounds.length} round${rounds.length === 1 ? '' : 's'}, ${holesPlayed} holes. Each part of your game translated to the handicap that normally plays it that well.</p>
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
        <strong>Upside</strong> is the strokes per 18 you would save by lifting that part of the game to the level of the rest &mdash; not to scratch, just to your own standard.
        ${profile.weakest && profile.weakest.gapToOverall < -1
          ? ` Right now that is <strong>${CATEGORY_LABELS[profile.weakest.category]}</strong>, worth about ${upsideFor(profile.weakest).toFixed(1)} shots.`
          : ' Your game is fairly even across the board.'}
      </p>
      <p class="tiny">The handicap conversion is a model, not a measurement. It is anchored on scoring, which is solid; the split between categories is approximate. Good for spotting the weak spot, not for arguing over a decimal.</p>
    </div>

    <div class="card">
      <h2>The basics</h2>
      <div class="stat-grid g4">
        <div class="stat-box"><div class="val">${gir.pct}%</div><div class="lbl">Greens</div></div>
        <div class="stat-box"><div class="val">${tee.fairwayPct}%</div><div class="lbl">Fairways</div></div>
        <div class="stat-box"><div class="val">${(rounds.reduce((s, r) => s + roundScore(r), 0) / rounds.length).toFixed(1)}</div><div class="lbl">Avg score</div></div>
        <div class="stat-box"><div class="val">${(putts.reduce((s, b) => s + b.putts, 0) / holesPlayed * 18).toFixed(1)}</div><div class="lbl">Putts/18</div></div>
      </div>
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
    ${renderComparison()}`;
}

/**
 * Everyone's numbers side by side. Normalised per 18 holes so a
 * weekday nine compares honestly against a full Saturday round.
 */
function renderComparison() {
  const everyone = store.getRounds();
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
      <div class="row">
        <div class="badge" style="font-size:12px">${Math.round((row.count / tee.total) * 100)}%</div>
        <div class="row-meta">
          <div class="rname">${LIE_LABELS[row.lie] || esc(row.lie)}</div>
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
      <div class="row">
        <div class="badge" style="font-size:11px">${esc(b.label)}</div>
        <div class="row-meta">
          <div class="rname">${b.putts} putt${b.putts === 1 ? '' : 's'} &middot; ${Math.round((b.holed / b.putts) * 100)}% holed</div>
          <div class="rsub">${b.threePutts ? `${b.threePutts} three-putt${b.threePutts === 1 ? '' : 's'} from here` : 'no three-putts from here'}</div>
        </div>
        <div class="row-val ${sgClass(b.sg / b.putts)}">${fmtSG(b.sg / b.putts)}</div>
      </div>`).join('')}
  </div>`;
}

function renderApproachCard(buckets) {
  if (!buckets.length) return '';
  return `<div class="card">
    <h2>Approach play</h2>
    <p class="muted">Strokes gained and average proximity by distance.</p>
    ${buckets.map((b) => `
      <div class="row">
        <div class="badge" style="font-size:11px">${esc(b.label)}</div>
        <div class="row-meta">
          <div class="rname">${b.shots} shot${b.shots === 1 ? '' : 's'}</div>
          <div class="rsub">${b.proximityCount
            ? 'Avg ' + Math.round(b.proximitySum / b.proximityCount) + 'ft when on'
            : 'never finished on the green'}</div>
        </div>
        <div class="row-val ${sgClass(b.sg / b.shots)}">${fmtSG(b.sg / b.shots)}</div>
      </div>`).join('')}
    <p class="tiny" style="margin-top:8px">Per-shot average. The bucket costing most per swing is where practice pays.</p>
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
  summary: screenSummary,
  history: screenHistory,
  detail: screenDetail,
  settings: screenSettings,
  stats: screenStats,
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

function playerRounds() {
  return store.getRounds().filter((r) => r.player === STATE.player);
}

function go(screen, extra = {}) {
  STATE.error = null;
  STATE.notice = null;
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

  STATE.round = newRound({
    player: STATE.player,
    courseId: course.id,
    courseName: course.name,
    teeName: tee,
    layout: option.label,
    holes: buildRoundHoles(course, option, tee),
  });
  STATE.holeIdx = 0;
  STATE.draft = {};
  STATE.setupCourseId = null;
  store.saveActiveRound(STATE.round);
  go('play');
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

function exportData() {
  const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
  'goto-settings': () => go('settings', { syncDraft: null }),

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
    return `Pushed ${result.pushed}, pulled ${result.pulled} round${result.pulled === 1 ? '' : 's'}.`;
  }),

  'full-pull': () => runSync('Pull', async () => {
    await sync.pullCourses();
    const result = await sync.pullRounds({ full: true });
    return `Pulled ${result.added} new round${result.added === 1 ? '' : 's'} of ${result.seen} on the sheet.`;
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
    go(STATE.round && !isRoundComplete(STATE.round) ? 'play' : 'home');
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
  resume: () => go('play'),
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
  const target = event.target.closest('[data-action],[data-nav],[data-lie],[data-miss],[data-penalty],[data-tee-idx],[data-nine-idx],[data-setup-tee],[data-par],[data-scope],[data-verified],[data-edit-shot],[data-goto-hole],[data-preset],[data-set-theme],[data-presets],[data-open-hole]');
  if (!target) return;

  const verified = target.getAttribute('data-verified');
  if (verified !== null) {
    STATE.courseDraft.verified = verified === 'yes';
    return render();
  }

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

  const preset = target.getAttribute('data-preset');
  if (preset !== null) {
    STATE.draft.endDist = preset;
    return render();
  }

  const theme = target.getAttribute('data-set-theme');
  if (theme) { store.setPref('theme', theme); applyTheme(); return render(); }

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
    if (nav === 'home' && STATE.round && !isRoundComplete(STATE.round)) return go('play');
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
    STATE.screen = STATE.round && !isRoundComplete(STATE.round) ? 'play' : 'home';
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
