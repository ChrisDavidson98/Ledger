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
  approachBuckets,
  missTally,
} from './model.js';

import * as store from './storage.js';
import * as sync from './sync.js';

import {
  newCourse,
  blankTee,
  listCourses,
  findTee,
  teePar,
  teeYardage,
  upsertCourse,
  validateTee,
} from './courses.js';

const PLAYERS = ['Chris', 'Kaden', 'Manny'];

const STATE = {
  screen: 'login',
  player: null,
  round: null,
  holeIdx: 0,
  draft: {},           // in-progress shot entry
  courseDraft: null,   // course being edited
  courseTeeIdx: 0,
  setupCourseId: null, // course chosen, awaiting a tee
  viewRoundId: null,
  historyScope: 'mine',
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
  courses: ['courses', 'courseEdit'],
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
  return `${topbar('Who is playing?')}
    <div class="card">
      <h2>Sign in</h2>
      <p class="muted">Pick your name. Rounds are kept separately for each player on this device.</p>
      <div class="stack" style="margin-top:14px">
        ${PLAYERS.map((p) => `
          <button class="btn-primary" data-action="pick-player" data-player="${esc(p)}">${esc(p)}</button>
        `).join('')}
      </div>
    </div>`;
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
            <div class="badge">${c.tees.length}</div>
            <div class="row-meta">
              <div class="rname">${esc(c.name)}</div>
              <div class="rsub">${c.tees.map((t) => esc(t.name)).join(' &middot; ')}</div>
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
  const course = store.getCourse(STATE.setupCourseId);
  if (!course) return screenSetup();
  return `${topbar(course.name)}
    ${notices()}
    <div class="card">
      <h2>Which tees?</h2>
      <p class="muted">Yardages come from the scorecard you saved, so this is instant.</p>
      ${course.tees.map((t) => `
        <button class="row" data-action="start-round" data-tee="${esc(t.name)}">
          <div class="badge">${teePar(t)}</div>
          <div class="row-meta">
            <div class="rname">${esc(t.name)}</div>
            <div class="rsub">${teeYardage(t).toLocaleString()} yards &middot; par ${teePar(t)}</div>
          </div>
          <div class="row-val">&rsaquo;</div>
        </button>
      `).join('')}
      <div class="btn-row">
        <button class="btn-ghost" data-action="edit-course" data-id="${esc(course.id)}">Edit Scorecard</button>
      </div>
    </div>`;
}

