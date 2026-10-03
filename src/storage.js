/* ---------------------------------------------------------------
   storage.js — local persistence.

   localStorage is the primary write path, not a cache. On a golf
   course you have no signal; nothing may ever block on a network
   call. Phase 2 adds a Google Sheet as a SYNC TARGET behind this
   same interface — `unsynced()` already tracks what would need
   pushing, so wiring it up won't touch any calling code.
--------------------------------------------------------------- */

import { CLUBS, DEFAULT_BAG, DEFAULT_BENCHMARK } from './baseline.js';

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
  players: PREFIX + 'players',
  rosterSource: PREFIX + 'roster_source',
  seenInvites: PREFIX + 'seen_invites',
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
 * Who may sign in.
 *
 * This used to be a per-device list, which was a mistake with a very
 * specific failure: adding somebody on YOUR phone did nothing at all
 * on theirs. They opened the app, typed a name their phone had never
 * heard of, and were turned away by a message blaming their device.
 * Nothing was broken; the list simply never travelled.
 *
 * It now lives on the sheet and is pulled at the gate. The per-device
 * list survives underneath as the fallback, for two cases that both
 * matter: a phone with no sheet configured at all, and the window
 * between deploying this and anybody typing a name into the new tab.
 * Falling back beats locking everyone out.
 */
export function getPlayers() {
  const stored = read(KEYS.players, null);
  return Array.isArray(stored) ? stored : [];
}

/** Cache the shared roster, with where it came from and when. */
export function setPlayers(players, source = 'network') {
  write(KEYS.players, players);
  write(KEYS.rosterSource, { source, at: new Date().toISOString(), count: players.length });
}

/** What the last roster load managed, for the message at the gate. */
export function rosterOrigin() {
  return read(KEYS.rosterSource, null);
}

/** True once the sheet has anybody on it, which changes what Settings offers. */
export function hasSharedRoster() {
  return getPlayers().length > 0;
}

/** Active names only — the list every other screen means by "the roster". */
export function getRoster() {
  const shared = activeNames(getPlayers());
  if (shared.length) return shared;
  const stored = read(KEYS.roster, null);
  return Array.isArray(stored) && stored.length ? stored : [...DEFAULT_ROSTER];
}

/** The local fallback list, kept for a device with no sheet behind it. */
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

/** Active names out of a set of player records. */
export function activeNames(players) {
  return (players || []).filter((p) => p.active !== false).map((p) => p.player);
}

/**
 * Match a typed name against a roster, and say WHY when it fails.
 *
 * Pure, and separated from storage for exactly that reason: it is the
 * piece the gate hangs on, so it should be testable without a device
 * to write to. `shared` is the sheet's list; `local` is the per-device
 * fallback used only when the sheet has nobody on it yet.
 *
 * The gate needs the difference between "no such player", "that
 * account is switched off" and "you typed nothing", because each one
 * needs a different sentence and a single null could not tell them
 * apart. Matching is on trimmed lowercase both sides; what comes back
 * is the roster's own spelling, never what was typed.
 */
export function findInRoster(name, shared, local) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return { status: 'empty', player: null };

  if (shared && shared.length) {
    const found = shared.find((p) => String(p.player).trim().toLowerCase() === wanted);
    if (!found) return { status: 'missing', player: null };
    if (found.active === false) return { status: 'inactive', player: found.player };
    return { status: 'ok', player: found.player };
  }

  const fallback = (local || []).find((n) => String(n).trim().toLowerCase() === wanted);
  return fallback ? { status: 'ok', player: fallback } : { status: 'missing', player: null };
}

/** The same, against whatever this device currently holds. */
export function lookupPlayer(name) {
  return findInRoster(name, getPlayers(), getRoster());
}

/* --- Seen invites ------------------------------------------------
   Per player, because a phone can be handed to somebody else: one
   person dismissing an invite should not hide another's.
------------------------------------------------------------------ */

export function getSeenInvites(player) {
  const all = read(KEYS.seenInvites, {}) || {};
  return all[String(player || '').toLowerCase()] || [];
}

export function markInvitesSeen(player, ids) {
  const all = read(KEYS.seenInvites, {}) || {};
  const key = String(player || '').toLowerCase();
  all[key] = Array.from(new Set((all[key] || []).concat(ids)));
  write(KEYS.seenInvites, all);
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

/**
 * The clubs a player carries. Kept per player rather than per phone:
 * rounds get logged on whichever phone is to hand, and Manny's 2-hybrid
 * should not turn up in anybody else's picker.
 */
export function getBag(player) {
  const bags = getPrefs().bags || {};
  const bag = bags[player];
  return Array.isArray(bag) && bag.length ? bag : DEFAULT_BAG.slice();
}

export function toggleBagClub(player, club) {
  const bags = getPrefs().bags || {};
  const bag = getBag(player);
  const next = bag.includes(club) ? bag.filter((c) => c !== club) : [...bag, club];
  if (!next.length) return;
  bags[player] = CLUBS.filter((c) => next.includes(c));
  setPref('bags', bags);
}

export function usePresets() {
  return getPrefs().presets === true;
}

/** Miss grid on the shot screen itself (default), or behind a tap. */
export function missInline() {
  return getPrefs().missInline !== false;
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
  const chosen = getPrefs().benchmark;
  if (chosen) return chosen;
  // Against tour nearly every row an amateur sees says "costing
  // strokes", which teaches a new player nothing. New devices start at
  // the player's own level instead (DEFAULT_BENCHMARK). A device that already holds rounds was
  // reading tour before this default existed, so it keeps tour rather
  // than having every number shift under it. Settled once, then stored.
  const fallback = getRounds().length ? 'tour' : DEFAULT_BENCHMARK;
  setPref('benchmark', fallback);
  return fallback;
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
