/* ---------------------------------------------------------------
   sync.js — Google Sheet sync.

   The sheet is a sync target, not a save button. Every call here is
   opportunistic: it runs after data is already safe in localStorage,
   it is allowed to fail, and failure only means "still queued". No
   screen ever waits on it.

   Rounds are pushed as raw shot rows. Strokes gained is mirrored
   into the sheet for pivoting there, but is never read back — the
   app recomputes from raw columns so old rows keep improving as the
   baseline tables do.
--------------------------------------------------------------- */

import { shotSG, roundTotals, roundScore, roundPar, playedHoles, holeScore } from './model.js';
import * as store from './storage.js';

const CONFIG_KEY = 'ledger:sync_config';
const LAST_PULL_KEY = 'ledger:last_pull';

/* --- Config ------------------------------------------------------ */

export function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY)) || { url: '', secret: '' };
  } catch (err) {
    return { url: '', secret: '' };
  }
}

export function setConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function isConfigured() {
  const { url, secret } = getConfig();
  return Boolean(url && secret);
}

/** A sheet is known, but this device does not hold the passphrase. */
export function needsPassphrase() {
  const { url, secret } = getConfig();
  return Boolean(url) && !secret;
}

export function hasUrl() {
  return Boolean(getConfig().url);
}

/**
 * Check a passphrase by actually asking the backend. There is no
 * local copy to compare against on purpose: the passphrase IS the
 * sheet secret, so a wrong one cannot reach any data no matter what
 * the client believes. Kept on success so it is asked for once per
 * device rather than once per round.
 */
export async function unlock(passphrase) {
  const { url } = getConfig();
  if (!url) throw new Error('No sheet is set up on this device yet.');
  setConfig({ url, secret: String(passphrase || '').trim() });
  try {
    await ping();
    return true;
  } catch (err) {
    setConfig({ url, secret: '' });
    throw err;
  }
}

/** Forget the passphrase but keep the sheet, so it is asked for again. */
export function lock() {
  const { url } = getConfig();
  setConfig({ url, secret: '' });
}

/* --- Setup links -------------------------------------------------- */

/**
 * A link that points a new phone at the sheet without anyone having
 * to retype an /exec URL. It carries the URL ONLY — never the
 * passphrase, which is what makes the link safe to text. Whoever
 * opens it still has to know the passphrase to reach any data, and
 * the URL is not worth protecting on its own.
 *
 * Kept out of the repo on purpose: a URL sitting in public source is
 * something strangers can pointlessly hammer, even though they cannot
 * read anything.
 */
