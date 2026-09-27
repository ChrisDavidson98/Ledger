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
  CLUBS,
} from './baseline.js';

export { unitForLie };

/**
 * `mode` is 'full' for shot-by-shot, or 'score' for a round where
 * only the hole scores were kept.
 *
 * A score-only round earns its place in score history, the trend and
 * the head-to-head, and is excluded from every strokes-gained figure —
 * it has no shots, and inventing them from a score would quietly
 * corrupt the one number the app exists to produce.
 */
export function newRound({
  player, courseId, courseName, teeName, layout, holes, mode = 'full', groupId = null,
}) {
  return {
    id: 'r_' + Date.now().toString(36),
    schema: 4,
    player,
    courseId,
    courseName,
    teeName,
    layout: layout || null, // which nine or pairing was played
    /*
     * Set only when the round was started from a scheduled tee time.
     * Rounds sharing one were played together, which is what makes a
     * group leaderboard possible after the fact without anybody ever
     * writing to anybody else's round. Blank on every round logged
     * before the calendar existed, and nothing may assume it is set.
     */
    groupId: groupId || null,
    mode,
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
      // Only used in score mode; null means the hole was not played.
      score: null,
      done: false,
    })),
  };
}

export function isScoreOnly(round) {
  return round && round.mode === 'score';
}

/** Rounds that carry shot data, and so can contribute to strokes gained. */
export function sgRounds(rounds) {
  return rounds.filter((r) => !isScoreOnly(r));
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
  club = null,
  clubGuess = false,
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
    club,
    // The club was the app's suggestion and never touched. Local only:
    // the sheet has no column for it, and it only matters until the
    // round has been looked over.
    ...(clubGuess && club ? { clubGuess: true } : {}),
  };
}

/**
 * Things in a finished round worth a second look, or an empty list.
 *
 * Nothing here is an error — every one can genuinely happen — so it
 * is offered after the round rather than demanded during it. Each
 * item names the hole it is on, so it can open straight to it.
 */
export function roundReview(round) {
  if (round.mode === 'score') return [];
  const items = [];
  const lastPlayed = round.holes.reduce((last, h, i) => (h.shots.length ? i : last), -1);
  const guessed = [];

  round.holes.forEach((hole, i) => {
    const at = { holeIdx: i, hole: hole.hole };
    // A blank hole only counts if play carried on past it; blanks at
    // the end are just a round ended early.
    if (!hole.shots.length) {
      if (i < lastPlayed) items.push({ ...at, text: 'No shots logged.' });
      return;
    }
    const last = hole.shots[hole.shots.length - 1];
    if (!last.holed) items.push({ ...at, text: 'Never holed out.' });
    const score = holeScore(hole);
    if (last.holed && score >= hole.par + 4) {
      items.push({ ...at, text: `${score} on a par ${hole.par}.` });
    }
    hole.shots.forEach((shot) => {
      const doubts = implausibleShot(
        { lie: shot.startLie, dist: shot.startDist },
        { lie: shot.holed ? 'holed' : shot.endLie, dist: shot.endDist },
      );
      if (doubts.length) items.push({ ...at, text: `Shot ${shot.n}: ${doubts[0]}` });
      if (shot.clubGuess) guessed.push(hole.hole);
    });
  });

  if (guessed.length) {
    const holes = [...new Set(guessed)];
    items.push({
      holeIdx: round.holes.findIndex((h) => h.hole === holes[0]),
      hole: holes[0],
      text: `${guessed.length} shot${guessed.length === 1 ? '' : 's'} kept the suggested club without it being checked (hole${holes.length === 1 ? '' : 's'} ${holes.join(', ')}).`,
      guesses: true,
    });
  }
  return items;
}

/**
 * How far each club actually goes, from approach shots that stayed in
 * play. Distance advanced, not carry — the same caveat as a drive,
 * though an approach is aimed at the green rather than round a corner,
 * so the two are much closer together.
 */
