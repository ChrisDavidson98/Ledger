/* ---------------------------------------------------------------
   handicap.js — translating strokes gained into a handicap level.

   Measured against a tour baseline every amateur is negative, which
   is accurate and almost useless: when every column reads minus, none
   of them stands out. This converts the same numbers into "you play
   this part of the game like an X handicap", which is a scale people
   actually think in.

   HOW THE MODEL WAS BUILT, because it matters for how far to trust it:

   Total strokes gained against a tour baseline is, structurally, your
   score minus what a tour player would shoot on the same course. That
   is not an assumption — it falls out of the arithmetic, and it is
   visible in real rounds: a 77 came out at -6.6 and a 97 at -26.16 on
   the same course, a 20 stroke score gap against a 19.6 stroke SG gap.

   So the total line is anchored on scoring, calibrated against those
   two real rounds:

       total SG per 18  ~=  -(3.2 + 0.85 * handicap)

   Scratch lands at -3.2, which matches the usual figure of a scratch
   golfer being about three strokes behind tour average. The two rounds
   above land at handicap 4 and handicap 27, against scores of 77 and
   97. Published tables were tried first and rejected: one widely cited
   set puts a 20 handicap at -15.2 total, which would have a 20 handicap
   shooting about 86 on a par 71, and that is not what a 20 shoots.

   The split BETWEEN categories is the softer part. Category shares come
   from the consistent finding that approach play is the biggest
   separator between amateurs and professionals, with driving second.
   Treat the per-category handicap as indicative — good for "approach is
   my weak spot", not for "I am exactly a 12.4 approach player".

   Everything here is a small set of constants on purpose. Better data
   means editing the numbers below, and since strokes gained is always
   recomputed from raw shots, every round already logged updates with it.
--------------------------------------------------------------- */

import { CATEGORIES, SCRATCH_GAP, PER_HANDICAP, gapShape } from './baseline.js';
import { sgRounds, playedHoles, shotSG } from './model.js';

/* SCRATCH_GAP and PER_HANDICAP moved to baseline.js when benchmarks
   arrived: the same two numbers now define the whole family of
   handicap-level expected-strokes tables, so they belong where the
   tables are. Nothing about them changed. */

/**
 * How the gap divides between parts of the game. Approach is the
 * largest single share; putting is a smaller share than most golfers
 * assume, which is the most useful thing this whole screen says.
 */
const SHARES = { ott: 0.24, app: 0.43, arg: 0.16, putt: 0.17 };

export const HANDICAP_RANGE = { min: 0, max: 36 };

/** Expected strokes gained per 18 for a given handicap, by category. */
export function expectedSG(handicap) {
  const total = -(SCRATCH_GAP + PER_HANDICAP * handicap);
  const out = { total };
  CATEGORIES.forEach((c) => { out[c] = total * SHARES[c]; });
  return out;
}

function clamp(value) {
  return Math.max(HANDICAP_RANGE.min, Math.min(HANDICAP_RANGE.max, value));
}

/** The handicap whose total strokes gained matches this figure. */
export function handicapForTotal(sgPer18) {
  return clamp((-sgPer18 - SCRATCH_GAP) / PER_HANDICAP);
}

/**
 * The handicap whose expected loss in ONE category matches this
 * figure — "your putting is at a 9 handicap level".
 */
export function handicapForCategory(category, sgPer18) {
  const share = SHARES[category];
  if (!share) return null;
  return clamp((-sgPer18 / share - SCRATCH_GAP) / PER_HANDICAP);
}

/** Whole numbers read better than decimals for something this rough. */
export function fmtHandicap(value) {
  if (value == null) return '—';
  if (value <= 0.5) return 'scratch';
  if (value >= HANDICAP_RANGE.max) return `${HANDICAP_RANGE.max}+`;
  return String(Math.round(value));
}

