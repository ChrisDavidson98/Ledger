/* ---------------------------------------------------------------
   storage.js — local persistence.

   localStorage is the primary write path, not a cache. On a golf
   course you have no signal; nothing may ever block on a network
   call. Phase 2 adds a Google Sheet as a SYNC TARGET behind this
   same interface — `unsynced()` already tracks what would need
   pushing, so wiring it up won't touch any calling code.
--------------------------------------------------------------- */

const PREFIX = 'ledger:';
const KEYS = {
  player: PREFIX + 'player',
  roster: PREFIX + 'roster',
  prefs: PREFIX + 'prefs',
  activeRound: PREFIX + 'active_round',
  rounds: PREFIX + 'rounds',
  courses: PREFIX + 'courses',
  syncQueue: PREFIX + 'sync_queue',
  deleteQueue: PREFIX + 'delete_queue',
  teeTimes: PREFIX + 'tee_times',
  teeTimeQueue: PREFIX + 'tee_time_queue',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (err) {
    console.warn('storage read failed', key, err);
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error('storage write failed', key, err);
    return false;
  }
}

/* --- Player ----------------------------------------------------- */

export function getPlayer() {
  return read(KEYS.player, null);
}

export function setPlayer(name) {
  write(KEYS.player, name);
}

export function clearPlayer() {
  localStorage.removeItem(KEYS.player);
}

/* --- Roster ----------------------------------------------------- */

const DEFAULT_ROSTER = ['Chris', 'Kaden', 'Manny'];

/**
 * Who may sign in on this device. Editable from Settings so a fourth
 * name never needs a code change. Per-device by design — this is
 * identity, not security. What actually keeps strangers out of the
 * data is the shared secret on the sheet.
 */
export function getRoster() {
  const stored = read(KEYS.roster, null);
  return Array.isArray(stored) && stored.length ? stored : [...DEFAULT_ROSTER];
}

export function setRoster(names) {
  const cleaned = names
    .map((n) => String(n).trim())
    .filter(Boolean)
    .filter((n, i, all) => all.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i);
  write(KEYS.roster, cleaned.length ? cleaned : [...DEFAULT_ROSTER]);
}

/** Case-insensitive lookup returning the roster's own capitalisation. */
export function matchPlayer(name) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;
  return getRoster().find((n) => n.toLowerCase() === wanted) || null;
}

/* --- Preferences ------------------------------------------------- */

export function getPrefs() {
  return read(KEYS.prefs, {}) || {};
}

export function setPref(key, value) {
  const prefs = getPrefs();
  prefs[key] = value;
  write(KEYS.prefs, prefs);
}

/** Distance buttons instead of the keypad. Off by default — a
 *  rangefinder gives an exact number, and typing it is fine. */
export function trackClubs() {
  return getPrefs().clubs === true;
}

export function usePresets() {
  return getPrefs().presets === true;
}

/** 'auto' follows the phone, otherwise 'light' or 'dark'. */
export function getTheme() {
  return getPrefs().theme || 'auto';
}

/**
 * Which standard strokes gained is measured against on this device.
 *
 * Deliberately a per-device display preference and not a property of
 * a round: two people can look at the same group round against
 * different benchmarks without either of them changing anything, and
 * nothing recomputed this way is ever written back to the sheet.
 */
export function getBenchmark() {
  return getPrefs().benchmark || 'tour';
}

export function setBenchmark(key) {
  setPref('benchmark', key);
}

/** How many recent rounds the rolling handicap figure looks back over. */
export function getHandicapWindow() {
  const n = Number(getPrefs().handicapWindow);
  return Number.isFinite(n) && n >= 3 ? n : 10;
}

/* --- Active round ----------------------------------------------- */

export function getActiveRound() {
  return read(KEYS.activeRound, null);
}

export function saveActiveRound(round) {
  return write(KEYS.activeRound, round);
}

export function clearActiveRound() {
  localStorage.removeItem(KEYS.activeRound);
}

/* --- Completed rounds ------------------------------------------- */

export function getRounds() {
  return read(KEYS.rounds, []);
}

export function getRound(id) {
  return getRounds().find((r) => r.id === id) || null;
}

/** Stores the full round (raw shots included) newest-first. */
export function saveRound(round) {
  const rounds = getRounds().filter((r) => r.id !== round.id);
  rounds.push(round);
  rounds.sort((a, b) => new Date(b.date) - new Date(a.date));
  write(KEYS.rounds, rounds);
  enqueueSync(round.id);
}

/**
 * Write a round WITHOUT queueing it for sync. Used when a round
 * arrives from the sheet — queueing it would push it straight back.
 */
export function replaceRound(round) {
  const rounds = getRounds().filter((r) => r.id !== round.id);
  rounds.push(round);
  rounds.sort((a, b) => new Date(b.date) - new Date(a.date));
  write(KEYS.rounds, rounds);
}

/**
 * Delete locally and remember to delete on the sheet.
 *
 * The tombstone matters twice over: it tells the next sync to remove
 * the round from the sheet, and it stops a pull that happens first
 * from resurrecting it. Without it a deleted round came back every
 * time anyone pulled.
 */