export function clubDistances(rounds, baseline = 'tour') {
  const byClub = new Map();

  sgRounds(rounds).forEach((round) => {
    round.holes.forEach((hole) => {
      hole.shots.forEach((shot) => {
        if (!shot.club || shot.penalty) return;
        if (shot.startUnit !== 'y') return;
        const { category } = shotSG(shot, hole.par, baseline);
        if (category !== 'app' && category !== 'ott') return;

        const endYards = shot.holed ? 0
          : shot.endUnit === 'ft' ? shot.endDist / 3 : shot.endDist;
        const travelled = shot.startDist - endYards;
        if (!(travelled > 0)) return;

        if (!byClub.has(shot.club)) byClub.set(shot.club, { club: shot.club, distances: [] });
        byClub.get(shot.club).distances.push(travelled);
      });
    });
  });

  const order = new Map(CLUBS.map((c, i) => [c, i]));
  return [...byClub.values()].map((entry) => {
    const sorted = entry.distances.slice().sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    const at = (fraction) => sorted[Math.min(sorted.length - 1,
      Math.floor(fraction * sorted.length))];
    return {
      club: entry.club,
      shots: sorted.length,
      distances: sorted,
      avg: sum / sorted.length,
      shortest: sorted[0],
      longest: sorted[sorted.length - 1],
      // The middle of the pack, which is closer to "what you can
      // count on" than an average a single thin one drags down.
      typical: at(0.5),
      // The middle half — where the club lands when nothing unusual
      // happens, which is the number worth clubbing off.
      lowerQuartile: at(0.25),
      upperQuartile: at(0.75),
    };
  }).sort((a, b) => (order.get(a.club) ?? 99) - (order.get(b.club) ?? 99));
}

/**
 * Stock distances for someone with nothing logged yet — a 7-iron at
 * 150 and roughly ten yards a club either side. Driver is left out:
 * nobody wants it suggested for an approach off a stock number. Your
 * own logged number replaces any of these as soon as it exists.
 */
export const GENERIC_CLUB_YARDS = {
  '3W': 215, '5W': 200, '7W': 190, '2H': 205, '3H': 195, '4H': 185, '5H': 175,
  'Hyb': 185, '2i': 195, '3i': 185, '4i': 170, '5i': 165, '6i': 160,
  '7i': 150, '8i': 140, '9i': 130, 'PW': 120, 'GW': 105, 'SW': 90, 'LW': 75,
};

/** Shots with a club before its own number is trusted over the stock one. */
const OWN_CLUB_MIN_SHOTS = 3;

/**
 * The club in the bag whose typical distance is nearest the yardage.
 *
 * Pass the output of clubDistances so the player's own numbers win
 * wherever there are enough of them. Nothing beyond the longest club
 * or inside the shortest is refused — the answer is just the end of
 * the bag, which is what you would be hitting anyway.
 */
export function suggestClub(yards, clubs = [], bag = CLUBS) {
  if (!(yards > 0)) return null;
  const table = { ...GENERIC_CLUB_YARDS };
  clubs.forEach((c) => {
    if (c.shots >= OWN_CLUB_MIN_SHOTS) table[c.club] = c.typical;
  });
  let best = null;
  Object.entries(table).forEach(([club, carry]) => {
    if (!bag.includes(club)) return;
    const off = Math.abs(carry - yards);
    if (!best || off < best.off) best = { club, off };
  });
  return best ? best.club : null;
}

/**
 * One club shorter (step +1) or longer (step -1) through the bag. A
 * club not in the bag — an old round, a borrowed club — steps to the
 * nearest bag club in that direction.
 */
export function stepClub(club, step, bag = CLUBS) {
  const ordered = CLUBS.filter((c) => bag.includes(c));
  if (!ordered.length) return club;
  const at = CLUBS.indexOf(club);
  if (at < 0) return ordered[0];
  const next = step > 0
    ? ordered.find((c) => CLUBS.indexOf(c) > at)
    : [...ordered].reverse().find((c) => CLUBS.indexOf(c) < at);
  return next || club;
}

