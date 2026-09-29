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
  BENCHMARKS,
  benchmarkLabel,
} from './baseline.js';

import {
  newRound,
  newShot,
  lieAfter,
  shotSG,
  holeTotals,
  roundTotals,
  holeScore,
  roundReview,
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
  approachGreen,
  greenVerdict,
  GREEN_BANDS,
  puttingBuckets,
  teeOutcomes,
  greensInRegulation,
  trendSeries,
  personalBests,
  playerSummary,
  nemesisHoles,
  clubDistances,
  shortGameStats,
  distanceHistogram,
  clubGapping,
  suggestClub,
  stepClub,
  implausibleShot,
  holeRecords,
  missTally,
  groupLeaderboard,
} from './model.js';

import {
  roundBrief,
  careerBrief,
  shotsCsv,
  roundFilename,
  careerFilename,
} from './brief.js';

import {
  sgByCategoryChart,
  approachByDistanceChart,
  rollingMean,
} from './charts.js';

import {
  KINDS,
  KIND_LABELS,
  PRACTICE_TYPES,
  WEEKDAYS,
  newTeeTime,
  cleanInvitees,
  playersOf,
  visibleTeeTimes,
  newInvites,
  describeTeeTime,
  monthGrid,
  monthLabel,
  calendarIndex,
  todayKey,
  fmtDateKey,
  fmtTime,
  isValidTime,
  daysFromToday,
  toICS,
} from './schedule.js';