function screenPlay() {
  const round = STATE.round;
  if (!round) return screenHome();
  const hole = round.holes[STATE.holeIdx];
  const start = lieAfter(hole);
  const played = playedHoles(round).length;
  const pct = Math.round((played / 18) * 100);

  const shotNum = hole.shots.length + 1;
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
        <span class="mono muted">Hole ${hole.hole}</span>
        <div class="track"><div class="fill" style="width:${pct}%"></div></div>
        <span class="mono muted">${fmtToPar(roundToPar(round))}</span>
      </div>
      <div class="stat-grid g4">
        <div class="stat-box"><div class="val">${hole.par}</div><div class="lbl">Par</div></div>
        <div class="stat-box"><div class="val">${hole.yards}</div><div class="lbl">Yards</div></div>
        <div class="stat-box"><div class="val">${holeScore(hole)}</div><div class="lbl">Strokes</div></div>
        <div class="stat-box"><div class="val ${sgClass(holeTotals(hole).total)}">${fmtSG(holeTotals(hole).total)}</div><div class="lbl">SG</div></div>
      </div>
    </div>

    ${hole.shots.length ? `
      <div class="card">
        <div class="split"><h3>Shots</h3>
          <button class="chip" data-action="undo-shot" style="min-height:36px;padding:6px 12px">Undo last</button>
        </div>
        ${hole.shots.map((s) => renderShotLine(s, hole)).join('')}
      </div>` : ''}

    ${hole.done ? renderHoleComplete(hole) : renderShotForm(hole, start, category, shotNum)}

    ${played > 0 && !hole.done ? `
      <button class="btn-ghost" data-action="end-round">End Round Here</button>` : ''}`;
}

function renderShotLine(shot, hole) {
  const { category, sg } = shotSG(shot, hole.par);
  const from = `${LIE_LABELS[shot.startLie]} ${fmtDist(shot.startDist, shot.startUnit)}`;
  const to = shot.holed
    ? 'holed'
    : `${LIE_LABELS[shot.endLie]} ${fmtDist(shot.endDist, shot.endUnit)}`;
  const extras = [];
  if (shot.miss && shot.miss !== 'target') extras.push(MISS_LABELS[shot.miss]);
  if (shot.penalty) extras.push(`+${shot.penalty} pen`);
  return `<div class="shot-line">
    <span class="desc">
      <strong class="mono">${shot.n}</strong>&nbsp; ${esc(from)} &rarr; ${esc(to)}
      <span class="tiny">${CATEGORY_SHORT[category]}${extras.length ? ' &middot; ' + esc(extras.join(' · ')) : ''}</span>
    </span>
    <span class="mono ${sgClass(sg)}">${fmtSG(sg)}</span>
  </div>`;
}

function renderShotForm(hole, start, category, shotNum) {
  const draft = STATE.draft;
  const endLie = draft.endLie;
  const unit = endLie && endLie !== 'holed' ? unitForLie(endLie) : null;
  const needsDist = endLie && endLie !== 'holed';
  const ready = endLie && (!needsDist || isValidDist(draft.endDist));

  const startLabel = `${LIE_LABELS[start.lie]}, ${fmtDist(start.dist, start.unit)} out`;

  return `<div class="card">
    <div class="split">
      <h2>Shot ${shotNum}</h2>
      <span class="tiny">${CATEGORY_LABELS[category]}</span>
    </div>
    <p class="muted">From ${esc(startLabel)}.</p>

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
      Save Shot
    </button>
  </div>`;
}

function renderHoleComplete(hole) {
  const totals = holeTotals(hole);
  const score = holeScore(hole);
  const last = STATE.holeIdx >= 17;
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
    <div class="card">
      <h2>Hole by hole</h2>
      ${holes.map((h) => {
        const t = holeTotals(h);
        const s = holeScore(h);
        return `<div class="row">
          <div class="badge">${h.hole}</div>
          <div class="row-meta">
            <div class="rname">${s} on par ${h.par} <span class="tiny">(${fmtToPar(s - h.par)})</span></div>
            <div class="rsub">${h.yards}y &middot; ${h.shots.length} shots</div>
          </div>
          <div class="row-val ${sgClass(t.total)}">${fmtSG(t.total)}</div>
        </div>`;
      }).join('')}
    </div>`;
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

    <div class="card">
      <h2>Player</h2>
      <p class="muted">Signed in as ${esc(STATE.player)}.</p>
      <button class="btn-ghost" data-action="sign-out">Switch Player</button>
    </div>

    <button class="btn-ghost" data-action="goto-history">&larr; Back</button>`;
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

  const avg = {};
  CATEGORIES.forEach((c) => {
    avg[c] = rounds.reduce((sum, r) => sum + roundTotals(r)[c], 0) / rounds.length;
  });
  const avgTotal = CATEGORIES.reduce((sum, c) => sum + avg[c], 0);
  const buckets = approachBuckets(rounds);
  const teeMiss = missTally(rounds, 'ott');
  const appMiss = missTally(rounds, 'app');

  return `${topbar(`${STATE.player} · Stats`)}
    <div class="card">
      <h2>Average per round</h2>
      <p class="muted">Across ${rounds.length} round${rounds.length === 1 ? '' : 's'}.</p>
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

    ${buckets.length ? `
      <div class="card">
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
        <p class="tiny" style="margin-top:8px">Per-shot average. The bucket costing you most per swing is where practice pays.</p>
      </div>` : ''}

    ${renderMissCard('Tee shot misses', teeMiss)}
    ${renderMissCard('Approach misses', appMiss)}`;
}

function renderMissCard(title, { tally, total }) {
  if (!total) return '';
  const cells = MISS_GRID.flat().map((dir) => {
    const count = tally[dir] || 0;
    const share = total ? Math.round((count / total) * 100) : 0;
    const strength = count ? Math.min(0.14 + (count / total) * 1.1, 1) : 0;
    const style = count
      ? `background:rgba(23,59,46,${strength.toFixed(2)});color:${strength > 0.5 ? 'var(--cream)' : 'var(--ink)'};border-color:var(--green-deep)`
      : '';
    return `<div class="miss-cell ${dir === 'target' ? 'center' : ''}" style="${style}">
      ${count ? `<span><strong class="mono">${count}</strong><br><span class="tiny">${share}%</span></span>` : '&middot;'}
    </div>`;
  }).join('');
  return `<div class="card">
    <h2>${esc(title)}</h2>
    <p class="muted">${total} logged. Center is on target.</p>
    <div class="miss-grid">${cells}</div>
  </div>`;
}

/* --- Course management ------------------------------------------- */

function screenCourses() {
  const courses = listCourses();
  return `${topbar('Courses')}
    ${notices()}
    <div class="card">
      <h2>Saved scorecards</h2>
      <p class="muted">Enter a course once, from every tee, and it is ready for good.</p>
      ${courses.length === 0 ? `
        <div class="empty"><div class="glyph">&#128220;</div><div>Nothing saved yet.</div></div>
      ` : courses.map((c) => `
        <button class="row" data-action="edit-course" data-id="${esc(c.id)}">
          <div class="badge">${c.tees.length}</div>
          <div class="row-meta">
            <div class="rname">${esc(c.name)}</div>
            <div class="rsub">${c.tees.map((t) => `${esc(t.name)} ${teeYardage(t)}y`).join(' &middot; ')}</div>
          </div>
          <div class="row-val">&rsaquo;</div>
        </button>`).join('')}
      <button class="btn-primary" style="margin-top:12px" data-action="new-course">Add a Course</button>
    </div>`;
}

function screenCourseEdit() {
  const course = STATE.courseDraft;
  if (!course) return screenCourses();
  const tee = course.tees[STATE.courseTeeIdx];
  const problems = validateTee(tee);

  return `${topbar('Scorecard')}
    ${notices()}
    <div class="card">
      <label>Course name</label>
      <input type="text" id="courseName" value="${esc(course.name)}" placeholder="Course name">

      <label>Tee sets</label>
      <div class="tee-tabs">
        ${course.tees.map((t, i) => `
          <button class="chip ${i === STATE.courseTeeIdx ? 'active' : ''}" data-tee-idx="${i}">${esc(t.name)}</button>
        `).join('')}
        <button class="chip" data-action="add-tee">+ Tee</button>
      </div>

      <label>Tee name</label>
      <input type="text" id="teeName" value="${esc(tee.name)}" placeholder="Blue">
    </div>

    <div class="card">
      <div class="split">
        <h2>${esc(tee.name)}</h2>
        <span class="tiny mono">par ${teePar(tee)} &middot; ${teeYardage(tee)}y</span>
      </div>
      <div class="card-editor">
        <div class="hdr"><span>#</span><span>Par</span><span>Yards</span></div>
        ${tee.holes.map((h, i) => `
          <div class="line">
            <span class="hno">${h.hole}</span>
            <span class="par-toggle">
              ${[3, 4, 5].map((p) => `
                <button class="${Number(h.par) === p ? 'active' : ''}" data-par="${p}" data-hole="${i}">${p}</button>
              `).join('')}
            </span>
            <input type="number" inputmode="numeric" data-yards="${i}" value="${esc(h.yards)}">
          </div>`).join('')}
      </div>
    </div>

    ${problems.length ? `<div class="err-box">${problems.slice(0, 3).map(esc).join('<br>')}</div>` : ''}

    <div class="card">
      <button class="btn-primary" data-action="save-course">Save Course</button>
      <div class="btn-row">
        <button class="btn-ghost" data-action="goto-courses">Cancel</button>
        ${course.persisted ? `<button class="btn-danger" data-action="delete-course" data-id="${esc(course.id)}">Delete</button>` : ''}
      </div>
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

  const teeName = document.getElementById('teeName');
  if (teeName) {
    teeName.oninput = (e) => {
      STATE.courseDraft.tees[STATE.courseTeeIdx].name = e.target.value;
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
      STATE.courseDraft.tees[STATE.courseTeeIdx].holes[idx].yards = e.target.value;
    };
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
  const start = lieAfter(hole);
  const draft = STATE.draft;
  const holed = draft.endLie === 'holed';

  const shot = newShot({
    shotNum: hole.shots.length + 1,
    startLie: start.lie,
    startDist: Number(start.dist),
    endLie: holed ? null : draft.endLie,
    endDist: holed ? null : Number(draft.endDist),
    holed,
    penalty: Number(draft.penalty || 0),
    miss: draft.miss || null,
  });

  hole.shots.push(shot);
  if (holed) hole.done = true;

  STATE.draft = {};
  store.saveActiveRound(STATE.round);
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
  if (STATE.holeIdx >= 17) return finishRound();
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
  sync.syncInBackground();
}

function startRound(teeName) {
  const course = store.getCourse(STATE.setupCourseId);
  const tee = findTee(course, teeName);
  const problems = validateTee(tee);
  if (problems.length) {
    STATE.error = problems[0] + ' Fix the scorecard before starting.';
    render();
    return;
  }
  STATE.round = newRound({
    player: STATE.player,
    courseId: course.id,
    courseName: course.name,
    teeName: tee.name,
    holes: tee.holes.map((h) => ({
      hole: h.hole,
      par: Number(h.par),
      yards: Number(h.yards),
    })),
  });
  STATE.holeIdx = 0;
  STATE.draft = {};
  STATE.setupCourseId = null;
  store.saveActiveRound(STATE.round);
  go('play');
}

function saveCourseDraft() {
  const course = STATE.courseDraft;
  course.tees.forEach((tee) => {
    tee.holes.forEach((h) => {
      h.par = Number(h.par);
      h.yards = Number(h.yards);
    });
  });
  const problems = validateTee(course.tees[STATE.courseTeeIdx]);
  if (problems.length) {
    STATE.error = problems[0];
    render();
    return;
  }
  course.persisted = true;
  upsertCourse(course);
  go('courses', { courseDraft: null, notice: `Saved ${course.name}.` });
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

  'pick-player': (el) => {
    STATE.player = el.getAttribute('data-player');
    store.setPlayer(STATE.player);
    loadActiveRound();
    go(STATE.round && !isRoundComplete(STATE.round) ? 'play' : 'home');
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
  'pick-course': (el) => go('setup', { setupCourseId: el.getAttribute('data-id') }),
  'start-round': (el) => startRound(el.getAttribute('data-tee')),
  'save-shot': saveShot,
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
  'new-course': () => go('courseEdit', { courseDraft: newCourse(''), courseTeeIdx: 0 }),
  'edit-course': (el) => {
    const course = store.getCourse(el.getAttribute('data-id'));
    if (!course) return;
    go('courseEdit', {
      courseDraft: JSON.parse(JSON.stringify({ ...course, persisted: true })),
      courseTeeIdx: 0,
    });
  },
  'add-tee': () => {
    STATE.courseDraft.tees.push(blankTee('New Tee'));
    STATE.courseTeeIdx = STATE.courseDraft.tees.length - 1;
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
  const target = event.target.closest('[data-action],[data-nav],[data-lie],[data-miss],[data-penalty],[data-tee-idx],[data-par],[data-scope]');
  if (!target) return;

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

  const teeIdx = target.getAttribute('data-tee-idx');
  if (teeIdx !== null) {
    STATE.courseTeeIdx = Number(teeIdx);
    return render();
  }

  const par = target.getAttribute('data-par');
  if (par !== null) {
    const holeIdx = Number(target.getAttribute('data-hole'));
    STATE.courseDraft.tees[STATE.courseTeeIdx].holes[holeIdx].par = Number(par);
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
    STATE.holeIdx = next === null ? 17 : next;
  } else {
    STATE.round = null;
    STATE.holeIdx = 0;
  }
}

function init() {
  document.body.addEventListener('click', onClick);

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

  // Opportunistic catch-up: on launch, and again whenever the phone
  // finds signal after a round played out of coverage.
  sync.syncInBackground(refreshIfIdle);
  window.addEventListener('online', () => sync.syncInBackground(refreshIfIdle));
}

/** Re-render after a background sync, but never mid shot-entry. */
function refreshIfIdle(result) {
  if (!result || (!result.pulled && !result.pushed)) return;
  if (STATE.screen === 'play' || STATE.screen === 'courseEdit') return;
  render();
}

init();