/**
 * The furthest a ball can plausibly be advanced from each lie.
 * Generous on purpose — this is for catching a mis-tap, not for
 * doubting a good shot.
 */
const MAX_ADVANCE_YARDS = { tee: 380, fairway: 300, rough: 260, sand: 230, recovery: 200 };

/**
 * Reasons a shot looks like a mis-entry, or an empty list.
 *
 * `start` is where it began ({ lie, dist } in the lie's own unit),
 * `end` where it finished ({ lie, dist }, lie 'holed' for in). Each
 * reason is a sentence to put in front of the player; none of them
 * blocks the shot, because every one of them can genuinely happen.
 */
export function implausibleShot(start, end) {
  const toYards = (lie, dist) => (unitForLie(lie) === 'ft' ? dist / 3 : dist);
  const startY = toYards(start.lie, Number(start.dist));
  const reasons = [];

  if (end.lie === 'holed') {
    if (startY > 250) reasons.push(`Holed from ${Math.round(startY)} yards?`);
    return reasons;
  }
  const endY = toYards(end.lie, Number(end.dist));
  const advanced = startY - endY;
  const cap = MAX_ADVANCE_YARDS[start.lie];

  if (start.lie === 'green' && end.lie !== 'green' && endY > startY) {
    reasons.push(`A putt from the green that finished ${Math.round(endY)} yards away in the ${end.lie}?`);
  } else if (cap && advanced > cap) {
    reasons.push(`That is ${Math.round(advanced)} yards from the ${start.lie}.`);
  } else if (start.lie !== 'green' && startY > 150 && end.lie === 'green' && endY <= 1) {
    reasons.push(`From ${Math.round(startY)} yards to ${Math.round(end.dist)} ft?`);
  }
  return reasons;
}

/**
 * Distances grouped into bins, for drawing the shape of a club rather
 * than just its ends. Small samples produce a sparse chart, which is
 * the honest picture of a small sample.
 */
export function distanceHistogram(distances, binSize = 5) {
  if (!distances.length) return { bins: [], binSize, peak: 0 };
  const lo = Math.floor(Math.min(...distances) / binSize) * binSize;
  const hi = Math.ceil((Math.max(...distances) + 0.001) / binSize) * binSize;
  const count = Math.max(1, Math.round((hi - lo) / binSize));

  const bins = Array.from({ length: count }, (_, i) => ({
    from: lo + i * binSize,
    to: lo + (i + 1) * binSize,
    count: 0,
  }));
  distances.forEach((d) => {
    const idx = Math.min(bins.length - 1, Math.floor((d - lo) / binSize));
    bins[idx].count += 1;
  });

  return { bins, binSize, peak: Math.max(...bins.map((b) => b.count)) };
}

/**
 * The gap between each club and the next one down.
 *
 * Overlapping clubs are two clubs doing one job; a wide gap is a
 * distance that has to be forced or eased, which is where mis-clubs
 * come from. Both are read off typical distances rather than the
 * longest one anybody ever hit.
 */
export function clubGapping(clubs, { minShots = 3 } = {}) {
  const usable = clubs
    .filter((c) => c.shots >= minShots)
    .slice()
    .sort((a, b) => b.typical - a.typical);

  const gaps = [];
  for (let i = 0; i < usable.length - 1; i++) {
    const longer = usable[i];
    const shorter = usable[i + 1];
    const gap = longer.typical - shorter.typical;
    gaps.push({
      longer: longer.club,
      shorter: shorter.club,
      gap,
      // Under 5 yards is one club doing another's job; over 20 leaves
      // a distance with nothing that covers it comfortably.
      verdict: gap < 5 ? 'overlap' : gap > 20 ? 'wide' : 'ok',
    });
  }
  return { gaps, clubs: usable };
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
  if (hole.score != null && !hole.shots.length) return hole.score;
  return hole.shots.reduce((sum, s) => sum + 1 + (s.penalty || 0), 0);
}

