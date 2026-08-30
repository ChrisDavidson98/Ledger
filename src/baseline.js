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
  tee: [
    [50, 2.40], [100, 2.80], [125, 2.90], [150, 2.98], [175, 3.02], [200, 3.08],
    [225, 3.20], [250, 3.51], [275, 3.65], [300, 3.80], [325, 3.90], [350, 4.00],
    [375, 4.15], [400, 4.30], [425, 4.45], [450, 4.59], [475, 4.73], [500, 4.87],
    [525, 4.98], [550, 5.09], [575, 5.18], [600, 5.28],
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
  green: [
    [1, 1.001], [2, 1.01], [3, 1.04], [4, 1.08], [5, 1.16], [6, 1.24], [7, 1.30],
    [8, 1.36], [9, 1.42], [10, 1.47], [15, 1.70], [20, 1.85], [25, 1.96],
    [30, 2.05], [40, 2.19], [50, 2.29], [60, 2.36], [75, 2.48], [90, 2.61],
    [120, 2.85],
  ],
};

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
 */
export function expectedStrokes(lie, dist, baseline = 'tour') {
  if (dist == null || dist <= 0) return 0;
  const tables = BASELINES[baseline] || TOUR;
  const table = tables[lie] || tables.fairway;
  return interpolate(table, dist);
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
 * Clubs offered on approach shots, longest first.
 *
 * Approach only, and optional. Logging a club on every tee shot, chip
 * and putt would roughly triple the taps for an answer nobody needs —
 * you know what you hit off the tee. The question worth answering is
 * how far each iron actually goes, and that lives on approaches.
 */
export const CLUBS = [
  '3W', '5W', 'Hyb', '2i', '3i',
  '4i', '5i', '6i', '7i', '8i',
  '9i', 'PW', 'GW', 'SW', 'LW',
];

/** True when a shot is one worth asking miss direction for. */
export function tracksMiss(category) {
  return category === 'ott' || category === 'app';
}
