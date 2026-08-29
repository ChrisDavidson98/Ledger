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
  activeRound: PREFIX + 'active_round',
  rounds: PREFIX + 'rounds',
  courses: PREFIX + 'courses',
  syncQueue: PREFIX + 'sync_queue',
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

export function deleteRound(id) {
  write(KEYS.rounds, getRounds().filter((r) => r.id !== id));
  markSynced(id);
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

/* --- Backup / restore ------------------------------------------- */

/** Everything, as one JSON blob — insurance until the Sheet backend lands. */
export function exportAll() {
  return {
    exportedAt: new Date().toISOString(),
    schema: 1,
    player: getPlayer(),
    rounds: getRounds(),
    courses: getCourses(),
    activeRound: getActiveRound(),
  };
}

export function importAll(data) {
  if (!data || typeof data !== 'object') throw new Error('Not a Ledger backup');
  if (Array.isArray(data.rounds)) write(KEYS.rounds, data.rounds);
  if (Array.isArray(data.courses)) write(KEYS.courses, data.courses);
  if (data.player) write(KEYS.player, data.player);
  if (data.activeRound) write(KEYS.activeRound, data.activeRound);
}
