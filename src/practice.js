/* ---------------------------------------------------------------
   practice.js — "what should I go and practise", from recent rounds.

   Measured the same way as the handicap card on Stats: the weakest
   part of the game is the one furthest below the level of the rest of
   it, not the one with the most negative strokes gained. Against a
   tour baseline approach is nearly always the biggest number for an
   amateur simply because it is the biggest share of the game; asking
   which part lags YOUR overall level is what makes the answer useful.
--------------------------------------------------------------- */

import { CATEGORIES } from './baseline.js';
import { sgRounds, roundTotals, playedHoles } from './model.js';
import { handicapProfile, upsideFor } from './handicap.js';

/** Recent enough to reflect the current game, enough to not be one bad day. */
export const FOCUS_WINDOW = 10;
export const FOCUS_MIN_ROUNDS = 3;
/** Below this many shots a round, the gap is noise, not a weakness. */
const MIN_UPSIDE = 0.5;

/**
 * What a session for each category looks like. `practiceType` is one
 * of schedule.js PRACTICE_TYPES so booking it lands in the diary as an
 * ordinary practice session.
 */
export const FOCUS_PLANS = {
  ott: {
    practiceType: 'Range',
    minutes: 45,
    title: 'Driver and fairway woods',
    drill: 'Pick two targets a fairway apart and hit every ball at one of them. Count how many finish between.',
  },
  app: {
    practiceType: 'Range',
    minutes: 45,
    title: 'Wedges and mid-irons',
    drill: 'Work through 60, 90, 120 and 150 yards, five balls each, to a flag. Note how many land within a club length of the number.',
  },
  arg: {
    practiceType: 'Short game',
    minutes: 40,
    title: 'Chipping and bunker play',
    drill: 'Nine balls from nine different spots inside 30 yards. Keep score: up and down as if it were the course.',
  },
  putt: {
    practiceType: 'Putting',
    minutes: 30,
    title: 'Lag putting and short putts',
    drill: 'Ten putts from 30 feet to a tee-length circle, then make 20 in a row from 4 feet before leaving.',
  },
};

/**
 * The weakest part of this player's recent game, or null when there is
 * not enough to say — too few rounds with shots, or no part of the game
 * lagging the rest by enough to be worth a session.
 */
/**
 * The recent game as a handicap profile: strokes gained per 18 against
 * tour, and the handicap each part of the game plays like. Null until
 * there are enough rounds with shots to say anything.
 */
export function gameProfile(rounds, { window = FOCUS_WINDOW, minRounds = FOCUS_MIN_ROUNDS } = {}) {
  const recent = sgRounds(rounds || [])
    .filter((r) => playedHoles(r).length)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, window);
  if (recent.length < minRounds) return null;

  const holes = recent.reduce((sum, r) => sum + playedHoles(r).length, 0);
  const per18 = { total: 0 };
  CATEGORIES.forEach((c) => { per18[c] = 0; });
  recent.forEach((round) => {
    const totals = roundTotals(round, 'tour');
    CATEGORIES.forEach((c) => { per18[c] += totals[c]; });
    per18.total += totals.total;
  });
  const scale = 18 / holes;
  Object.keys(per18).forEach((k) => { per18[k] *= scale; });

  return { per18, profile: handicapProfile(per18), rounds: recent.length };
}

export function practiceFocus(rounds, options = {}) {
  const game = gameProfile(rounds, options);
  if (!game) return null;
  const { profile } = game;
  const weakest = profile.weakest;
  const upside = upsideFor(weakest);
  if (upside < MIN_UPSIDE) return null;

  return {
    category: weakest.category,
    handicap: weakest.handicap,
    overall: profile.overall,
    strokesPer18: upside,
    rounds: game.rounds,
    plan: FOCUS_PLANS[weakest.category],
  };
}

/**
 * A practice session of the suggested kind already booked in the next
 * week, so the card can say "you have one" instead of asking again.
 */
export function bookedFocus(teeTimes, practiceType, today, days = 7) {
  const end = addDays(today, days);
  return (teeTimes || [])
    .filter((t) => !t.deletedAt && t.status === 'scheduled' && t.kind === 'practice')
    .filter((t) => t.practiceType === practiceType && t.date >= today && t.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))[0] || null;
}

function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d + n);
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