export function setupLink(origin = window.location.href) {
  const { url } = getConfig();
  if (!url) return null;
  const base = origin.split('?')[0].split('#')[0];
  const encoded = btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${base}?s=${encoded}`;
}

/**
 * Consume a ?s= parameter on load. Only applies when this device has
 * no sheet yet, so a link can never silently repoint a working phone
 * at somewhere else.
 */
export function applySetupLink() {
  try {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('s');
    if (!encoded) return false;
    if (hasUrl()) return false;

    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const url = atob(padded);
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) return false;

    setConfig({ url, secret: '' });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Drop the ?s= parameter — but only once this device is actually
 * unlocked.
 *
 * It used to be stripped the moment the page loaded, which quietly
 * broke the iOS route: open the link in Safari, add it to the home
 * screen, and the shortcut you saved had already lost the parameter.
 * A home-screen app is a separate storage container, so it started
 * with no sheet at all and the link looked like it had done nothing.
 * Keeping the parameter until sign-in succeeds means a shortcut saved
 * at any point before that still carries what it needs.
 */
export function clearSetupParam() {
  try {
    if (!isConfigured()) return;
    if (!new URLSearchParams(window.location.search).get('s')) return;
    window.history.replaceState({}, '', window.location.pathname);
  } catch (err) {
    /* address bar tidying is never worth throwing over */
  }
}

function lastPull() {
  return localStorage.getItem(LAST_PULL_KEY) || null;
}

function setLastPull(stamp) {
  if (stamp) localStorage.setItem(LAST_PULL_KEY, stamp);
}

/* --- Transport --------------------------------------------------- */

/**
 * Apps Script cannot answer a CORS preflight, so the request must stay
 * a "simple" one: text/plain, no custom headers. The body is still JSON.
 */
async function post(action, payload = {}, { timeout = 20000 } = {}) {
  const { url, secret } = getConfig();
  if (!url || !secret) throw new Error('Sync is not configured.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, secret, ...payload }),
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Backend returned ${response.status}.`);
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Backend rejected the request.');
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('The backend did not answer in time. Apps Script is slow on its first request after a quiet spell — try once more.');
    }
    // A blocked request and no connection both surface as this one
    // opaque TypeError, so say what to actually go and check.
    if (err.name === 'TypeError') {
      throw new Error(
        navigator.onLine
          ? 'Could not reach the backend. Check the URL is the deployed /exec one and that access is set to "Anyone".'
          : 'No connection. Rounds stay saved on this phone and upload once you have signal.'
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function ping() {
  return post('ping', {}, { timeout: 15000 });
}

export function setupSheets() {
  return post('setup');
}

/* --- Shape conversion -------------------------------------------- */

const yn = (value) => (value ? 'yes' : 'no');

/** A round becomes one summary row plus one row per shot. */
export function flattenRound(round) {
  const totals = roundTotals(round);
  const holes = playedHoles(round);

  const summary = {
    round_id: round.id,
    player: round.player,
    date: round.date,
    finished_at: round.finishedAt || '',
    course_id: round.courseId || '',
    course_name: round.courseName,
    tee_name: round.teeName,
    mode: round.mode || 'full',
    holes_played: holes.length,
    score: roundScore(round),
    par: roundPar(round),
    to_par: roundScore(round) - roundPar(round),
    sg_ott: round2(totals.ott),
    sg_app: round2(totals.app),
    sg_arg: round2(totals.arg),
    sg_putt: round2(totals.putt),
    sg_total: round2(totals.total),
  };

  const shots = [];
  holes.forEach((hole) => {
    const common = {
      round_id: round.id,
      player: round.player,
      date: round.date,
      course_name: round.courseName,
      tee_name: round.teeName,
      hole: hole.hole,
      par: hole.par,
      hole_yards: hole.yards,
      hole_score: holeScore(hole),
    };

    // A score-only hole has no shots to write, so it gets a single
    // row carrying the score. Otherwise its hole-by-hole detail would
    // live nowhere but the phone that entered it, and the pull — which
    // rebuilds rounds from these rows — would never see the round.
    if (!hole.shots.length) {
      shots.push({
        ...common,
        shot_num: 0,
        start_lie: '', start_dist: '', start_unit: '',
        end_lie: '', end_dist: '', end_unit: '',
        holed: '', penalty: 0, miss: '', category: 'score', sg: '',
      });
      return;
    }

    hole.shots.forEach((shot) => {
      const { category, sg } = shotSG(shot, hole.par);
      shots.push({
        ...common,
        shot_num: shot.n,
        start_lie: shot.startLie,
        start_dist: shot.startDist,
        start_unit: shot.startUnit,
        end_lie: shot.endLie || '',
        end_dist: shot.endDist == null ? '' : shot.endDist,
        end_unit: shot.endUnit || '',
        holed: yn(shot.holed),
        penalty: shot.penalty || 0,
        miss: shot.miss || '',
        category,
        sg: round2(sg),
      });
    });
  });

  return { summary, shots };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/** Rebuild a round object from the flat rows the sheet returns. */
export function rebuildRound(summaryRow, shotRows) {
  const byHole = new Map();
  const mode = String(summaryRow.mode || 'full') === 'score' ? 'score' : 'full';

  shotRows
    .slice()
    .sort((a, b) => Number(a.hole) - Number(b.hole) || Number(a.shot_num) - Number(b.shot_num))
    .forEach((row) => {
      const holeNum = Number(row.hole);
      if (!byHole.has(holeNum)) {
        byHole.set(holeNum, {
          hole: holeNum,
          par: Number(row.par),
          yards: Number(row.hole_yards),
          shots: [],
          score: null,
          done: false,
        });
      }
      const hole = byHole.get(holeNum);

      // shot_num 0 is a score-only hole: a score and nothing else.
      if (Number(row.shot_num) === 0) {
        const score = Number(row.hole_score);
        hole.score = Number.isFinite(score) && score > 0 ? score : null;
        hole.done = hole.score != null;
        return;
      }

      const holed = String(row.holed).toLowerCase() === 'yes'
        || String(row.holed).toLowerCase() === 'true';
      hole.shots.push({
        n: Number(row.shot_num),
        startLie: String(row.start_lie),
        startDist: Number(row.start_dist),
        startUnit: String(row.start_unit),
        endLie: holed ? null : String(row.end_lie),
        endDist: holed ? null : Number(row.end_dist),
        endUnit: holed ? null : String(row.end_unit),
        holed,
        penalty: Number(row.penalty) || 0,
        miss: row.miss ? String(row.miss) : null,
      });
      if (holed) hole.done = true;
    });

  return {
    id: String(summaryRow.round_id),
    schema: 3,
    mode,
    player: String(summaryRow.player),
    courseId: summaryRow.course_id ? String(summaryRow.course_id) : null,
    courseName: String(summaryRow.course_name),
    teeName: String(summaryRow.tee_name),
    date: toIso(summaryRow.date),
    finishedAt: summaryRow.finished_at ? toIso(summaryRow.finished_at) : null,
    holes: [...byHole.values()].sort((a, b) => a.hole - b.hole),
    remote: true,
  };
}

/** Sheets hands back Date objects for anything it parsed as a date. */
function toIso(value) {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/* --- Operations -------------------------------------------------- */

/** Push every round still sitting in the queue. */
export async function pushPending() {
  const queued = store.unsynced();
  if (!queued.length) return { pushed: 0 };

  const payloads = queued
    .map((id) => store.getRound(id))
    .filter(Boolean)
    .map(flattenRound);

  if (!payloads.length) {
    queued.forEach(store.markSynced);
    return { pushed: 0 };
  }

  await post('pushRounds', { rounds: payloads });
  queued.forEach(store.markSynced);
  return { pushed: payloads.length };
}

/** Remove deleted rounds from the sheet so they stop coming back. */
export async function pushDeletions() {
  const ids = store.pendingDeletions();
  if (!ids.length) return { deleted: 0 };
  await post('deleteRounds', { ids });
  ids.forEach(store.clearDeletion);
  return { deleted: ids.length };
}

/** Rounds sitting in the sheet's archive, newest deletion first. */
export async function listArchive() {
  const data = await post('listArchive');
  return (data.rounds || []).map((row) => ({
    id: String(row.round_id),
    player: String(row.player),
    courseName: String(row.course_name),
    teeName: String(row.tee_name),
    mode: String(row.mode || 'full'),
    score: Number(row.score) || 0,
    toPar: Number(row.to_par) || 0,
    holes: Number(row.holes_played) || 0,
    date: row.date,
    deletedAt: row.deleted_at,
  }));
}

/** Put an archived round back, then pull it down again. */
export async function restoreRound(id) {
  await post('restoreRounds', { ids: [id] });
  store.clearDeletion(id);
  await pullRounds({ full: true });
}

/**
 * Re-send every stored round, whether or not it is queued. Needed
 * when the row format changes: rounds already marked synced are
 * sitting on the sheet in the old shape and nothing would resend them.
 */
export async function pushAll() {
  const count = store.requeueAll();
  await pushPending();
  return { pushed: count };
}

/** Pull everyone's rounds and merge them in, local edits winning. */
export async function pullRounds({ full = false } = {}) {
  const data = await post('pullRounds', { since: full ? null : lastPull() });
  const shotsByRound = new Map();

  (data.shots || []).forEach((row) => {
    const id = String(row.round_id);
    if (!shotsByRound.has(id)) shotsByRound.set(id, []);
    shotsByRound.get(id).push(row);
  });

  const local = store.getRounds();
  const localIds = new Set(local.map((r) => r.id));
  const pending = new Set(store.unsynced());
  const deleted = new Set(store.pendingDeletions());
  let added = 0;

  (data.rounds || []).forEach((summaryRow) => {
    const id = String(summaryRow.round_id);
    // Never let the server overwrite a round we have not pushed yet.
    if (pending.has(id)) return;
    // Nor resurrect one this device has deleted but not yet synced.
    if (deleted.has(id)) return;
    const rows = shotsByRound.get(id) || [];
    // A round with no rows at all is a partial write, not a real round.
    if (!rows.length) return;
    const round = rebuildRound(summaryRow, rows);
    if (!playedHoles(round).length) return;
    if (!localIds.has(id)) added += 1;
    store.replaceRound(round);
  });

  setLastPull(data.serverTime);
  return { added, seen: (data.rounds || []).length };
}

export async function pushCourses() {
  const courses = store.getCourses();
  if (!courses.length) return { pushed: 0 };
  await post('pushCourses', { courses });
  return { pushed: courses.length };
}

export async function pullCourses() {
  const data = await post('pullCourses');
  const local = store.getCourses();
  const localIds = new Set(local.map((c) => c.id));
  let added = 0;

  (data.courses || []).forEach((course) => {
    if (!course.nines || !course.nines.length) return;
    if (!localIds.has(course.id)) added += 1;
    store.saveCourse(course);
  });

  return { added, seen: (data.courses || []).length };
}

/** Everything, in the order that keeps local work safest. */
export async function syncAll() {
  const result = { pushed: 0, pulled: 0, courses: 0, errors: [] };

  // Deletions go first, so a round removed here is gone from the
  // sheet before the pull could hand it back.
  try {
    result.deleted = (await pushDeletions()).deleted;
  } catch (err) {
    result.errors.push('Delete failed: ' + err.message);
  }

  // Push before pull: local work should reach the sheet before
  // anything from the sheet is allowed to land on top of it.
  try {
    result.pushed = (await pushPending()).pushed;
  } catch (err) {
    result.errors.push('Push failed: ' + err.message);
  }

  try {
    await pushCourses();
    result.courses = (await pullCourses()).added;
  } catch (err) {
    result.errors.push('Courses failed: ' + err.message);
  }

  try {
    result.pulled = (await pullRounds()).added;
  } catch (err) {
    result.errors.push('Pull failed: ' + err.message);
  }

  return result;
}

let lastAuto = 0;
let inFlight = false;
const AUTO_GAP_MS = 45000;

/**
 * Fire-and-forget flush, safe to call from anywhere and safe to call
 * often — it will not stack up overlapping syncs, and automatic
 * triggers are spaced out. Deliberate actions (a finished round, a
 * saved course, Sync Now) pass force so they never get swallowed.
 */
export function syncInBackground(onDone, { force = false } = {}) {
  if (!isConfigured() || !navigator.onLine || inFlight) return;
  const now = Date.now();
  if (!force && now - lastAuto < AUTO_GAP_MS) return;

  lastAuto = now;
  inFlight = true;
  syncAll()
    .then((result) => { if (onDone) onDone(result); })
    .catch(() => {})
    .finally(() => { inFlight = false; });
}
