/* ---------------------------------------------------------------
   monthly.js — one player's month, worked out as a plain object.

   Like every other derived number here it is a read view: built from
   the raw shots on demand against whichever benchmark is asked for,
   and thrown away. The cards in monthcards.js only draw what this
   returns, so everything they say can be tested without a canvas.
--------------------------------------------------------------- */

import { CATEGORIES, CATEGORY_LABELS, LIE_LABELS } from './baseline.js';
import {
  shotSG, playedHoles, sgRounds, roundToPar, flaggedShot, shortGameStats,
} from './model.js';

/** Under this many attempts a band or category is shown greyed, and never named as the leak or the strength. */
export const MIN_ATTEMPTS = 5;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/* Where the strokes went, said the way a golfer would say it. */
const CATEGORY_WHERE = {
  ott: 'off the tee', app: 'on approach', arg: 'around the green', putt: 'on the greens',
};

/* Putting matches puttingBuckets; approach folds 30-100 into one band
   because anything inside 30 is short game, which gets the three below. */
const PUTT_BANDS = [[0, 3], [3, 6], [6, 10], [10, 20], [20, 30], [30, Infinity]];
const APP_BANDS = [[30, 100], [100, 125], [125, 150], [150, 175], [175, Infinity]];
const ARG_BANDS = [[0, 10], [10, 20], [20, 30]];

