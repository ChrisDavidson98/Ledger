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
  rounds.unshift(round);
  write(KEYS.rounds, rounds);
  enqueueSync(round.id);
}

export function deleteRound(id) {
  write(KEYS.rounds, getRounds().filter((r) => r.id !== id));
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
