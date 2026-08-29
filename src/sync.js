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

import { shotSG, roundTotals, roundScore, roundPar, playedHoles } from './model.js';
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
    hole.shots.forEach((shot) => {
      const { category, sg } = shotSG(shot, hole.par);
      shots.push({
        round_id: round.id,
        player: round.player,
        date: round.date,
        course_name: round.courseName,
        tee_name: round.teeName,
        hole: hole.hole,
        par: hole.par,
        hole_yards: hole.yards,
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
          done: false,
        });
      }
      const holed = String(row.holed).toLowerCase() === 'yes'
        || String(row.holed).toLowerCase() === 'true';
      const hole = byHole.get(holeNum);
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
    schema: 1,
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
  let added = 0;

  (data.rounds || []).forEach((summaryRow) => {
    const id = String(summaryRow.round_id);
    // Never let the server overwrite a round we have not pushed yet.
    if (pending.has(id)) return;
    const rows = shotsByRound.get(id) || [];
    if (!rows.length) return;
    const round = rebuildRound(summaryRow, rows);
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
    if (!course.tees || !course.tees.length) return;
    if (!localIds.has(course.id)) added += 1;
    store.saveCourse(course);
  });

  return { added, seen: (data.courses || []).length };
}

/** Everything, in the order that keeps local work safest. */
export async function syncAll() {
  const result = { pushed: 0, pulled: 0, courses: 0, errors: [] };

  // Push first: local work should reach the sheet before anything
  // from the sheet is allowed to land on top of it.
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

/** Fire-and-forget flush, safe to call from anywhere. */
export function syncInBackground(onDone) {
  if (!isConfigured() || !navigator.onLine) return;
  syncAll().then((result) => {
    if (onDone) onDone(result);
  }).catch(() => {});
}