/** 'YYYY-MM' for a round's date, in the phone's own time. */
export function monthOf(value) {
  // A bare day key is a local day; new Date() would read it as UTC
  // midnight and put a round on the 1st into the month before.
  const key = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(value || ''));
  if (key) return `${key[1]}-${key[2]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthName(month, { year = true } = {}) {
  const [y, m] = String(month).split('-').map(Number);
  const name = MONTH_NAMES[m - 1] || '';
  return year ? `${name} ${y}` : name;
}

export function nextMonth(month) {
  const [y, m] = String(month).split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Months this player has a round in, newest first. */
export function recapMonths(rounds, player) {
  const months = new Set();
  rounds.forEach((r) => {
    if (r.player !== player || !playedHoles(r).length) return;
    const month = monthOf(r.date);
    if (month) months.add(month);
  });
  return [...months].sort().reverse();
}

function num(v, places = 1) {
  return Math.abs(v).toFixed(places);
}

function plural(n, word, many = word + 's') {
  return `${n} ${n === 1 ? word : many}`;
}

function bandLabel(lo, hi, unit) {
  if (hi === Infinity) return `${lo}+ ${unit}`;
  if (lo === 0 && unit === 'yds') return `Inside ${hi} yds`;
  return `${lo}–${hi} ${unit}`;
}

/** Every shot worth counting, and how many were left out as doubtful. */
function collect(rounds, benchmark) {
  const shots = [];
  let skipped = 0;
  rounds.forEach((round) => {
    round.holes.forEach((hole) => {
      hole.shots.forEach((shot) => {
        if (flaggedShot(shot)) { skipped += 1; return; }
        const { category, sg } = shotSG(shot, hole.par, benchmark);
        shots.push({ round, hole, shot, category, sg });
      });
    });
  });
  return { shots, skipped };
}

/** Per-18 strokes gained by category, with the shots behind each. */
function categoryTotals(rounds, benchmark) {
  const { shots, skipped } = collect(rounds, benchmark);
  const holes = rounds.reduce((sum, r) => sum + playedHoles(r).length, 0);
  const scale = holes ? 18 / holes : 0;
  const per18 = { total: 0 };
  const counts = {};
  CATEGORIES.forEach((c) => { per18[c] = 0; counts[c] = 0; });
  shots.forEach(({ category, sg }) => {
    per18[category] += sg * scale;
    per18.total += sg * scale;
    counts[category] += 1;
  });
  return { shots, skipped, holes, scale, per18, counts };
}

function bandRows(entries, bounds, unit, textFor) {
  return bounds.map(([lo, hi]) => {
    const inBand = entries.filter((e) => e.shot.startDist >= lo && e.shot.startDist < hi);
    const label = bandLabel(lo, hi, unit);
    return {
      label,
      from: `from ${label.charAt(0).toLowerCase()}${label.slice(1)}`,
      n: inBand.length,
      sg: inBand.reduce((sum, e) => sum + e.sg, 0),
      thin: inBand.length < MIN_ATTEMPTS,
      text: textFor(inBand),
    };
  }).filter((row) => row.n > 0);
}

function missSplit(entries) {
  const count = (word) => entries.filter((e) => e.shot.miss && e.shot.miss.includes(word)).length;
  return { left: count('left'), right: count('right'), short: count('short'), long: count('long') };
}

/* One category opened up: ruled rows that each carry a strokes-gained
   figure, and a few plain sentences the rows cannot say. */
const BREAKDOWNS = {
  putt(entries) {
    const rows = bandRows(entries, PUTT_BANDS, 'ft', (band) => {
      const made = band.filter((e) => e.shot.holed).length;
      return `Made ${made} of ${band.length}`;
    });
    const greens = new Map();
    entries.forEach((e) => {
      const key = `${e.round.id}|${e.hole.hole}`;
      greens.set(key, (greens.get(key) || 0) + 1);
    });
    const threePutts = [...greens.values()].filter((n) => n >= 3).length;
    return {
      rows,
      facts: [`${plural(threePutts, 'three-putt')} on ${plural(greens.size, 'green')}.`],
    };
  },

  ott(entries) {
    const lies = ['fairway', 'rough', 'sand', 'recovery', 'green'];
    const rows = lies.map((lie) => {
      const there = entries.filter((e) => (e.shot.holed ? 'green' : e.shot.endLie) === lie);
      return {
        label: LIE_LABELS[lie],
        from: lie === 'recovery' ? 'from tee shots that found trouble' : `from tee shots that finished in the ${lie}`,
        n: there.length,
        sg: there.reduce((sum, e) => sum + e.sg, 0),
        thin: there.length < MIN_ATTEMPTS,
        text: `${there.length} of ${entries.length} tee shots`,
      };
    }).filter((row) => row.n > 0);

    const fairways = entries.filter((e) => e.shot.endLie === 'fairway').length;
    const penalties = entries.filter((e) => e.shot.penalty).length;
    const miss = missSplit(entries);
    const facts = [`Hit ${fairways} of ${entries.length} fairways.`];
    facts.push(penalties ? `${plural(penalties, 'tee shot')} took a penalty.` : 'No penalties off the tee.');
    if (miss.left || miss.right) facts.push(`Missed left ${miss.left}, right ${miss.right}.`);
    return { rows, facts };
  },

  app(entries) {
    const rows = bandRows(entries, APP_BANDS, 'yds', (band) => plural(band.length, 'shot'));
    const miss = missSplit(entries);
    const facts = [];
    if (miss.short || miss.long || miss.left || miss.right) {
      facts.push(`Misses: ${miss.short} short, ${miss.long} long, ${miss.left} left, ${miss.right} right.`);
    }
    return { rows, facts };
  },

  arg(entries, rounds) {
    const rows = bandRows(entries, ARG_BANDS, 'yds', (band) => plural(band.length, 'shot'));
    const { upDown } = shortGameStats(rounds);
    return {
      rows,
      facts: upDown.chances ? [`Got up and down ${upDown.made} of ${upDown.chances} times.`] : [],
    };
  },
};

function describeShot({ shot }) {
  const from = `${shot.startDist} ${shot.startUnit === 'ft' ? 'ft' : 'yds'}`;
  if (shot.startLie === 'green') {
    return shot.holed ? `Holed a ${from} putt` : `Putt from ${from} to ${shot.endDist} ft`;
  }
  const lead = shot.club ? `${shot.club} from ${from}` : `From ${from}`;
  if (shot.holed) return `${lead}, holed`;
  return `${lead} to ${shot.endDist} ${shot.endUnit === 'ft' ? 'ft' : 'yds'}`;
}

function bestShotOf(shots) {
  let best = null;
  shots.forEach((entry) => {
    const later = best && entry.sg === best.sg && new Date(entry.round.date) > new Date(best.round.date);
    if (!best || entry.sg > best.sg || later) best = entry;
  });
  if (!best) return null;
  return {
    text: describeShot(best),
    sg: best.sg,
    category: best.category,
    club: best.shot.club || null,
    startDist: best.shot.startDist,
    startUnit: best.shot.startUnit,
    hole: best.hole.hole,
    par: best.hole.par,
    course: best.round.courseName,
    date: best.round.date,
  };
}

/**
 * What penalties cost. The count is shots that took one; the cost is
 * the strokes gained of those shots, whole, because the bad swing and
 * the stroke added to it are one mistake. Off the tee is then read a
 * second time with those tee shots left out.
 */
export function penaltyImpact(shots, scale) {
  const penal = shots.filter((e) => e.shot.penalty);
  if (!penal.length) return null;
  const ott = shots.filter((e) => e.category === 'ott');
  const sum = (list) => list.reduce((total, e) => total + e.sg, 0);
  return {
    count: penal.length,
    strokes: penal.reduce((total, e) => total + e.shot.penalty, 0),
    sgCost: sum(penal),
    costPer18: sum(penal) * scale,
    ottCount: ott.filter((e) => e.shot.penalty).length,
    ottPer18: sum(ott) * scale,
    ottCleanPer18: sum(ott.filter((e) => !e.shot.penalty)) * scale,
  };
}

function sgPhrase(label, per18) {
  if (per18 >= 0.05) return `${label} gained ${num(per18)} strokes per 18`;
  if (per18 <= -0.05) return `${label} cost ${num(per18)} strokes per 18`;
  return `${label} was level with the benchmark`;
}

/** The band doing most of the damage (or the good), when one clearly is. */
function mostlyFrom(rows, sign) {
  const pool = rows.filter((r) => !r.thin && r.sg * sign > 0);
  if (!pool.length) return '';
  const top = pool.reduce((a, b) => (b.sg * sign > a.sg * sign ? b : a));
  return `, mostly ${top.from}`;
}

function openCategory(key, totals, rounds, role) {
  const entries = totals.shots.filter((e) => e.category === key);
  const breakdown = BREAKDOWNS[key](entries, rounds);
  const label = CATEGORY_LABELS[key];
  const per18 = totals.per18[key];
  let caption;
  if (role === 'leak') {
    caption = per18 <= -0.05
      ? `${sgPhrase(label, per18)}${mostlyFrom(breakdown.rows, -1)}.`
      : `${label} was the weakest part of the game, and still ${per18 >= 0.05 ? `gained ${num(per18)} strokes per 18` : 'level with the benchmark'}.`;
  } else {
    caption = per18 >= 0.05
      ? `${sgPhrase(label, per18)}${mostlyFrom(breakdown.rows, 1)}.`
      : `${label} was the best part of the game, ${per18 <= -0.05 ? `costing only ${num(per18)} strokes per 18` : 'level with the benchmark'}.`;
  }
  return { key, label, per18, shots: entries.length, ...breakdown, caption };
}

function monthOverMonth(now, prev, prevMonth) {
  const rows = CATEGORIES.map((key) => ({
    key,
    label: CATEGORY_LABELS[key],
    now: now.per18[key],
    prev: prev.per18[key],
    delta: now.per18[key] - prev.per18[key],
    thin: now.counts[key] < MIN_ATTEMPTS || prev.counts[key] < MIN_ATTEMPTS,
  }));
  const total = { now: now.per18.total, prev: prev.per18.total, delta: now.per18.total - prev.per18.total };

  const since = monthName(prevMonth, { year: false });
  const solid = rows.filter((r) => !r.thin);
  const up = solid.filter((r) => r.delta >= 0.05).sort((a, b) => b.delta - a.delta)[0];
  const down = solid.filter((r) => r.delta <= -0.05).sort((a, b) => a.delta - b.delta)[0];
  let caption;
  if (up && down) {
    caption = `${up.label} improved by ${num(up.delta)} strokes per 18 since ${since}, while ${down.label.toLowerCase()} slipped by ${num(down.delta)}.`;
  } else if (up) {
    caption = `${up.label} improved by ${num(up.delta)} strokes per 18 since ${since}, and nothing slipped.`;
  } else if (down) {
    caption = `${down.label} slipped by ${num(down.delta)} strokes per 18 since ${since}, and nothing improved.`;
  } else {
    caption = `Every part of the game is within a tenth of a stroke of ${since}.`;
  }
  return { month: prevMonth, label: monthName(prevMonth), rows, total, caption };
}

/**
 * Everything the month's cards say.
 *
 * `rounds` is every round on the device; only `player`'s rounds dated
 * inside `month` ('YYYY-MM') are read, so nobody's recap can pick up
 * anybody else's rows. `notes` is the player's own focus for next
 * month, the one part that is typed rather than measured. `playsLike`
 * is the handicap the app already shows for this player, or null.
 */
export function buildRecap(rounds, player, month, benchmark = 'tour', { benchLabel = 'tour', notes = null, playsLike = null } = {}) {
  const mine = rounds.filter((r) => r.player === player && playedHoles(r).length);
  const inMonth = mine.filter((r) => monthOf(r.date) === month);
  const base = { player, month, monthLabel: monthName(month), benchmark, benchLabel };
  if (!inMonth.length) return { ...base, empty: true, cards: [], captions: {} };

  const withShots = sgRounds(inMonth);
  const totals = categoryTotals(withShots, benchmark);
  const holes = inMonth.reduce((sum, r) => sum + playedHoles(r).length, 0);
  const toPar = inMonth.reduce((sum, r) => sum + roundToPar(r), 0);
  const toParPer18 = (toPar / holes) * 18;

  const cover = {
    rounds: inMonth.length,
    shotRounds: withShots.length,
    holes,
    sgHoles: totals.holes,
    toParPer18,
    skipped: totals.skipped,
    // The app's own handicap figure, handed in so the card and the app agree.
    playsLike,
  };
  const captions = {
    cover: `${plural(inMonth.length, 'round')} and ${plural(holes, 'hole')}, averaging ${
      Math.abs(toParPer18) < 0.05 ? 'level par' : `${num(toParPer18)} ${toParPer18 > 0 ? 'over' : 'under'} par`} per 18.`,
  };
  const cards = ['cover'];
  const recap = { ...base, empty: false, cover, sg: null, leak: null, strength: null, penalties: null, mom: null, focus: null };

  if (totals.holes && totals.shots.length) {
    const thin = {};
    CATEGORIES.forEach((c) => { thin[c] = totals.counts[c] < MIN_ATTEMPTS; });
    recap.sg = { holes: totals.holes, per18: totals.per18, shots: totals.counts, thin };

    // Lowest and highest per 18; on a tie the one with more shots behind it.
    const ranked = CATEGORIES.filter((c) => !thin[c])
      .sort((a, b) => totals.per18[a] - totals.per18[b] || totals.counts[b] - totals.counts[a]);
    let leakKey = null;
    let strengthKey = null;
    if (ranked.length > 1) {
      leakKey = ranked[0];
      const top = totals.per18[ranked[ranked.length - 1]];
      strengthKey = ranked.filter((c) => totals.per18[c] === top)
        .sort((a, b) => totals.counts[b] - totals.counts[a])[0];
    } else if (ranked.length === 1) {
      if (totals.per18[ranked[0]] < 0) leakKey = ranked[0]; else strengthKey = ranked[0];
    }

    const total = totals.per18.total;
    let share = '';
    if (total <= -0.05 && leakKey && totals.per18[leakKey] < 0) share = `, most of it ${CATEGORY_WHERE[leakKey]}`;
    if (total >= 0.05 && strengthKey && totals.per18[strengthKey] > 0) share = `, most of it ${CATEGORY_WHERE[strengthKey]}`;
    captions.sg = Math.abs(total) < 0.05
      ? `Level with ${benchLabel} over ${plural(totals.holes, 'hole')}.`
      : `${total > 0 ? 'Gained' : 'Lost'} ${num(total)} strokes per 18 against ${benchLabel}${share}.`;
    cards.push('sg');

    if (leakKey) {
      recap.leak = openCategory(leakKey, totals, withShots, 'leak');
      captions.leak = recap.leak.caption;
      cards.push('leak');
    }
    if (strengthKey) {
      recap.strength = openCategory(strengthKey, totals, withShots, 'strength');
      recap.strength.bestShot = bestShotOf(totals.shots);
      captions.strength = recap.strength.caption;
      cards.push('strength');
    }

    const penalties = penaltyImpact(totals.shots, totals.scale);
    if (penalties) {
      recap.penalties = penalties;
      const cost = `${plural(penalties.count, 'penalty', 'penalties')} cost ${num(penalties.sgCost)} strokes`;
      captions.penalties = penalties.ottCount
        ? `${cost}; without them, off the tee reads ${signed(penalties.ottCleanPer18)} per 18 instead of ${signed(penalties.ottPer18)}.`
        : `${cost}, none of them off the tee.`;
      cards.push('penalties');
    }

    // Against the last month with shots in it, which after a winter
    // off is not the calendar month before.
    const earlier = sgRounds(mine).filter((r) => monthOf(r.date) < month);
    const prevMonth = earlier.map((r) => monthOf(r.date)).sort().pop();
    if (prevMonth) {
      const prev = categoryTotals(earlier.filter((r) => monthOf(r.date) === prevMonth), benchmark);
      if (prev.holes && prev.shots.length) {
        recap.mom = monthOverMonth(totals, prev, prevMonth);
        captions.mom = recap.mom.caption;
        cards.push('mom');
      }
    }
  }

  const practice = String((notes && notes.practice) || '').trim();
  const rule = String((notes && notes.rule) || '').trim();
  if (practice || rule) {
    recap.focus = { practice, rule, forMonth: monthName(nextMonth(month), { year: false }) };
    captions.focus = `Focus for ${recap.focus.forMonth}.`;
    cards.push('focus');
  }

  return { ...recap, cards, captions };
}

/** A per-18 figure with its sign, using a true minus. */
export function signed(v, places = 1) {
  const r = Number(Math.abs(v).toFixed(places));
  if (r === 0) return (0).toFixed(places);
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(places)}`;
}
