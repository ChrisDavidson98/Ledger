/* ---------------------------------------------------------------
   baseline.js — expected-strokes tables and shot classification.

   These are the ONLY place golf "physics" lives. Everything else in
   the app derives from raw shot records + these tables, so swapping
   in a better baseline (or a handicap-level one) retroactively
   updates every round ever logged.

   Units: all lies are in YARDS except `green`, which is in FEET.
   That asymmetry matches how golfers actually talk, and is enforced
   by unitForLie() rather than left to the caller to remember.
--------------------------------------------------------------- */

export const LIES = ['tee', 'fairway', 'rough', 'sand', 'recovery', 'green'];

export const LIE_LABELS = {
  tee: 'Tee',
  fairway: 'Fairway',
  rough: 'Rough',
  sand: 'Sand',
  recovery: 'Trouble',
  green: 'Green',
};

export const CATEGORIES = ['ott', 'app', 'arg', 'putt'];

export const CATEGORY_LABELS = {
  ott: 'Off the Tee',
  app: 'Approach',
  arg: 'Short Game',
  putt: 'Putting',
};

export const CATEGORY_SHORT = {
  ott: 'Tee',
  app: 'App',
  arg: 'Short',
  putt: 'Putt',
};

/* Approximation of published PGA Tour expected-strokes values
   (Broadie-style). Distances in yards; `green` in feet. */
const TOUR = {
  // Broadie, Every Shot Counts, tour from the tee: 400y 3.99, 500y
  // 4.41, 600y 4.82. The old rows ran 0.3-0.5 high past 375y and
  // handed every long drive free strokes gained off the tee.
  tee: [
    [50, 2.40], [100, 2.92], [120, 2.99], [140, 2.97], [160, 2.99], [180, 3.05],
    [200, 3.12], [220, 3.17], [240, 3.25], [260, 3.45], [280, 3.65], [300, 3.71],
    [320, 3.79], [340, 3.86], [360, 3.92], [380, 3.96], [400, 3.99], [420, 4.02],
    [440, 4.08], [460, 4.17], [480, 4.28], [500, 4.41], [520, 4.54], [540, 4.65],
    [560, 4.74], [580, 4.79], [600, 4.82],
  ],
  fairway: [
    [10, 2.20], [20, 2.40], [30, 2.52], [40, 2.60], [50, 2.65], [60, 2.70],
    [80, 2.75], [100, 2.80], [120, 2.85], [140, 2.92], [150, 2.97], [175, 3.08],
    [200, 3.15], [220, 3.28], [250, 3.40], [275, 3.55], [300, 3.70],
  ],
  rough: [
    [10, 2.35], [20, 2.60], [30, 2.65], [40, 2.70], [50, 2.78], [60, 2.85],
    [80, 2.90], [100, 2.95], [120, 3.00], [140, 3.05], [150, 3.09], [175, 3.19],
    [200, 3.32], [220, 3.45], [250, 3.60], [275, 3.75], [300, 3.90],
  ],
  sand: [
    [10, 2.50], [20, 2.60], [30, 2.70], [40, 2.75], [50, 2.85], [60, 2.90],
    [80, 3.00], [100, 3.15], [120, 3.25], [150, 3.45], [175, 3.55], [200, 3.70],
    [250, 4.00],
  ],
  recovery: [
    [10, 2.60], [20, 2.80], [30, 2.90], [40, 3.00], [50, 3.05], [60, 3.10],
    [80, 3.20], [100, 3.30], [120, 3.40], [150, 3.55], [175, 3.70], [200, 3.85],
    [250, 4.10],
  ],
  // Broadie, Every Shot Counts, tour putting: 8 ft is the 50/50 putt
  // (1.50). The old rows ran ~0.1 low from 5-15 ft, inventing a putting
  // deficit, and high from 30 ft out. 120 ft is extrapolated.
  green: [
    [1, 1.001], [2, 1.01], [3, 1.04], [4, 1.13], [5, 1.23], [6, 1.34], [7, 1.42],
    [8, 1.50], [9, 1.56], [10, 1.61], [15, 1.78], [20, 1.87], [25, 1.93],
    [30, 1.98], [40, 2.06], [50, 2.14], [60, 2.21], [90, 2.40], [120, 2.55],
  ],
};

/* Kept for anything that wants the raw table. The other levels are
   not tables at all — they are TOUR plus a gap; see Benchmarks. */
export const BASELINES = { tour: TOUR };