/**
 * Holes actually played — those with shots logged, or with a score
 * entered on a score-only round. Lets a 9-hole round score correctly.
 */
export function playedHoles(round) {
  return round.holes.filter((h) => h.shots.length > 0 || h.score != null);
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
  // Starts at 30, not 0: anything inside 30 yards is classified as
  // short game, so a bucket labelled 0-50 could only ever hold 30-50
  // and the label misrepresented it.
  const bounds = [
    [30, 50], [50, 75], [75, 100], [100, 125], [125, 150],
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

/**
 * Greens in regulation: on the putting surface in par minus two —
 * a par 3 in one, a par 4 in two, a par 5 in three.
 *
 * Also split by par, because the blended number hides a lot. Par 5s
 * demand a green in three and drag the total down; par 3s only ask
 * for one swing. Which of the three is weak is the useful question.
 */
export function greensInRegulation(rounds) {
  let greens = 0;
  let holes = 0;
  const byPar = {};

  rounds.forEach((round) => {
    playedHoles(round).forEach((hole) => {
      const par = hole.par;
      if (!byPar[par]) byPar[par] = { par, greens: 0, holes: 0, pct: 0 };
      holes += 1;
      byPar[par].holes += 1;

      const allowed = par - 2;
      const shot = hole.shots[allowed - 1];
      let hit = false;
      if (shot) {
        // Holing out counts, and so does being on the green in regulation.
        if (shot.holed || shot.endLie === 'green') hit = true;
        else if (hole.shots.slice(0, allowed).some((s) => s.holed)) hit = true;
      }
      if (hit) {
        greens += 1;
        byPar[par].greens += 1;
      }
    });
  });

  Object.values(byPar).forEach((row) => {
    row.pct = row.holes ? Math.round((row.greens / row.holes) * 100) : 0;
  });

  return {
    greens,
    holes,
    pct: holes ? Math.round((greens / holes) * 100) : 0,
    byPar: Object.values(byPar).sort((a, b) => a.par - b.par),
  };
}

/**
 * The short game on its own: chips, pitches and bunker shots inside
 * 30 yards. `upDown` is the scrambling rate — of the holes where the
 * green was missed in regulation, how many still finished in par or
 * better. `leaveFt` is the average first putt left by a short-game
 * shot that finished on the green.
 */
export function shortGameStats(rounds, baseline = 'tour') {
  let shots = 0;
  let sgTotal = 0;
  let onGreen = 0;
  let leaveTotal = 0;
  let holed = 0;
  let chances = 0;
  let made = 0;

  rounds.forEach((round) => {
    playedHoles(round).forEach((hole) => {
      if (!hole.shots.length) return;
      hole.shots.forEach((shot) => {
        const { category, sg } = shotSG(shot, hole.par, baseline);
        if (category !== 'arg') return;
        shots += 1;
        sgTotal += sg;
        if (shot.holed) holed += 1;
        else if (shot.endLie === 'green') {
          onGreen += 1;
          leaveTotal += shot.endUnit === 'ft' ? Number(shot.endDist) : Number(shot.endDist) * 3;
        }
      });

      const allowed = hole.par - 2;
      const inReg = hole.shots.slice(0, allowed).some((s) => s.holed || s.endLie === 'green');
      if (!inReg) {
        chances += 1;
        if (holeScore(hole) <= hole.par) made += 1;
      }
    });
  });

  return {
    shots,
    sgPerShot: shots ? sgTotal / shots : 0,
    onGreenPct: shots ? Math.round(((onGreen + holed) / shots) * 100) : 0,
    leaveFt: onGreen ? leaveTotal / onGreen : null,
    holed,
    upDown: { made, chances, pct: chances ? Math.round((made / chances) * 100) : 0 },
  };
}

/**
 * One point per round, oldest first, normalised per 18 holes so a
 * weekday nine sits on the same scale as a full round.
 */
export function trendSeries(rounds, baseline = 'tour') {
  return rounds
    .filter((r) => playedHoles(r).length > 0)
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((round) => {
      const holes = playedHoles(round).length || 1;
      const totals = roundTotals(round, baseline);
      const scale = 18 / holes;
      const point = {
        id: round.id,
        date: round.date,
        courseName: round.courseName,
        scoreOnly: isScoreOnly(round),
        holes,
        score: roundScore(round),
        // Negated so that, like every other series here, up is better.
        toPar: -roundToPar(round) * scale,
        total: totals.total * scale,
      };
      CATEGORIES.forEach((c) => { point[c] = totals[c] * scale; });
      return point;
    });
}

/**
 * Standout single shots and rounds. All of this is already in the raw
 * data — a drive's length is just where it started minus where it
 * finished — it simply was not surfaced anywhere.
 */
export function personalBests(rounds, baseline = 'tour') {
  const best = {
    longestDrive: null,
    longestFairwayDrive: null,
    closestApproach: null,
    longestPutt: null,
    longestHoleOut: null,
    bestRound: null,
    bestSG: null,
  };

  const consider = (key, candidate, better) => {
    if (!candidate) return;
    if (!best[key] || better(candidate, best[key])) best[key] = candidate;
  };

  rounds.forEach((round) => {
    const where = { round: round.id, date: round.date, course: round.courseName };

    round.holes.forEach((hole) => {
      hole.shots.forEach((shot) => {
        const { category } = shotSG(shot, hole.par, baseline);
        const context = { ...where, hole: hole.hole, par: hole.par };

        const clean = !shot.penalty;

        /*
         * Distance advanced off the tee, which is NOT the same as how
         * far the ball was hit. Hole yardage is measured along the
         * centreline, so cutting a dogleg removes more yardage from
         * the card than the ball actually travelled. Nothing in the
         * data says which holes bend, so the figure is biased upward
         * and cannot be corrected — see the note in the UI.
         *
         * Counted when the ball stayed in play: no penalty, and not
         * in trouble. A drive that leaked into the rough or a fairway
         * bunker was still struck that far, so it counts. A drive into
         * the trees followed by a drop was not, and used to score a
         * huge number for a ball nobody hit.
         */
        const inPlay = ['fairway', 'rough', 'sand', 'green'].includes(shot.endLie);
        if (category === 'ott' && clean && !shot.holed && shot.endDist != null && inPlay) {
          const endYards = shot.endUnit === 'ft' ? shot.endDist / 3 : shot.endDist;
          const carried = shot.startDist - endYards;
          if (carried > 0) {
            const drive = { ...context, yards: Math.round(carried), endLie: shot.endLie };
            consider('longestDrive', drive, (a, b) => a.yards > b.yards);
            // The long-drive competition rule: only counts if you
            // found the short grass.
            if (shot.endLie === 'fairway') {
              consider('longestFairwayDrive', drive, (a, b) => a.yards > b.yards);
            }
          }
        }

        if (category === 'app' && clean && !shot.holed && shot.endLie === 'green') {
          consider('closestApproach',
            { ...context, feet: shot.endDist, from: Math.round(shot.startDist) },
            (a, b) => a.feet < b.feet);
        }

        if (shot.holed && clean && shot.startLie === 'green') {
          consider('longestPutt', { ...context, feet: shot.startDist },
            (a, b) => a.feet > b.feet);
        }

        if (shot.holed && clean && shot.startLie !== 'green' && shot.startUnit === 'y') {
          consider('longestHoleOut', { ...context, yards: Math.round(shot.startDist) },
            (a, b) => a.yards > b.yards);
        }
      });
    });

    const holes = playedHoles(round).length;
    if (!holes) return;
    consider('bestRound',
      { ...where, holes, score: roundScore(round), toPar: roundToPar(round) },
      (a, b) => a.toPar < b.toPar);
    consider('bestSG',
      { ...where, holes, sg: (roundTotals(round, baseline).total / holes) * 18 },
      (a, b) => a.sg > b.sg);
  });

  return best;
}

/**
 * Miss directions for one category, with what each one costs.
 *
 * The count alone says where the ball goes; the strokes gained per
 * direction says whether it matters. A miss you make often but which
 * costs nothing is not the miss to fix.
 */
/**
 * Everything about one player, in the shapes a comparison needs.
 *
 * Scoring figures use every round; strokes-gained figures use only
 * rounds with shots in them. Mixing those would let a score-only
 * round drag somebody's approach average toward zero.
 */
export function playerSummary(player, allRounds, baseline = 'tour') {
  const mine = allRounds.filter((r) => r.player === player && playedHoles(r).length);
  const withShots = sgRounds(mine);

  const holes = withShots.reduce((sum, r) => sum + playedHoles(r).length, 0);
  const scoredHoles = mine.reduce((sum, r) => sum + playedHoles(r).length, 0);
  const scale = holes ? 18 / holes : 0;

  const sg = { total: 0 };
  CATEGORIES.forEach((c) => { sg[c] = 0; });
  withShots.forEach((round) => {
    const totals = roundTotals(round, baseline);
    CATEGORIES.forEach((c) => { sg[c] += totals[c]; });
    sg.total += totals.total;
  });
  CATEGORIES.forEach((c) => { sg[c] *= scale; });
  sg.total *= scale;

  const gir = greensInRegulation(withShots);
  const tee = teeOutcomes(withShots, baseline);
  const putts = puttingBuckets(withShots, baseline).reduce((sum, b) => sum + b.putts, 0);

  // Scoring is per 18 so a nine does not look like a brilliant round.
  const toParPer18 = scoredHoles
    ? (mine.reduce((sum, r) => sum + roundToPar(r), 0) / scoredHoles) * 18
    : null;

  return {
    player,
    rounds: mine.length,
    shotRounds: withShots.length,
    holes: scoredHoles,
    sg: holes ? sg : null,
    toParPer18,
    girPct: gir.holes ? gir.pct : null,
    fairwayPct: tee.total ? tee.fairwayPct : null,
    puttsPer18: holes ? (putts / holes) * 18 : null,
    bests: personalBests(mine, baseline),
  };
}

/**
 * The same physical hole aggregated across every round it appears in.
 *
 * Keyed on the SOURCE hole, not its position in the round: at Gardner
 * the 4th and the 13th are the same piece of ground played twice, and
 * counting them separately would halve the evidence for both.
 */
export function holeRecords(rounds, baseline = 'tour') {
  const map = new Map();

  sgRounds(rounds).forEach((round) => {
    playedHoles(round).forEach((hole) => {
      const nine = hole.sourceNine || '';
      const number = hole.sourceHole || hole.hole;
      const key = `${round.courseName}|${nine}|${number}`;

      if (!map.has(key)) {
        map.set(key, {
          key,
          courseName: round.courseName,
          nine,
          hole: number,
          par: hole.par,
          yards: hole.yards,
          plays: 0,
          sg: 0,
          strokes: 0,
          overPar: 0,
          byCategory: CATEGORIES.reduce((acc, c) => { acc[c] = 0; return acc; }, {}),
        });
      }

      const record = map.get(key);
      const totals = holeTotals(hole, baseline);
      const score = holeScore(hole);
      record.plays += 1;
      record.sg += totals.total;
      record.strokes += score;
      record.overPar += score - hole.par;
      CATEGORIES.forEach((c) => { record.byCategory[c] += totals[c]; });
    });
  });

  return [...map.values()].map((record) => ({
    ...record,
    avgSG: record.sg / record.plays,
    avgScore: record.strokes / record.plays,
    avgToPar: record.overPar / record.plays,
    // Which part of the game this hole takes its toll on.
    worstCategory: CATEGORIES.reduce(
      (a, b) => (record.byCategory[a] <= record.byCategory[b] ? a : b)
    ),
  }));
}

/**
 * The holes costing the most and least, given enough plays to mean
 * something. One bad hole once is a bad hole once, not a nemesis.
 */
export function nemesisHoles(rounds, { minPlays = 2, count = 3, baseline = 'tour' } = {}) {
  const records = holeRecords(rounds, baseline).filter((r) => r.plays >= minPlays);
  const byCost = records.slice().sort((a, b) => a.avgSG - b.avgSG);
  return {
    worst: byCost.slice(0, count),
    best: byCost.slice(-count).reverse(),
    considered: records.length,
  };
}

export function missTally(rounds, category, baseline = 'tour') {
  const tally = {};
  const sgByDir = {};
  let total = 0;
  let onTarget = 0;
  let onTargetSG = 0;
  let missSG = 0;

  rounds.forEach((round) => {
    round.holes.forEach((hole) => {
      hole.shots.forEach((shot) => {
        if (!shot.miss) return;
        const { category: cat, sg } = shotSG(shot, hole.par, baseline);
        if (cat !== category) return;
        tally[shot.miss] = (tally[shot.miss] || 0) + 1;
        sgByDir[shot.miss] = (sgByDir[shot.miss] || 0) + sg;
        total += 1;
        if (shot.miss === 'target') {
          onTarget += 1;
          onTargetSG += sg;
        } else {
          missSG += sg;
        }
      });
    });
  });

  // The direction costing the most in total, ignoring on-target shots.
  let worst = null;
  Object.keys(sgByDir).forEach((dir) => {
    if (dir === 'target') return;
    if (!worst || sgByDir[dir] < sgByDir[worst]) worst = dir;
  });

  const missCount = total - onTarget;
  return {
    tally,
    sgByDir,
    total,
    onTarget,
    onTargetPct: total ? Math.round((onTarget / total) * 100) : 0,
    avgOnTarget: onTarget ? onTargetSG / onTarget : null,
    avgMiss: missCount ? missSG / missCount : null,
    worst,
    worstCount: worst ? tally[worst] : 0,
    worstAvg: worst ? sgByDir[worst] / tally[worst] : null,
    // A one-sided miss is an aim problem; a two-way miss is not.
    leftCount: ['left', 'long-left', 'short-left'].reduce((s, d) => s + (tally[d] || 0), 0),
    rightCount: ['right', 'long-right', 'short-right'].reduce((s, d) => s + (tally[d] || 0), 0),
    shortCount: ['short', 'short-left', 'short-right'].reduce((s, d) => s + (tally[d] || 0), 0),
    longCount: ['long', 'long-left', 'long-right'].reduce((s, d) => s + (tally[d] || 0), 0),
  };
}

/**
 * Rounds played together, joined after the fact by the group id a
 * scheduled tee time stamped on them.
 *
 * This is the only thing that makes a group result possible, and it
 * is entirely a read-time operation. Nobody ever wrote to a shared
 * record: each player's round arrived on the sheet on its own, from
 * their own phone, whenever their signal came back.
 */
export function roundsInGroup(rounds, groupId) {
  if (!groupId) return [];
  return rounds
    .filter((r) => r.groupId === groupId && playedHoles(r).length)
    .sort((a, b) => roundToPar(a) - roundToPar(b));
}

/**
 * The card for a group: everyone who logged a round against the same
 * tee time, best score first.
 *
 * Holes played is carried because there is nothing stopping one
 * player logging nine and another eighteen, and a leaderboard that
 * quietly compared the two would be wrong rather than merely thin.
 */
export function groupLeaderboard(rounds, groupId, benchmark = 'tour') {
  return roundsInGroup(rounds, groupId).map((round) => {
    const holes = playedHoles(round).length;
    return {
      round,
      player: round.player,
      holes,
      score: roundScore(round),
      toPar: roundToPar(round),
      scoreOnly: isScoreOnly(round),
      sg: isScoreOnly(round) ? null : roundTotals(round, benchmark),
    };
  });
}
