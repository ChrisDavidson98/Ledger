/* ---------------------------------------------------------------
   model.js — round/hole/shot structures and all derived numbers.

   Design rule: a stored round contains ONLY raw observations —
   where the ball was, where it went, how many strokes it cost.
   Every strokes-gained figure is computed on read. Nothing derived
   is ever written to storage, so improving the baseline tables
   retroactively improves every round in your history.
--------------------------------------------------------------- */

import {
  expectedStrokes,
  classifyShot,
  unitForLie,
  CATEGORIES,
} from './baseline.js';

export { unitForLie };

export function newRound({ player, courseId, courseName, teeName, layout, holes }) {
  return {
    id: 'r_' + Date.now().toString(36),
    schema: 2,
    player,
    courseId,
    courseName,
    teeName,
    layout: layout || null, // which nine or pairing was played
    date: new Date().toISOString(),
    finishedAt: null,
    holes: holes.map((h) => ({
      hole: h.hole,
      par: h.par,
      yards: h.yards,
      // Kept so a course played twice round can still name the
      // physical hole a shot was struck on.
      sourceNine: h.sourceNine || null,
      sourceHole: h.sourceHole || h.hole,
      shots: [],
      done: false,
    })),
  };
}

/**
 * Build a raw shot record. `endDist` is null when the ball was holed.
 * Units are derived from the lie so a caller can never mismatch them.
 */
export function newShot({
  shotNum,
  startLie,
  startDist,
  endLie,
  endDist,
  holed,
  penalty = 0,
  miss = null,
}) {
  return {
    n: shotNum,
    startLie,
    startDist,
    startUnit: unitForLie(startLie),
    endLie: holed ? null : endLie,
    endDist: holed ? null : endDist,
    endUnit: holed ? null : unitForLie(endLie),
    holed: !!holed,
    penalty,
    miss,
  };
}

/**
 * Rebuild each shot's starting point from the previous shot's finish.
 *
 * A shot stores where it started as well as where it ended, which
 * makes every other calculation simple but means editing shot 3 leaves
 * shot 4 claiming to have started somewhere the ball no longer was.
 * Call this after any edit or deletion and the chain is consistent
 * again — including the shot numbering and whether the hole is done.
 */
export function relinkHole(hole) {
  let lie = 'tee';
  let dist = hole.yards;

  hole.shots.forEach((shot, index) => {
    shot.n = index + 1;
    shot.startLie = lie;
    shot.startDist = dist;
    shot.startUnit = unitForLie(lie);

    if (shot.holed) {
      shot.endLie = null;
      shot.endDist = null;
      shot.endUnit = null;
    } else {
      shot.endUnit = unitForLie(shot.endLie);
      lie = shot.endLie;
      dist = shot.endDist;
    }
  });

  const last = hole.shots[hole.shots.length - 1];
  hole.done = Boolean(last && last.holed);
  return hole;
}

/** Where the next shot on this hole starts from. */
export function lieAfter(hole) {
  const last = hole.shots[hole.shots.length - 1];
  if (!last) return { lie: 'tee', dist: hole.yards, unit: 'y' };
  return { lie: last.endLie, dist: last.endDist, unit: last.endUnit };
}

/** Strokes gained for a single shot, plus the category it counts toward. */
export function shotSG(shot, par, baseline = 'tour') {
  const category = classifyShot({
    shotNum: shot.n,
    par,
    startLie: shot.startLie,
    startDist: shot.startDist,
    startUnit: shot.startUnit,
  });
  const before = expectedStrokes(shot.startLie, shot.startDist, baseline);
  const after = shot.holed
    ? 0
    : expectedStrokes(shot.endLie, shot.endDist, baseline);
  const strokes = 1 + (shot.penalty || 0);
  return { category, sg: before - after - strokes };
}

function emptyTotals() {
  const t = {};
  CATEGORIES.forEach((c) => (t[c] = 0));
  t.total = 0;
  return t;
}

export function holeTotals(hole, baseline = 'tour') {
  const totals = emptyTotals();
  hole.shots.forEach((shot) => {
    const { category, sg } = shotSG(shot, hole.par, baseline);
    totals[category] += sg;
    totals.total += sg;
  });
  return totals;
}

export function roundTotals(round, baseline = 'tour') {
  const totals = emptyTotals();
  round.holes.forEach((hole) => {
    const ht = holeTotals(hole, baseline);
    CATEGORIES.forEach((c) => (totals[c] += ht[c]));
    totals.total += ht.total;
  });
  return totals;
}

/** Strokes on a hole: shots played plus any penalty strokes incurred. */
export function holeScore(hole) {
  return hole.shots.reduce((sum, s) => sum + 1 + (s.penalty || 0), 0);
}

/** Holes with at least one shot logged. Lets a 9-hole round score correctly. */
export function playedHoles(round) {
  return round.holes.filter((h) => h.shots.length > 0);
}

export function roundScore(round) {
  return playedHoles(round).reduce((sum, h) => sum + holeScore(h), 0);
}

export function roundPar(round) {
  return playedHoles(round).reduce((sum, h) => sum + h.par, 0);
}

export function roundToPar(round) {
  return roundScore(round) - roundPar(round);
}

export function isRoundComplete(round) {
  return round.holes.every((h) => h.done);
}

/** Index of the next hole still needing shots, or null when the round is done. */
export function nextUnplayedHole(round) {
  const idx = round.holes.findIndex((h) => !h.done);
  return idx === -1 ? null : idx;
}

/* --- Aggregate stats across rounds ------------------------------ */

