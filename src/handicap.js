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

import { CATEGORIES } from './baseline.js';

/** Strokes behind tour average for a scratch golfer, per 18 holes. */
const SCRATCH_GAP = 3.2;

/** Additional strokes lost per point of handicap. */
const PER_HANDICAP = 0.85;

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