import * as store from './storage.js';
import * as sync from './sync.js';
import { missingSeeds, cloneSeed } from './seed.js';
import { EXTRACTION_PROMPT, parseCourseText, describeCourse } from './import.js';
import { recapData, drawRecap, shareRecap } from './recap.js';
import { practiceFocus, bookedFocus, gameProfile } from './practice.js';
import { standings } from './standings.js';
import { AVATARS, isAvatar, avatarSvg, emojiOf, emojiAvatar } from './avatars.js';
import { planRepair, describePlan } from './repair.js';
import {
  handicapProfile, fmtHandicap, fmtHandicapShort, upsideFor,
  handicapForTotal, handicapForCategory,
  rollingImplied, impliedHandicaps, fmtImplied, fmtImpliedShort, MIN_CATEGORY_SHOTS,
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
  yardageWarnings,
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
  trendSmooth: true,     // rolling average laid over the trend line
  calYear: null,         // month on show; null means "this month"
  calMonth: null,
  calDay: null,          // day whose detail is open
  teeTimeDraft: null,    // tee time being created or edited
  viewTeeTimeId: null,
  missMode: 'count',     // miss grid shaded by frequency, or by cost
  greenBand: 'all',      // distance chip on the approach green view
  repairPlan: null,      // previewed scorecard repair, before anything is written
  repairCourseId: null,
  rosterState: null,     // what the last roster read managed, shown at the gate
  setupPaste: '',        // a setup link pasted in by hand at the gate
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

/**
 * A visible build marker.
 *
 * Bump it whenever a deploy needs to be told apart from the one before
 * it on somebody else's phone. "Is he on the new version" turned into
 * an hour of guesswork twice, once because a fix genuinely had not
 * arrived and once because it had; a four-character string at the
 * bottom of the sign-in screen answers it in a text message.
 */
const BUILD = '2026-09-26t';

/* --- Benchmark ---------------------------------------------------
   Which standard strokes gained is measured against on this device.

   Read fresh on every call rather than cached in STATE, because it is
   a stored preference and a re-render is the only thing that has to
   see it change. Nothing recomputed against it is written anywhere:
   the shot rows are the record, the benchmark is how they are read.
------------------------------------------------------------------ */

function bench() {
  return store.getBenchmark();
}

function benchName() {
  return benchmarkLabel(bench()).toLowerCase();
}

/**
 * The one-line reminder of which standard is in force. Every screen
 * showing a strokes-gained figure carries one, because the number is
 * meaningless without it — the same round reads −18 against tour and
 * +2 against a 20 handicap, and both are true.
 */
function benchNote() {
  return `Measured against a <strong>${esc(benchName())}</strong> baseline.`;
}

/** The compact picker that sits on any screen full of SG figures. */
function benchPicker() {
  const current = bench();
  return `<div class="chip-grid" style="grid-template-columns:repeat(6,1fr);gap:6px">
    ${BENCHMARKS.map((b) => `
      <button class="chip ${current === b.key ? 'active' : ''}" data-benchmark="${esc(b.key)}"
              style="padding:7px 0;font-size:11px;min-height:36px"
              aria-pressed="${current === b.key}">${esc(b.short)}</button>
    `).join('')}
  </div>`;
}

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

/*
 * What a strokes-gained figure means, in a word, so nobody has to know
 * that −0.04 is fine. Thresholds depend on what the number covers: a
 * tenth of a shot is nothing over a round and a lot on one swing.
 */
const SG_SCALE = {
  shot: { near: 0.05, small: 0.15 },
  hole: { near: 0.05, small: 0.2 },
  round: { near: 0.5, small: 2 },
};

function sgVerdict(v, per = 'shot') {
  const { near, small } = SG_SCALE[per];
  if (v > near) return { word: 'gaining', cls: 'sg-pos' };
  if (v >= -near) return { word: 'about even', cls: 'sg-zero' };
  if (v >= -small) return { word: 'a little behind', cls: 'sg-neg' };
  return { word: 'costing strokes', cls: 'sg-neg' };
}

/** A right-hand row value: the SG figure with its word underneath. */
function sgValue(v, per = 'shot', style = '') {
  const { word, cls } = sgVerdict(v, per);
  return `<div class="row-val ${cls}" style="text-align:right;${style}">${fmtSG(v)}<div class="sg-word">${word}</div></div>`;
}

function fmtToPar(diff) {
  if (diff === 0) return 'E';
  return diff > 0 ? '+' + diff : '−' + Math.abs(diff);
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

/*
 * Five tabs, icons only, with the current one opening into a pill that
 * carries its name. Courses lost its tab: it is opened when starting a
 * round, or from Settings, which is when anybody actually needs it.
 */
const NAV_ICON_PATHS = {
  home: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  history: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
  stats: '<path d="M5 20v-8M12 20V5M19 20v-11"/>',
  clubhouse: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6"/>',
};

const NAV = [
  { key: 'home', label: 'Play' },
  { key: 'calendar', label: 'Diary' },
  { key: 'history', label: 'Rounds' },
  { key: 'stats', label: 'Stats' },
  { key: 'clubhouse', label: 'Club' },
];

const NAV_GROUPS = {
  home: ['home', 'setup', 'play', 'scorecard', 'summary'],
  calendar: ['calendar', 'teeTime', 'teeTimeEdit'],
  history: ['history', 'detail', 'settings', 'repair'],
  stats: ['stats'],
  clubhouse: ['clubhouse', 'player'],
};

/** Course screens belong to whichever tab opened them. */
function navGroupOf(screen) {
  if (['courses', 'courseEdit', 'courseImport'].includes(screen)) {
    return courseHome() === 'setup' ? 'home' : 'history';
  }
  return NAV.find((tab) => NAV_GROUPS[tab.key].includes(screen))?.key || null;
}

function renderNav() {
  // Hidden mid-hole: the shot buttons sit where the tab bar would.
  if (STATE.screen === 'login' || STATE.screen === 'play') return '';
  const current = navGroupOf(STATE.screen);
  return NAV.map((tab) => {
    const active = tab.key === current;
    const icon = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NAV_ICON_PATHS[tab.key]}</svg>`;
    return `<button class="navbtn ${active ? 'active' : ''}" data-nav="${tab.key}" aria-label="${tab.label}"${active ? ' aria-current="page"' : ''}>
      ${icon}${active ? `<span>${tab.label}</span>` : ''}
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
      ${STATE.notice ? `<div class="ok-box">${esc(STATE.notice)}</div>` : ''}
      ${STATE.error ? `<div class="err-box">${esc(STATE.error)}</div>` : ''}
      ${STATE.error && STATE.rosterState ? `<p class="tiny">Player list: ${
        STATE.rosterState.unconfigured
          ? 'not connected to a sheet — using the names built into the app'
          : STATE.rosterState.error
            ? `could not be read (${esc(STATE.rosterState.error)})`
            : STATE.rosterState.empty
              ? 'reached the sheet, but the players tab is empty'
              : `${STATE.rosterState.count} name${STATE.rosterState.count === 1 ? '' : 's'} read from the sheet`
      }. Show this line to Chris if it keeps happening.</p>` : ''}

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
    </div>

    ${!sync.hasUrl() ? `
      <div class="card">
        <h2>Connect this device</h2>
        <p class="muted">This one has no sheet behind it, so it only knows the names built into the app and nothing you log here will reach anybody else.</p>
        <p class="tiny">Opening a setup link usually does this for you. It does not survive <strong>Add to Home Screen</strong> on an iPhone &mdash; the icon launches the app's own start address and drops the part of the link that matters, and a home-screen app keeps its own storage separate from Safari. So paste the link here instead.</p>

        <label>Setup link</label>
        <input type="text" id="setupPaste" placeholder="Paste the whole link Chris sent you"
               value="${esc(STATE.setupPaste || '')}"
               autocapitalize="off" autocorrect="off" spellcheck="false">
        <button class="btn-ghost" style="margin-top:10px" data-action="connect-device">Connect</button>
        <p class="tiny">The link carries the sheet address only, never the passphrase &mdash; you will be asked for that next.</p>
      </div>` : ''}

    <p class="tiny" style="text-align:center">Build ${BUILD}${
      isStandalone() ? ' · home screen' : ' · browser tab'
    }</p>

    ${isStandalone() === false ? `
      <div class="card">
        <h2>Adding it to your home screen</h2>
        <p class="muted">The home screen version keeps its own data, separate from this browser tab. Whichever one you sign into is the one to keep using.</p>
        <p class="tiny">iPhone: Share, then Add to Home Screen. Android: the browser menu, then Install or Add to Home screen.</p>
        <p class="tiny"><strong>On an iPhone the icon will not inherit the setup link.</strong> It launches the app's own start address, which drops the part of the link that points at the sheet, and the icon's storage is separate from this tab's &mdash; so it opens knowing nothing. Copy the link Chris sent you, open the app from the icon, and paste it into <em>Connect this device</em> there. That is the whole of it, once.</p>
      </div>` : ''}`;
}

function screenHome() {
  const round = STATE.round;
  const resumable = round && !isRoundComplete(round);
  const rounds = playerRounds();
  const today = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  return `${topbar(`${STATE.player} · ${today}`)}
    ${notices()}
    ${renderInviteBanner()}
    ${renderScheduleBanner()}
    ${resumable ? `
      <div class="card">
        <div class="eyebrow">Round in progress</div>
        <h2 style="margin:6px 0 4px">${esc(round.courseName)}</h2>
        <p class="mono" style="font-size:11px;color:var(--text-2);margin:0">${esc(round.teeName).toUpperCase()} TEES &middot; THRU ${playedHoles(round).length} &middot; ${fmtToPar(roundToPar(round))}</p>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn-danger" data-action="discard-round">Discard Round</button>
        </div>
      </div>` : ''}
    ${renderBook()}
    ${renderDiaryStrip()}
    ${rounds.length ? '' : `
      <div class="card">
        <div class="eyebrow">How this works</div>
        <p class="muted" style="margin-top:8px">Every shot is measured against the strokes a tour player would expect to need from the same lie and distance. Beat that number and you gain; fall short and you lose. Totals break down into tee shots, approaches, short game and putting &mdash; so you can see which part of the round actually cost you.</p>
      </div>`}
    <div class="dock-space"></div>
    <div class="dock">
      ${resumable
        ? `<button class="btn-primary" data-action="resume">Continue &middot; Hole ${STATE.holeIdx + 1} &rarr;</button>`
        : `<button class="btn-primary" data-action="goto-setup">Start a round &rarr;</button>`}
    </div>`;
}

/**
 * Where the course screens hand back to. Courses has no tab of its
 * own: opened from New Round it returns there, from Settings it
 * returns to the full list.
 */
function courseHome() {
  return STATE.courseReturn === 'setup' ? 'setup' : 'courses';
}

function screenSetup() {
  const courses = listCourses();
  return `${topbar('New Round')}
    ${notices()}
    <div class="card">
      <div class="split">
        <h2>Choose a course</h2>
        ${courses.length ? '<button class="link-btn" data-action="new-course">+ Add course</button>' : ''}
      </div>
      ${courses.length === 0 ? `
        <div class="empty">
          <div class="glyph">&#9971;</div>
          <div>No courses saved yet. Add a scorecard once and it is there for good.</div>
        </div>
        <button class="btn-primary" data-action="new-course">Add a Course</button>
      ` : `
        ${courses.map((c) => `
          <div class="row" style="padding:0">
            <button class="row" style="flex:1;border:none" data-action="pick-course" data-id="${esc(c.id)}">
              <div class="badge">${c.nines.length * 9}</div>
              <div class="row-meta">
                <div class="rname">${esc(c.name)}</div>
                <div class="rsub">${isIncomplete(c) ? '<span class="sg-neg">needs fixing</span>' : esc(c.teeNames.join(' · '))}</div>
              </div>
            </button>
            <button class="link-btn muted-link" data-action="edit-course" data-id="${esc(c.id)}">Edit</button>
          </div>
        `).join('')}
      `}
    </div>
    <p class="tiny" style="text-align:center">Every course, plus importing from a photo, is also under Rounds &rsaquo; Settings &rsaquo; Courses.</p>`;
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

/* --- Shot entry ----------------------------------------------------
   One hole on one screen: the hole drawn as a ruler from tee to pin
   with the ball's path on it, the shots so far as ruled rows, then the
   form for the next one with its two buttons in thumb reach. The tab
   bar is hidden here — mid-hole is not the moment to wander off.
------------------------------------------------------------------ */

const LIE_CODES = { tee: 'TEE', fairway: 'FWY', rough: 'RGH', sand: 'SND', recovery: 'TRB', green: 'GRN' };

/** A distance as yards from the pin, whatever unit it was logged in. */
function yardsToPin(dist, unit) {
  return unit === 'ft' ? Number(dist) / 3 : Number(dist);
}

function screenPlay() {
  const round = STATE.round;
  if (!round) return screenHome();
  const hole = round.holes[STATE.holeIdx];
  const editing = STATE.editShotIdx != null && hole.shots[STATE.editShotIdx];
  const played = playedHoles(round).length;

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
  const showForm = STATE.editShotIdx != null || !hole.done;
  // A new approach arrives with a club already picked from the
  // distance, so logging the shot is enough to record it. `undefined`
  // means untouched; a club cleared on purpose is null and stays so.
  const draft = STATE.draft;
  // Off the tee of a par 4 or 5 that is driver; a par 3 tee shot is an
  // approach, so it gets the club for the yardage like any other.
  if (showForm && !editing && store.trackClubs() && (category === 'app' || category === 'ott')
      && draft.club === undefined && start.unit === 'y') {
    const bag = store.getBag(STATE.player);
    draft.club = category === 'ott'
      ? (bag.includes('Dr') ? 'Dr' : bag[0])
      : suggestClub(Number(start.dist), myClubDistances(), bag);
    draft.clubSuggested = !!draft.club;
  }
  // Score through finished holes only: a hole in progress would read
  // as three under after the tee shot.
  const finished = round.holes.filter((h) => h.done);
  const toPar = finished.reduce((sum, h) => sum + holeScore(h) - h.par, 0);

  return `<header class="topbar hole-head">
      <button class="hole-no" data-action="toggle-hole-picker" aria-label="Hole ${hole.hole} of ${round.holes.length}. Jump to another hole">
        <span class="hole-num">No. ${hole.hole}</span>
        <span class="hole-meta">PAR ${hole.par} &middot; ${hole.yards}</span>
      </button>
      <div class="hole-score">
        <div class="hole-topar">${fmtToPar(toPar)}</div>
        <div class="hole-thru">thru ${finished.length}</div>
      </div>
    </header>
    ${notices()}
    ${STATE.amending ? `
      <div class="card">
        <div class="split">
          <div><strong>Editing a saved round</strong>
            <p class="tiny" style="margin:2px 0 0">Tap a shot to change it. Nothing is saved until you do.</p></div>
        </div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn-ghost" data-action="amend-cancel">Cancel</button>
          <button class="btn-primary" data-action="amend-save">Save changes</button>
        </div>
      </div>` : ''}
    ${STATE.holePicker ? renderHolePicker(round) : ''}

    <div class="card" style="border-top:none;padding-top:14px">
      <div class="eyebrow">${esc(round.courseName)}${hole.sourceNine && hole.sourceHole !== hole.hole
        ? ` &middot; ${esc(hole.sourceNine)} ${hole.sourceHole}` : ''} &middot; yards to pin</div>
      ${renderHoleRuler(hole)}
      <div class="shot-log">
        ${hole.shots.map((s, i) => renderShotLine(s, hole, i)).join('')}
        ${showForm && !editing ? renderPendingLine(hole, start, shotNum) : ''}
      </div>
    </div>

    ${showForm ? renderShotForm(hole, start, category, shotNum) : renderHoleComplete(hole)}

    ${played > 0 && !hole.done && !editing && !STATE.amending ? `
      <div style="text-align:center;margin:4px 0 8px">
        <button class="link-btn muted-link" data-action="end-round">End round here</button>
      </div>` : ''}
    ${STATE.sheet ? renderSheet(category) : ''}`;
}

/**
 * The hole from tee (left) to pin (right), ticked every 100 yards to
 * the pin. Each shot is a dashed run to where the ball finished, and
 * the ball's current spot is a ring with the distance still to go.
 */
function renderHoleRuler(hole) {
  const W = 340;
  const x0 = 10;
  const x1 = W - 14;
  const length = Math.max(Number(hole.yards) || 0, 1);
  const pos = (yards) => x0 + (1 - Math.min(Math.max(yards, 0), length) / length) * (x1 - x0);
  const lineY = 34;

  const ticks = [];
  for (let t = 100; t < length; t += 100) ticks.push(t);
  // A tick label within about 40px of the tee's own yardage would sit
  // on top of it (a 510-yard hole and its 500 mark), so that one goes.
  const labelled = (t) => pos(t) - x0 > 40;

  const segments = [];
  let from = length;
  hole.shots.forEach((s) => {
    const to = s.holed ? 0 : yardsToPin(s.endDist, s.endUnit);
    segments.push({ from, to });
    from = to;
  });
  const lastShot = hole.shots[hole.shots.length - 1];
  const ball = hole.done || !hole.shots.length || (lastShot && lastShot.holed)
    ? null
    : { x: pos(yardsToPin(lastShot.endDist, lastShot.endUnit)), label: fmtDist(lastShot.endDist, lastShot.endUnit).replace(/y$/, '') };

  return `<svg viewBox="0 0 ${W} 64" style="width:100%;height:auto;display:block;margin:10px 0 6px" role="img"
      aria-label="Hole ${hole.hole}, ${length} yards. ${ball ? `${ball.label} to go.` : hole.done ? 'Holed.' : 'On the tee.'}">
    <line x1="${x0}" y1="${lineY}" x2="${x1}" y2="${lineY}" stroke="var(--rule-strong)" stroke-width="1.5"/>
    ${ticks.map((t) => `
      <line x1="${pos(t)}" y1="${lineY - 4}" x2="${pos(t)}" y2="${lineY + 4}" stroke="var(--rule-strong)" stroke-width="1"/>
      <text x="${pos(t)}" y="${lineY + 20}" text-anchor="middle" font-size="9.5"
        font-family="Martian Mono, monospace" fill="var(--text-2)">${labelled(t) ? t : ''}</text>`).join('')}
    <text x="${x0}" y="${lineY + 20}" text-anchor="start" font-size="9.5"
      font-family="Martian Mono, monospace" fill="var(--text-2)">${length}</text>
    ${segments.map((s) => `
      <line x1="${pos(s.from)}" y1="${lineY - 3}" x2="${pos(s.to)}" y2="${lineY - 3}"
        stroke="var(--gain)" stroke-width="2" stroke-dasharray="5 4"/>`).join('')}
    <rect x="${x0 - 5}" y="${lineY - 5}" width="10" height="10" fill="var(--text)"/>
    <line x1="${x1}" y1="${lineY}" x2="${x1}" y2="${lineY - 22}" stroke="var(--loss)" stroke-width="2"/>
    <path d="M${x1} ${lineY - 22} h10 v8 h-10 z" fill="var(--loss)"/>
    ${ball ? `
      <circle cx="${ball.x}" cy="${lineY}" r="6.5" fill="var(--bg)" stroke="var(--gain)" stroke-width="2.5"/>
      <text x="${ball.x}" y="${lineY - 14}" text-anchor="middle" font-size="11" font-weight="600"
        font-family="Martian Mono, monospace" fill="var(--gain)">${esc(ball.label)}</text>` : ''}
  </svg>`;
}

function shotRoute(startLie, startDist, startUnit, end) {
  return `${LIE_CODES[startLie] || ''} ${fmtDist(startDist, startUnit).replace(/y$/, '')} &rarr; ${end}`;
}

function renderShotLine(shot, hole, index) {
  const { sg } = shotSG(shot, hole.par, bench());
  const end = shot.holed
    ? 'HOLED'
    : `${LIE_CODES[shot.endLie] || ''} ${fmtDist(shot.endDist, shot.endUnit).replace(/y$/, '')}`;
  const extras = [];
  if (shot.miss && shot.miss !== 'target') extras.push(MISS_LABELS[shot.miss]);
  if (shot.penalty) extras.push(`+${shot.penalty} pen`);
  const editing = STATE.editShotIdx === index;

  return `<button class="shot-line${editing ? ' is-editing' : ''}" data-edit-shot="${index}" aria-label="Shot ${shot.n}. Tap to change it.">
    <span class="sl-n">${shot.n}</span>
    <span class="sl-club">${esc(shot.club || '')}</span>
    <span class="sl-route">${shotRoute(shot.startLie, shot.startDist, shot.startUnit, end)}${
      extras.length ? `<span class="sl-extra">${esc(extras.join(' · '))}</span>` : ''}</span>
    <span class="sl-sg ${sgClass(sg)}">${fmtSG(sg)}</span>
  </button>`;
}

/** The shot being entered, dimmed, so the log reads as a sentence being finished. */
function renderPendingLine(hole, start, shotNum) {
  const draft = STATE.draft;
  const end = draft.endLie === 'holed'
    ? 'HOLED'
    : draft.endLie ? `${LIE_CODES[draft.endLie]}${isValidDist(draft.endDist) ? ' ' + Math.round(draft.endDist) + (unitForLie(draft.endLie) === 'ft' ? 'ft' : '') : ''}` : '&hellip;';
  return `<div class="shot-line is-pending">
    <span class="sl-n">${shotNum}</span>
    <span class="sl-club">${esc(draft.club || '')}</span>
    <span class="sl-route">${shotRoute(start.lie, start.dist, start.unit, end)}</span>
    <span class="sl-sg">&mdash;</span>
  </div>`;
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
          <span class="tiny" style="${i === STATE.holeIdx ? 'color:var(--primary-ink)' : ''}">${
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
  const clubs = store.trackClubs() && (category === 'app' || category === 'ott');
  const misses = tracksMiss(category);
  const penalty = Number(draft.penalty || 0);

  return `<div class="card" style="padding-top:12px">
    <div class="split" style="align-items:baseline">
      <h2 style="font-size:30px;margin:0">${editing ? `Editing shot ${shotNum}&hellip;` : `Shot ${shotNum} finished&hellip;`}</h2>
      <span class="eyebrow">${esc(CATEGORY_LABELS[category])}</span>
    </div>
    ${editing ? `<p class="tiny" style="margin:4px 0 0">Changing this re-links every later shot on the hole.</p>` : ''}

    <div class="lie-grid" role="group" aria-label="Where did it finish?">
      ${['fairway', 'rough', 'sand', 'recovery', 'green'].map((lie) => `
        <button class="lie-cell ${endLie === lie ? 'active' : ''}" data-lie="${lie}" aria-pressed="${endLie === lie}">${LIE_LABELS[lie]}</button>
      `).join('')}
      <button class="lie-cell holed ${endLie === 'holed' ? 'active' : ''}" data-lie="holed" aria-pressed="${endLie === 'holed'}">Holed</button>
    </div>

    ${needsDist ? `
      <div class="stepper">
        <button data-dist-step="-1" aria-label="Less">&minus;</button>
        <label class="stepper-mid" for="distInput">
          <span class="eyebrow">${unit === 'ft' ? 'Feet' : 'Yards'} to pin</span>
          <input type="number" inputmode="decimal" id="distInput" class="stepper-input"
                 placeholder="${unit === 'ft' ? '18' : '120'}" value="${draft.endDist == null ? '' : esc(draft.endDist)}">
        </label>
        <button data-dist-step="1" aria-label="More">+</button>
      </div>
      ${store.usePresets() ? renderPresets(unit, draft.endDist) : ''}
    ` : ''}

    ${misses && store.missInline() ? `
      <div class="eyebrow" style="margin:4px 0 0">Miss &middot; optional</div>
      <div class="miss-grid miss-inline" role="group" aria-label="Where did you miss?">
        ${MISS_GRID.flat().map((dir) => `
          <button class="miss-cell ${dir === 'target' ? 'center' : ''} ${draft.miss === dir ? 'active' : ''}"
                  data-miss="${dir}" aria-pressed="${draft.miss === dir}">${dir === 'target' ? 'Hit it' : MISS_LABELS[dir]}</button>`).join('')}
      </div>` : ''}

    <div class="field-row">
      ${clubs ? `
        <div class="field field-club${draft.clubSuggested ? ' is-suggested' : ''}">
          <button class="club-step" data-action="club-step" data-step="1" aria-label="Shorter club">&minus;</button>
          <button class="club-name" data-action="open-sheet" data-sheet="club" aria-label="Club: ${esc(draft.club || 'none')}. Tap for all clubs.">
            <span class="eyebrow">${draft.clubSuggested ? 'Club?' : 'Club'}</span><strong>${esc(draft.club || '—')}</strong>
          </button>
          <button class="club-step" data-action="club-step" data-step="-1" aria-label="Longer club">+</button>
        </div>` : ''}
      ${misses && !store.missInline() ? `
        <button class="field" data-action="open-sheet" data-sheet="miss">
          <span class="eyebrow">Miss</span><strong>${esc(draft.miss ? (draft.miss === 'target' ? 'Hit it' : MISS_LABELS[draft.miss]) : '—')}</strong>
        </button>` : ''}
      <button class="field ${penalty ? 'has-penalty' : ''}" data-action="cycle-penalty" aria-label="Penalty strokes: ${penalty}. Tap to change.">
        <span class="eyebrow">${penalty ? 'Penalty' : '+ Penalty'}</span><strong>${penalty ? `+${penalty}` : ''}</strong>
      </button>
    </div>

    ${editing ? `
      <div style="text-align:right;margin-top:6px">
        <button class="link-btn" data-action="delete-shot">Delete shot</button>
      </div>` : ''}
  </div>
  <div class="dock-space"></div>
  <div class="dock dock-play">
    ${editing
      ? '<button class="btn-ghost" data-action="cancel-edit">Cancel</button>'
      : `<button class="btn-ghost" data-action="undo-shot" ${hole.shots.length ? '' : 'disabled'}>Undo</button>`}
    <button class="btn-primary" id="saveShot" data-action="save-shot" ${ready ? '' : 'disabled'}>
      ${editing ? `Update shot ${shotNum}` : `Log shot ${shotNum} &rarr;`}
    </button>
  </div>`;
}

/** Club and miss choices, as a sheet from the bottom of the screen. */
function renderSheet(category) {
  const draft = STATE.draft;
  const body = STATE.sheet === 'club'
    ? `<div class="chip-grid" style="grid-template-columns:repeat(5,1fr);gap:6px">
        ${CLUBS.filter((c) => store.getBag(STATE.player).includes(c) || c === draft.club).map((club) => `
          <button class="chip ${draft.club === club ? 'active' : ''}" data-club="${club}"
                  style="padding:8px 0;font-size:13px">${club}</button>`).join('')}
      </div>`
    : `<div class="miss-grid" style="margin:8px auto">
        ${MISS_GRID.flat().map((dir) => `
          <button class="miss-cell ${dir === 'target' ? 'center' : ''} ${draft.miss === dir ? 'active' : ''}"
                  data-miss="${dir}">${dir === 'target' ? 'Hit it' : MISS_LABELS[dir]}</button>`).join('')}
      </div>`;
  return `<div class="sheet-backdrop" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-label="${STATE.sheet === 'club' ? 'Club' : 'Where did you miss?'}">
      <div class="split">
        <h3 style="margin:0">${STATE.sheet === 'club' ? 'Club' : 'Where did you miss?'}</h3>
        <button class="link-btn muted-link" data-action="close-sheet">Done</button>
      </div>
      ${body}
      <p class="tiny" style="margin:8px 0 0">Optional. Tap again to clear.</p>
    </div>`;
}

function renderHoleComplete(hole) {
  const totals = holeTotals(hole, bench());
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
      ${last ? (STATE.amending ? 'Save changes' : 'Finish Round') : `Hole ${hole.hole + 1} →`}
    </button>
    <div class="btn-row">
      <button class="btn-ghost" data-action="undo-shot">Undo Last Shot</button>
    </div>
  </div>`;
}

/** At the top, because sending it is usually the first thing wanted. */
function recapButton(round) {
  if (!playedHoles(round).length) return '';
  // Spaced like a card so it does not sit on the red rule under the header.
  return `<div style="margin:18px 0 14px">
    <button class="btn-flag" data-action="share-recap" data-id="${esc(round.id)}"${
      STATE.recapBusy ? ' disabled' : ''
    }>${STATE.recapBusy ? 'Drawing…' : 'Share Recap'}</button>
  </div>`;
}

/**
 * Anything in the round worth a second look, each one tap from being
 * fixed. Absent when there is nothing, so a clean round looks exactly
 * as it always did. The round is already saved either way.
 */
function reviewCard(round) {
  const items = roundReview(round);
  if (!items.length) return '';
  return `<div class="card review-card">
    <h2 style="margin-bottom:4px">Worth a look</h2>
    <p class="tiny" style="margin:0 0 8px">Saved already. Tap one to open that hole and change it, or leave it if it is right.</p>
    ${items.map((item) => `
      <button class="review-item" data-action="review-hole" data-id="${esc(round.id)}" data-hole="${item.holeIdx}">
        <span class="badge">${item.hole}</span>
        <span>${esc(item.text)}</span>
        <span class="muted">&rsaquo;</span>
      </button>`).join('')}
  </div>`;
}

function screenSummary() {
  const round = STATE.round || store.getRound(STATE.viewRoundId);
  if (!round) return screenHome();
  return `${topbar('Round Complete')}
    ${reviewCard(round)}
    ${recapButton(round)}
    ${roundReport(round)}
    ${exportCard(round)}
    <button class="btn-primary" data-action="goto-history">Done</button>`;
}

function roundReport(round) {
  const totals = roundTotals(round, bench());
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
        ${/*
           The single most useful thing on this screen. Four numbers in
           boxes have to be compared one at a time; the same four as
           bars off a shared zero answer "where did this round go" at a
           glance, which is the question the screen exists for.
        */''}
        ${sgByCategoryChart(totals, { label: benchName() })}
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
          <div class="tiny">vs. ${esc(benchName())} baseline</div>
        </div>
        ${benchPicker()}
        <p class="tiny">${benchNote()} Changing this recomputes every figure from the shots as they were logged &mdash; nothing is rewritten, and it changes nothing for anyone else.</p>
      `}
    </div>
    ${isScoreOnly(round) ? '' : renderRoundBreakdown(round)}

    <div class="card">
      <h2>Hole by hole</h2>
      <p class="muted">${isScoreOnly(round) ? 'Scores as entered.' : 'Tap a hole to see the shots.'}</p>
      ${holes.map((h) => {
        const t = holeTotals(h, bench());
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
              const { category, sg } = shotSG(s2, h.par, bench());
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
  const tee = teeOutcomes(rounds, bench());
  const putts = puttingBuckets(rounds, bench());
  const buckets = approachBuckets(rounds, bench());
  const totalPutts = putts.reduce((s, b) => s + b.putts, 0);
  const totals = roundTotals(round, bench());

  // Which hole cost the most, and which part of the game it was.
  const worstHole = holes.reduce((worst, h) => {
    const t = holeTotals(h, bench()).total;
    return worst === null || t < holeTotals(worst, bench()).total ? h : worst;
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
      // One round rarely clears the shot threshold in every category,
      // which is the point of passing it: the thin ones say so.
      implied: impliedHandicaps(rounds),
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
          worstHole ? `, and hole ${worstHole.hole} was the single worst at ${fmtSG(holeTotals(worstHole, bench()).total)}` : ''
        }.
      </p>
    </div>

    ${renderTeeCard(tee)}
    ${renderApproachCard(buckets)}
    ${renderPuttingCard(putts)}
    ${renderMissCard('Tee shot misses', missTally(rounds, 'ott', bench()))}
    ${renderMissCard('Approach misses', missTally(rounds, 'app', bench()))}`;
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
          <div class="row-val ${isScoreOnly(r) ? '' : sgClass(roundTotals(r, bench()).total)}">${
            isScoreOnly(r) ? '<span class="tiny">no SG</span>' : fmtSG(roundTotals(r, bench()).total)
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
  const bag = store.getBag(STATE.player);
  const config = sync.getConfig();
  const pending = store.unsynced().length;

  return `${topbar('Settings')}
    ${notices()}
    ${renderAvatarPicker()}

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

      <label>Clubs</label>
      <div class="chip-grid g2">
        <button class="chip ${store.trackClubs() ? '' : 'active'}" data-clubs="off">Off</button>
        <button class="chip ${store.trackClubs() ? 'active' : ''}" data-clubs="on">Track</button>
      </div>
      <p class="tiny">Tee shots and approaches arrive with a club already picked &mdash; driver off the tee on a par 4 or 5, the club for the yardage everywhere else. &minus; drops to a shorter club, + goes longer; logging the shot records it. Chips and putts are left alone.</p>
      ${store.trackClubs() ? `
        <label>Your bag</label>
        <div class="chip-grid" style="grid-template-columns:repeat(5,1fr);gap:6px">
          ${CLUBS.map((club) => `
            <button class="chip ${bag.includes(club) ? 'active' : ''}" data-bag-club="${club}"
                    style="padding:8px 0;font-size:13px">${club}</button>`).join('')}
        </div>
        <p class="tiny">Only these show up when picking or stepping through clubs, and only these are suggested. Saved per player, so a borrowed phone keeps its owner's bag.</p>` : ''}

      <label>Miss direction</label>
      <div class="chip-grid g2">
        <button class="chip ${store.missInline() ? 'active' : ''}" data-miss-inline="on">On screen</button>
        <button class="chip ${store.missInline() ? '' : 'active'}" data-miss-inline="off">Behind a tap</button>
      </div>
      <p class="tiny">On tee shots and approaches. On screen shows the grid under the distance so a miss is one tap; behind a tap keeps the screen shorter. Either way it is optional.</p>
    </div>

    <div class="card">
      <h2>Benchmark</h2>
      <p class="muted">Strokes gained answers "compared with whom". Tour is the default and is what every figure meant before this setting existed; the handicap levels ask the same question against somebody nearer your own game, where zero means you played to that standard.</p>
      ${benchPicker()}
      <p class="tiny">This is a way of reading the data, not a change to it. Every figure is recomputed from the shots exactly as they were logged, nothing is written back to the sheet, and the setting stays on this phone &mdash; so two people can look at the same round against different standards without either of them affecting the other.</p>
      <p class="tiny">Only the tour table is measured data. The handicap levels are built from it plus the strokes a golfer at that level is expected to lose, spread across the positions a round passes through. Good enough to answer "was that a decent round for a 15", not a substitute for a real tour dataset at every level.</p>

      <label>Rolling window</label>
      <div class="chip-grid">
        ${[5, 10, 20].map((n) => `
          <button class="chip ${store.getHandicapWindow() === n ? 'active' : ''}" data-hcp-window="${n}">${n} rounds</button>
        `).join('')}
      </div>
      <p class="tiny">How far back the per-category "plays like" figures look. Shorter follows form; longer is steadier but slower to notice you have got better.</p>
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

    <button class="admin-toggle" data-action="toggle-admin" aria-expanded="${STATE.adminOpen ? 'true' : 'false'}">
      <span>
        <span class="admin-tag">Admin only</span>
        <span class="admin-title">Sheet &amp; group setup</span>
        <span class="admin-note">For whoever runs the Google Sheet. Nothing in here is needed to play.</span>
      </span>
      <span class="admin-chev" aria-hidden="true">${STATE.adminOpen ? '&minus;' : '+'}</span>
    </button>
    ${STATE.adminOpen ? `<div class="admin-body">
    <div class="card">
      <button class="row" style="border:none;padding:0" data-action="open-courses">
        <div class="row-meta">
          <div class="rname">Courses</div>
          <div class="rsub">Saved scorecards, add by hand or from a photo</div>
        </div>
        <div class="row-val">&rsaquo;</div>
      </button>
    </div>

    ${sync.hasUrl() ? `
      <div class="card">
        <h2>Add another phone</h2>
        <p class="muted">Send this link to whoever is joining. Opening it points their phone at the sheet, so all they have to type is their name and the passphrase.</p>
        <button class="btn-ghost" data-action="copy-setup-link">Copy Setup Link</button>
        <p class="tiny">The link carries the sheet address only &mdash; never the passphrase. Tell them that separately, and not in the same message.</p>
      </div>` : ''}

    ${renderRosterCard()}

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
      <div class="btn-row">
        <button class="btn-ghost" data-action="goto-repair">Scorecard Repair</button>
      </div>
      <p class="tiny">Clean Up Sheet removes duplicated rows and any round still sitting in the live tabs after being deleted. Safe to run any time; it reports what it found.</p>
      <p class="tiny">Scorecard Repair is for after a course has been corrected: a round keeps the yardages it was played against, so fixing the card does not reach back into rounds already logged. It shows the difference before writing anything.</p>
      <p class="tiny">This app is build <strong>${esc(BUILD)}</strong>, running from the <strong>${isStandalone() ? 'home screen' : 'browser tab'}</strong>. On a phone those two keep separate data, so a name signed in on one is not signed in on the other.</p>
      <p class="tiny">Check Which Version asks the URL what it is serving, without needing the passphrase. Use it when two phones disagree &mdash; if they report different contract numbers, one is pointed at an older deployment.</p>
      ${STATE.syncStatus ? `<div class="${STATE.syncStatus.bad ? 'err-box' : 'ok-box'}">${esc(STATE.syncStatus.text)}</div>` : ''}
    </div>

    </div>` : ''}

    <button class="btn-ghost" data-action="goto-history">&larr; Back</button>`;
}

/**
 * Who can sign in — now one shared list rather than one per phone.
 *
 * The old version was a textarea of names in this device's storage,
 * which read as though it controlled who could get in and did nothing
 * of the sort for anybody else. This edits the sheet instead, so a
 * name added here is a name that works on every phone.
 *
 * Nobody is ever removed, only switched off. Their rounds are on the
 * sheet either way, and a list that forgets people who used to play
 * is a worse record than one that remembers they stopped.
 */
function renderRosterCard() {
  const shared = store.getPlayers();
  const origin = store.rosterOrigin();
  const configured = sync.isConfigured();

  if (!configured) {
    return `<div class="card">
      <h2>Who can sign in</h2>
      <p class="muted">No sheet is connected, so this device keeps its own list: ${esc(store.getRoster().join(', '))}.</p>
      <p class="tiny">Connect a sheet below and the roster becomes shared &mdash; a name added on any phone works on all of them.</p>
    </div>`;
  }

  if (!shared.length) {
    return `<div class="card">
      <h2>Who can sign in</h2>
      <p class="muted">The <span class="mono">players</span> tab on the sheet is empty, so this device is still falling back to its own list: ${esc(store.getRoster().join(', '))}.</p>
      <p class="tiny">Until somebody is on that tab, a new phone only knows the built-in names &mdash; which is exactly why a new player could not get in. Publish this list once and it becomes the shared one.</p>
      <button class="btn-primary" data-action="publish-roster" ${STATE.syncBusy ? 'disabled' : ''}>Publish This List to the Sheet</button>
      <div class="btn-row">
        <button class="btn-ghost" data-action="refresh-roster" ${STATE.syncBusy ? 'disabled' : ''}>Check Again</button>
      </div>
      <p class="tiny">You can also just type names straight into the <span class="mono">players</span> tab &mdash; one name per row, everything else left blank.</p>
    </div>`;
  }

  const active = shared.filter((p) => p.active !== false).length;

  return `<div class="card">
    <div class="split">
      <h2>Who can sign in</h2>
      <span class="tiny">${active} active${shared.length > active ? ` · ${shared.length - active} off` : ''}</span>
    </div>
    <p class="muted">Shared by everyone. A name added here works on every phone as soon as it syncs.</p>

    ${shared.map((p) => {
      const on = p.active !== false;
      return `<div class="row">
        <div class="badge" style="font-size:13px${on ? '' : ';opacity:0.4'}">${avatarOf(p.player) ? avatarSvg(avatarOf(p.player), 18) : esc(String(p.player).slice(0, 2).toUpperCase())}</div>
        <div class="row-meta" style="${on ? '' : 'opacity:0.55'}">
          <div class="rname">${esc(p.player)}${p.player === STATE.player ? ' <span class="tiny">you</span>' : ''}</div>
          <div class="rsub">${on ? 'Can sign in' : 'Inactive — cannot sign in'}</div>
        </div>
        <button class="chip ${on ? '' : 'active'}" data-action="toggle-player" data-name="${esc(p.player)}"
                style="min-height:38px;padding:0 12px" ${STATE.syncBusy ? 'disabled' : ''}>${on ? 'Turn off' : 'Turn on'}</button>
      </div>`;
    }).join('')}

    <div class="btn-row">
      <button class="btn-primary" data-action="add-player" ${STATE.syncBusy ? 'disabled' : ''}>Add a Player</button>
      <button class="btn-ghost" data-action="refresh-roster" ${STATE.syncBusy ? 'disabled' : ''}>Refresh</button>
    </div>
    ${origin ? `<p class="tiny">Last read from the ${esc(origin.source)} ${
      origin.source === 'network' ? '' : '(this phone could not reach the sheet last time) '
    }&middot; ${origin.count} name${origin.count === 1 ? '' : 's'}.</p>` : ''}
    <p class="tiny">Turning somebody off blocks them at the gate and leaves every round they logged exactly where it is. This is identity, not a lock &mdash; what keeps strangers out of the data is the sheet secret below.</p>
  </div>`;
}

/**
 * Put rounds back in step with a scorecard that has since been fixed.
 *
 * A round keeps its own copy of the yardages from the day it was
 * played, which is normally right — it is the record of what the card
 * said. When the card was wrong, correcting the course does nothing
 * for rounds already on it, and this is how they catch up.
 *
 * Nothing is written until the diff has been looked at. That is the
 * whole design: the tool's job is to be trusted, and a repair that
 * applies itself before anybody has seen what it would do is not.
 */
function screenRepair() {
  const plan = STATE.repairPlan;
  const courses = listCourses();
  const rounds = store.getRounds();

  const scoped = STATE.repairCourseId
    ? rounds.filter((r) => r.courseId === STATE.repairCourseId)
    : rounds;

  return `${topbar('Scorecard Repair')}
    ${notices()}

    <div class="card">
      <h2>Rounds against a corrected card</h2>
      <p class="muted">A round stores the yardages it was played against. Fixing a course does not reach back into rounds already logged &mdash; this compares them and offers to bring them into line.</p>
      <p class="tiny">Strokes gained is not stored anywhere and is never written by this. It is recomputed from the shots every time it is shown, so correcting a yardage is enough on its own.</p>

      <label>Course</label>
      <div class="chip-grid g2">
        <button class="chip ${STATE.repairCourseId ? '' : 'active'}" data-repair-course="">Every course</button>
        ${courses.map((c) => `
          <button class="chip ${STATE.repairCourseId === c.id ? 'active' : ''}"
                  data-repair-course="${esc(c.id)}" style="font-size:12px">${esc(c.name)}</button>
        `).join('')}
      </div>
      <p class="tiny">${scoped.length} round${scoped.length === 1 ? '' : 's'} on this device in scope, everybody's included &mdash; whoever runs this repairs the group, and the rest pick it up on their next sync.</p>

      <button class="btn-primary" data-action="repair-preview">Check These Rounds</button>
    </div>

    ${plan ? `
      <div class="card">
        <div class="split">
          <h2>${plan.changed.length ? `${plan.changed.length} to correct` : 'Nothing to correct'}</h2>
          <span class="tiny">${plan.unchanged.length} already right${plan.blocked.length ? ` · ${plan.blocked.length} unreadable` : ''}</span>
        </div>

        ${plan.changed.length ? `
          ${plan.changed.map((p) => `
            <div class="row" style="display:block">
              <div class="rname">${esc(p.player)} &middot; ${fmtDate(p.date)}</div>
              <div class="rsub">${esc(p.courseName)} &middot; ${esc(p.teeName)}${p.layout ? ` &middot; ${esc(p.layout)}` : ''}</div>
              <div class="card-editor" style="margin-top:8px">
                ${p.holes.map((h) => `
                  <div class="line" style="grid-template-columns:56px 1fr">
                    <span class="tiny">Hole ${h.hole}</span>
                    <span class="mono tiny">${h.from}y &rarr; <strong>${h.to}y</strong>
                      &middot; SG ${fmtSG(h.sgBefore)} &rarr; ${fmtSG(h.sgAfter)}
                      <span class="${sgClass(h.sgAfter - h.sgBefore)}">(${fmtSG(h.sgAfter - h.sgBefore)})</span></span>
                  </div>`).join('')}
                ${(() => {
                  const moved = ['total', ...CATEGORIES]
                    .filter((k) => Math.abs(p.after[k] - p.before[k]) >= 0.005);
                  if (!moved.length) {
                    // Two holes swapped move by equal and opposite
                    // amounts, so the round total does not budge. Saying
                    // so beats leaving a gap that reads as "no effect".
                    return `<div class="line" style="grid-template-columns:1fr">
                      <span class="tiny">Round totals unchanged &mdash; these holes moved by equal and opposite amounts.</span>
                    </div>`;
                  }
                  return moved.map((k) => `
                    <div class="line" style="grid-template-columns:56px 1fr">
                      <span class="tiny">${k === 'total' ? 'Total' : CATEGORY_SHORT[k]}</span>
                      <span class="mono tiny">${fmtSG(p.before[k])} &rarr; ${fmtSG(p.after[k])}
                        <span class="${sgClass(p.after[k] - p.before[k])}">(${fmtSG(p.after[k] - p.before[k])})</span></span>
                    </div>`).join('');
                })()}
                ${p.parMismatches.map((m) => `
                  <div class="line" style="grid-template-columns:60px 1fr">
                    <span class="tiny">Hole ${m.hole}</span>
                    <span class="tiny sg-neg">par ${m.from} here, ${m.to} on the course &mdash; left alone</span>
                  </div>`).join('')}
              </div>
            </div>`).join('')}

          <p class="tiny" style="margin-top:10px">${benchNote()} Par is reported but never rewritten &mdash; changing it would rewrite the score-to-par of a round somebody actually played, which should be a deliberate act rather than a side effect.</p>
          <button class="btn-flag" style="margin-top:8px" data-action="repair-apply">Correct ${plan.changed.length} Round${plan.changed.length === 1 ? '' : 's'}</button>
        ` : `<p class="muted">Every round in scope already matches its scorecard. Running this again would do nothing, which is how it is meant to behave.</p>`}

        ${plan.blocked.length ? `
          <div class="fairway-divider"></div>
          <p class="tiny">These could not be checked:</p>
          ${plan.blocked.map((p) => `
            <p class="tiny">${esc(p.player)} &middot; ${fmtDate(p.date)} &middot; ${esc(p.courseName)} &mdash; ${esc(p.reason)}</p>
          `).join('')}` : ''}
      </div>` : ''}

    <button class="btn-ghost" data-action="goto-settings">&larr; Back</button>`;
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
        style="width:100%;padding:12px;border-radius:9px;border:1.5px solid var(--green-line);background:var(--paper);font-family:'Martian Mono',monospace;font-size:13px;color:var(--ink)">${esc(STATE.importText || '')}</textarea>
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
    ${reviewCard(round)}
    ${recapButton(round)}
    ${roundReport(round)}
    ${exportCard(round)}
    <div class="btn-row">
      <button class="btn-ghost" data-action="goto-history">&larr; Back</button>
      ${isScoreOnly(round) ? '' : `<button class="btn-ghost" data-action="amend-round" data-id="${esc(round.id)}">Edit shots</button>`}
      <button class="btn-danger" data-action="delete-round" data-id="${esc(round.id)}">Delete</button>
    </div>`;
}

/* --- Calendar ----------------------------------------------------
   A month of what is booked and what has already been played, which
   turns out to be the same screen: by December the grid IS the season.

   Everything here is a plan. Nothing on this screen is ever the record
   of what happened — that is a round, written by whoever played it.
------------------------------------------------------------------ */

/** Tee times this player owns or was invited to, soonest first. */
function visibleSchedule() {
  return visibleTeeTimes(store.getLiveTeeTimes(), STATE.player)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
}

/** Anything booked for today and not yet cancelled. */
function todaysTeeTimes() {
  const today = todayKey();
  return visibleSchedule().filter((t) => t.date === today && t.status === 'scheduled');
}

function calendarCursor() {
  const now = new Date();
  return {
    year: STATE.calYear == null ? now.getFullYear() : STATE.calYear,
    month: STATE.calMonth == null ? now.getMonth() : STATE.calMonth,
  };
}

function screenCalendar() {
  const { year, month } = calendarCursor();
  const schedule = visibleSchedule();
  // Everyone's rounds, not just this player's — a day the group played
  // is a day worth seeing on the calendar even if you sat it out.
  const index = calendarIndex(schedule, store.getRounds());
  const weeks = monthGrid(year, month);
  const today = todayKey();

  const upcoming = schedule
    .filter((t) => t.date >= today && t.status === 'scheduled')
    .slice(0, 4);

  const dayCell = (day) => {
    const entry = index.get(day.key) || { teeTimes: [], rounds: [] };
    const mine = entry.rounds.filter((r) => r.player === STATE.player);
    const scheduled = entry.teeTimes.filter((t) => t.status === 'scheduled');
    const cancelled = entry.teeTimes.filter((t) => t.status === 'cancelled');

    const marks = [];
    if (mine.length) marks.push('<span class="mk done" aria-hidden="true">&#10003;</span>');
    scheduled.filter((t) => t.kind === 'round')
      .slice(0, 2).forEach(() => marks.push('<span class="mk round"></span>'));
    scheduled.filter((t) => t.kind === 'practice')
      .slice(0, 2).forEach(() => marks.push('<span class="mk practice"></span>'));
    if (cancelled.length && !scheduled.length) marks.push('<span class="mk cancelled"></span>');

    const classes = [
      'cal-day',
      day.inMonth ? '' : 'muted-day',
      day.isToday ? 'today' : '',
      mine.length ? 'played' : '',
      entry.teeTimes.length ? 'has-events' : '',
    ].filter(Boolean).join(' ');

    // The label is what a screen reader gets, so it has to say in
    // words what the dots say in shapes.
    const described = [
      mine.length ? `${mine.length} round played` : '',
      scheduled.length ? `${scheduled.length} scheduled` : '',
    ].filter(Boolean).join(', ');

    return `<button class="${classes}" data-cal-day="${day.key}"
      aria-label="${esc(fmtDateKey(day.key))}${described ? ', ' + described : ''}">
      <span>${day.day}</span>
      <span class="marks">${marks.join('')}</span>
    </button>`;
  };

  return `${topbar('Diary')}
    ${notices()}
    ${renderScheduleBanner()}

    <div class="card">
      <div class="cal-nav">
        <button data-cal-step="-1" aria-label="Previous month">&lsaquo;</button>
        <h2>${esc(monthLabel(year, month))}</h2>
        <button data-cal-step="1" aria-label="Next month">&rsaquo;</button>
      </div>
      <div class="cal-head">${WEEKDAYS.map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid">${weeks.map((week) => week.map(dayCell).join('')).join('')}</div>
      <div class="cal-legend">
        <span><i class="mk round" style="width:6px;height:6px;border-radius:50%;background:var(--green-mid);display:inline-block"></i> round booked</span>
        <span><i style="width:6px;height:6px;border-radius:50%;border:1.5px solid var(--green-mid);display:inline-block"></i> practice</span>
        <span><i style="color:var(--green-mid);font-weight:700">&#10003;</i> played</span>
      </div>
      <div class="btn-row">
        <button class="btn-ghost" data-action="cal-today">Today</button>
        <button class="btn-primary" data-action="new-tee-time" data-date="${esc(today)}">Add</button>
      </div>
    </div>

    ${STATE.calDay ? renderDayCard(STATE.calDay, index.get(STATE.calDay)) : ''}

    <div class="card">
      <div class="split">
        <h2>Coming up</h2>
        <span class="tiny">${schedule.length ? `${schedule.length} in the diary` : ''}</span>
      </div>
      ${upcoming.length ? upcoming.map((t) => teeTimeRow(t)).join('') : `
        <div class="empty">
          <div class="glyph">&#128197;</div>
          <div>Nothing booked. Tap a day to put something in.</div>
        </div>`}
      ${upcoming.length ? `
        <button class="btn-ghost" style="margin-top:10px" data-action="export-calendar">Add All to iPhone Calendar</button>
        <p class="tiny">Downloads a calendar file. Opening it on the phone offers to add every upcoming entry. It only goes one way &mdash; Ledger cannot read your calendar back, so this stays the place a tee time is changed.</p>
      ` : ''}
    </div>`;
}

/** One tee time as a tappable row. */
function teeTimeRow(teeTime) {
  const days = daysFromToday(teeTime.date);
  const when = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : fmtDateKey(teeTime.date);
  const others = (teeTime.invitees || []).length;

  return `<button class="row" data-action="view-tee-time" data-id="${esc(teeTime.id)}">
    <div class="badge" style="font-size:11px">${teeTime.kind === 'practice' ? 'PR' : 'GO'}</div>
    <div class="row-meta">
      <div class="rname">${esc(describeTeeTime(teeTime))}${
        teeTime.status === 'cancelled' ? ' <span class="tiny">cancelled</span>' : ''
      }</div>
      <div class="rsub">${esc(when)} &middot; ${esc(fmtTime(teeTime.time))}${
        others ? ` &middot; with ${esc(teeTime.invitees.join(', '))}` : ''
      }</div>
    </div>
    <div class="row-val">&rsaquo;</div>
  </button>`;
}

/** What one day of the month holds, opened by tapping it. */
function renderDayCard(key, entry) {
  const day = entry || { teeTimes: [], rounds: [] };
  const mine = day.rounds.filter((r) => r.player === STATE.player);
  const others = day.rounds.filter((r) => r.player !== STATE.player);

  return `<div class="card">
    <div class="split">
      <h2>${esc(fmtDateKey(key))}</h2>
      <button class="chip" data-cal-day="" style="min-height:34px;padding:0 12px">Close</button>
    </div>

    ${day.teeTimes.length ? day.teeTimes.map((t) => teeTimeRow(t)).join('') : ''}

    ${mine.map((r) => `
      <button class="row" data-action="view-round" data-id="${esc(r.id)}">
        <div class="badge">${fmtToPar(roundToPar(r))}</div>
        <div class="row-meta">
          <div class="rname">${esc(r.courseName)}</div>
          <div class="rsub">Played &middot; ${roundScore(r)} strokes</div>
        </div>
        <div class="row-val">&rsaquo;</div>
      </button>`).join('')}

    ${others.length ? `<p class="tiny" style="margin-top:8px">${
      others.map((r) => `${esc(r.player)} played ${esc(r.courseName)}`).join('. ')
    }.</p>` : ''}

    ${!day.teeTimes.length && !day.rounds.length ? `
      <p class="muted">Nothing on this day yet.</p>` : ''}

    <button class="btn-primary" style="margin-top:10px"
            data-action="new-tee-time" data-date="${esc(key)}">Book Something</button>
  </div>`;
}

/**
 * The one thing the calendar owes the rest of the app: on the morning
 * of a round, a way into it that skips choosing the course you already
 * chose when you booked it.
 *
 * Kept deliberately plain. No streak, no encouragement, no countdown —
 * it is a button that starts the round you are about to play.
 */
/**
 * "You've been invited" — the in-app stand-in for a push notification.
 * Stays until dismissed or opened, so an invite that arrived in a
 * background sync is still waiting the next time the app is looked at.
 */
function renderInviteBanner() {
  const invites = newInvites(store.getLiveTeeTimes(), STATE.player, store.getSeenInvites(STATE.player));
  if (!invites.length) return '';

  return `<div class="card">
    <h2>${invites.length === 1 ? `${esc(invites[0].owner)} invited you` : `${invites.length} new invites`}</h2>
    ${invites.map((t) => `
      <button class="row" data-action="open-invite" data-id="${esc(t.id)}">
        <div class="badge" style="font-size:11px">${t.kind === 'practice' ? 'PR' : 'GO'}</div>
        <div class="row-meta">
          <div class="rname">${esc(describeTeeTime(t))}</div>
          <div class="rsub">${esc(fmtDateKey(t.date))}${t.time ? ` &middot; ${esc(fmtTime(t.time))}` : ''}${
            invites.length > 1 ? ` &middot; from ${esc(t.owner)}` : ''
          }</div>
        </div>
        <div class="row-val">&rsaquo;</div>
      </button>`).join('')}
    <div class="btn-row">
      <button class="btn-ghost" data-action="dismiss-invites">Got It</button>
    </div>
  </div>`;
}

/* --- Home: the book on you ----------------------------------------
   The recent game as a yardage book would put it: one headline number,
   where each part of the game sits against it, and the one leak worth
   fixing — with a session to book for it. It replaced the separate
   practice card, which said the same thing at greater length.
------------------------------------------------------------------ */

const HANDICAP_WORDS = [
  'scratch', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three',
  'twenty-four', 'twenty-five', 'twenty-six', 'twenty-seven', 'twenty-eight',
  'twenty-nine', 'thirty',
];

function handicapWords(value) {
  const n = Math.round(value);
  if (n <= 0) return 'scratch';
  if (n > 30) return `${n > 36 ? '36+' : n}`;
  return `a ${HANDICAP_WORDS[n]}`;
}

/**
 * The scale: scratch to 30, a dot per part of the game, and the
 * overall level as a marker. Dots that would sit on top of each other
 * are nudged apart, and every label (the parts and "YOU") takes the
 * lowest row above the line where it does not touch another.
 */
function renderBookScale(profile, marker = 'YOU') {
  const W = 340;
  const x0 = 8;
  const x1 = W - 8;
  const max = 30;
  const at = (h) => x0 + (Math.min(Math.max(h, 0), max) / max) * (x1 - x0);
  const charW = 7.4;
  const rowH = 13;

  const dots = profile.rows
    .map((row) => ({ ...row, x: at(row.handicap), good: row.handicap <= profile.overall + 0.5 }))
    .sort((a, b) => a.x - b.x);
  dots.forEach((d, i) => {
    if (i && d.x - dots[i - 1].x < 13) d.x = dots[i - 1].x + 13;
  });

  const you = at(profile.overall);
  const labels = [
    { text: `${marker} ${Math.round(profile.overall)}`, x: you + 4, colour: 'var(--text)', weight: 600 },
    ...dots.map((d) => ({ text: CATEGORY_SHORT_BOOK[d.category], x: d.x - 5, colour: d.good ? 'var(--gain)' : 'var(--loss)', weight: 500 })),
  ];
  const rows = [];
  labels.forEach((l) => {
    const width = l.text.length * charW;
    l.x = Math.max(0, Math.min(l.x, W - width));
    let tier = rows.findIndex((end) => l.x > end + 6);
    if (tier === -1) { tier = rows.length; rows.push(-Infinity); }
    rows[tier] = l.x + width;
    l.tier = tier;
  });

  const top = rows.length * rowH + 6;
  const lineY = top + 10;
  const H = lineY + 24;

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;margin:8px 0 4px"
      role="img" aria-label="Handicap level by part of the game, scratch to 30. Overall ${Math.round(profile.overall)}.">
    <line x1="${x0}" y1="${lineY}" x2="${x1}" y2="${lineY}" stroke="var(--rule-strong)" stroke-width="1"/>
    ${[0, 10, 20, 30].map((t) => `
      <line x1="${at(t)}" y1="${lineY - 4}" x2="${at(t)}" y2="${lineY + 4}" stroke="var(--rule-strong)" stroke-width="1"/>
      <text x="${at(t)}" y="${lineY + 19}" text-anchor="${t === 0 ? 'start' : t === max ? 'end' : 'middle'}"
        font-size="9.5" font-family="Martian Mono, monospace" fill="var(--text-2)">${t === 0 ? 'scr' : t}</text>`).join('')}
    <line x1="${you}" y1="${lineY - 16}" x2="${you}" y2="${lineY + 9}" stroke="var(--text)" stroke-width="2"/>
    ${labels.map((l) => `
      <text x="${l.x}" y="${top - l.tier * rowH - 4}" font-size="10" font-weight="${l.weight}"
        font-family="Martian Mono, monospace" fill="${l.colour}">${l.text}</text>`).join('')}
    ${dots.map((d) => `
      <rect x="${d.x - 7}" y="${lineY - 7}" width="14" height="14" rx="5"
        fill="${d.good ? 'var(--gain)' : 'var(--loss)'}" stroke="var(--bg)" stroke-width="1.5"/>`).join('')}
  </svg>`;
}

const CATEGORY_SHORT_BOOK = { ott: 'Tee', app: 'Approach', arg: 'Short', putt: 'Putting' };

/**
 * The book on a player — you on Home, anyone from the Club tab. Only
 * your own book offers to book a session for the leak.
 */
function renderBook(player = STATE.player) {
  const self = player === STATE.player;
  const theirs = store.getRounds().filter((r) => r.player === player);
  const who = self ? 'you' : player;
  const game = gameProfile(theirs);
  if (!game) {
    const have = sgRounds(theirs).length;
    return `<div class="card">
      <div class="eyebrow">The book on ${esc(who)}</div>
      <h2 style="font-size:34px;margin:6px 0 8px">Still writing it.</h2>
      <p class="muted">${self
        ? `Log ${3 - have} more round${3 - have === 1 ? '' : 's'} shot by shot and this fills in: the handicap each part of your game plays like, and where the strokes are going.`
        : `${esc(player)} needs ${3 - have} more round${3 - have === 1 ? '' : 's'} with shots logged before there is a book to read.`}</p>
    </div>`;
  }

  const { profile, per18, rounds } = game;
  const focus = practiceFocus(theirs);
  const rows = profile.rows.slice().sort((a, b) => b.handicap - a.handicap);

  let booking = '';
  if (focus && self) {
    const booked = bookedFocus(
      visibleTeeTimes(store.getLiveTeeTimes(), STATE.player), focus.plan.practiceType, todayKey()
    );
    const days = booked ? daysFromToday(booked.date) : null;
    const when = booked ? (days === 0 ? 'today' : days === 1 ? 'tomorrow' : fmtDateKey(booked.date)) : '';
    booking = booked
      ? `<button class="row" data-action="view-tee-time" data-id="${esc(booked.id)}">
          <div class="row-meta">
            <div class="rname">${esc(focus.plan.practiceType)} booked ${esc(when)}</div>
            <div class="rsub">Spend it on ${esc(focus.plan.title.toLowerCase())}</div>
          </div>
          <div class="row-val">&rsaquo;</div>
        </button>`
      : `<button class="row" data-action="book-focus">
          <div class="row-meta">
            <div class="rname">${esc(focus.plan.title)} &middot; ${focus.plan.minutes} min</div>
            <div class="rsub">${esc(focus.plan.drill)}</div>
          </div>
          <div class="row-val sg-neg" style="white-space:nowrap">BOOK &rsaquo;</div>
        </button>`;
  }

  return `<div class="card">
    <div class="eyebrow">The book on ${esc(who)} &middot; ${rounds} rounds &middot; vs tour</div>
    <h2 style="font-size:38px;margin:6px 0 2px">Plays like <em class="${profile.overall <= 18 ? 'sg-pos' : ''}" style="font-style:italic">${esc(handicapWords(profile.overall))}.</em></h2>
    ${renderBookScale(profile, self ? 'YOU' : String(player).toUpperCase())}
    <div style="border-top:1px solid var(--rule-strong);margin-top:6px">
      ${rows.map((row) => {
        const good = row.handicap <= profile.overall + 0.5;
        return `<div class="row" style="min-height:40px;padding:9px 0">
          <div class="row-meta"><div class="rname" style="font-weight:500">${esc(CATEGORY_LABELS[row.category])}</div></div>
          <div class="row-val ${sgClass(per18[row.category])}" style="width:64px;text-align:right">${fmtSG(per18[row.category])}</div>
          <div class="row-val ${good ? 'sg-pos' : 'sg-neg'}" style="width:40px;text-align:right">${row.handicap <= 0.5 ? 'scr' : esc(fmtHandicapShort(row.handicap))}</div>
        </div>`;
      }).join('')}
    </div>
    ${focus ? `
      <p class="callout" style="margin:14px 0 6px">${esc(CATEGORY_LABELS[focus.category])} is the leak. ${self
        ? `Bring it to your own level and save about ${focus.strokesPer18.toFixed(1)} a round.`
        : `Brought up to the rest of ${esc(player)}&rsquo;s game, it would save about ${focus.strokesPer18.toFixed(1)} a round.`}</p>
      ${self ? `<button class="link-btn" data-action="stats-tab" data-tab="${focus.category}" style="padding:0">See the ${esc(CATEGORY_LABELS[focus.category].toLowerCase())} numbers &rsaquo;</button>` : ''}
      ${booking}` : `
      <p class="callout" style="margin:14px 0 0">${self
        ? 'No part of your game is dragging the rest. Keep doing what you are doing.'
        : `No part of ${esc(player)}&rsquo;s game is dragging the rest.`}</p>`}
  </div>`;
}

/** Upcoming tee times and the last round, as ruled rows. */
function renderDiaryStrip() {
  const today = todayKey();
  const upcoming = visibleSchedule()
    .filter((t) => t.status === 'scheduled' && t.date >= today)
    .slice(0, 3);
  const last = playerRounds()[0];
  if (!upcoming.length && !last) return '';

  const dayLabel = (key) => {
    const d = daysFromToday(key);
    if (d === 0) return 'TODAY';
    if (d === 1) return 'TMRW';
    const date = new Date(`${key}T12:00:00`);
    return `${date.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()} ${date.getDate()}`;
  };

  return `<div class="card">
    <div class="eyebrow" style="margin-bottom:4px">In the diary</div>
    ${upcoming.map((t) => `
      <button class="row" data-action="view-tee-time" data-id="${esc(t.id)}">
        <span class="mono sg-pos" style="width:62px;font-size:11px;font-weight:600">${dayLabel(t.date)}</span>
        <div class="row-meta"><div class="rname" style="font-weight:500">${esc(describeTeeTime(t))} <span style="color:var(--text-2)">&middot; ${esc(fmtTime(t.time))}</span></div></div>
        <span class="mono" style="font-size:11px;color:var(--text-2)">${t.kind === 'practice' ? 'PR' : 'GO'}</span>
      </button>`).join('')}
    ${last ? (() => {
      const sg = isScoreOnly(last) ? null : roundTotals(last, bench()).total;
      return `<button class="row" data-action="view-round" data-id="${esc(last.id)}">
        <span class="mono" style="width:62px;font-size:11px;font-weight:600;color:var(--text-2)">LAST</span>
        <div class="row-meta"><div class="rname" style="font-weight:500">${esc(last.courseName)} <span style="color:var(--text-2)">&middot; ${esc(last.teeName)}</span></div></div>
        <span class="mono" style="font-size:12px;font-weight:600">${fmtToPar(roundToPar(last))}</span>
        ${sg == null ? '' : `<span class="mono ${sgClass(sg)}" style="font-size:12px;font-weight:600;width:52px;text-align:right">${fmtSG(sg)}</span>`}
      </button>`;
    })() : ''}
  </div>`;
}

function renderScheduleBanner() {
  // Nothing to offer while a round is already in progress.
  if (STATE.round && !isRoundComplete(STATE.round)) return '';

  const today = todaysTeeTimes();
  if (!today.length) return '';

  return today.map((teeTime) => {
    const played = store.getRounds().some(
      (r) => r.groupId === teeTime.groupId && r.player === STATE.player
    );
    const course = teeTime.courseId ? safeCourse(teeTime.courseId) : null;
    const ready = teeTime.kind === 'round' && course && !played;

    return `<div class="card">
      <div class="split">
        <h2>Today${teeTime.time ? ` &middot; ${esc(fmtTime(teeTime.time))}` : ''}</h2>
        <span class="tiny">${esc(KIND_LABELS[teeTime.kind])}</span>
      </div>
      <p class="muted">${esc(describeTeeTime(teeTime))}${
        teeTime.teeName ? ` &mdash; ${esc(teeTime.teeName)} tees` : ''
      }${(teeTime.invitees || []).length ? `<br>With ${esc(teeTime.invitees.join(', '))}` : ''}</p>
      ${played ? `<p class="tiny">Your round for this one is already logged.</p>` : ''}
      ${ready ? `
        <button class="btn-flag" data-action="start-scheduled" data-id="${esc(teeTime.id)}">
          Start Round
        </button>` : ''}
      ${!played && teeTime.kind === 'round' && !course ? `
        <p class="tiny">The course this was booked against is not saved on this phone, so the round has to be started the usual way.</p>` : ''}
      <div class="btn-row">
        <button class="btn-ghost" data-action="view-tee-time" data-id="${esc(teeTime.id)}">Details</button>
      </div>
    </div>`;
  }).join('');
}

function screenTeeTime() {
  const teeTime = store.getTeeTime(STATE.viewTeeTimeId);
  if (!teeTime || teeTime.deletedAt) return screenCalendar();

  const days = daysFromToday(teeTime.date);
  const isToday = days === 0;
  const course = teeTime.courseId ? safeCourse(teeTime.courseId) : null;
  const board = groupLeaderboard(store.getRounds(), teeTime.groupId, bench());
  const mine = board.some((row) => row.player === STATE.player);

  return `${topbar('Tee Time')}
    ${notices()}
    <div class="card">
      <h2>${esc(describeTeeTime(teeTime))}</h2>
      <p class="muted">
        ${esc(fmtDateKey(teeTime.date))} &middot; ${esc(fmtTime(teeTime.time))}<br>
        ${esc(KIND_LABELS[teeTime.kind])}${teeTime.teeName ? ` &middot; ${esc(teeTime.teeName)} tees` : ''}
        ${teeTime.holes ? ` &middot; ${teeTime.holes} holes` : ''}<br>
        ${esc(playersOf(teeTime).join(', '))}
      </p>
      ${teeTime.notes ? `<p class="tiny">${esc(teeTime.notes)}</p>` : ''}
      ${teeTime.status === 'cancelled' ? `<div class="err-box">Cancelled.</div>` : ''}
      ${teeTime.status === 'played' ? `<div class="ok-box">Marked as played.</div>` : ''}

      ${isToday && teeTime.status === 'scheduled' && teeTime.kind === 'round' && course && !mine ? `
        <button class="btn-flag" data-action="start-scheduled" data-id="${esc(teeTime.id)}">Start Round</button>
      ` : ''}

      <div class="btn-row">
        <button class="btn-ghost" data-action="export-tee-time" data-id="${esc(teeTime.id)}">Add to iPhone Calendar</button>
      </div>
      <div class="btn-row">
        <button class="btn-ghost" data-action="edit-tee-time" data-id="${esc(teeTime.id)}">Edit</button>
        ${teeTime.status === 'cancelled'
          ? `<button class="btn-ghost" data-action="uncancel-tee-time" data-id="${esc(teeTime.id)}">Reinstate</button>`
          : `<button class="btn-danger" data-action="cancel-tee-time" data-id="${esc(teeTime.id)}">Cancel</button>`}
      </div>
      <div class="btn-row">
        <button class="btn-danger" data-action="delete-tee-time" data-id="${esc(teeTime.id)}">Remove from Diary</button>
      </div>
      <p class="tiny">Cancelling keeps the entry and marks it off. Removing takes it off everyone's calendar.</p>
    </div>

    ${board.length ? renderGroupCard(board) : (
      teeTime.status !== 'cancelled' && days < 0 && teeTime.kind === 'round' ? `
      <div class="card">
        <h2>No rounds logged</h2>
        <p class="muted">Nobody has logged a round against this tee time. Rounds join up here automatically once they sync &mdash; each player writes their own, and they find each other afterwards.</p>
      </div>` : ''
    )}

    <button class="btn-ghost" data-action="goto-calendar">&larr; Back</button>`;
}

/**
 * Everyone who played the same tee time, side by side.
 *
 * Assembled entirely on read from rounds that arrived separately.
 * Nobody wrote to a shared record, which is what makes this work at
 * all over a sheet and a bad signal.
 */
function renderGroupCard(board) {
  return `<div class="card">
    <div class="split">
      <h2>How it went</h2>
      <span class="tiny">${board.length} card${board.length === 1 ? '' : 's'}</span>
    </div>
    <div class="card-editor">
      <div class="hdr" style="grid-template-columns:minmax(0,1fr) 44px 52px 56px">
        <span>Player</span>
        <span style="text-align:center">Holes</span>
        <span style="text-align:center">Score</span>
        <span style="text-align:center">SG</span>
      </div>
      ${board.map((row) => `
        <div class="line" style="grid-template-columns:minmax(0,1fr) 44px 52px 56px">
          <span><strong>${esc(row.player)}</strong></span>
          <span class="mono" style="text-align:center;font-size:12px">${row.holes}</span>
          <span class="mono" style="text-align:center;font-size:12px">${row.score} <span class="tiny">${fmtToPar(row.toPar)}</span></span>
          <span class="mono ${row.sg ? sgClass(row.sg.total) : ''}" style="text-align:center;font-size:12px">${
            row.sg ? fmtSG(row.sg.total) : '<span class="tiny">—</span>'
          }</span>
        </div>`).join('')}
    </div>
    <p class="tiny" style="margin-top:8px">${benchNote()} ${
      board.some((r) => r.holes !== board[0].holes)
        ? 'These cards are not all the same length, so the scores are not directly comparable.'
        : ''
    }</p>
  </div>`;
}

function screenTeeTimeEdit() {
  const draft = STATE.teeTimeDraft;
  if (!draft) return screenCalendar();

  const editing = Boolean(draft.id);
  const courses = listCourses();
  const course = draft.courseId ? safeCourse(draft.courseId) : null;
  const options = course ? playOptions(course) : [];
  const roster = store.getRoster().filter((n) => n !== STATE.player);

  return `${topbar(editing ? 'Edit Tee Time' : 'New Tee Time')}
    ${notices()}

    <div class="card">
      <h2>What and when</h2>
      <div class="chip-grid g2">
        ${KINDS.map((k) => `
          <button class="chip ${draft.kind === k ? 'active' : ''}" data-tt-kind="${k}">${KIND_LABELS[k]}</button>
        `).join('')}
      </div>

      <label>Date</label>
      <input type="date" id="ttDate" value="${esc(draft.date || '')}">

      <label>Time</label>
      <input type="time" id="ttTime" value="${esc(draft.time || '')}">
      <p class="tiny">Leave the time blank if it is not booked yet &mdash; it shows as TBD and exports as an all-day entry.</p>
    </div>

    ${draft.kind === 'practice' ? `
      <div class="card">
        <h2>Practice</h2>
        <div class="chip-grid g2">
          ${PRACTICE_TYPES.map((p) => `
            <button class="chip ${draft.practiceType === p ? 'active' : ''}" data-tt-practice="${esc(p)}">${esc(p)}</button>
          `).join('')}
        </div>
      </div>
    ` : `
      <div class="card">
        <h2>Course</h2>
        ${courses.length ? courses.map((c) => `
          <button class="row" data-tt-course="${esc(c.id)}"
                  style="${c.id === draft.courseId ? 'background:var(--cream)' : ''}">
            <div class="badge">${c.nines.length * 9}</div>
            <div class="row-meta">
              <div class="rname">${esc(c.name)}</div>
              <div class="rsub">${esc(c.teeNames.join(' · '))}</div>
            </div>
            <div class="row-val">${c.id === draft.courseId ? '&check;' : '&rsaquo;'}</div>
          </button>`).join('') : `
          <p class="muted">No courses saved yet. You can still book a time and pick the course later.</p>`}

        ${course ? `
          <label>Tees</label>
          <div class="chip-grid">
            ${course.teeNames.map((name) => `
              <button class="chip ${draft.teeName === name ? 'active' : ''}" data-tt-tee="${esc(name)}">${esc(name)}</button>
            `).join('')}
          </div>

          <label>Playing</label>
          <div class="chip-grid g2">
            ${options.map((option) => `
              <button class="chip ${draft.layoutKey === option.key ? 'active' : ''}"
                      data-tt-layout="${esc(option.key)}" data-holes="${option.holeCount}"
                      style="font-size:12px">${esc(option.label)}</button>
            `).join('')}
          </div>
          <p class="tiny">Choosing this now is what lets the round start straight from the diary on the day, without going back through the course picker.</p>
        ` : ''}
      </div>
    `}

    <div class="card">
      <h2>Who else</h2>
      ${roster.length ? `
        <div class="chip-grid">
          ${roster.map((name) => `
            <button class="chip ${(draft.invitees || []).includes(name) ? 'active' : ''}"
                    data-tt-invite="${esc(name)}">${esc(name)}</button>
          `).join('')}
        </div>
        <p class="tiny">They see it on their own diary once their phone syncs. Everyone still logs their own round; the group card comes from joining them up afterwards.</p>
      ` : `<p class="muted">Nobody else is on this device's roster. Add names in Settings.</p>`}

      <label>Notes</label>
      <textarea id="ttNotes" rows="2"
        style="width:100%;padding:12px;border-radius:9px;border:1.5px solid var(--green-line);background:var(--paper);font-family:inherit;font-size:16px;color:var(--ink)">${esc(draft.notes || '')}</textarea>
    </div>

    <div class="card">
      <button class="btn-primary" data-action="save-tee-time">${editing ? 'Save Changes' : 'Add to Diary'}</button>
      <div class="btn-row">
        <button class="btn-ghost" data-action="goto-calendar">Cancel</button>
      </div>
    </div>`;
}

/* --- Stats ---------------------------------------------------------
   Organised the way the game is: an overview, then one tab per part
   of it. Each part opens on the one number that matters — the
   handicap it plays like — and then everything about that part, so
   "how is my putting" has exactly one place to go.
------------------------------------------------------------------ */

const STATS_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'ott', label: 'Tee' },
  { key: 'app', label: 'Approach' },
  { key: 'arg', label: 'Short' },
  { key: 'putt', label: 'Putting' },
];

function screenStats() {
  const allRounds = playerRounds();
  // Everything strokes-gained is computed from rounds that actually
  // carry shots. A score-only round has none, so including it would
  // dilute every average toward zero.
  const rounds = sgRounds(allRounds);
  const head = `<header class="topbar">
      <div class="brand">Stats</div>
      <div class="sub">${rounds.length} round${rounds.length === 1 ? '' : 's'} &middot; vs ${esc(benchName())}</div>
    </header>`;

  if (allRounds.length === 0) {
    return `${head}
      <div class="card"><div class="empty">Play a round and the patterns show up here.</div></div>`;
  }

  if (rounds.length === 0) {
    return `${head}
      ${renderTrendCard(trendSeries(allRounds, bench()), 'toPar')}
      <div class="card">
        <h2>No shot data yet</h2>
        <p class="muted">All ${allRounds.length} of your rounds are score only, so there is nothing to measure against the baseline. Track one round shot by shot and the rest of this page fills in.</p>
      </div>`;
  }

  const tab = STATS_TABS.some((t) => t.key === STATE.statsTab) ? STATE.statsTab : 'overview';

  // Normalised per 18 holes, otherwise a weekday nine would drag the
  // average toward zero purely for being short.
  const holesPlayed = rounds.reduce((sum, r) => sum + playedHoles(r).length, 0) || 1;
  const avg = {};
  CATEGORIES.forEach((c) => {
    const total = rounds.reduce((sum, r) => sum + roundTotals(r, bench())[c], 0);
    avg[c] = (total / holesPlayed) * 18;
  });
  const avgTotal = CATEGORIES.reduce((sum, c) => sum + avg[c], 0);

  // "Plays like" is always read against tour — it is a scale in its
  // own right — while the SG figures follow the chosen benchmark.
  const game = gameProfile(allRounds, { window: 1000, minRounds: 1 });
  const ctx = { allRounds, rounds, holesPlayed, avg, avgTotal, game };

  return `${head}
    <div class="seg stats-tabs" role="tablist" style="margin-top:12px">
      ${STATS_TABS.map((t) => `
        <button role="tab" aria-selected="${t.key === tab}" class="${t.key === tab ? 'active' : ''}"
                data-action="stats-tab" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    ${tab === 'overview' ? renderStatsOverview(ctx) : renderStatsPart(tab, ctx)}
    <p class="tiny" style="text-align:center;margin:10px 0 0">Strokes gained vs ${esc(benchName())} &middot; change it in Rounds &rsaquo; Settings</p>`;
}

/** The headline for one part: the handicap it plays like, and its SG. */
function renderPartHead(part, ctx) {
  const { game, avg } = ctx;
  const row = game ? game.profile.rows.find((r) => r.category === part) : null;
  const good = row && row.handicap <= game.profile.overall + 0.5;
  const upside = row ? upsideFor(row) : 0;
  return `<div class="card" style="border-top:none;padding-top:14px">
    <div class="split" style="align-items:flex-end">
      <div>
        <div class="eyebrow">${esc(CATEGORY_LABELS[part])} plays like</div>
        <div class="part-num ${row ? (good ? 'sg-pos' : 'sg-neg') : ''}">${row ? (row.handicap <= 0.5 ? 'scr' : esc(fmtHandicapShort(row.handicap))) : '&ndash;'}</div>
      </div>
      <div style="text-align:right">
        <div class="eyebrow">SG / 18</div>
        <div class="mono ${sgVerdict(avg[part], 'round').cls}" style="font-size:20px;font-weight:600">${fmtSG(avg[part])}</div>
        <div class="sg-word ${sgVerdict(avg[part], 'round').cls}">${sgVerdict(avg[part], 'round').word}</div>
        ${upside >= 0.1 ? `<div class="eyebrow" style="font-size:9.5px">Worth ~${upside.toFixed(1)} a round</div>` : ''}
      </div>
    </div>
    ${row ? `<p class="tiny" style="margin:6px 0 0">${good
      ? `At or better than the rest of your game, which plays like ${esc(fmtHandicap(game.profile.overall))}.`
      : `Behind the rest of your game, which plays like ${esc(fmtHandicap(game.profile.overall))}.`}</p>` : ''}
  </div>`;
}

function renderStatsPart(part, ctx) {
  const { rounds } = ctx;
  // The same trend card as Overview, in the same place, drawing only
  // this part — so switching tabs reads as zooming in.
  const headline = renderPartHead(part, ctx) + renderTrendCard(trendSeries(ctx.allRounds, bench()), part);

  if (part === 'ott') {
    return `${headline}
      ${renderTeeCard(teeOutcomes(rounds, bench()))}
      ${renderMissCard('Tee shot misses', missTally(rounds, 'ott', bench()))}`;
  }
  if (part === 'app') {
    const cd = clubDistances(rounds, bench());
    return `${headline}
      ${renderGreenCard(rounds)}
      ${renderApproachCard(approachBuckets(rounds, bench()))}
      ${renderClubCard(cd)}${renderGappingCard(cd)}`;
  }
  if (part === 'arg') {
    const s = shortGameStats(rounds, bench());
    return `${headline}
      <div class="card">
        <h2>Around the green</h2>
        ${s.shots ? `
          <div class="stat-grid g4">
            <div class="stat-box"><div class="val">${s.upDown.chances ? `${s.upDown.pct}%` : '&ndash;'}</div><div class="lbl">Up &amp; down</div></div>
            <div class="stat-box"><div class="val">${s.leaveFt == null ? '&ndash;' : `${Math.round(s.leaveFt)}ft`}</div><div class="lbl">Avg leave</div></div>
            <div class="stat-box"><div class="val">${s.onGreenPct}%</div><div class="lbl">On green</div></div>
            <div class="stat-box"><div class="val ${sgClass(s.sgPerShot)}">${fmtSG(s.sgPerShot)}</div><div class="lbl">SG / shot</div></div>
          </div>
          <p class="tiny" style="margin-top:10px">${s.shots} shot${s.shots === 1 ? '' : 's'} from inside 30 yards${s.holed ? `, ${s.holed} holed` : ''}.
            Up &amp; down is ${s.upDown.made} of ${s.upDown.chances} holes where the green was missed in regulation and you still made par or better.</p>`
          : '<p class="muted">No shots from inside 30 yards logged yet.</p>'}
      </div>`;
  }
  return `${headline}
    ${renderPuttingCard(puttingBuckets(rounds, bench()))}`;
}

function renderStatsOverview(ctx) {
  const { allRounds, rounds, holesPlayed, avg, avgTotal, game } = ctx;
  const gir = greensInRegulation(rounds);
  const tee = teeOutcomes(rounds, bench());
  const putts = puttingBuckets(rounds, bench());
  const nineCount = rounds.filter((r) => playedHoles(r).length <= 9).length;
  const profile = handicapProfile({ ...avg, total: avgTotal });
  const implied = rollingImplied(rounds, { window: store.getHandicapWindow() });

  const parts = game ? game.profile.rows.slice().sort((a, b) => b.handicap - a.handicap) : [];

  return `
    ${game ? `
      <div class="card" style="border-top:none;padding-top:14px">
        <div class="eyebrow">Plays like &middot; ${rounds.length} round${rounds.length === 1 ? '' : 's'}</div>
        <h2 style="font-size:40px;margin:4px 0 0">Plays like <em class="${game.profile.overall <= 18 ? 'sg-pos' : ''}" style="font-style:italic">${esc(handicapWords(game.profile.overall))}.</em></h2>
      </div>` : ''}

    ${renderTrendCard(trendSeries(allRounds, bench()), null, { choices: ['total', 'toPar'] })}

    ${parts.length ? `
      <div class="card">
        <div class="eyebrow" style="margin-bottom:4px">Where the strokes go</div>
        ${parts.map((row) => {
          const good = row.handicap <= game.profile.overall + 0.5;
          return `<button class="row" data-action="stats-tab" data-tab="${row.category}" style="min-height:44px;padding:10px 0">
            <div class="row-meta"><div class="rname" style="font-weight:500">${esc(CATEGORY_LABELS[row.category])}</div></div>
            ${sgValue(avg[row.category], 'round', 'width:96px')}
            <div class="row-val ${good ? 'sg-pos' : 'sg-neg'}" style="width:40px;text-align:right">${row.handicap <= 0.5 ? 'scr' : esc(fmtHandicapShort(row.handicap))}</div>
            <div class="row-val" style="width:14px;text-align:right">&rsaquo;</div>
          </button>`;
        }).join('')}
        <p class="tiny" style="margin-top:8px">Strokes gained per 18, then the handicap each part plays like. Tap one for the detail.</p>
      </div>` : ''}

    <div class="card">
      <h2>Scoring</h2>
      <p class="muted" style="margin:-4px 0 8px">Across ${rounds.length} round${rounds.length === 1 ? '' : 's'}${nineCount ? ` (${nineCount} of them nine holes)` : ''}, ${holesPlayed} holes.</p>
      <div class="stat-grid g4">
        <div class="stat-box"><div class="val">${gir.pct}%</div><div class="lbl">Greens</div></div>
        <div class="stat-box"><div class="val">${tee.fairwayPct}%</div><div class="lbl">Fairways</div></div>
        <div class="stat-box"><div class="val">${(rounds.reduce((s, r) => s + roundScore(r), 0) / rounds.length).toFixed(1)}</div><div class="lbl">Avg score</div></div>
        <div class="stat-box"><div class="val">${(putts.reduce((s, b) => s + b.putts, 0) / holesPlayed * 18).toFixed(1)}</div><div class="lbl">Putts/18</div></div>
      </div>
      ${gir.byPar.length > 1 ? `
        <label>Greens in regulation by par</label>
        <div class="stat-grid" style="grid-template-columns:repeat(${gir.byPar.length},minmax(0,1fr))">
          ${gir.byPar.map((row) => `
            <div class="stat-box">
              <div class="val" style="font-size:15px">${row.pct}%</div>
              <div class="lbl">Par ${row.par}</div>
              <div class="tiny">${row.greens}/${row.holes}</div>
            </div>`).join('')}
        </div>` : ''}
      <div style="text-align:center;margin-top:12px">
        <span class="muted">Total strokes gained per 18 </span>
        <span class="mono ${sgClass(avgTotal)}" style="font-size:16px;font-weight:700">${fmtSG(avgTotal)}</span>
      </div>
    </div>

    ${renderHandicapCard(profile, {
      implied,
      subtitle: `Across ${rounds.length} round${rounds.length === 1 ? '' : 's'}, ${holesPlayed} holes. Each part of your game translated to the handicap that normally plays it that well.`,
    })}

    ${renderNemesisCard(rounds)}
    ${renderBestsCard(personalBests(rounds, bench()), allRounds)}

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
 * Strokes gained per 18, one point per round, oldest to newest.
 *
 * Drawn as inline SVG rather than pulling in a charting library: it
 * is one line and a zero rule, it inherits the theme through CSS
 * variables, and it keeps the app dependency-free and offline.
 */
function renderTrendCard(allSeries, forcedKey, { choices = ['toPar', 'total', ...CATEGORIES] } = {}) {
  const key = forcedKey || (choices.includes(STATE.trendKey) ? STATE.trendKey : (choices.includes('total') ? 'total' : choices[0]));
  // Overview offers the whole-game views; a part's own tab draws only
  // that part, so moving between them reads as zooming in, not leaving.
  const switches = forcedKey ? [] : choices.map((k) => [k, k === 'toPar' ? 'Score' : k === 'total' ? 'Total SG' : CATEGORY_SHORT[k]]);
  const title = CATEGORIES.includes(forcedKey) ? `Trend &middot; ${CATEGORY_LABELS[forcedKey]}` : 'Trend';
  // Score is the one measure a score-only round can contribute to.
  const series = key === 'toPar' ? allSeries : allSeries.filter((p) => !p.scoreOnly);
  const excluded = allSeries.length - series.length;

  if (series.length < 2) {
    return series.length === 1 || allSeries.length ? `<div class="card">
      <h2>${title}</h2>
      <p class="muted">${series.length === 1
        ? 'One round in. A second will start the line.'
        : 'No rounds with shot data yet — switch to Score to include score-only rounds.'}</p>
      ${allSeries.length > 1 && switches.length > 1 ? `<div class="chip-grid" style="grid-template-columns:repeat(${switches.length},1fr);gap:6px">
        ${switches.map(([k, label]) => `
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

  /*
   * Round to round, this line is mostly noise: one hot putting day
   * moves it further than a month of getting better does. The rolling
   * mean is the part worth reading, so it is drawn on top and on by
   * default, with the raw line left underneath rather than replaced —
   * a smoothed line alone hides how erratic the scoring actually is.
   */
  const smoothWindow = 5;
  const smoothOn = STATE.trendSmooth !== false && series.length >= 4;
  const smoothed = smoothOn ? rollingMean(values, smoothWindow) : null;
  const smoothPath = smoothed
    ? smoothed.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
    : '';

  const first = values[0];
  const last = values[values.length - 1];
  const change = last - first;
  const best = Math.max(...values);

  return `<div class="card">
    <div class="split">
      <h2>${title}</h2>
      <span class="tiny">${series.length} rounds</span>
    </div>
    ${switches.length > 1 ? `<div class="chip-grid" style="grid-template-columns:repeat(${switches.length},1fr);gap:6px">
      ${switches.map(([k, label]) => `
        <button class="chip ${key === k ? 'active' : ''}" data-trend="${k}"
                style="padding:7px 0;font-size:11px;min-height:36px">${label}</button>
      `).join('')}
    </div>` : ''}

    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;margin-top:6px"
         role="img" aria-label="Strokes gained per 18 holes by round">
      <path d="${area}" fill="var(--green-mid)" opacity="0.12"></path>
      <line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}"
            stroke="var(--green-line)" stroke-width="1" stroke-dasharray="3 3"></line>
      <text x="${padL - 4}" y="${zeroY}" text-anchor="end" dominant-baseline="middle"
            font-size="9" fill="var(--ink-faint)" font-family="Martian Mono, monospace">0</text>
      ${/* Skip an end label that would sit on top of the zero rule. */ ''}
      ${Math.abs(y(max) - y(0)) > 11 ? `<text x="${padL - 4}" y="${padT + 4}" text-anchor="end"
            font-size="9" fill="var(--ink-faint)" font-family="Martian Mono, monospace">${max.toFixed(0)}</text>` : ''}
      ${Math.abs(y(min) - y(0)) > 11 ? `<text x="${padL - 4}" y="${H - padB}" text-anchor="end"
            font-size="9" fill="var(--ink-faint)" font-family="Martian Mono, monospace">${min.toFixed(0)}</text>` : ''}
      <path d="${line}" fill="none" stroke="var(--flag)" stroke-width="${smoothOn ? 1.2 : 2}"
            stroke-linejoin="round" stroke-linecap="round"
            opacity="${smoothOn ? 0.45 : 1}"></path>
      ${smoothPath ? `<path d="${smoothPath}" fill="none" stroke="var(--green-mid)"
            stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"></path>` : ''}
      ${series.map((p, i) => `
        <circle cx="${x(i).toFixed(1)}" cy="${y(p[key]).toFixed(1)}" r="${smoothOn ? 2.4 : 3.5}"
                fill="var(--paper)" stroke="var(--flag)" stroke-width="${smoothOn ? 1.4 : 2}"
                opacity="${smoothOn ? 0.6 : 1}"></circle>
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
    ${series.length >= 4 ? `
      <div class="chip-grid g2" style="gap:6px">
        <button class="chip ${smoothOn ? 'active' : ''}" data-smooth="on"
                style="padding:7px 0;font-size:11px;min-height:36px">${smoothWindow}-round average</button>
        <button class="chip ${smoothOn ? '' : 'active'}" data-smooth="off"
                style="padding:7px 0;font-size:11px;min-height:36px">Every round</button>
      </div>` : ''}

    <p class="tiny" style="margin-top:8px">Per 18 holes, so nines sit on the same scale. Higher is better; the dashed line is ${
      key === 'toPar' ? 'level par (shown inverted, so up is still better)' : `${esc(benchName())} average`
    }.${smoothOn ? ` The heavy line is a trailing ${smoothWindow}-round average — one good putting day moves the faint line more than a month of improvement does.` : ''}${
      excluded ? ` ${excluded} score-only round${excluded === 1 ? '' : 's'} left out — switch to Score to include ${excluded === 1 ? 'it' : 'them'}.` : ''}</p>
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
    <p class="muted">Where tee shots on par 4s and 5s finished, and what each outcome cost. Tap a row to see the shots.</p>
    ${tee.rows.map((row) => drillRow(`tee:${row.lie}`, `
        <div class="badge" style="font-size:12px">${Math.round((row.count / tee.total) * 100)}%</div>
        <div class="row-meta">
          <div class="rname">${LIE_LABELS[row.lie] || esc(row.lie)}${thinMark(row.count)}</div>
          <div class="rsub">${row.count} of ${tee.total} tee shots</div>
        </div>
        ${sgValue(row.sg / row.count)}`,
      thinStyle(row.count), row.detail, shotPath)).join('')}
    <p class="tiny" style="margin-top:8px">Strokes gained per shot vs ${esc(benchName())}. A miss that costs little is not the miss to fix.</p>
  </div>`;
}

/**
 * A distance band as a left-hand label column ("100–150" over "YDS").
 * Ranges are too wide for a round badge in a monospace face.
 */
function rangeTag(label, unit) {
  const range = String(label).replace(/ft/g, '').replace('-', '–');
  return `<div class="range-tag"><span>${esc(range)}</span><small>${unit}</small></div>`;
}

function renderPuttingCard(putts) {
  if (!putts.length) return '';
  return `<div class="card">
    <h2>Putting</h2>
    <p class="muted">Grouped by how far away your first putt was. Strokes gained is per hole, counting every putt it took. Tap a row to see the putts.</p>
    ${putts.map((b) => drillRow(`putt:${b.label}`, `
        ${rangeTag(b.label, 'ft')}
        <div class="row-meta">
          <div class="rname">Made ${b.holed} of ${b.holes} first putt${b.holes === 1 ? '' : 's'} (${Math.round((b.holed / b.holes) * 100)}%)${thinMark(b.holes)}</div>
          <div class="rsub">${(b.putts / b.holes).toFixed(1)} putts a hole${b.threePutts ? ` &middot; ${b.threePutts} three-putt${b.threePutts === 1 ? '' : 's'}` : ''}</div>
        </div>
        ${sgValue(b.sg / b.holes, 'hole')}`,
      thinStyle(b.holes), b.detail,
      (s) => `${fmtDist(s.startDist, s.startUnit)} &rarr; ${s.holed ? '<strong>holed</strong>' : `missed, ${fmtDist(s.endDist, s.endUnit)} left`}`)).join('')}
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
function renderHandicapCard(profile, { subtitle, caveat, implied } = {}) {
  /*
   * "Plays like" comes from one of two places, and the card says
   * which. When there are enough shots, it is SOLVED from them: the
   * handicap level at which that part of the game would have come out
   * level, given where the ball actually was. When there are not, it
   * falls back to the fixed category shares — a description of golfers
   * in general rather than of this one — and is marked with a degree
   * sign so a modelled figure never passes as a measured one.
   */
  const impliedFor = (category) => {
    if (!implied) return null;
    const row = implied.rows.find((r) => r.category === category);
    if (!row || row.handicap == null || row.thin) return null;
    return row;
  };

  const anySolved = profile.rows.some((row) => impliedFor(row.category));
  const thinRows = implied
    ? implied.rows.filter((r) => r.thin || r.handicap == null)
    : [];

  return `<div class="card">
    <h2>${profile.overall <= 0.5 ? 'You play like scratch' : `You play like a ${fmtHandicap(profile.overall)}`}</h2>
    ${subtitle ? `<p class="muted">${subtitle}</p>` : ''}
    <div class="card-editor">
      <div class="hdr" style="grid-template-columns:minmax(0,1fr) 56px 62px 58px">
        <span>Part of the game</span>
        <span style="text-align:center">SG/18</span>
        <span style="text-align:center">Plays like</span>
        <span style="text-align:center">Upside</span>
      </div>
      ${profile.rows.map((row) => {
        const solved = impliedFor(row.category);
        const level = solved ? solved.handicap : row.handicap;
        // The read on strong or weak is relative to the rest of the
        // game either way, so it follows whichever figure is shown.
        const gap = profile.overall - level;
        return `<div class="line" style="grid-template-columns:minmax(0,1fr) 56px 62px 58px">
          <span>
            <strong>${CATEGORY_LABELS[row.category]}</strong>
            <span class="tiny">${
              gap < -1 ? 'holding you back'
              : gap > 1 ? 'ahead of the rest'
              : 'in line with the rest'
            }${solved ? ` &middot; ${solved.shots} shots` : ''}</span>
          </span>
          <span class="mono ${sgClass(row.sg)}" style="text-align:center;font-size:12px">${fmtSG(row.sg)}</span>
          <span class="mono" style="text-align:center;font-size:13px;font-weight:700;color:${
            gap < -1 ? 'var(--flag)' : gap > 1 ? 'var(--green-mid)' : 'var(--ink-soft)'
          }">${solved ? esc(fmtImpliedShort(solved)) : fmtHandicapShort(row.handicap) + "&deg;"}</span>
          <span class="mono tiny" style="text-align:center">${
            upsideFor(row) >= 0.1 ? '−' + upsideFor(row).toFixed(1) : '—'
          }</span>
        </div>`;
      }).join('')}
    </div>
    <p class="tiny" style="margin-top:10px">
      <strong>Upside</strong> is the strokes per 18 saved by lifting that part of the game to the level of the rest &mdash; not to scratch, just to your own standard.
      ${profile.weakest && profile.weakest.gapToOverall < -1
        ? ` Here that is <strong>${CATEGORY_LABELS[profile.weakest.category]}</strong>, worth about ${upsideFor(profile.weakest).toFixed(1)} shots.`
        : ' Fairly even across the board.'}
    </p>
    ${implied ? `<p class="tiny"><strong>Plays like</strong> is solved from your own shots over the last ${
      implied.rounds
    } round${implied.rounds === 1 ? '' : 's'}: the standard at which that part of the game would have come out level, given where the ball actually finished.${
      implied.weakest ? ` The weakest is <strong>${CATEGORY_LABELS[implied.weakest.category]}</strong>, playing like ${esc(fmtImplied(implied.weakest))}.` : ''
    }${
      profile.rows.some((r) => { const s = impliedFor(r.category); return s && s.belowRange; })
        ? ' A figure written with a plus, as on a scorecard, is better than scratch.' : ''
    }${
      thinRows.length ? ` ${thinRows.map((r) => CATEGORY_LABELS[r.category]).join(' and ')} ${
        thinRows.length === 1 ? 'has' : 'have'
      } under ${MIN_CATEGORY_SHOTS} shots in that window, so ${
        thinRows.length === 1 ? 'it falls' : 'they fall'
      } back to the model &mdash; marked &deg;.` : ''}${
      !anySolved ? ' Nothing has enough shots yet, so every figure here is modelled.' : ''
    }</p>` : ''}
    <p class="tiny">${caveat || 'The total is anchored on scoring, which is solid. A per-category figure marked &deg; is the general model rather than your shots, and is indicative — good for spotting the weak spot, not for arguing over a decimal.'}</p>
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
  const { worst, best, considered } = nemesisHoles(rounds, { minPlays: 2, count: 3, baseline: bench() });
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

/** Most shots listed under an opened row before the rest are summarised. */
const DRILL_LIMIT = 25;

/**
 * A stats row that opens in place to list the shots behind it — the
 * same drop-down as a hole in Hole by hole, so the numbers can be
 * checked against what actually happened rather than taken on trust.
 *
 * `inner` is the row's usual contents; `line` describes one shot. When
 * the shots come from more than one round, each is labelled with its
 * date and course, since "hole 7" alone would be ambiguous.
 */
function drillRow(key, inner, style, detail, line) {
  const open = STATE.openDrill === key;
  const multi = new Set(detail.map((d) => d.round.id)).size > 1;
  const shown = detail.slice()
    .sort((a, b) => (new Date(b.round.date) - new Date(a.round.date)) || (a.hole.hole - b.hole.hole) || (a.shot.n - b.shot.n))
    .slice(0, DRILL_LIMIT);
  return `<button class="row drill-row${open ? ' is-open' : ''}" data-action="toggle-drill" data-key="${esc(key)}"
      aria-expanded="${open}" style="${style}">${inner}</button>
    ${open ? `<div class="drill-list">
      ${shown.map((d) => `
        <div class="shot-line" style="padding:5px 0">
          <span class="desc tiny">${multi ? `${esc(fmtDate(d.round.date))} &middot; ${esc(d.round.courseName)} &middot; ` : ''}Hole ${d.hole.hole}${
            d.shot.club ? ` &middot; ${esc(d.shot.club)}` : ''} &middot; ${line(d.shot)}</span>
          <span class="mono ${sgClass(d.sg)}" style="font-size:12px">${fmtSG(d.sg)}</span>
        </div>`).join('')}
      ${detail.length > shown.length ? `<p class="tiny" style="margin:4px 0 0">And ${detail.length - shown.length} older.</p>` : ''}
    </div>` : ''}`;
}

/** Where a shot started and finished, in words. */
function shotPath(shot) {
  const to = shot.holed ? 'holed' : `${LIE_LABELS[shot.endLie]} ${fmtDist(shot.endDist, shot.endUnit)}`;
  const miss = shot.miss && shot.miss !== 'target' ? ` &middot; ${esc(MISS_LABELS[shot.miss])}` : '';
  const pen = shot.penalty ? ` &middot; +${shot.penalty} pen` : '';
  return `${LIE_LABELS[shot.startLie]} ${fmtDist(shot.startDist, shot.startUnit)} &rarr; ${esc(to)}${miss}${pen}`;
}

function renderApproachCard(buckets) {
  if (!buckets.length) return '';
  const thin = buckets.filter((b) => b.shots < THIN_SAMPLE).length;
  return `<div class="card">
    <h2>Approach play</h2>
    <p class="muted">Strokes gained and average proximity by distance. Approach starts at 30 yards &mdash; anything closer counts as short game. Tap a row to see the shots.</p>
    ${/*
       The chart says which yardage is bleeding shots; the rows below
       carry the proximity and the counts, which a chart cannot hold
       without becoming three charts.
    */''}
    ${approachByDistanceChart(buckets, { thinBelow: THIN_SAMPLE, label: benchName() })}
    ${buckets.map((b) => drillRow(`app:${b.label}`, `
        ${rangeTag(b.label, 'yds')}
        <div class="row-meta">
          <div class="rname">${b.shots} shot${b.shots === 1 ? '' : 's'}${thinMark(b.shots)}</div>
          <div class="rsub">${b.proximityCount
            ? `Found the green ${b.proximityCount} of ${b.shots}, ${Math.round(b.proximitySum / b.proximityCount)}ft away on average`
            : 'never finished on the green'}</div>
        </div>
        ${sgValue(b.sg / b.shots)}`,
      thinStyle(b.shots), b.detail, shotPath)).join('')}
    <p class="tiny" style="margin-top:8px">Bars and figures are the per-shot average, with the number of shots under each band. The bucket costing most per swing is where practice pays${
      thin ? `, but ${thin === 1 ? 'the faded row has' : 'faded rows have'} under ${THIN_SAMPLE} shots &mdash; not enough to trust yet` : ''
    }.</p>
  </div>`;
}

function renderBestsCard(bests, allRounds) {
  const items = [];
  const when = (b) => `${esc(b.course)} &middot; hole ${b.hole}`;

  // Best round is about scoring, so a score-only round is eligible
  // even though it can contribute to nothing else here.
  const scoringBest = personalBests(allRounds || [], bench()).bestRound;
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

/*
 * Where each miss direction sits around the green, in degrees with
 * y pointing down the screen: short is below the green, long above.
 */
const GREEN_ANGLES = {
  right: 0, 'short-right': 45, short: 90, 'short-left': 135,
  left: 180, 'long-left': 225, long: 270, 'long-right': 315,
};

/** A small repeatable random source, so dots hold still between renders. */
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Below this many approaches, the green is drawn but not read aloud. */
const GREEN_MIN_SHOTS = 8;

/**
 * Approaches as a picture: a green seen from above with one ball for
 * every 1% of shots, on the green or in the direction they missed.
 * The point is that nobody needs telling how to read it — balls short
 * of the green are shots that came up short.
 */
function renderGreenCard(rounds) {
  const band = GREEN_BANDS.find((b) => b.key === STATE.greenBand) || GREEN_BANDS[0];
  const g = approachGreen(rounds, bench(), band);
  const all = band.key === 'all' ? g : approachGreen(rounds, bench());
  if (!all.total) return '';

  const verdict = greenVerdict(g);
  const thin = g.total < GREEN_MIN_SHOTS;
  const pct = (n) => (g.total ? Math.round((n / g.total) * 100) : 0);

  const W = 460;
  const H = 270;
  const cx = W / 2;
  const cy = H / 2;
  const rx = 80;
  const ry = 58;

  // The miss sector that happens most is the one drawn in the flag colour.
  const worstDir = Object.keys(g.byDir).sort((a, b) => g.byDir[b] - g.byDir[a])[0];

  const dots = [];
  const rand = seededRandom(band.lo * 7 + 11);
  for (let i = 0; i < pct(g.onGreen); i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 0.82;
    dots.push(`<circle cx="${(cx + Math.cos(a) * r * rx).toFixed(1)}" cy="${(cy + Math.sin(a) * r * ry).toFixed(1)}" r="4.2" fill="var(--gain)"/>`);
  }
  const labels = [];
  Object.entries(GREEN_ANGLES).forEach(([dir, deg], k) => {
    const n = pct(g.byDir[dir] || 0);
    const dirRand = seededRandom(band.lo * 7 + k * 101 + 3);
    const colour = dir === worstDir ? 'var(--loss)' : 'var(--text-3)';
    for (let i = 0; i < n; i++) {
      const a = ((deg + (dirRand() - 0.5) * 34) * Math.PI) / 180;
      const t = 1.22 + dirRand() * 0.5;
      dots.push(`<circle cx="${(cx + Math.cos(a) * t * rx).toFixed(1)}" cy="${(cy + Math.sin(a) * t * ry).toFixed(1)}" r="4.2" fill="${colour}"/>`);
    }
    if (n) {
      const rad = (deg * Math.PI) / 180;
      // Labels sit outside the ring of balls and read away from the
      // green, so a busy sector never prints over its own dots.
      const side = Math.abs(Math.cos(rad)) > 0.3;
      const lx = cx + Math.cos(rad) * (side ? 1.9 : 0) * rx;
      const ly = cy + Math.sin(rad) * 2.02 * ry + 4;
      const anchor = Math.cos(rad) > 0.3 ? 'start' : Math.cos(rad) < -0.3 ? 'end' : 'middle';
      labels.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" class="green-label" fill="${dir === worstDir ? 'var(--loss)' : 'var(--text-2)'}">${esc(MISS_LABELS[dir].toUpperCase())} ${n}%</text>`);
    }
  });

  return `<div class="card">
    <h2>Where approaches finish</h2>
    <p class="muted">Each ball is 1% of your approaches from 30 yards and out. Green balls found the green.</p>
    <div class="chip-grid green-chips">
      ${GREEN_BANDS.map((b) => `<button class="chip ${b.key === band.key ? 'active' : ''}" data-green-band="${b.key}"
          aria-pressed="${b.key === band.key}">${b.label}</button>`).join('')}
    </div>
    ${g.total ? `
      <svg class="green-map" viewBox="0 0 ${W} ${H}" role="img" style="${thin ? 'opacity:0.55' : ''}"
           aria-label="${pct(g.onGreen)}% on the green, ${pct(g.shortCount)}% short, ${pct(g.longCount)}% long, ${pct(g.leftCount)}% left, ${pct(g.rightCount)}% right">
        <ellipse cx="${cx}" cy="${cy}" rx="${rx + 9}" ry="${ry + 8}" fill="none" stroke="var(--gain)" stroke-opacity="0.35" stroke-dasharray="3 4"/>
        <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="var(--gain)" fill-opacity="0.13" stroke="var(--gain)" stroke-opacity="0.6"/>
        <line x1="${cx + 6}" y1="${cy - 4}" x2="${cx + 6}" y2="${cy - 30}" stroke="var(--text)" stroke-width="1.4"/>
        <path d="M${cx + 6} ${cy - 30} l14 5 l-14 5 z" fill="var(--loss)"/>
        <circle cx="${cx + 6}" cy="${cy - 3}" r="2.6" fill="var(--text)"/>
        ${dots.join('')}
        ${labels.join('')}
      </svg>
      <div class="green-read">
        <div class="green-stat"><strong class="mono">${pct(g.onGreen)}%</strong><span>on the green</span></div>
        <div class="green-stat"><strong class="mono">${g.total}</strong><span>approach${g.total === 1 ? '' : 'es'}</span></div>
      </div>
      ${thin
        ? `<p class="tiny"><span class="thin-tag">LOW SAMPLE</span> Only ${g.total} approach${g.total === 1 ? '' : 'es'} from here &mdash; not enough to read a pattern yet.</p>`
        : `<h3 class="green-headline">${esc(verdict.headline)}</h3>
           <p style="margin:2px 0 6px">${esc(verdict.body)}</p>
           <p class="eyebrow" style="margin:0">${esc(verdict.line)}</p>`}
      ${g.other ? `<p class="tiny" style="margin-top:6px">${pct(g.other)}% missed the green with no direction logged, so they are not drawn.</p>` : ''}`
      : '<p class="muted">No approaches from this distance yet.</p>'}
    <details class="more-numbers">
      <summary>Show the numbers</summary>
      ${renderMissCard('Approach misses', missTally(rounds, 'app', bench()))}
    </details>
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

  /*
   * Two readings of the same nine cells. Frequency says where the ball
   * goes; cost says whether it matters. They are genuinely different
   * pictures — a miss you make constantly that costs nothing is not
   * the miss to work on, and the frequency grid alone cannot say so.
   */
  const byCost = STATE.missMode === 'cost';

  /*
   * Shading in the cost view is relative to the worst direction, with
   * a floor under it. Without the floor, a set of misses that between
   * them cost three hundredths of a shot would still paint one cell
   * bright red for being the worst of a harmless bunch — technically
   * true, and a completely wrong impression.
   */
  const worstCost = Math.max(0.15, ...MISS_GRID.flat().map((dir) => {
    const count = tally[dir] || 0;
    return count ? Math.abs(Math.min(0, (stats.sgByDir[dir] || 0) / count)) : 0;
  }));

  const cells = MISS_GRID.flat().map((dir) => {
    const count = tally[dir] || 0;
    const share = total ? Math.round((count / total) * 100) : 0;
    const avg = count ? (stats.sgByDir[dir] || 0) / count : 0;

    // A direction that gains gets no tint at all. Giving it the faint
    // baseline wash every other cell starts from would have it read as
    // mildly costly, which is the opposite of what it is.
    const strength = !count || (byCost && avg >= 0) ? 0
      : byCost
        ? Math.min(0.14 + (Math.abs(avg) / worstCost) * 1.05, 1)
        : Math.min(0.14 + (count / total) * 1.1, 1);
    // Cost shades in the flag colour, frequency in green, so the two
    // views are never mistaken for each other at a glance.
    const rgb = byCost ? '168,57,31' : '62,107,87';
    const style = strength
      ? `background:rgba(${rgb},${strength.toFixed(2)});border-color:${byCost ? 'var(--flag)' : 'var(--green-mid)'}`
      : '';

    return `<div class="miss-cell ${dir === 'target' ? 'center' : ''}" style="${style}"
      title="${esc(MISS_LABELS[dir])}">
      ${count
        ? `<span><strong class="mono">${byCost ? fmtSG(avg) : count}</strong><br><span class="tiny">${
            byCost ? `${count} shot${count === 1 ? '' : 's'}` : `${share}%`
          }</span></span>`
        : '&middot;'}
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
    <p class="muted">${total} logged. Centre is on target; darker means ${
      byCost ? 'more costly per shot' : 'more often'
    }.</p>
    <div class="chip-grid g2" style="gap:6px">
      <button class="chip ${byCost ? '' : 'active'}" data-miss-mode="count"
              style="padding:7px 0;font-size:11px;min-height:36px">How often</button>
      <button class="chip ${byCost ? 'active' : ''}" data-miss-mode="cost"
              style="padding:7px 0;font-size:11px;min-height:36px">What it costs</button>
    </div>
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

/* --- Clubhouse -----------------------------------------------------
   Two views. Field: the season table and where everybody sits on
   each part of the game. Head to head: you against one other player,
   part by part. "Plays like" — the handicap that normally plays a
   part of the game that well — is the headline number throughout,
   because it is the scale golfers already think in.
------------------------------------------------------------------ */

/**
 * Each player's marker: a circle with an initial, told apart by fill
 * as well as colour — you solid in the gain colour, then solid ink,
 * then outline, then dashed outline, then solid loss colour.
 */
function playerMarkers(players) {
  const others = players.filter((p) => p !== STATE.player).sort();
  const order = players.includes(STATE.player) ? [STATE.player, ...others] : others;
  const styles = ['me', 'solid', 'outline', 'dashed', 'loss'];
  const initials = new Map();
  order.forEach((p) => {
    let tag = String(p).charAt(0).toUpperCase();
    // Two players with the same initial get two letters each.
    if (order.some((q) => q !== p && String(q).charAt(0).toUpperCase() === tag)) tag = String(p).slice(0, 2);
    initials.set(p, tag);
  });
  const map = new Map();
  order.forEach((p, i) => map.set(p, {
    initial: initials.get(p),
    avatar: avatarOf(p),
    style: styles[i % styles.length],
  }));
  return map;
}

/**
 * Saved on this phone at once so it shows straight away, then sent to
 * the sheet for everyone else. An older sheet script quietly drops the
 * field, and the note says so rather than pretending it worked.
 */
async function saveAvatar(avatar) {
  store.setPref('avatar', avatar);
  render();
  if (!sync.isConfigured()) return;
  try {
    const kept = await sync.pushAvatar(STATE.player, avatar);
    STATE.notice = kept
      ? 'Marker saved. Everyone sees it on their next sync.'
      : 'Saved on this phone. The others will see it once the sheet script is updated and redeployed.';
  } catch (err) {
    STATE.notice = 'Saved on this phone. It will reach the others when you are back online.';
  }
  if (STATE.screen === 'settings') render();
}

/** Settings: pick the icon on your marker, or keep your initial. */
function renderAvatarPicker() {
  if (!STATE.player) return '';
  const current = avatarOf(STATE.player);
  const initial = String(STATE.player).charAt(0).toUpperCase();
  const option = (key, inner, label) => `
    <button class="avatar-opt ${current === key ? 'active' : ''}" data-action="set-avatar" data-avatar="${key}"
            aria-label="${esc(label)}" aria-pressed="${current === key}">
      <span class="pmark pm-me">${inner}</span>
    </button>`;
  return `<div class="card">
    <h2>Your marker</h2>
    <p class="muted">How you show up in the Clubhouse. Everyone else sees it once your phone syncs.</p>
    <div class="avatar-grid">
      ${option('', esc(initial), 'Your initial')}
      ${Object.entries(AVATARS).map(([key, a]) => option(key, avatarSvg(key, 22), a.label)).join('')}
      <button class="avatar-opt ${emojiOf(current) ? 'active' : ''}" data-action="emoji-entry"
              aria-label="Use an emoji" aria-pressed="${!!emojiOf(current)}">
        <span class="pmark pm-me">${emojiOf(current) ? avatarSvg(current, 22) : '<span class="emoji-plus">&#9786;</span>'}</span>
      </button>
    </div>
    ${STATE.emojiEntry ? `
      <div class="emoji-entry">
        <label for="emojiInput">One emoji</label>
        <div style="display:flex;gap:8px">
          <input type="text" id="emojiInput" inputmode="text" autocomplete="off" autocorrect="off"
                 placeholder="🐦" value="${esc(emojiOf(current) || '')}" style="font-size:24px;text-align:center">
          <button class="btn-primary" data-action="save-emoji" style="width:auto;min-height:var(--tap)">Use</button>
        </div>
        <p class="tiny">Switch to the emoji keyboard and pick one. Each phone draws emoji its own way, so it may look a little different on everyone else&rsquo;s.</p>
        ${STATE.emojiError ? `<div class="err-box">${esc(STATE.emojiError)}</div>` : ''}
      </div>` : ''}
  </div>`;
}

/**
 * The icon a player chose, or '' for their initial — which is the
 * default and what everyone has until they pick something. Your own
 * choice is read from this phone first, so it shows straight away
 * even before (or without) the sheet having it.
 */
function avatarOf(player) {
  const name = String(player || '').toLowerCase();
  if (name === String(STATE.player || '').toLowerCase()) {
    const mine = store.getPrefs().avatar;
    if (mine !== undefined) return isAvatar(mine) ? mine : '';
  }
  const row = store.getPlayers().find((p) => String(p.player).toLowerCase() === name);
  return row && isAvatar(row.avatar) ? row.avatar : '';
}

function markerHtml(marker, extra = '') {
  return `<span class="pmark pm-${marker.style}" ${extra}>${
    marker.avatar ? avatarSvg(marker.avatar, 17) : esc(marker.initial)
  }</span>`;
}

function screenClubhouse() {
  const all = store.getRounds();
  const players = [...new Set(all.map((r) => r.player))].filter(Boolean).sort();
  const view = STATE.clubView === 'h2h' ? 'h2h' : 'field';

  const head = `<header class="topbar">
      <div class="brand">Clubhouse</div>
      <div class="sub">${all.length} round${all.length === 1 ? '' : 's'} &middot; vs tour</div>
    </header>`;

  if (players.length === 0) {
    return `${head}
      <div class="card"><div class="empty">Nobody has logged a round yet.</div></div>`;
  }

  const markers = playerMarkers(players);

  return `${head}
    ${notices()}
    <div class="seg" role="tablist" style="margin-top:14px">
      <button role="tab" aria-selected="${view === 'field'}" class="${view === 'field' ? 'active' : ''}" data-action="club-view" data-view="field">Field</button>
      <button role="tab" aria-selected="${view === 'h2h'}" class="${view === 'h2h' ? 'active' : ''}" data-action="club-view" data-view="h2h">Head to head</button>
    </div>
    ${view === 'field'
      ? `${renderStandings(all, markers)}${renderWhoPlaysWhat(all, players, markers)}${renderSharedHoles(all, players)}`
      : renderHeadToHead(all, players, markers)}`;
}

/**
 * One player, opened by tapping their name on the Club tab: their
 * book, their recent rounds and their bests. Nothing here that the
 * Rounds and Club tabs do not already show — it gathers it in one place.
 */
function screenPlayer() {
  const player = STATE.viewPlayer;
  const all = store.getRounds();
  const theirs = all.filter((r) => r.player === player);
  if (!player || !theirs.length) return screenClubhouse();

  const players = [...new Set(all.map((r) => r.player))].filter(Boolean);
  const marker = playerMarkers(players).get(player);
  const self = player === STATE.player;
  const summary = playerSummary(player, all, 'tour');
  const plays = summary.sg ? handicapForTotal(summary.sg.total) : null;
  const bests = summary.bests;
  const bestRows = [
    ['Best round', bests.bestRound ? `${fmtToPar(bests.bestRound.toPar)} &middot; ${esc(bests.bestRound.course || '')}` : null],
    ['Longest drive', bests.longestDrive ? `${bests.longestDrive.yards}y` : null],
    ['Closest approach', bests.closestApproach ? `${Math.round(bests.closestApproach.feet)}ft` : null],
    ['Longest putt', bests.longestPutt ? `${Math.round(bests.longestPutt.feet)}ft` : null],
  ].filter(([, v]) => v);

  return `<header class="topbar">
      <div class="brand">${esc(player)}</div>
      <div class="sub">${theirs.length} round${theirs.length === 1 ? '' : 's'}${plays == null ? '' : ` &middot; plays like ${esc(fmtHandicapShort(plays))}`}</div>
    </header>
    ${notices()}
    <div style="display:flex;align-items:center;gap:12px;margin:14px 0 4px">
      ${marker ? markerHtml(marker, 'style="width:44px;height:44px;font-size:16px"') : ''}
      <button class="link-btn muted-link" data-action="goto-club" style="margin-left:auto">&larr; Club</button>
    </div>

    ${renderBook(player)}

    <div class="card">
      <div class="eyebrow" style="margin-bottom:4px">Recent rounds</div>
      ${theirs.slice(0, 5).map((r) => {
        const sg = isScoreOnly(r) ? null : roundTotals(r, bench()).total;
        return `<button class="row" data-action="view-round" data-id="${esc(r.id)}">
          <div class="row-meta">
            <div class="rname" style="font-weight:500">${esc(r.courseName)} <span style="color:var(--text-2)">&middot; ${esc(r.teeName)}</span></div>
            <div class="rsub">${fmtDate(r.date)} &middot; ${playedHoles(r).length} holes</div>
          </div>
          <span class="mono" style="font-size:12px;font-weight:600">${fmtToPar(roundToPar(r))}</span>
          ${sg == null ? '' : `<span class="mono ${sgClass(sg)}" style="font-size:12px;font-weight:600;width:52px;text-align:right">${fmtSG(sg)}</span>`}
        </button>`;
      }).join('')}
    </div>

    ${bestRows.length ? `
      <div class="card">
        <div class="eyebrow" style="margin-bottom:4px">Career bests</div>
        ${bestRows.map(([label, value]) => `
          <div class="row" style="min-height:40px;padding:9px 0">
            <div class="row-meta"><div class="rname" style="font-weight:500">${label}</div></div>
            <span class="mono" style="font-size:12px;font-weight:600">${value}</span>
          </div>`).join('')}
      </div>` : ''}

    ${self ? '' : `
      <div class="card" style="border-top:none;padding-top:4px">
        <button class="btn-primary" data-action="h2h-with" data-player="${esc(player)}">Head to head with ${esc(player)} &rarr;</button>
      </div>`}`;
}

/**
 * The season table, ranked on strokes gained per 18 against tour and
 * shown as the handicap that plays like — the same order either way.
 */
function renderStandings(allRounds, markers) {
  const scope = STATE.standingsScope === 'recent' ? 'recent' : 'season';
  const { rows, minRounds } = standings(allRounds, { scope, baseline: 'tour' });
  const year = new Date().getFullYear();

  const bestOf = (player) => {
    const theirs = allRounds.filter((r) => r.player === player && playedHoles(r).length >= 18);
    if (!theirs.length) return null;
    return Math.min(...theirs.map(roundToPar));
  };
  const move = (row) => {
    if (scope !== 'season' || !row.rank) return '';
    if (row.move == null) return ' &middot; NEW';
    if (row.move > 0) return ` &middot; &#9650;${row.move}`;
    if (row.move < 0) return ` &middot; &#9660;${-row.move}`;
    return '';
  };

  const body = rows.length ? rows.map((row) => {
    const plays = row.sg ? handicapForTotal(row.sg.total) : null;
    const best = bestOf(row.player);
    const details = [
      `${row.rounds} RD${row.rounds === 1 ? '' : 'S'}`,
      row.toParPer18 == null ? null : `${fmtToPar(Math.round(row.toParPer18))}/18`,
      best == null ? null : `BEST ${fmtToPar(best)}`,
    ].filter(Boolean).join(' &middot; ');
    return `<button class="stand-row${row.qualified ? '' : ' is-short'}" data-action="view-player" data-player="${esc(row.player)}"
        aria-label="${esc(row.player)}: open their page">
      <span class="stand-rank">${row.rank || '&ndash;'}</span>
      ${markerHtml(markers.get(row.player) || { initial: '?', style: 'outline' })}
      <div class="stand-name">
        <div class="serif-name">${esc(row.player)}</div>
        <div class="stand-meta">${row.qualified ? details + move(row) : `${minRounds - row.shotRounds} MORE TO QUALIFY`}</div>
      </div>
      <div class="stand-plays">
        <div class="eyebrow" style="font-size:9px">Plays like</div>
        <div class="stand-num ${row.rank === 1 ? 'sg-pos' : ''}">${plays == null ? '&ndash;' : esc(fmtHandicapShort(plays))}</div>
      </div>
    </button>`;
  }).join('') : `<p class="muted" style="margin-top:12px">No rounds ${scope === 'season' ? `in ${year}` : 'in the last 30 days'} yet.</p>`;

  return `<div class="card" style="border-top:none;padding-top:8px">
      <div class="split">
        <div class="seg seg-small">
          <button class="${scope === 'season' ? 'active' : ''}" data-standings="season">${year}</button>
          <button class="${scope === 'recent' ? 'active' : ''}" data-standings="recent">30 days</button>
        </div>
        <span class="eyebrow">Min ${minRounds} rds</span>
      </div>
      <div style="margin-top:10px;border-top:1px solid var(--rule-strong)">${body}</div>
    </div>`;
}

const PART_ROWS = [
  { key: 'total', label: 'Overall', phrase: 'the whole game' },
  { key: 'ott', label: 'Off the tee', phrase: 'the tee' },
  { key: 'app', label: 'Approach', phrase: 'the approach' },
  { key: 'arg', label: 'Short game', phrase: 'the short game' },
  { key: 'putt', label: 'Putting', phrase: 'the greens' },
];

function playsLikeFor(sg, key) {
  if (!sg) return null;
  return key === 'total' ? handicapForTotal(sg.total) : handicapForCategory(key, sg[key]);
}

/**
 * One scale per part of the game with every player's marker on it.
 * Markers that would overlap lift above the line rather than hide
 * each other.
 */
function renderWhoPlaysWhat(allRounds, players, markers) {
  const mode = STATE.wpwMode === 'sg' ? 'sg' : 'plays';
  const summaries = players
    .map((p) => playerSummary(p, allRounds, 'tour'))
    .filter((s) => s.sg);
  if (summaries.length < 2) {
    return `<div class="card">
      <div class="eyebrow">Who plays what</div>
      <p class="muted" style="margin-top:8px">Once a second player logs a round with shots in it, this shows where everyone sits on each part of the game.</p>
    </div>`;
  }

  const valueOf = (s, key) => (mode === 'plays' ? playsLikeFor(s.sg, key) : s.sg[key]);
  const allValues = summaries.flatMap((s) => PART_ROWS.map((r) => valueOf(s, r.key)));
  const lo = mode === 'plays' ? 0 : Math.floor(Math.min(...allValues)) - 1;
  const hi = mode === 'plays' ? 36 : Math.ceil(Math.max(...allValues, 0)) + 1;
  // Plays like: scratch on the left, lower is better. SG: better on the right.
  const pct = (v) => {
    const clamped = Math.min(Math.max(v, lo), hi);
    return ((clamped - lo) / (hi - lo)) * 100;
  };

  const scales = PART_ROWS.map((part) => {
    const points = summaries
      .map((s) => ({ player: s.player, value: valueOf(s, part.key) }))
      .map((p) => ({ ...p, x: pct(p.value) }))
      .sort((a, b) => a.x - b.x);
    // About 24px on a phone-width scale.
    const tiers = [];
    points.forEach((p) => {
      let tier = tiers.findIndex((last) => p.x - last >= 9);
      if (tier === -1) { tier = tiers.length; tiers.push(-Infinity); }
      tiers[tier] = p.x;
      p.tier = tier;
    });

    const ranked = points.slice().sort((a, b) => (mode === 'plays' ? a.value - b.value : b.value - a.value));
    const [first, second] = ranked;
    const gap = Math.abs(first.value - second.value);
    const gapText = mode === 'plays' ? String(Math.round(gap)) : gap.toFixed(1);
    const note = gap < (mode === 'plays' ? 0.5 : 0.05)
      ? 'Level'
      : `${esc(first.player)} by ${gapText}`;

    return `<div class="wpw">
      <div class="split">
        <span class="wpw-label">${part.label}</span>
        <span class="wpw-note ${first.player === STATE.player && note !== 'Level' ? 'sg-pos' : ''}">${note}</span>
      </div>
      <div class="wpw-track" style="height:${16 + tiers.length * 20}px">
        ${points.map((p) => markerHtml(markers.get(p.player), `style="left:${p.x}%;bottom:${p.tier * 20}px" title="${esc(p.player)}: ${
          mode === 'plays' ? fmtHandicap(p.value) : fmtSG(p.value)}"`)).join('')}
      </div>
    </div>`;
  }).join('');

  return `<div class="card">
    <div class="wpw-head">
      <span class="eyebrow">Who plays what</span>
      <div class="seg seg-small">
        <button class="${mode === 'plays' ? 'active' : ''}" data-action="wpw-mode" data-mode="plays">Plays like</button>
        <button class="${mode === 'sg' ? 'active' : ''}" data-action="wpw-mode" data-mode="sg">SG/18</button>
      </div>
    </div>
    ${scales}
    <div class="wpw-axis">
      ${mode === 'plays'
        ? '<span>&larr; Scratch</span><span>Lower is better</span><span>36+</span>'
        : `<span>${fmtSG(lo).replace(/.00$/, '')}</span><span>Higher is better</span><span>${fmtSG(hi).replace(/.00$/, '')} &rarr;</span>`}
    </div>
  </div>`;
}

/** You against one other player, part by part, then the scoring. */
function renderHeadToHead(allRounds, players, markers) {
  const me = STATE.player;
  const others = players.filter((p) => p !== me).sort();
  if (!players.includes(me) || !others.length) {
    return `<div class="card"><p class="muted">Head to head needs rounds from you and at least one other player.</p></div>`;
  }
  const them = others.includes(STATE.h2hOpponent) ? STATE.h2hOpponent : others[0];
  const a = playerSummary(me, allRounds, 'tour');
  const b = playerSummary(them, allRounds, 'tour');

  const picker = `<div class="split" style="margin:14px 0 4px;flex-wrap:wrap">
      <span class="eyebrow">${esc(me)} vs</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${others.map((p) => `<button class="pill ${p === them ? 'active' : ''}" data-action="h2h-pick" data-player="${esc(p)}">${esc(p)}</button>`).join('')}
      </div>
    </div>`;

  if (!a.sg || !b.sg) {
    return `${picker}<div class="card"><p class="muted">${esc(!a.sg ? 'You need' : `${them} needs`)} a round with shots in it before the two games can be compared.</p></div>`;
  }

  const rows = PART_ROWS.map((part) => {
    const left = playsLikeFor(a.sg, part.key);
    const right = playsLikeFor(b.sg, part.key);
    // Decided on strokes gained, which has no floor or ceiling: two
    // players both shown as "36+" can still be a stroke apart.
    const gained = a.sg[part.key] - b.sg[part.key];
    const winner = Math.abs(gained) < 0.1 ? null : gained > 0 ? 'me' : 'them';
    const width = winner ? Math.max(4, Math.min(50, (Math.abs(right - left) / 36) * 100)) : 0;
    return { part, left, right, winner, width, gained };
  });

  // The summary counts the four parts, not the overall line.
  const parts = rows.slice(1);
  const mine = parts.filter((r) => r.winner === 'me');
  const theirs = parts.filter((r) => r.winner === 'them');
  const words = ['no', 'one', 'two', 'three', 'four'];
  const phrases = (list) => {
    const p = list.map((r) => r.part.phrase);
    return p.length > 1 ? `${p.slice(0, -1).join(', ')} and ${p[p.length - 1]}` : p[0];
  };
  let summary;
  if (!mine.length && !theirs.length) summary = 'Dead level across the board.';
  else if (!theirs.length) summary = mine.length === 4 ? 'You lead every part of the game.' : `You lead on ${phrases(mine)}; level on the rest.`;
  else if (!mine.length) summary = theirs.length === 4 ? `${them} leads every part of the game.` : `${them} leads on ${phrases(theirs)}; level on the rest.`;
  else {
    const lead = mine.length === theirs.length
      ? `Split ${words[mine.length]} parts each.`
      : mine.length > theirs.length
        ? `You lead ${words[mine.length]} parts of the game to ${words[theirs.length]}.`
        : `${them} leads ${words[theirs.length]} parts of the game to ${words[mine.length]}.`;
    const theirBest = theirs.slice().sort((x, y) => x.gained - y.gained)[0];
    const myBest = mine.slice().sort((x, y) => y.gained - x.gained)[0];
    const owner = mine.length >= theirs.length
      ? `${them} owns ${theirBest.part.phrase}.`
      : `You own ${myBest.part.phrase}.`;
    summary = `${lead} ${owner}`;
  }

  const num = (value, won, lost) => `<span class="h2h-num ${won ? 'sg-pos' : lost ? 'is-dim' : ''}">${esc(fmtHandicapShort(value))}</span>`;

  const scoring = COMPARE_SECTIONS
    .filter((s) => ['Scoring', 'The basics', 'Career bests'].includes(s.title))
    .flatMap((s) => s.metrics)
    .map((m) => {
      const va = m.get(a);
      const vb = m.get(b);
      let win = null;
      if (m.better && va != null && vb != null && va !== vb) {
        win = (m.better === 'higher' ? va > vb : va < vb) ? 'me' : 'them';
      }
      return `<div class="h2h-stat">
        <span class="${win === 'me' ? 'sg-pos' : ''}">${va == null ? '&ndash;' : m.fmt(va)}</span>
        <span class="h2h-stat-label">${m.label}</span>
        <span class="${win === 'them' ? 'sg-pos' : ''}">${vb == null ? '&ndash;' : m.fmt(vb)}</span>
      </div>`;
    }).join('');

  return `${picker}
    <div class="card" style="border-top:none;padding-top:6px">
      <div class="h2h-face">
        <div>
          <div class="h2h-name">${esc(me)}</div>
          <div class="eyebrow ${rows[0].winner === 'me' ? 'sg-pos' : ''}">Plays like ${esc(fmtHandicapShort(rows[0].left))}</div>
        </div>
        <span class="h2h-vs">vs</span>
        <div style="text-align:right">
          <div class="h2h-name">${esc(them)}</div>
          <div class="eyebrow ${rows[0].winner === 'them' ? 'sg-pos' : ''}">Plays like ${esc(fmtHandicapShort(rows[0].right))}</div>
        </div>
      </div>
      <p class="callout" style="margin:10px 0 4px">${esc(summary)}</p>
      <div style="border-top:1px solid var(--rule-strong)">
        ${rows.map((r) => `
          <div class="h2h-row">
            <div class="h2h-line">
              ${num(r.left, r.winner === 'me', r.winner === 'them')}
              <span class="h2h-part">${r.part.label}</span>
              ${num(r.right, r.winner === 'them', r.winner === 'me')}
            </div>
            <div class="h2h-track" aria-hidden="true">
              ${r.winner ? `<span class="h2h-bar" style="${r.winner === 'me' ? 'right:50%' : 'left:50%'};width:${r.width}%"></span>` : ''}
            </div>
          </div>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="eyebrow" style="margin-bottom:4px">Scoring &amp; the basics</div>
      ${scoring}
      <p class="tiny" style="margin-top:10px">All rounds each of you has logged. Per 18 holes where it says so, so a nine compares with a full round.</p>
    </div>`;
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
    const { worst } = nemesisHoles(theirs, { minPlays: 2, count: 1, baseline: bench() });
    return { player, hole: worst[0] || null };
  }).filter((row) => row.hole);

  // Holes at least two people have played more than once.
  const shared = holeRecords(allRounds, bench())
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
    </div>
    <button class="btn-ghost" data-action="${courseHome() === 'setup' ? 'goto-setup-courses' : 'goto-settings'}">&larr; Back</button>`;
}

function screenCourseEdit() {
  const course = STATE.courseDraft;
  if (!course) return screenCourses();

  const nine = course.nines[STATE.courseNineIdx] || course.nines[0];
  const tee = course.teeNames[STATE.courseTeeIdx] || course.teeNames[0];
  const problems = validateNine(nine, tee);
  // Warnings, not problems: these never block a save. A real course
  // can have a 95-yard par 3, and an editor that argued would be wrong
  // more often than the person typing.
  const odd = yardageWarnings(course, tee);

  return `${topbar('Scorecard')}
    ${notices()}
    ${odd.length ? `<div class="card">
      <h2>Worth a second look</h2>
      <p class="muted">Nothing here stops you saving. These are just the numbers that would be unusual on a real card, from the ${esc(tee)} tees.</p>
      ${odd.map((w) => `<p class="tiny" style="color:var(--flag)">${esc(w)}</p>`).join('')}
      <p class="tiny">A par 4 entered at 530 yards and a par 5 at 306 is how three rounds got scored against the wrong card once already &mdash; the two had been swapped, and nothing said so until the strokes gained came out strange.</p>
    </div>` : ''}
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
  calendar: screenCalendar,
  teeTime: screenTeeTime,
  teeTimeEdit: screenTeeTimeEdit,
  stats: screenStats,
  clubhouse: screenClubhouse,
  player: screenPlayer,
  courses: screenCourses,
  courseImport: screenCourseImport,
  courseEdit: screenCourseEdit,
  repair: screenRepair,
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

  const setupPaste = document.getElementById('setupPaste');
  if (setupPaste) {
    setupPaste.oninput = (e) => { STATE.setupPaste = e.target.value; };
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

  // The tee time form's free-text fields. Same reasoning as the
  // distance field: re-rendering per keystroke would drop focus and
  // shut the keyboard mid-word.
  const ttDate = document.getElementById('ttDate');
  if (ttDate) {
    ttDate.onchange = (e) => { STATE.teeTimeDraft.date = e.target.value; };
  }

  const ttTime = document.getElementById('ttTime');
  if (ttTime) {
    ttTime.onchange = (e) => { STATE.teeTimeDraft.time = e.target.value; };
  }

  const ttNotes = document.getElementById('ttNotes');
  if (ttNotes) {
    ttNotes.oninput = (e) => { STATE.teeTimeDraft.notes = e.target.value; };
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
  STATE.sheet = null;
  STATE.error = null;
  STATE.notice = null;
  STATE.exportStatus = null;
  Object.assign(STATE, extra, { screen });
  render();
}

/**
 * Your own club distances, for suggesting a club mid-round. Worked out
 * once per round rather than on every tap; nothing hit today should
 * move the number between one shot and the next.
 */
function myClubDistances() {
  const key = `${STATE.player}|${STATE.round && STATE.round.id}`;
  if (!STATE.clubCache || STATE.clubCache.key !== key) {
    STATE.clubCache = { key, clubs: clubDistances(playerRounds(), bench()) };
  }
  return STATE.clubCache.clubs;
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

  // A slip of the thumb — 1 ft where 91 was meant — is easy to make
  // and hard to find weeks later in the sheet, so ask while the shot
  // is still fresh. Never blocks: every one of these can happen.
  const doubts = implausibleShot(start, { lie: draft.endLie, dist: draft.endDist });
  if (doubts.length && !confirm(`${doubts.join(' ')}\n\nLog it anyway?`)) return;

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
    clubGuess: !!draft.clubSuggested,
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
  persistPlay();
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
  persistPlay();
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
  persistPlay();
  render();
}

function nextHole() {
  if (STATE.holeIdx >= STATE.round.holes.length - 1) return finishRound();
  STATE.holeIdx += 1;
  STATE.draft = {};
  persistPlay();
  render();
}

/**
 * Keep the round on screen safe. A round being played is written on
 * every tap, since a phone can die on the 14th. A saved round being
 * corrected is not: it is a copy, and nothing reaches storage or the
 * sheet until Save changes, so Cancel leaves the original untouched.
 */
function persistPlay() {
  if (!STATE.amending) store.saveActiveRound(STATE.round);
}

/**
 * Open a saved round in the hole-by-hole screen to fix a mis-entered
 * shot. Blocked while a round is being played, because both would
 * need the same screen and the live one must not be disturbed.
 */
function beginAmend(id, holeIdx = null) {
  if (STATE.round && !isRoundComplete(STATE.round)) {
    alert('Finish or discard the round in progress first.');
    return;
  }
  const saved = store.getRound(id);
  if (!saved) return;
  STATE.round = JSON.parse(JSON.stringify(saved));
  STATE.amending = true;
  STATE.editShotIdx = null;
  STATE.draft = {};
  go('play', holeIdx == null ? { holeIdx: 0, holePicker: true } : { holeIdx, holePicker: false });
}

function leaveAmend(saved) {
  const id = STATE.round.id;
  if (saved) {
    // saveRound queues it, and the sheet replaces the round's rows by
    // id rather than adding a second copy.
    store.saveRound(STATE.round);
    sync.syncInBackground(null, { force: true });
  }
  STATE.amending = false;
  STATE.round = null;
  STATE.editShotIdx = null;
  STATE.draft = {};
  go('detail', { viewRoundId: id });
}

function finishRound() {
  if (STATE.amending) return leaveAmend(true);
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
  persistPlay();
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
  go(courseHome(), {
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
 * Hand off tee times as a calendar file.
 *
 * iOS recognises text/calendar and offers to add the events. The UID
 * on each event is the tee time's own id, so exporting twice updates
 * what is already in the calendar rather than duplicating it.
 */
function exportCalendar(teeTimes, name) {
  if (!teeTimes.length) {
    STATE.error = 'Nothing to add to the calendar.';
    return render();
  }
  download(toICS(teeTimes), name, 'text/calendar');
  STATE.notice = teeTimes.length === 1
    ? 'Calendar file ready. Open it to add the tee time.'
    : `Calendar file ready with ${teeTimes.length} entries. Open it to add them.`;
  render();
}

/**
 * Begin the round that was booked, with the course, tees, layout and
 * group id already filled in.
 *
 * The group id is the whole point: it is what lets four separately
 * written rounds be recognised afterwards as one game.
 */
function startScheduledRound(teeTimeId) {
  const teeTime = store.getTeeTime(teeTimeId);
  if (!teeTime) return;

  const course = teeTime.courseId ? safeCourse(teeTime.courseId) : null;
  if (!course) {
    STATE.error = 'That course is not saved on this phone, so the round has to be started from Play.';
    return render();
  }

  const tee = teeTime.teeName || course.teeNames[0];
  const option = (teeTime.layoutKey && findPlayOption(course, teeTime.layoutKey))
    || playOptions(course)[0];
  if (!option) {
    STATE.error = 'That course has no playable nine on this phone.';
    return render();
  }

  const problems = [];
  option.nineIds.forEach((id) => {
    const nine = course.nines.find((n) => n.id === id);
    if (nine) problems.push(...validateNine(nine, tee));
  });
  if (problems.length) {
    STATE.error = problems[0] + ' Fix the scorecard before starting.';
    return render();
  }

  STATE.round = newRound({
    player: STATE.player,
    courseId: course.id,
    courseName: course.name,
    teeName: tee,
    layout: option.label,
    holes: buildRoundHoles(course, option, tee),
    mode: 'full',
    groupId: teeTime.groupId,
  });
  STATE.holeIdx = 0;
  STATE.draft = {};
  persistPlay();

  // The tee time has served its purpose; marking it played keeps it
  // out of tomorrow's banner without deleting the record of it.
  store.saveTeeTime({ ...teeTime, status: 'played' });
  go('play');
  sync.syncInBackground(null, { force: true });
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

  /* --- Calendar ------------------------------------------------- */

  'goto-calendar': () => go('calendar', { teeTimeDraft: null }),
  'cal-today': () => go('calendar', { calYear: null, calMonth: null, calDay: todayKey() }),

  'new-tee-time': (el) => {
    const date = el.getAttribute('data-date') || todayKey();
    go('teeTimeEdit', {
      teeTimeDraft: {
        id: null,
        kind: 'round',
        date,
        time: '',
        courseId: null,
        courseName: '',
        teeName: null,
        layoutKey: null,
        holes: null,
        practiceType: null,
        invitees: [],
        notes: '',
      },
    });
  },

  // Lands on the ordinary edit screen so the day, time and who else is
  // coming are still the player's to choose.
  'book-focus': () => {
    const focus = practiceFocus(playerRounds());
    if (!focus) return;
    go('teeTimeEdit', {
      teeTimeDraft: {
        id: null,
        kind: 'practice',
        date: todayKey(),
        time: '',
        courseId: null,
        courseName: '',
        teeName: null,
        layoutKey: null,
        holes: null,
        practiceType: focus.plan.practiceType,
        invitees: [],
        notes: `${focus.plan.title}: ${focus.plan.drill}`,
      },
    });
  },

  'edit-tee-time': (el) => {
    const teeTime = store.getTeeTime(el.getAttribute('data-id'));
    if (!teeTime) return;
    go('teeTimeEdit', { teeTimeDraft: { ...teeTime, invitees: [...(teeTime.invitees || [])] } });
  },

  'save-tee-time': () => {
    const draft = STATE.teeTimeDraft;
    if (!draft) return;

    if (!draft.date) {
      STATE.error = 'Pick a date first.';
      return render();
    }
    if (!isValidTime(draft.time)) {
      STATE.error = 'That time does not look right. Use the time picker, or leave it blank.';
      return render();
    }
    if (draft.kind === 'round' && !draft.courseId && !draft.courseName) {
      STATE.error = 'Pick a course, or switch this to practice.';
      return render();
    }

    const existing = draft.id ? store.getTeeTime(draft.id) : null;
    const course = draft.courseId ? safeCourse(draft.courseId) : null;

    const teeTime = existing
      ? {
        ...existing,
        kind: draft.kind,
        date: draft.date,
        time: draft.time || '',
        courseId: draft.courseId || null,
        courseName: course ? course.name : (draft.courseName || ''),
        teeName: draft.teeName || null,
        layoutKey: draft.layoutKey || null,
        holes: draft.holes || null,
        practiceType: draft.kind === 'practice' ? (draft.practiceType || null) : null,
        invitees: cleanInvitees(draft.invitees, existing.owner),
        notes: draft.notes || '',
      }
      : newTeeTime({
        owner: STATE.player,
        invitees: draft.invitees,
        date: draft.date,
        time: draft.time,
        courseId: draft.courseId,
        courseName: course ? course.name : draft.courseName,
        teeName: draft.teeName,
        layoutKey: draft.layoutKey,
        holes: draft.holes,
        kind: draft.kind,
        practiceType: draft.practiceType,
        notes: draft.notes,
      });

    store.saveTeeTime(teeTime);
    go('calendar', {
      teeTimeDraft: null,
      calDay: teeTime.date,
      notice: existing ? 'Tee time updated.' : 'Added to the diary.',
    });
    sync.syncInBackground(null, { force: true });
  },

  'share-recap': async (el) => {
    const id = el.getAttribute('data-id');
    const round = (STATE.round && STATE.round.id === id ? STATE.round : null) || store.getRound(id);
    if (!round || STATE.recapBusy) return;
    STATE.recapBusy = true;
    render();
    try {
      const blob = await drawRecap(recapData(round, bench()), { benchLabel: benchName() });
      const slug = String(round.courseName || 'round').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const outcome = await shareRecap(blob, `${slug}-${String(round.date).slice(0, 10)}.png`, round.courseName);
      STATE.notice = outcome === 'saved' ? 'Recap image saved.' : '';
    } catch (err) {
      STATE.notice = 'Could not make the recap: ' + err.message;
    } finally {
      STATE.recapBusy = false;
      render();
    }
  },

  'open-invite': (el) => {
    const id = el.getAttribute('data-id');
    store.markInvitesSeen(STATE.player, [id]);
    go('teeTime', { viewTeeTimeId: id });
  },

  'dismiss-invites': () => {
    const invites = newInvites(store.getLiveTeeTimes(), STATE.player, store.getSeenInvites(STATE.player));
    store.markInvitesSeen(STATE.player, invites.map((t) => t.id));
    render();
  },

  'view-tee-time': (el) => go('teeTime', { viewTeeTimeId: el.getAttribute('data-id') }),

  'cancel-tee-time': (el) => {
    const teeTime = store.getTeeTime(el.getAttribute('data-id'));
    if (!teeTime) return;
    store.saveTeeTime({ ...teeTime, status: 'cancelled' });
    go('teeTime', { notice: 'Marked as cancelled.' });
    sync.syncInBackground(null, { force: true });
  },

  'uncancel-tee-time': (el) => {
    const teeTime = store.getTeeTime(el.getAttribute('data-id'));
    if (!teeTime) return;
    store.saveTeeTime({ ...teeTime, status: 'scheduled' });
    go('teeTime', { notice: 'Back on.' });
    sync.syncInBackground(null, { force: true });
  },

  'delete-tee-time': (el) => {
    if (!confirm('Remove this from everyone’s diary?')) return;
    store.deleteTeeTime(el.getAttribute('data-id'));
    go('calendar', { viewTeeTimeId: null, notice: 'Removed.' });
    sync.syncInBackground(null, { force: true });
  },

  'start-scheduled': (el) => startScheduledRound(el.getAttribute('data-id')),

  'export-tee-time': (el) => {
    const teeTime = store.getTeeTime(el.getAttribute('data-id'));
    if (!teeTime) return;
    exportCalendar([teeTime], `ledger-${teeTime.date}.ics`);
  },

  'export-calendar': () => {
    // The same set the Coming up list shows, so the button does what
    // the card above it says. A tee time already played is not an
    // upcoming entry, whatever its date says.
    const today = todayKey();
    const upcoming = visibleSchedule().filter((t) => t.date >= today && t.status === 'scheduled');
    exportCalendar(upcoming, 'ledger-tee-times.ics');
  },

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

  /**
   * The gate.
   *
   * The order matters and it is not the obvious one. The roster lives
   * on the sheet now, and reaching the sheet needs the passphrase — so
   * the passphrase has to be checked FIRST, and only then can the name
   * be looked up. Matching the name first, as this used to, meant a
   * brand new phone compared it against a list of three names baked in
   * as a fallback and turned away everybody else.
   *
   * Every branch out of here renders something. The bug that started
   * all this was not that the app rejected Dakota — it was that what
   * it said, "not set up on this device", sounded like a fault with
   * his phone and gave him nothing to do about it.
   */
  'sign-in': async () => {
    const typed = (document.getElementById('loginName') || {}).value || STATE.loginDraft;
    STATE.loginDraft = typed;

    if (!String(typed || '').trim()) {
      STATE.error = 'Type your name to continue.';
      return render();
    }

    // The passphrase unlocks the sheet, and the sheet holds the roster.
    if (sync.needsPassphrase()) {
      const pass = (document.getElementById('loginPass') || {}).value || STATE.passDraft;
      if (!pass) {
        STATE.error = 'The passphrase is needed to unlock this device.';
        return render();
      }
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

    STATE.syncBusy = true;
    render();
    const roster = await sync.loadRoster();
    STATE.syncBusy = false;

    // Logged rather than swallowed, so the next time somebody cannot
    // get in it can be read off their phone instead of guessed at.
    console.info(
      `[ledger] roster: ${roster.players.length} from ${roster.source}`
      + `${roster.unconfigured ? ' (no sheet on this device)' : ''}`
      + `${roster.empty ? ' (sheet tab is empty)' : ''}`
      + `${roster.error ? ` — ${roster.error.message}` : ''}`
    );

    // And kept for the screen. A console on a phone is not somewhere
    // anybody is going to look, and the first time this went wrong it
    // cost a round of guessing that one line would have settled.
    STATE.rosterState = {
      count: roster.players.length,
      source: roster.source,
      unconfigured: Boolean(roster.unconfigured),
      empty: Boolean(roster.empty),
      error: roster.error ? roster.error.message : null,
    };

    const found = store.lookupPlayer(typed);

    if (found.status === 'inactive') {
      STATE.error = 'This account is inactive. Ask Chris to switch it back on.';
      return render();
    }

    if (found.status !== 'ok') {
      /*
       * Four different things send somebody away, and they need four
       * different sentences. Collapsing them is what made this hard to
       * diagnose the first time: "you are not on the roster" was said
       * to a phone that had never looked at the roster, which sent the
       * wrong person to fix the wrong thing.
       *
       * The order matters. Not connected beats could-not-reach, which
       * beats nobody-on-the-list, which beats genuinely-not-on-it —
       * each one is a reason the next check could not be trusted.
       */
      if (roster.unconfigured) {
        STATE.error = 'This phone is not connected to the shared sheet yet, so it only knows the names built into the app. Ask Chris for the setup link.';
      } else if (roster.error) {
        STATE.error = 'Could not reach the player list, so this is the last one this phone saw. Check your connection and try again.';
      } else if (roster.empty) {
        STATE.error = 'The shared player list is empty, so this phone fell back to the names built into the app. Ask Chris to add you to the players tab.';
      } else {
        STATE.error = `${typed.trim()} is not on the roster yet. Ask Chris to add you.`;
      }
      return render();
    }

    STATE.player = found.player;
    STATE.loginDraft = '';
    STATE.passDraft = '';
    store.setPlayer(found.player);
    loadActiveRound();
    go(activeScreen());
    sync.clearSetupParam();
    sync.syncInBackground(refreshIfIdle, { force: true });
  },

  /**
   * Point a device at the sheet from the gate itself.
   *
   * Settings would be the natural home for this and is the wrong one:
   * it sits behind the sign-in, and a device that cannot sign in
   * cannot reach it. That was survivable while the setup link always
   * worked, and it stopped being survivable on the iPhone route, where
   * adding to the home screen drops the link and hands the new
   * container no way of ever being told about the sheet.
   */
  'connect-device': () => {
    const pasted = (document.getElementById('setupPaste') || {}).value || STATE.setupPaste;
    const url = sync.readSetupText(pasted);
    if (!url) {
      STATE.error = 'That does not look like a setup link. It should be the whole link, or the sheet address ending in /exec.';
      return render();
    }
    sync.connectTo(url);
    STATE.setupPaste = '';
    STATE.error = null;
    STATE.notice = 'Connected. Enter the passphrase and your name.';
    render();
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
  'goto-courses': () => go(courseHome(), { courseDraft: null }),
  'goto-setup-courses': () => go('setup', { courseDraft: null }),
  'open-courses': () => go('courses', { courseDraft: null, courseReturn: 'courses' }),
  'pick-course': (el) => go('setup', {
    setupCourseId: el.getAttribute('data-id'), setupTee: null,
  }),
  'start-round': (el) => startRound(el.getAttribute('data-option')),
  'fill-par': () => {
    STATE.round.holes.forEach((h) => { if (h.score == null) h.score = h.par; });
    persistPlay();
    render();
  },

  'save-score-round': () => {
    const played = STATE.round.holes.filter((h) => h.score != null).length;
    if (!played) return;
    if (played < STATE.round.holes.length
      && !confirm(`Only ${played} holes have a score. Save it as a ${played}-hole round?`)) return;
    finishRound();
  },

  'save-shot': () => { STATE.sheet = null; saveShot(); },
  'set-avatar': (el) => {
    STATE.emojiEntry = false;
    return saveAvatar(el.getAttribute('data-avatar') || '');
  },

  'emoji-entry': () => {
    STATE.emojiEntry = !STATE.emojiEntry;
    STATE.emojiError = null;
    render();
    const input = document.getElementById('emojiInput');
    if (input) input.focus();
  },

  'save-emoji': () => {
    const input = document.getElementById('emojiInput');
    const avatar = emojiAvatar(input ? input.value : '');
    if (!avatar) {
      STATE.emojiError = 'That needs to be a single emoji — letters and words will not work.';
      return render();
    }
    STATE.emojiEntry = false;
    STATE.emojiError = null;
    return saveAvatar(avatar);
  },

  'view-player': (el) => go('player', { viewPlayer: el.getAttribute('data-player') }),
  'goto-club': () => go('clubhouse'),
  'h2h-with': (el) => go('clubhouse', { clubView: 'h2h', h2hOpponent: el.getAttribute('data-player') }),
  'toggle-admin': () => { STATE.adminOpen = !STATE.adminOpen; render(); },
  'stats-tab': (el) => {
    STATE.statsTab = el.getAttribute('data-tab');
    if (STATE.screen === 'stats') { render(); window.scrollTo(0, 0); } else go('stats');
  },
  'club-view': (el) => { STATE.clubView = el.getAttribute('data-view'); render(); },
  'wpw-mode': (el) => { STATE.wpwMode = el.getAttribute('data-mode'); render(); },
  'h2h-pick': (el) => { STATE.h2hOpponent = el.getAttribute('data-player'); render(); },
  'club-step': (el) => {
    const d = STATE.draft;
    const bag = store.getBag(STATE.player);
    d.club = d.club ? stepClub(d.club, Number(el.getAttribute('data-step')), bag)
      : (bag.includes('7i') ? '7i' : bag[0]);
    d.clubSuggested = false;
    render();
  },
  'open-sheet': (el) => { STATE.sheet = el.getAttribute('data-sheet'); render(); },
  'close-sheet': () => { STATE.sheet = null; render(); },
  // None, +1, +2, back to none: penalties are rare enough that one
  // small control beats a row of three buttons on every shot.
  'cycle-penalty': () => { STATE.draft.penalty = (Number(STATE.draft.penalty || 0) + 1) % 3; render(); },
  'delete-shot': deleteShot,
  'cancel-edit': () => { STATE.editShotIdx = null; STATE.draft = {}; render(); },
  'toggle-hole-picker': () => { STATE.holePicker = !STATE.holePicker; render(); },
  'undo-shot': undoShot,
  'next-hole': nextHole,
  'end-round': () => {
    if (!confirm('End the round here and save it?')) return;
    finishRound();
  },
  'toggle-drill': (el) => {
    const key = el.getAttribute('data-key');
    STATE.openDrill = STATE.openDrill === key ? null : key;
    render();
  },
  'amend-round': (el) => beginAmend(el.getAttribute('data-id')),
  'review-hole': (el) => beginAmend(el.getAttribute('data-id'), Number(el.getAttribute('data-hole'))),
  'amend-save': () => leaveAmend(true),
  'amend-cancel': () => {
    if (!confirm('Throw away the changes to this round?')) return;
    leaveAmend(false);
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
    go(courseHome(), {
      importText: '', importPreview: null, importCourse: null, importForce: false,
      notice: `Saved ${course.name}. Open it and mark it checked once you have compared it to the card.`,
    });
    sync.syncInBackground(null, { force: true });
  },

  /* --- Scorecard repair ------------------------------------------ */

  'goto-repair': () => go('repair', { repairPlan: null }),

  'repair-preview': () => {
    const result = planRepair(
      store.getRounds(),
      (round) => safeCourse(round.courseId),
      { courseId: STATE.repairCourseId, benchmark: bench() }
    );
    // Printed as well as shown, because a diff you can copy out of a
    // console is a diff you can paste to somebody and argue about.
    console.info('[ledger] scorecard repair\n' + describePlan(result));
    STATE.repairPlan = result;
    STATE.notice = result.changed.length
      ? `${result.changed.length} round${result.changed.length === 1 ? '' : 's'} differ from the saved card. Nothing written yet.`
      : 'Everything in scope already matches.';
    render();
  },

  'repair-apply': () => {
    const plan = STATE.repairPlan;
    if (!plan || !plan.changed.length) return;
    if (!confirm(`Correct ${plan.changed.length} round${plan.changed.length === 1 ? '' : 's'}? `
      + 'The shots are untouched — only the yardages they were played against change.')) return;

    plan.changed.forEach((p) => store.saveRound(p.repaired));
    const count = plan.changed.length;

    // Re-plan straight away rather than trusting the write: running it
    // twice must find nothing, and this is the cheapest way to show
    // that it does.
    const after = planRepair(
      store.getRounds(),
      (round) => safeCourse(round.courseId),
      { courseId: STATE.repairCourseId, benchmark: bench() }
    );
    console.info('[ledger] after repair\n' + describePlan(after));

    go('repair', {
      repairPlan: after,
      notice: `Corrected ${count} round${count === 1 ? '' : 's'}. `
        + `${after.changed.length ? 'Some still differ — check the list.' : 'Nothing left to correct.'} `
        + 'Everyone else picks these up on their next sync.',
    });
    sync.syncInBackground(null, { force: true });
  },

  /* --- Roster ---------------------------------------------------- */

  'refresh-roster': () => runSync('Roster refresh', async () => {
    const roster = await sync.loadRoster();
    console.info(`[ledger] roster: ${roster.players.length} from ${roster.source}`);
    if (roster.error) throw roster.error;
    if (roster.empty) return 'Reached the sheet, but the players tab is still empty.';
    return `${roster.players.length} name${roster.players.length === 1 ? '' : 's'} on the sheet.`;
  }),

  'add-player': () => {
    const name = prompt('Name of the player, spelled the way they should see it');
    if (!name || !name.trim()) return;
    const clean = name.trim();

    const existing = store.getPlayers();
    if (existing.some((p) => p.player.toLowerCase() === clean.toLowerCase())) {
      STATE.error = `${clean} is already on the list.`;
      return render();
    }

    runSync('Adding a player', async () => {
      await sync.pushPlayers([{ player: clean, active: true }]);
      // Read back rather than assuming, so what shows is what the
      // sheet actually holds — including anyone typed in by hand.
      const roster = await sync.loadRoster();
      return `${clean} added. ${roster.players.length} on the roster.`;
    });
  },

  'toggle-player': (el) => {
    const name = el.getAttribute('data-name');
    const found = store.getPlayers().find((p) => p.player === name);
    if (!found) return;
    const next = found.active === false;

    if (!next && name === STATE.player
      && !confirm(`Turn off ${name}? That is you — you will not be able to sign in again until somebody turns it back on.`)) return;

    runSync('Updating the roster', async () => {
      await sync.pushPlayers([{ player: name, active: next }]);
      await sync.loadRoster();
      return `${name} is now ${next ? 'active' : 'inactive'}.`;
    });
  },

  /**
   * Seed the sheet from whatever this device knows.
   *
   * Only offered while the tab is empty. It is the one-tap version of
   * typing four names in by hand, and it exists so the changeover does
   * not start with everybody locked out of a list nobody has filled in.
   */
  'publish-roster': () => runSync('Publishing the roster', async () => {
    const names = store.getRoster();
    await sync.pushPlayers(names.map((player) => ({ player, active: true })));
    const roster = await sync.loadRoster();
    return `Published ${roster.players.length}: ${roster.players.map((p) => p.player).join(', ')}.`;
  }),

  'load-seeds': () => {
    const pending = missingSeeds(listCourses());
    pending.forEach((course) => upsertCourse(cloneSeed(course)));
    go(courseHome(), {
      notice: `Loaded ${pending.map((c) => c.name).join(', ')}.`,
    });
  },

  'new-course': () => go('courseEdit', {
    courseDraft: newCourse(''), courseTeeIdx: 0, courseNineIdx: 0, comboDraft: null,
    ...(STATE.screen === 'setup' ? { courseReturn: 'setup' } : {}),
  }),

  'edit-course': (el) => {
    const course = safeCourse(el.getAttribute("data-id"));
    if (!course) return;
    go('courseEdit', {
      ...(STATE.screen === 'setup' ? { courseReturn: 'setup' } : {}),
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
    go(courseHome(), { courseDraft: null });
  },
  export: exportData,
};

function onClick(event) {
  const target = event.target.closest('[data-action],[data-nav],[data-lie],[data-miss],[data-penalty],[data-tee-idx],[data-nine-idx],[data-setup-tee],[data-par],[data-scope],[data-standings],[data-dist-step],[data-verified],[data-edit-shot],[data-goto-hole],[data-preset],[data-club],[data-set-theme],[data-presets],[data-clubs],[data-bag-club],[data-miss-inline],[data-open-hole],[data-trend],[data-setup-mode],[data-score-step],[data-benchmark],[data-cal-day],[data-cal-step],[data-tt-kind],[data-tt-practice],[data-tt-course],[data-tt-tee],[data-tt-layout],[data-tt-invite],[data-miss-mode],[data-green-band],[data-smooth],[data-hcp-window],[data-repair-course]');
  if (!target) return;

  const benchmark = target.getAttribute('data-benchmark');
  if (benchmark) {
    store.setBenchmark(benchmark);
    return render();
  }

  const missMode = target.getAttribute('data-miss-mode');
  if (missMode) { STATE.missMode = missMode; return render(); }

  const greenBand = target.getAttribute('data-green-band');
  if (greenBand) { STATE.greenBand = greenBand; return render(); }

  const repairCourse = target.getAttribute('data-repair-course');
  if (repairCourse !== null) {
    STATE.repairCourseId = repairCourse || null;
    STATE.repairPlan = null;
    return render();
  }

  const hcpWindow = target.getAttribute('data-hcp-window');
  if (hcpWindow) {
    store.setPref('handicapWindow', Number(hcpWindow));
    return render();
  }

  const smooth = target.getAttribute('data-smooth');
  if (smooth) { STATE.trendSmooth = smooth === 'on'; return render(); }

  /* --- Calendar and the tee time form ---------------------------- */

  const calStep = target.getAttribute('data-cal-step');
  if (calStep) {
    const { year, month } = calendarCursor();
    const moved = new Date(year, month + Number(calStep), 1);
    STATE.calYear = moved.getFullYear();
    STATE.calMonth = moved.getMonth();
    // Closing the open day avoids a detail card describing a day the
    // grid above is no longer showing.
    STATE.calDay = null;
    return render();
  }

  const calDay = target.getAttribute('data-cal-day');
  if (calDay !== null) {
    STATE.calDay = (calDay && STATE.calDay !== calDay) ? calDay : null;
    return render();
  }

  const ttKind = target.getAttribute('data-tt-kind');
  if (ttKind) {
    STATE.teeTimeDraft.kind = ttKind;
    return render();
  }

  const ttPractice = target.getAttribute('data-tt-practice');
  if (ttPractice) {
    const draft = STATE.teeTimeDraft;
    draft.practiceType = draft.practiceType === ttPractice ? null : ttPractice;
    return render();
  }

  const ttCourse = target.getAttribute('data-tt-course');
  if (ttCourse) {
    const draft = STATE.teeTimeDraft;
    // Switching course invalidates the tee and the layout, which
    // belong to the old one and would otherwise silently survive.
    if (draft.courseId !== ttCourse) {
      draft.courseId = ttCourse;
      draft.teeName = null;
      draft.layoutKey = null;
      draft.holes = null;
      const course = safeCourse(ttCourse);
      draft.courseName = course ? course.name : '';
      if (course && course.teeNames.length === 1) draft.teeName = course.teeNames[0];
    }
    return render();
  }

  const ttTee = target.getAttribute('data-tt-tee');
  if (ttTee) {
    STATE.teeTimeDraft.teeName = ttTee;
    return render();
  }

  const ttLayout = target.getAttribute('data-tt-layout');
  if (ttLayout) {
    const draft = STATE.teeTimeDraft;
    const same = draft.layoutKey === ttLayout;
    draft.layoutKey = same ? null : ttLayout;
    draft.holes = same ? null : Number(target.getAttribute('data-holes')) || null;
    return render();
  }

  const ttInvite = target.getAttribute('data-tt-invite');
  if (ttInvite) {
    const draft = STATE.teeTimeDraft;
    const list = draft.invitees || [];
    draft.invitees = list.includes(ttInvite)
      ? list.filter((n) => n !== ttInvite)
      : list.concat([ttInvite]);
    return render();
  }

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
    persistPlay();
    return render();
  }

  const club = target.getAttribute('data-club');
  if (club) {
    STATE.draft.club = STATE.draft.club === club ? null : club;
    STATE.draft.clubSuggested = false;
    STATE.sheet = null;
    return render();
  }

  // − and + either side of the distance: a foot at a time on the
  // green, five yards elsewhere. The number itself still takes typing.
  const distStep = target.getAttribute('data-dist-step');
  if (distStep) {
    const unit = unitForLie(STATE.draft.endLie);
    const step = unit === 'ft' ? 1 : 5;
    const current = Number(STATE.draft.endDist);
    const base = Number.isFinite(current) && current > 0 ? current : (unit === 'ft' ? 10 : 100);
    const next = isValidDist(STATE.draft.endDist) ? base + Number(distStep) * step : base;
    STATE.draft.endDist = String(Math.max(1, Math.round(next)));
    return render();
  }

  const preset = target.getAttribute('data-preset');
  if (preset !== null) {
    STATE.draft.endDist = preset;
    return render();
  }

  const theme = target.getAttribute('data-set-theme');
  if (theme) { store.setPref('theme', theme); applyTheme(); return render(); }

  const bagClub = target.getAttribute('data-bag-club');
  if (bagClub) {
    store.toggleBagClub(STATE.player, bagClub);
    return render();
  }

  const clubsPref = target.getAttribute('data-clubs');
  if (clubsPref) { store.setPref('clubs', clubsPref === 'on'); return render(); }

  const presets = target.getAttribute('data-presets');
  if (presets) { store.setPref('presets', presets === 'on'); return render(); }

  const missInlinePref = target.getAttribute('data-miss-inline');
  if (missInlinePref) { store.setPref('missInline', missInlinePref === 'on'); return render(); }

  const standingsScope = target.getAttribute('data-standings');
  if (standingsScope) {
    STATE.standingsScope = standingsScope;
    return render();
  }

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
    STATE.sheet = null;
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
    persistPlay();
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
  if (meta) meta.setAttribute('content', dark ? '#0f1311' : '#f7f4ec');
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
  if (!result || (!result.pulled && !result.pushed && !result.teeTimes)) return;
  if (STATE.screen === 'play' || STATE.screen === 'courseEdit') return;
  render();
}

init();