/** Approach shots bucketed by distance, with proximity and miss tendency. */
export function approachBuckets(rounds, baseline = 'tour') {
  const bounds = [
    [0, 50], [50, 75], [75, 100], [100, 125], [125, 150],
    [150, 175], [175, 200], [200, Infinity],
  ];
  const buckets = bounds.map(([lo, hi]) => ({
    lo,
    hi,
    label: hi === Infinity ? `${lo}+` : `${lo}-${hi}`,
    shots: 0,
    sg: 0,
    proximitySum: 0,
    proximityCount: 0,
    misses: {},
  }));

  rounds.forEach((round) => {
    round.holes.forEach((hole) => {
      hole.shots.forEach((shot) => {
        const { category, sg } = shotSG(shot, hole.par, baseline);
        if (category !== 'app') return;
        const yards = shot.startDist;
        const bucket = buckets.find((b) => yards >= b.lo && yards < b.hi);
        if (!bucket) return;
        bucket.shots += 1;
        bucket.sg += sg;
        // Proximity only means something when the ball finished on the green.
        if (shot.holed) {
          bucket.proximitySum += 0;
          bucket.proximityCount += 1;
        } else if (shot.endLie === 'green') {
          bucket.proximitySum += shot.endDist;
          bucket.proximityCount += 1;
        }
        if (shot.miss) {
          bucket.misses[shot.miss] = (bucket.misses[shot.miss] || 0) + 1;
        }
      });
    });
  });

  return buckets.filter((b) => b.shots > 0);
}

/** Every shot across a set of rounds, tagged with its category. */
function eachShot(rounds, baseline, visit) {
  rounds.forEach((round) => {
    round.holes.forEach((hole) => {
      hole.shots.forEach((shot) => {
        const { category, sg } = shotSG(shot, hole.par, baseline);
        visit(shot, hole, category, sg, round);
      });
    });
  });
}

/**
 * Putting by distance. `holed` is the make rate, which is the number
 * golfers actually recognise, and `threePutts` counts holes where
 * putting from this bucket took three or more.
 */
export function puttingBuckets(rounds, baseline = 'tour') {
  const bounds = [
    [0, 3], [3, 6], [6, 10], [10, 20], [20, 30], [30, Infinity],
  ];
  const buckets = bounds.map(([lo, hi]) => ({
    lo,
    hi,
    label: hi === Infinity ? `${lo}ft+` : `${lo}-${hi}ft`,
    putts: 0,
    holed: 0,
    sg: 0,
    firstPutts: 0,
    threePutts: 0,
  }));

  const find = (feet) => buckets.find((b) => feet >= b.lo && feet < b.hi);

  rounds.forEach((round) => {
    round.holes.forEach((hole) => {
      const putts = hole.shots.filter((s) => s.startLie === 'green');
      putts.forEach((shot, index) => {
        const bucket = find(shot.startDist);
        if (!bucket) return;
        const { sg } = shotSG(shot, hole.par, baseline);
        bucket.putts += 1;
        bucket.sg += sg;
        if (shot.holed) bucket.holed += 1;
        if (index === 0) {
          bucket.firstPutts += 1;
          if (putts.length >= 3) bucket.threePutts += 1;
        }
      });
    });
  });

  return buckets.filter((b) => b.putts > 0);
}

/**
 * Tee shots on par 4s and 5s, by where they finished. Fairways hit is
 * the familiar number; the strokes gained column is the one that says
 * whether a miss actually cost anything.
 */
export function teeOutcomes(rounds, baseline = 'tour') {
  const outcomes = {};
  let total = 0;
  let sgTotal = 0;

  eachShot(rounds, baseline, (shot, hole, category, sg) => {
    if (category !== 'ott') return;
    const lie = shot.holed ? 'green' : shot.endLie;
    if (!outcomes[lie]) outcomes[lie] = { lie, count: 0, sg: 0 };
    outcomes[lie].count += 1;
    outcomes[lie].sg += sg;
    total += 1;
    sgTotal += sg;
  });

  const rows = Object.values(outcomes).sort((a, b) => b.count - a.count);
  const fairways = outcomes.fairway ? outcomes.fairway.count : 0;
  return {
    rows,
    total,
    sgTotal,
    fairwayPct: total ? Math.round((fairways / total) * 100) : 0,
  };
}

/** Greens in regulation: on the putting surface in par minus two. */
export function greensInRegulation(rounds) {
  let greens = 0;
  let holes = 0;

  rounds.forEach((round) => {
    playedHoles(round).forEach((hole) => {
      holes += 1;
      const allowed = hole.par - 2;
      const shot = hole.shots[allowed - 1];
      if (!shot) return;
      // Holing out counts, and so does being on the green in regulation.
      if (shot.holed || shot.endLie === 'green') greens += 1;
      else if (hole.shots.slice(0, allowed).some((s) => s.holed)) greens += 1;
    });
  });

  return { greens, holes, pct: holes ? Math.round((greens / holes) * 100) : 0 };
}

/** Tally of miss directions for one category across rounds. */
export function missTally(rounds, category, baseline = 'tour') {
  const tally = {};
  let total = 0;
  rounds.forEach((round) => {
    round.holes.forEach((hole) => {
      hole.shots.forEach((shot) => {
        if (!shot.miss) return;
        const { category: cat } = shotSG(shot, hole.par, baseline);
        if (cat !== category) return;
        tally[shot.miss] = (tally[shot.miss] || 0) + 1;
        total += 1;
      });
    });
  });
  return { tally, total };
}
