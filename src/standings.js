/* ---------------------------------------------------------------
   standings.js — the season table on the Club tab.

   Ranked on strokes gained per 18 rather than score, because the
   group does not always play the same course or the same tees, and
   strokes gained is the one number that already allows for both.
   Score over par is still shown beside it, since it is what people
   actually talk about.
--------------------------------------------------------------- */

import { CATEGORIES } from './baseline.js';
import { playerSummary } from './model.js';

/** Enough rounds that one great day does not win a season. */
export const MIN_ROUNDS = { season: 5, recent: 2 };
const DAY_MS = 24 * 60 * 60 * 1000;

/** The rounds a scope covers, as [from, until) timestamps. */
export function scopeWindow(scope, now = new Date()) {
  if (scope === 'recent') return { from: now.getTime() - 30 * DAY_MS, until: now.getTime() + 1 };
  return { from: new Date(now.getFullYear(), 0, 1).getTime(), until: now.getTime() + 1 };
}

function within(rounds, { from, until }) {
  return (rounds || []).filter((r) => {
    const t = new Date(r.date).getTime();
    return t >= from && t < until;
  });
}

/**
 * Qualified players ranked best first, then everyone short of the
 * minimum in round order, unranked. Each row carries `move` — places
 * gained (+) or lost (−) against the same table 30 days ago — for the
 * season view only; a 30-day table compared with itself says nothing.
 */
export function standings(allRounds, { scope = 'season', baseline = 'tour', now = new Date() } = {}) {
  const minRounds = MIN_ROUNDS[scope] || MIN_ROUNDS.season;
  const table = rank(within(allRounds, scopeWindow(scope, now)), minRounds, baseline);

  if (scope === 'season') {
    const before = new Date(now.getTime() - 30 * DAY_MS);
    // Only compare within the same season: in January there is no "before".
    if (before.getFullYear() === now.getFullYear()) {
      const then = rank(within(allRounds, { from: scopeWindow('season', now).from, until: before.getTime() }), minRounds, baseline);
      const was = new Map(then.filter((r) => r.rank).map((r) => [r.player, r.rank]));
      table.forEach((row) => {
        if (!row.rank) return;
        row.move = was.has(row.player) ? was.get(row.player) - row.rank : null;
      });
    }
  }

  return { rows: table, minRounds, leaders: categoryLeaders(table) };
}

function rank(rounds, minRounds, baseline) {
  const players = [...new Set(rounds.map((r) => r.player))].filter(Boolean);
  const rows = players.map((player) => {
    const s = playerSummary(player, rounds, baseline);
    return {
      player,
      rounds: s.rounds,
      shotRounds: s.shotRounds,
      toParPer18: s.toParPer18,
      sg: s.sg,
      qualified: !!s.sg && s.shotRounds >= minRounds,
      rank: null,
      move: null,
    };
  });

  const qualified = rows.filter((r) => r.qualified).sort((a, b) => b.sg.total - a.sg.total);
  qualified.forEach((row, i) => { row.rank = i + 1; });
  const rest = rows.filter((r) => !r.qualified).sort((a, b) => b.shotRounds - a.shotRounds || a.player.localeCompare(b.player));
  return qualified.concat(rest);
}

/** Best in each part of the game among qualified players; null with fewer than two. */
function categoryLeaders(rows) {
  const qualified = rows.filter((r) => r.qualified);
  if (qualified.length < 2) return null;
  const out = {};
  CATEGORIES.forEach((c) => {
    const best = qualified.reduce((a, b) => (b.sg[c] > a.sg[c] ? b : a));
    out[c] = { player: best.player, sg: best.sg[c] };
  });
  return out;
}