/** The same figure where there is only room for a couple of characters. */
export function fmtHandicapShort(value) {
  if (value == null) return '—';
  if (value <= 0.5) return '0';
  if (value >= HANDICAP_RANGE.max) return `${HANDICAP_RANGE.max}+`;
  return String(Math.round(value));
}

/**
 * A per-category read on where the game stands, sorted so the part
 * costing the most sits at the top. `gapToOverall` is the interesting
 * column: positive means this category is better than the rest of the
 * game, negative means it is dragging.
 */
export function handicapProfile(sgPer18ByCategory) {
  const overall = handicapForTotal(sgPer18ByCategory.total);

  const rows = CATEGORIES.map((category) => {
    const sg = sgPer18ByCategory[category] || 0;
    const level = handicapForCategory(category, sg);
    return {
      category,
      sg,
      handicap: level,
      // Lower handicap is better, so a positive gap is a strength.
      gapToOverall: overall - level,
      expectedAtOverall: expectedSG(overall)[category],
    };
  });

  return {
    overall,
    rows: rows.slice().sort((a, b) => a.gapToOverall - b.gapToOverall),
    strongest: rows.reduce((best, r) => (r.gapToOverall > best.gapToOverall ? r : best), rows[0]),
    weakest: rows.reduce((worst, r) => (r.gapToOverall < worst.gapToOverall ? r : worst), rows[0]),
  };
}

/**
 * Strokes per 18 that would be saved by lifting one category to the
 * level of the rest of the game — the honest answer to "what should I
 * go and practise".
 */
export function upsideFor(row) {
  return Math.max(0, row.expectedAtOverall - row.sg);
}

/* --- Implied handicap from actual shots --------------------------
   Everything above splits the gap using SHARES — fixed proportions
   that describe golfers in general. This does the same job from the
   shots in front of it instead.

   For one category, strokes gained against benchmark level h is

       SG_h  =  SG_tour  +  gap(h) * PHI

   where PHI is the sum, over that category's shots, of the baseline
   shape at the start minus the shape at the finish. PHI depends only
   on where the ball actually was, so it is a property of YOUR round
   rather than of golfers on average. Setting SG_h to zero and solving
   for h answers the question directly: at what standard would this
   part of your game have been par for the course?

   The relation is linear and PHI is positive for any real category,
   so the solve is exact and needs no search. Both sides scale with
   the number of holes, which cancels — nine holes and thirty-six
   holes give the same answer, and nothing needs normalising per 18.

   The total agrees with handicapForTotal by construction, because
   PHI for the whole round telescopes down to the shape at the tees,
   which is what the family was calibrated on. Only the split between
   categories differs, and that is the point: it now reflects where
   your ball went rather than where an average golfer's does.
------------------------------------------------------------------ */


/** Below roughly this many shots a category's figure is noise. */
export const MIN_CATEGORY_SHOTS = 20;

/** How many rounds the rolling figure looks back over by default. */
export const DEFAULT_WINDOW = 10;

/**
 * Shape at a shot's finish. Zero when the ball was holed, which is
 * what makes the terms telescope across a hole.
 */
function endShape(shot) {
  return shot.holed ? 0 : gapShape(shot.endLie, shot.endDist);
}

/**
 * Raw ingredients per category: strokes gained against tour, the
 * shape delta, and how many shots went into each.
 */
export function impliedInputs(rounds) {
  const acc = {};
  CATEGORIES.forEach((c) => { acc[c] = { sgTour: 0, phi: 0, shots: 0 }; });
  const total = { sgTour: 0, phi: 0, shots: 0 };

  sgRounds(rounds).forEach((round) => {
    playedHoles(round).forEach((hole) => {
      hole.shots.forEach((shot) => {
        const { category, sg } = shotSG(shot, hole.par, 'tour');
        const delta = gapShape(shot.startLie, shot.startDist) - endShape(shot);
        const bucket = acc[category];
        if (!bucket) return;
        bucket.sgTour += sg;
        bucket.phi += delta;
        bucket.shots += 1;
        total.sgTour += sg;
        total.phi += delta;
        total.shots += 1;
      });
    });
  });

  return { byCategory: acc, total };
}