export function deleteRound(id) {
  write(KEYS.rounds, getRounds().filter((r) => r.id !== id));
  markSynced(id);
  const queue = read(KEYS.deleteQueue, []);
  if (!queue.includes(id)) {
    queue.push(id);
    write(KEYS.deleteQueue, queue);
  }
}

export function pendingDeletions() {
  return read(KEYS.deleteQueue, []);
}

export function clearDeletion(id) {
  write(KEYS.deleteQueue, pendingDeletions().filter((x) => x !== id));
}

/** Re-queue every stored round, to push them all up again. */
export function requeueAll() {
  const ids = getRounds().map((r) => r.id);
  write(KEYS.syncQueue, ids);
  return ids.length;
}

/* --- Courses ---------------------------------------------------- */

export function getCourses() {
  return read(KEYS.courses, []);
}

export function getCourse(id) {
  return getCourses().find((c) => c.id === id) || null;
}

export function saveCourse(course) {
  const courses = getCourses().filter((c) => c.id !== course.id);
  courses.push(course);
  courses.sort((a, b) => a.name.localeCompare(b.name));
  write(KEYS.courses, courses);
}

export function deleteCourse(id) {
  write(KEYS.courses, getCourses().filter((c) => c.id !== id));
}

/* --- Sync queue (Phase 2 groundwork) ---------------------------- */

function enqueueSync(roundId) {
  const queue = read(KEYS.syncQueue, []);
  if (!queue.includes(roundId)) {
    queue.push(roundId);
    write(KEYS.syncQueue, queue);
  }
}

export function unsynced() {
  return read(KEYS.syncQueue, []);
}

export function markSynced(roundId) {
  write(KEYS.syncQueue, unsynced().filter((id) => id !== roundId));
}

/* --- Tee times --------------------------------------------------
   Deleting is a tombstone in place rather than a removal: a tee time
   carries a `deletedAt` and stays put. That is simpler than the
   archive tabs rounds use, and enough — a tee time holds no shots,
   so nothing is lost if one is dropped, but a deletion still has to
   survive long enough to reach the other phones and stop the entry
   coming back on the next pull.
------------------------------------------------------------------ */

export function getTeeTimes() {
  return read(KEYS.teeTimes, []);
}

/** Live tee times only. Callers wanting tombstones use getTeeTimes(). */
export function getLiveTeeTimes() {
  return getTeeTimes().filter((t) => !t.deletedAt);
}

export function getTeeTime(id) {
  return getTeeTimes().find((t) => t.id === id) || null;
}

function writeTeeTimes(teeTimes) {
  const sorted = teeTimes.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))
    || String(a.time || '').localeCompare(String(b.time || '')));
  write(KEYS.teeTimes, sorted);
}

/** Save and queue for the sheet. Stamps `updatedAt` so pulls can compare. */
export function saveTeeTime(teeTime) {
  const next = { ...teeTime, updatedAt: new Date().toISOString() };
  writeTeeTimes(getTeeTimes().filter((t) => t.id !== next.id).concat([next]));
  enqueueTeeTime(next.id);
  return next;
}

/** Write one that arrived from the sheet, without pushing it back up. */
export function replaceTeeTime(teeTime) {
  writeTeeTimes(getTeeTimes().filter((t) => t.id !== teeTime.id).concat([teeTime]));
}

/** Tombstone rather than removal, so the deletion can reach the sheet. */
export function deleteTeeTime(id) {
  const found = getTeeTime(id);
  if (!found) return null;
  return saveTeeTime({ ...found, deletedAt: new Date().toISOString() });
}

function enqueueTeeTime(id) {
  const queue = read(KEYS.teeTimeQueue, []);
  if (!queue.includes(id)) {
    queue.push(id);
    write(KEYS.teeTimeQueue, queue);
  }
}

export function unsyncedTeeTimes() {
  return read(KEYS.teeTimeQueue, []);
}

export function markTeeTimeSynced(id) {
  write(KEYS.teeTimeQueue, unsyncedTeeTimes().filter((x) => x !== id));
}

/* --- Backup / restore ------------------------------------------- */

/** Everything, as one JSON blob — insurance until the Sheet backend lands. */
export function exportAll() {
  return {
    exportedAt: new Date().toISOString(),
    schema: 2,
    player: getPlayer(),
    rounds: getRounds(),
    courses: getCourses(),
    teeTimes: getTeeTimes(),
    activeRound: getActiveRound(),
  };
}

export function importAll(data) {
  if (!data || typeof data !== 'object') throw new Error('Not a Ledger backup');
  if (Array.isArray(data.rounds)) write(KEYS.rounds, data.rounds);
  if (Array.isArray(data.courses)) write(KEYS.courses, data.courses);
  // Absent in backups taken before the calendar existed, which is
  // fine — an old backup restores as a calendar with nothing in it.
  if (Array.isArray(data.teeTimes)) write(KEYS.teeTimes, data.teeTimes);
  if (data.player) write(KEYS.player, data.player);
  if (data.activeRound) write(KEYS.activeRound, data.activeRound);
}