/** Linear interpolation across a sorted [[x, y], ...] table, clamped at both ends. */
function interpolate(table, x) {
  if (x <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < table.length - 1; i++) {
    const [x0, y0] = table[i];
    const [x1, y1] = table[i + 1];
    if (x >= x0 && x <= x1) {
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return last[1];
}

/** Distance unit a lie is always measured in. Green is feet, everything else yards. */
export function unitForLie(lie) {
  return lie === 'green' ? 'ft' : 'y';
}

/**
 * Expected strokes to hole out from a given lie and distance.
 * `dist` must already be in the unit that unitForLie(lie) reports.
 *
 * `benchmark` is a key from BENCHMARKS, or a bare handicap number.
 * Anything unrecognised falls back to the tour table, so a stale
 * preference can never produce a wrong number — only the old one.
 */
export function expectedStrokes(lie, dist, benchmark = 'tour') {
  if (dist == null || dist <= 0) return 0;
  const table = TOUR[lie] || TOUR.fairway;
  const tour = interpolate(table, dist);
  if (benchmark === 'tour' || benchmark == null) return tour;
  const gap = benchmarkGap(benchmark);
  return gap ? tour + gap * gapShape(lie, dist) : tour;
}

/** Yards, for comparing distances recorded in different units. */
export function toYards(dist, unit) {
  return unit === 'ft' ? dist / 3 : dist;
}

/**
 * Which part of the game a shot belongs to.
 *
 * Follows the standard convention: par-3 tee shots are approach shots,
 * not off-the-tee. Off-the-tee is par 4s and 5s only, which is what
 * makes the number comparable to published SG-OTT figures.
 */
export function classifyShot({ shotNum, par, startLie, startDist, startUnit }) {
  if (shotNum === 1 && par > 3) return 'ott';
  if (startLie === 'green') return 'putt';
  if (toYards(startDist, startUnit) < 30) return 'arg';
  return 'app';
}

/** Miss directions, laid out as the 3x3 grid the UI renders. */
export const MISS_GRID = [
  ['long-left', 'long', 'long-right'],
  ['left', 'target', 'right'],
  ['short-left', 'short', 'short-right'],
];

export const MISS_LABELS = {
  'long-left': 'Long L',
  long: 'Long',
  'long-right': 'Long R',
  left: 'Left',
  target: 'Target',
  right: 'Right',
  'short-left': 'Short L',
  short: 'Short',
  'short-right': 'Short R',
};

/**
 * Every club the app knows, longest first. Each player picks their
 * own bag from these in Settings; this is the full shelf, not a bag.
 *
 * Logged on tee shots and approaches, never chips or putts — that would
 * triple the taps for answers nobody needs. 'Hyb' is the old unnumbered
 * hybrid, kept so clubs logged before numbered hybrids still read.
 */
export const CLUBS = [
  'Dr', '3W', '5W', '7W', '2H', '3H', '4H', '5H', 'Hyb',
  '2i', '3i', '4i', '5i', '6i', '7i', '8i',
  '9i', 'PW', 'GW', 'SW', 'LW',
];

/** A typical bag, until a player picks their own. */
export const DEFAULT_BAG = [
  'Dr', '3W', '5W', '4H', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW',
];

/** True when a shot is one worth asking miss direction for. */
export function tracksMiss(category) {
  return category === 'ott' || category === 'app';
}

/* --- Benchmarks -------------------------------------------------
   Everything above measures against a tour player. That is accurate
   and, for an amateur, almost useless on its own: every column reads
   minus and none of them stands out. A benchmark re-asks the same
   question against somebody you might actually be — "how did that
   round go for a 15 handicap?"

   HOW THE OTHER LEVELS ARE BUILT, because there is no published table
   for them here and inventing one would be worse than saying so.

   Only the tour table is data. Every other level is the tour table
   plus a gap:

       E_h(lie, dist) = E_tour(lie, dist) + gap(h) * shape(lie, dist)

   `gap(h)` is the strokes per 18 a handicap h is expected to lose,
   and it is NOT a new number — it is the same law handicap.js was
   already calibrated on against two real rounds. `shape` spreads that
   total over the positions a round passes through, and is a unit
   shape: it does not vary with h, so the levels are one family and
   are monotonic in h by construction.

   The property that makes any of this mean something is that strokes
   gained against level h should come out at roughly zero for a golfer
   who really is an h handicap. That falls out of one useful fact:
   summed over a hole, the shape terms telescope — every shot's finish
   is the next shot's start — leaving only the value at the tee. So
   total SG against level h is just "what an h handicap would take on
   these holes, minus what you took", and calibrating the whole family
   reduces to making the tee row sum to gap(h) over eighteen holes.
   tests.html asserts exactly that, per category, and it is the check
   to run if these constants are ever touched.
--------------------------------------------------------------- */

/** Strokes behind tour average for a scratch golfer, per 18 holes. */
export const SCRATCH_GAP = 3.2;

/** Additional strokes lost per point of handicap. */
export const PER_HANDICAP = 0.85;

/** Strokes per 18 a handicap is expected to lose to a tour player. */
export function gapForHandicap(handicap) {
  return Math.max(0, SCRATCH_GAP + PER_HANDICAP * handicap);
}

/**
 * How much harder a position gets for an amateur, relative to how
 * much work it holds. Rises quickly and then flattens: the gap
 * between a tour player and a 20 handicap from 250 yards is not
 * twice the gap from 180, because neither of them is reaching.
 */
const SHAPE_SATURATION = 1.6;

/**
 * Per-lie weighting of that gap. These are the softest numbers here.
 *
 * A full swing off a tee is where amateurs give up the most. Putting
 * is where they are relatively closest — the same finding that makes
 * putting a smaller share of the gap than golfers expect. Through the
 * green sits between the two, and is NOT split by lie: from fifteen
 * yards an amateur is much nearer a professional than from two
 * hundred, whether the ball is in rough or on the fairway, so how far
 * away it is matters far more than what it is sitting on. The tour
 * table already carries the difference between the lies themselves.
 */
const SHAPE_TEE = 1.00;
const SHAPE_THROUGH = 0.85;
const SHAPE_GREEN = 0.34;

/**
 * The distance at which a shot through the green counts for the full
 * through-the-green weight, and the floor it tapers to at nothing.
 *
 * Without this the shape gave the short game about a fifth of the
 * whole gap, against a sixth in the model it is calibrated with — a
 * chip counted almost as heavily against an amateur as a long iron,
 * which is not how anybody plays. The taper only redistributes; the
 * total is fixed by the tee row and does not move.
 */
const SHAPE_FULL_SWING = 60;
const SHAPE_SHORT_FLOOR = 0.75;

function weightForLie(lie, dist) {
  if (lie === 'tee') return SHAPE_TEE;
  if (lie === 'green') return SHAPE_GREEN;
  const reach = Math.min(1, Math.max(0, dist) / SHAPE_FULL_SWING);
  return SHAPE_THROUGH * (SHAPE_SHORT_FLOOR + (1 - SHAPE_SHORT_FLOOR) * reach);
}

/**
 * Scaled so the eighteen tee shots of a normal par 72 sum to about
 * 1.0 — one whole gap's worth. A short course therefore produces a
 * smaller gap for the same handicap, which is correct: a 20 handicap
 * does not lose twenty strokes to par on a par 3 course.
 */
const SHAPE_SCALE = 0.086;

/**
 * The unit shape. Zero once the ball is holed, which is what makes
 * the per-hole telescoping work.
 */
export function gapShape(lie, dist) {
  if (dist == null || dist <= 0) return 0;
  const work = Math.max(0, expectedStrokes(lie, dist, 'tour') - 1);
  return SHAPE_SCALE * weightForLie(lie, dist) * (work / (work + SHAPE_SATURATION));
}

/**
 * The benchmarks offered in the UI. `handicap: null` is the tour
 * table itself, untouched — what every figure in the
 * app meant before benchmarks existed.
 */
export const BENCHMARKS = [
  // Not a fixed level: the app swaps in the handicap the player's own
  // game plays like before anything is computed (see bench() in app.js).
  // Anything that receives the bare key reads it as tour.
  { key: 'self', label: 'Your level', short: 'You', handicap: null, self: true },
  { key: 'tour', label: 'Tour', short: 'Tour', handicap: null },
  { key: 'scratch', label: 'Scratch', short: 'Scr', handicap: 0 },
  { key: 'hcp5', label: '5 handicap', short: '5', handicap: 5 },
  { key: 'hcp10', label: '10 handicap', short: '10', handicap: 10 },
  { key: 'hcp15', label: '15 handicap', short: '15', handicap: 15 },
  { key: 'hcp20', label: '20 handicap', short: '20', handicap: 20 },
];

/** What a brand-new device starts on; see getBenchmark in storage.js. */
export const DEFAULT_BENCHMARK = 'self';

/** The key for "measure me against my own level". */
export const SELF_BENCHMARK = 'self';

/** The lowest and highest levels the tables cover, for clamping. */
export const BENCHMARK_HANDICAPS = BENCHMARKS
  .filter((b) => b.handicap != null)
  .map((b) => b.handicap);

export function findBenchmark(key) {
  return BENCHMARKS.find((b) => b.key === key) || BENCHMARKS.find((b) => b.key === 'tour');
}

export function benchmarkLabel(key) {
  return findBenchmark(key).label;
}

/**
 * A benchmark key, or a bare handicap number, resolved to the gap it
 * implies. Numbers are accepted so the implied-handicap solver can
 * ask about levels between the named ones without a table each.
 */
export function benchmarkGap(benchmark) {
  if (typeof benchmark === 'number') return gapForHandicap(benchmark);
  const found = findBenchmark(benchmark);
  return found.handicap == null ? 0 : gapForHandicap(found.handicap);
}