/**
 * The handicap level at which this category's strokes gained would
 * come out at zero. Null when there is not enough of a shape delta
 * to divide by — a category made entirely of tap-ins, for instance.
 */
function solve({ sgTour, phi }) {
  // Below this the divide is numerically meaningless, not merely
  // uncertain, and would produce a wild number rather than a wide one.
  if (!(phi > 0.02)) return null;
  const gap = -sgTour / phi;
  return (gap - SCRATCH_GAP) / PER_HANDICAP;
}

/**
 * Implied handicap for every category and for the round as a whole.
 *
 * `raw` is the unclamped solve, kept so the caller can say "better
 * than scratch" rather than silently reporting a 0 that is really a
 * minus three. `thin` marks a category the window did not gather
 * enough shots for — shown, but flagged, because hiding it entirely
 * makes a weak short game look like no short game.
 */
export function impliedHandicaps(rounds, { minShots = MIN_CATEGORY_SHOTS } = {}) {
  const { byCategory, total } = impliedInputs(rounds);

  const row = (key, input) => {
    const raw = solve(input);
    return {
      category: key,
      shots: input.shots,
      sgTour: input.sgTour,
      raw,
      handicap: raw == null ? null : clamp(raw),
      // Past the best level the tables describe. Saying "scratch"
      // there would understate it, and extrapolating would invent
      // precision the family does not have.
      belowRange: raw != null && raw < HANDICAP_RANGE.min,
      aboveRange: raw != null && raw > HANDICAP_RANGE.max,
      thin: input.shots < minShots,
    };
  };

  const rows = CATEGORIES.map((c) => row(c, byCategory[c]));
  const overall = row('total', total);

  const ranked = rows.filter((r) => r.handicap != null && !r.thin);

  return {
    rows,
    overall,
    shots: total.shots,
    rounds: sgRounds(rounds).filter((r) => playedHoles(r).length).length,
    // Highest handicap is the weakest part of the game.
    weakest: ranked.length
      ? ranked.reduce((w, r) => (r.handicap > w.handicap ? r : w))
      : null,
    strongest: ranked.length
      ? ranked.reduce((s, r) => (r.handicap < s.handicap ? r : s))
      : null,
  };
}

/**
 * The same figure over the most recent rounds only. Form matters and
 * a career average buries it — a year of improvement reads as a flat
 * line if the first month is still in the average.
 */
export function rollingImplied(rounds, { window = DEFAULT_WINDOW, minShots = MIN_CATEGORY_SHOTS } = {}) {
  const recent = sgRounds(rounds)
    .filter((r) => playedHoles(r).length > 0)
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, window);

  const result = impliedHandicaps(recent, { minShots });
  result.rounds = recent.length;
  result.window = window;
  return result;
}

/** "12", "better than scratch", or "—" when there was nothing to solve. */
export function fmtImplied(row) {
  if (!row || row.handicap == null) return '—';
  if (row.belowRange) return 'better than scratch';
  if (row.aboveRange) return `worse than ${HANDICAP_RANGE.max}`;
  return fmtHandicap(row.handicap);
}

/**
 * The same answer in a table column.
 *
 * Better than scratch is written the way a scorecard writes it — a
 * plus handicap, so two shots better than scratch is "+2". That is
 * the notation golfers already read, and it fits where "better than
 * scratch" wraps onto three lines and stops being legible.
 */
export function fmtImpliedShort(row) {
  if (!row || row.handicap == null) return '—';
  if (row.belowRange) return '+' + Math.max(1, Math.round(-row.raw));
  if (row.aboveRange) return `${HANDICAP_RANGE.max}+`;
  return fmtHandicapShort(row.handicap);
}
