/* ---------------------------------------------------------------
   brief.js — turning stored rounds into something you can hand to a
   chat and actually talk about.

   The app already answers "how bad was it and where". What it cannot
   do is discuss it: ask why hole 14 went wrong, or what the round
   looks like without the two blow-ups. That conversation happens
   somewhere else, and this module packs a round up for the trip.

   Two formats, because they do different jobs:

   - A Markdown BRIEF. Prose and small tables, with the conventions
     spelled out at the top. A model reading this needs no golf
     knowledge and no baseline tables — every strokes-gained figure
     is already computed, so it can talk about the round instead of
     guessing at arithmetic it cannot do.
   - A shots CSV. One row per shot, every column raw. For a
     spreadsheet, or for a model that would rather count than read.

   Both are read views, not storage. The rule that nothing derived is
   ever written to storage still holds: these strings are built on
   demand from raw shots and thrown away. A better baseline table
   changes what the next export says, exactly as it should.
--------------------------------------------------------------- */

import {
  CATEGORIES,
  CATEGORY_LABELS,
  LIE_LABELS,
  MISS_LABELS,
  expectedStrokes,
} from './baseline.js';

import {
  shotSG,
  holeTotals,
  roundTotals,
  holeScore,
  roundScore,
  roundPar,
  roundToPar,
  playedHoles,
  sgRounds,
  isScoreOnly,
  approachBuckets,
  puttingBuckets,
  teeOutcomes,
  greensInRegulation,
  missTally,
  clubDistances,
  clubGapping,
  nemesisHoles,
  personalBests,
} from './model.js';

import {
  handicapProfile,
  fmtHandicap,
  handicapForCategory,
  upsideFor,
} from './handicap.js';

/* --- Formatting -------------------------------------------------
   Deliberately ASCII. The UI uses a typographic minus because it
   looks better on screen; a file that gets pasted into a chat, or
   opened in a spreadsheet, wants the character everything parses. */

function sg(value) {
  const rounded = Math.round(value * 100) / 100;
  // Avoids "-0.00" for a value that rounds to nothing.
  const safe = rounded === 0 ? 0 : rounded;
  return (safe > 0 ? '+' : safe < 0 ? '-' : '') + Math.abs(safe).toFixed(2);
}

function toPar(diff) {
  const rounded = Math.round(diff * 10) / 10;
  if (rounded === 0) return 'E';
  return (rounded > 0 ? '+' : '-') + Math.abs(rounded);
}

function dist(value, unit) {
  if (value == null) return '';
  return Math.round(value) + (unit === 'ft' ? 'ft' : 'y');
}

function isoDay(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

function longDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function pct(part, whole) {
  return whole ? Math.round((part / whole) * 100) : 0;
}

/**
 * Miss directions as prose. MISS_LABELS is sized for a table column
 * ("Short R"), which reads badly mid-sentence.
 */
const MISS_PHRASE = {
  'long-left': 'long and left',
  long: 'long',
  'long-right': 'long and right',
  left: 'left',
  target: 'on target',
  right: 'right',
  'short-left': 'short and left',
  short: 'short',
  'short-right': 'short and right',
};

/**
 * fmtHandicap gives a bare number for a table column. Mid-sentence
 * that reads as a stray figure, so it gets an article — except at the
 * ends of the scale, where the word already is the phrase.
 */
function handicapPhrase(value) {
  const text = fmtHandicap(value);
  return /^\d/.test(text) ? `a ${text} handicap` : text;
}

/** Words rather than the UI's three-letter columns — this is prose. */
const CATEGORY_WORD = {
  ott: 'off the tee',
  app: 'approach',
  arg: 'short game',
  putt: 'putting',
};

function table(headers, rows, align = []) {
  const rule = headers.map((_, i) => (align[i] === 'r' ? '---:' : '---'));
  return [
    `| ${headers.join(' | ')} |`,
    `| ${rule.join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

/** Blocks joined with blank lines, with anything empty dropped. */
function join(blocks) {
  return blocks.filter((b) => b && b.trim()).join('\n\n');
}

/* --- Facts a brief needs more than once ------------------------- */

/** Penalty strokes are part of the score and part of strokes gained. */
function penaltyStrokes(round) {
  return playedHoles(round).reduce((sum, h) =>
    sum + h.shots.reduce((s, shot) => s + (shot.penalty || 0), 0), 0);
}

function puttCount(round) {
  return playedHoles(round).reduce((sum, h) =>
    sum + h.shots.filter((s) => s.startLie === 'green').length, 0);
}

function threePuttHoles(round) {
  return playedHoles(round).filter((h) =>
    h.shots.filter((s) => s.startLie === 'green').length >= 3).length;
}

/** Every shot of a round, flattened, with its hole and cost attached. */
function shotsOf(round, baseline = 'tour') {
  const out = [];
  playedHoles(round).forEach((hole) => {
    hole.shots.forEach((shot) => {
      const { category, sg: value } = shotSG(shot, hole.par, baseline);
      out.push({ round, hole, shot, category, sg: value });
    });
  });
  return out;
}

/**
 * The round with its worst holes deleted, for the question everybody
 * asks after a bad one: what was I actually playing at, minus the
 * blow-ups.
 *
 * Ranked by strokes over par, because the question is about scoring
 * pace. The result is scaled back to 18 holes — take three holes out
 * of eighteen and the raw total flatters itself otherwise.
 *
 * This is a thought experiment, not a score. Nothing here writes it
 * anywhere, and the brief says as much.
 */
export function withoutWorstHoles(round, count, baseline = 'tour') {
  const holes = playedHoles(round);
  const ranked = holes.slice().sort((a, b) => {
    const over = (holeScore(b) - b.par) - (holeScore(a) - a.par);
    if (over !== 0) return over;
    // Same damage on the card: the one that cost more shots decides.
    return holeTotals(a, baseline).total - holeTotals(b, baseline).total;
  });
  const dropped = ranked.slice(0, Math.min(count, holes.length));
  const droppedIds = new Set(dropped.map((h) => h.hole));
  const kept = holes.filter((h) => !droppedIds.has(h.hole));

  const score = kept.reduce((s, h) => s + holeScore(h), 0);
  const par = kept.reduce((s, h) => s + h.par, 0);
  const scale = kept.length ? 18 / kept.length : 0;
  const totals = kept.reduce((acc, h) => acc + holeTotals(h, baseline).total, 0);

  return {
    dropped,
    holes: kept.length,
    score,
    par,
    toPar: score - par,
    toParPer18: (score - par) * scale,
    sg: totals,
    sgPer18: totals * scale,
  };
}

/* --- The preamble ------------------------------------------------
   The single most valuable part of the file. A model handed a table
   of numbers with no conventions will guess at them, and the guesses
   are wrong in specific ways: it will assume green distances are
   yards, that a par-3 tee shot is a drive, that a negative number is
   an error. Stating the rules costs a paragraph and removes a whole
   class of confident nonsense. */

const HOW_TO_READ = `## How to read this file

Every shot is scored by **strokes gained**: the expected strokes to hole out
from where the ball started, minus the expected strokes from where it finished,
minus the strokes it took to get there. Beat the expectation and the number is
positive; fall short and it is negative. A shot worth -1.00 cost a full stroke
against the yardstick.

The yardstick is a **PGA Tour** baseline, so almost every number an amateur
produces is negative. That is the scale working, not a bad round. What matters
is which parts are more negative than the rest.

Conventions this data follows, which are not guessable from the numbers:

- **Distances are yards everywhere except on the green, where they are feet.**
  A putt listed as 34ft is thirty-four feet; an approach listed as 150y is
  a hundred and fifty yards.
- **A par-3 tee shot counts as an approach, not off the tee.** Off the tee is
  par 4s and 5s only, which is what makes the figure comparable to published
  tour numbers.
- **Penalty strokes count toward both the score and strokes gained**, and are
  attached to the shot that incurred them.
- **Miss direction and club never affect strokes gained.** They are entered by
  hand and are optional. They say why a shot happened; the strokes-gained
  figure says what it cost.
- Holes are grouped by the **physical hole**. Where one nine is played twice,
  the 4th and the 13th are the same piece of ground.
- Nine-hole rounds are real rounds, so anything labelled **per 18** has been
  scaled to make a nine and an eighteen comparable.`;

const LIMITS = `## What this file cannot tell you

Worth knowing before drawing conclusions from it:

- There is **no wind, weather, lie quality, pin position or slope** in this
  data. A 40-foot putt across two tiers and a 40-foot putt on a flat green are
  the same row here.
- **Hole yardage is measured along the centreline**, so a drive on a dogleg
  reads longer than the ball actually travelled. Nothing in the data says which
  holes bend.
- **Club is recorded on approach shots only**, and only when it was entered at
  the time. A missing club means it was not logged, not that none was used.
- **Miss direction is where the ball finished relative to the target**, typed in
  by the player. It is a memory, not a measurement.
- The expected-strokes tables are an **approximation** of published tour values,
  interpolated between reference distances. They are good enough to rank a
  round's problems and too rough to argue about hundredths.
- A round with no shot data appears here as a score only, and is deliberately
  absent from every strokes-gained figure.`;

/* --- Round brief ------------------------------------------------ */

function headerBlock(round) {
  const holes = playedHoles(round);
  const bits = [
    round.player,
    `${round.courseName} (${round.teeName} tees)`,
    round.layout || null,
    longDate(round.date),
  ].filter(Boolean);

  return `# ${round.courseName} — ${isoDay(round.date)} — ${round.player}

${bits.join(' · ')}

${holes.length} holes · ${roundScore(round)} strokes · par ${roundPar(round)} · **${toPar(roundToPar(round))}**${
    isScoreOnly(round) ? '\n\nScore only: no shots were logged for this round, so there is no strokes-gained detail below.' : ''
  }`;
}

function sgBlock(round, baseline) {
  const totals = roundTotals(round, baseline);
  const holeCount = playedHoles(round).length || 1;
  const scale = 18 / holeCount;

  const per18 = { total: totals.total * scale };
  CATEGORIES.forEach((c) => { per18[c] = totals[c] * scale; });
  const profile = handicapProfile(per18);

  const rows = CATEGORIES.map((c) => [
    CATEGORY_LABELS[c],
    sg(totals[c]),
    sg(per18[c]),
    fmtHandicap(handicapForCategory(c, per18[c])),
  ]);
  rows.push([
    '**Total**',
    `**${sg(totals.total)}**`,
    `**${sg(per18.total)}**`,
    `**${fmtHandicap(profile.overall)}**`,
  ]);

  const weakest = profile.weakest;
  const strongest = profile.strongest;

  return `## Strokes gained

${table(['Part of the game', 'This round', 'Per 18', 'Plays like'], rows, ['', 'r', 'r', ''])}

On this round alone, the game reads as a **${fmtHandicap(profile.overall)} handicap**.
${weakest.category === strongest.category
    ? 'Every part of the game came out at much the same level, so nothing stands out as the culprit.'
    : `${CATEGORY_LABELS[weakest.category]} is the part dragging it, at ${handicapPhrase(weakest.handicap)}, against ${CATEGORY_LABELS[strongest.category].toLowerCase()} at ${handicapPhrase(strongest.handicap)}.${
      upsideFor(weakest) >= 0.1 ? ` Lifting ${CATEGORY_WORD[weakest.category]} to the level of the rest of the game would have been worth about ${upsideFor(weakest).toFixed(1)} strokes.` : ''
    }`}

One round is a thin sample for a handicap read — a hot putter or two lost balls
move it further than they should. Read it as the shape of this round, not the
shape of the player.`;
}

function shapeBlock(round, baseline) {
  const rounds = [round];
  const gir = greensInRegulation(rounds);
  const tee = teeOutcomes(rounds, baseline);
  const putts = puttCount(round);
  const penalties = penaltyStrokes(round);
  const threes = threePuttHoles(round);

  const rows = [
    ['Greens in regulation', `${gir.greens} of ${gir.holes} (${gir.pct}%)`],
    ['Fairways hit', tee.total ? `${Math.round((tee.fairwayPct / 100) * tee.total)} of ${tee.total} (${tee.fairwayPct}%)` : 'no par 4s or 5s played'],
    ['Putts', String(putts)],
    ['Three-putts or worse', String(threes)],
    ['Penalty strokes', String(penalties)],
  ];

  const byPar = gir.byPar.map((r) => `par ${r.par}: ${r.greens}/${r.holes} (${r.pct}%)`).join(', ');

  return `## The shape of the round

${table(['', ''], rows)}

Greens by par — ${byPar}.`;
}

function costliestBlock(round, baseline) {
  const shots = shotsOf(round, baseline)
    .filter((s) => s.sg < 0)
    .sort((a, b) => a.sg - b.sg)
    .slice(0, 5);
  if (!shots.length) return '';

  const lines = shots.map(({ hole, shot, category, sg: value }) =>
    `- **Hole ${hole.hole}** (par ${hole.par}), shot ${shot.n} — ${describeShot(shot)} — ${CATEGORY_WORD[category]} **${sg(value)}**`);

  return `## The most expensive shots

The ${lines.length === 1 ? 'one shot' : `${lines.length} shots`} that cost the most against the baseline. Worth checking against
memory: a shot that cost a stroke and a half is usually one you can still picture.

${lines.join('\n')}`;
}

function counterfactualBlock(round, baseline) {
  const holes = playedHoles(round);
  if (holes.length < 4) return '';

  // Removing a hole that was played to par proves nothing, so the
  // table stops once the over-par holes run out.
  const overPar = holes.filter((h) => holeScore(h) > h.par).length;
  if (!overPar) return '';

  const rows = [[
    'nothing',
    String(holes.length),
    String(roundScore(round)),
    toPar(roundToPar(round)),
    toPar(roundToPar(round) * (18 / holes.length)),
  ]];

  [1, 2, 3].filter((n) => n <= overPar).forEach((n) => {
    const what = withoutWorstHoles(round, n, baseline);
    const names = what.dropped.map((h) => `${h.hole} (${toPar(holeScore(h) - h.par)})`).join(', ');
    rows.push([names, String(what.holes), String(what.score), toPar(what.toPar), toPar(what.toParPer18)]);
  });

  return `## Take away the worst holes

What the round looks like with the biggest holes removed. This is a thought
experiment about pace, not a score — the strokes were real and they count.

${table(['Holes removed', 'Holes left', 'Strokes', 'To par', 'Pace per 18'], rows, ['', 'r', 'r', 'r', 'r'])}`;
}

function describeShot(shot) {
  const from = `${LIE_LABELS[shot.startLie]} ${dist(shot.startDist, shot.startUnit)}`;
  const to = shot.holed ? 'holed' : `${LIE_LABELS[shot.endLie]} ${dist(shot.endDist, shot.endUnit)}`;
  const notes = [];
  if (shot.penalty) notes.push(`+${shot.penalty} penalty`);
  if (shot.miss) notes.push(shot.miss === 'target' ? 'on target' : `missed ${MISS_PHRASE[shot.miss] || shot.miss}`);
  if (shot.club) notes.push(shot.club);
  return `${from} -> ${to}${notes.length ? ` (${notes.join(', ')})` : ''}`;
}

function holeByHoleBlock(round, baseline) {
  const holes = playedHoles(round);
  const scoreOnly = isScoreOnly(round);

  const summary = table(
    scoreOnly
      ? ['Hole', 'Par', 'Yards', 'Score', 'To par']
      : ['Hole', 'Par', 'Yards', 'Score', 'To par', 'SG', 'Putts'],
    holes.map((h) => {
      const score = holeScore(h);
      const base = [
        String(h.hole) + (h.sourceNine && h.sourceHole !== h.hole ? ` (${h.sourceNine} ${h.sourceHole})` : ''),
        String(h.par),
        String(h.yards),
        String(score),
        toPar(score - h.par),
      ];
      if (scoreOnly) return base;
      return base.concat([
        sg(holeTotals(h, baseline).total),
        String(h.shots.filter((s) => s.startLie === 'green').length),
      ]);
    }),
    scoreOnly ? ['', 'r', 'r', 'r', 'r'] : ['', 'r', 'r', 'r', 'r', 'r', 'r'],
  );

  if (scoreOnly) {
    return `## Hole by hole\n\n${summary}`;
  }

  const detail = holes.map((h) => {
    const score = holeScore(h);
    const head = `### Hole ${h.hole} — par ${h.par}, ${h.yards}y — ${score} (${toPar(score - h.par)}) — SG ${sg(holeTotals(h, baseline).total)}`;
    const shots = h.shots.map((s) => {
      const { category, sg: value } = shotSG(s, h.par, baseline);
      return `${s.n}. ${describeShot(s)} · ${CATEGORY_WORD[category]} ${sg(value)}`;
    }).join('\n');
    return `${head}\n\n${shots}`;
  }).join('\n\n');

  return `## Hole by hole\n\n${summary}\n\n${detail}`;
}

/**
 * How this round sits against everything else the player has logged.
 * Without it a chat can say the round was bad; with it, it can say
 * whether it was bad *for you*, which is the more useful sentence.
 */
function contextBlock(round, history, baseline) {
  const others = sgRounds(history).filter((r) => r.id !== round.id && playedHoles(r).length);
  if (!others.length) return '';

  const holes = others.reduce((s, r) => s + playedHoles(r).length, 0);
  const scale = 18 / holes;
  const career = { total: 0 };
  CATEGORIES.forEach((c) => { career[c] = 0; });
  others.forEach((r) => {
    const t = roundTotals(r, baseline);
    CATEGORIES.forEach((c) => { career[c] += t[c]; });
    career.total += t.total;
  });

  const thisHoles = playedHoles(round).length || 1;
  const thisScale = 18 / thisHoles;
  const mine = roundTotals(round, baseline);

  const rows = CATEGORIES.concat(['total']).map((c) => {
    const now = mine[c] * thisScale;
    const usual = career[c] * scale;
    return [
      c === 'total' ? '**Total**' : CATEGORY_LABELS[c],
      sg(now),
      sg(usual),
      sg(now - usual),
    ];
  });

  const scoreHoles = others.reduce((s, r) => s + playedHoles(r).length, 0);
  const usualToPar = others.reduce((s, r) => s + roundToPar(r), 0) / scoreHoles * 18;

  return `## Against the player's usual

Per 18 holes, this round next to the ${others.length} other shot-by-shot round${
    others.length === 1 ? '' : 's'} on record.

${table(['Part of the game', 'This round', 'Usual', 'Difference'], rows, ['', 'r', 'r', 'r'])}

Usual scoring pace is ${toPar(usualToPar)} per 18; this round was ${
    toPar(roundToPar(round) * thisScale)}.`;
}

/**
 * One round, packaged for a conversation.
 *
 * `history` is optional — pass the player's other rounds and the brief
 * gains a comparison section. Without it the file still stands alone.
 */
export function roundBrief(round, { history = [], baseline = 'tour' } = {}) {
  if (!round) throw new Error('No round to export.');
  const scoreOnly = isScoreOnly(round);

  return join([
    headerBlock(round),
    HOW_TO_READ,
    scoreOnly ? '' : sgBlock(round, baseline),
    scoreOnly ? '' : shapeBlock(round, baseline),
    scoreOnly ? '' : costliestBlock(round, baseline),
    counterfactualBlock(round, baseline),
    scoreOnly ? '' : contextBlock(round, history, baseline),
    holeByHoleBlock(round, baseline),
    LIMITS,
  ]) + '\n';
}

/* --- Career brief ----------------------------------------------- */

function careerHeader(player, rounds, withShots) {
  const holes = rounds.reduce((s, r) => s + playedHoles(r).length, 0);
  const first = rounds[0];
  const last = rounds[rounds.length - 1];
  const span = first && last
    ? `${isoDay(first.date)} to ${isoDay(last.date)}`
    : 'no rounds yet';

  return `# Ledger — every round logged by ${player}

${rounds.length} round${rounds.length === 1 ? '' : 's'} · ${holes} holes · ${span}
${rounds.length === withShots.length
    ? 'Every round here was logged shot by shot.'
    : `${withShots.length} of them logged shot by shot. The other ${rounds.length - withShots.length} are score only, and are left out of every strokes-gained figure below.`}`;
}

function careerSGBlock(withShots, baseline) {
  const holes = withShots.reduce((s, r) => s + playedHoles(r).length, 0);
  if (!holes) return '';
  const scale = 18 / holes;

  const per18 = { total: 0 };
  CATEGORIES.forEach((c) => { per18[c] = 0; });
  withShots.forEach((r) => {
    const t = roundTotals(r, baseline);
    CATEGORIES.forEach((c) => { per18[c] += t[c]; });
    per18.total += t.total;
  });
  CATEGORIES.forEach((c) => { per18[c] *= scale; });
  per18.total *= scale;

  const profile = handicapProfile(per18);
  const rows = profile.rows.map((row) => [
    CATEGORY_LABELS[row.category],
    sg(row.sg),
    fmtHandicap(row.handicap),
    upsideFor(row) > 0.05 ? `${upsideFor(row).toFixed(1)} strokes` : '—',
  ]);

  return `## Where the game stands

Everything per 18 holes, across ${withShots.length} round${withShots.length === 1 ? '' : 's'} and ${holes} holes.
Sorted worst first. "Upside" is what lifting that part to the level of the rest
of the game would be worth.

${table(['Part of the game', 'SG per 18', 'Plays like', 'Upside'], rows, ['', 'r', '', 'r'])}

Overall: **${fmtHandicap(profile.overall)} handicap**, total ${sg(per18.total)} per 18.`;
}

function roundLogBlock(rounds, baseline) {
  const rows = rounds.slice().reverse().map((r) => {
    const holes = playedHoles(r).length;
    const shots = !isScoreOnly(r);
    return [
      isoDay(r.date),
      r.courseName + (r.layout ? ` (${r.layout})` : ''),
      String(holes),
      String(roundScore(r)),
      toPar(roundToPar(r)),
      shots ? sg((roundTotals(r, baseline).total / (holes || 1)) * 18) : 'score only',
    ];
  });

  return `## Every round, newest first

${table(['Date', 'Course', 'Holes', 'Score', 'To par', 'SG per 18'], rows, ['', '', 'r', 'r', 'r', 'r'])}`;
}

function careerDetailBlocks(withShots, baseline) {
  if (!withShots.length) return [];

  const gir = greensInRegulation(withShots);
  const tee = teeOutcomes(withShots, baseline);
  const putts = puttingBuckets(withShots, baseline);
  const apps = approachBuckets(withShots, baseline);
  const totalPutts = putts.reduce((s, b) => s + b.putts, 0);
  const holes = withShots.reduce((s, r) => s + playedHoles(r).length, 0);

  const basics = `## The basics

${table(['', ''], [
    ['Greens in regulation', `${gir.pct}% (${gir.greens} of ${gir.holes})`],
    ...gir.byPar.map((r) => [`  on par ${r.par}s`, `${r.pct}% (${r.greens} of ${r.holes})`]),
    ['Fairways hit', `${tee.fairwayPct}% of ${tee.total} tee shots on par 4s and 5s`],
    ['Putts per 18', holes ? ((totalPutts / holes) * 18).toFixed(1) : '—'],
  ])}`;

  const teeBlock = tee.total ? `## Off the tee

Where tee shots on par 4s and 5s finished, and what each outcome cost.

${table(['Finished', 'Shots', 'Share', 'SG total', 'SG per shot'],
    tee.rows.map((r) => [
      LIE_LABELS[r.lie] || r.lie,
      String(r.count),
      `${pct(r.count, tee.total)}%`,
      sg(r.sg),
      sg(r.sg / r.count),
    ]), ['', 'r', 'r', 'r', 'r'])}` : '';

  const appBlock = apps.length ? `## Approach play by distance

Proximity is the average distance left to the hole, counting only shots that
finished on the green.

${table(['Distance', 'Shots', 'SG total', 'SG per shot', 'Greens hit', 'Proximity'],
    apps.map((b) => [
      `${b.label}y`,
      String(b.shots),
      sg(b.sg),
      sg(b.sg / b.shots),
      `${b.proximityCount} of ${b.shots}`,
      b.proximityCount ? `${Math.round(b.proximitySum / b.proximityCount)}ft` : '—',
    ]), ['', 'r', 'r', 'r', 'r', 'r'])}` : '';

  const puttBlock = putts.length ? `## Putting by distance

${table(['Distance', 'Putts', 'Holed', 'Make rate', 'SG total', 'SG per putt', '3-putts from here'],
    putts.map((b) => [
      b.label,
      String(b.putts),
      String(b.holed),
      `${pct(b.holed, b.putts)}%`,
      sg(b.sg),
      sg(b.sg / b.putts),
      `${b.threePutts} of ${b.firstPutts}`,
    ]), ['', 'r', 'r', 'r', 'r', 'r', 'r'])}` : '';

  const missBlock = ['ott', 'app'].map((category) => {
    const t = missTally(withShots, category, baseline);
    if (!t.total) return '';
    const dirs = Object.keys(t.tally).sort((a, b) => t.tally[b] - t.tally[a]);
    const rows = dirs.map((dir) => [
      dir === 'target' ? 'On target' : `Missed ${MISS_PHRASE[dir] || dir}`,
      String(t.tally[dir]),
      `${pct(t.tally[dir], t.total)}%`,
      sg(t.sgByDir[dir]),
      sg(t.sgByDir[dir] / t.tally[dir]),
    ]);

    // A one-sided miss is an aim problem; a two-way miss is a swing one.
    const sides = `${t.leftCount} left, ${t.rightCount} right, ${t.shortCount} short, ${t.longCount} long`;

    return `**${CATEGORY_LABELS[category]}** — ${t.onTargetPct}% on target across ${t.total} shots (${sides}).

${table(['Where it finished', 'Shots', 'Share', 'SG total', 'SG per shot'], rows, ['', 'r', 'r', 'r', 'r'])}`;
  }).filter(Boolean);

  const misses = missBlock.length ? `## Miss patterns

Where the ball finishes when it does not finish at the target, and what each
direction costs. A miss that happens often but costs nothing is not the one to
go and fix. Only shots where a direction was entered appear here.

${missBlock.join('\n\n')}` : '';

  const clubs = clubDistances(withShots, baseline);
  const clubBlock = clubs.length ? `## How far each club actually goes

Distance advanced on approach shots that stayed in play, not carry. "Typical" is
the middle of the pack, and the quartiles are where the club lands when nothing
unusual happens.

${table(['Club', 'Shots', 'Typical', 'Middle half', 'Shortest', 'Longest'],
    clubs.map((c) => [
      c.club,
      String(c.shots),
      `${Math.round(c.typical)}y`,
      `${Math.round(c.lowerQuartile)}-${Math.round(c.upperQuartile)}y`,
      `${Math.round(c.shortest)}y`,
      `${Math.round(c.longest)}y`,
    ]), ['', 'r', 'r', 'r', 'r', 'r'])}

${(() => {
    const gaps = clubGapping(clubs);
    if (!gaps.length) return 'Not enough shots on enough clubs to read the gapping yet.';
    return `Gapping (${gaps.length} pair${gaps.length === 1 ? '' : 's'} with enough shots to judge):\n\n` +
      gaps.map((g) => `- ${g.longer} to ${g.shorter}: ${Math.round(g.gap)}y — ${
        g.verdict === 'overlap' ? 'overlapping, two clubs doing one job'
          : g.verdict === 'wide' ? 'a wide gap, a distance with nothing comfortable for it'
            : 'about right'}`).join('\n');
  })()}` : '';

  const nemesis = nemesisHoles(withShots, { count: 5, baseline });
  const holeRow = (h) => [
    `${h.hole}${h.nine ? ` (${h.nine})` : ''}`,
    h.courseName,
    String(h.par),
    String(h.plays),
    h.avgScore.toFixed(1),
    toPar(h.avgToPar),
    sg(h.avgSG),
    CATEGORY_LABELS[h.worstCategory],
  ];
  const holeHeaders = ['Hole', 'Course', 'Par', 'Played', 'Avg score', 'Avg to par', 'Avg SG', 'Costs most in'];
  const holeAlign = ['', '', 'r', 'r', 'r', 'r', 'r', ''];

  const nemesisBlock = nemesis.worst.length ? `## Holes that cost the most, and least

Aggregated on the physical hole, so a nine played twice is one piece of ground
played twice. Only holes played at least twice are considered${
    nemesis.considered ? ` (${nemesis.considered} qualify)` : ''}.

**Nemesis holes**

${table(holeHeaders, nemesis.worst.map(holeRow), holeAlign)}

${nemesis.considered > nemesis.worst.length + nemesis.best.length ? `**Holes that give strokes back**

${table(holeHeaders, nemesis.best.map(holeRow), holeAlign)}` : `Only ${nemesis.considered} holes have been played often enough to rank, which is
not enough for a separate list of the ones that give strokes back — they would
be the same holes in reverse.`}` : '';

  return [basics, teeBlock, appBlock, puttBlock, misses, clubBlock, nemesisBlock];
}

function bestsBlock(withShots, baseline) {
  const best = personalBests(withShots, baseline);
  const rows = [];
  const add = (label, value) => { if (value) rows.push([label, value]); };

  if (best.longestDrive) add('Longest drive', `${best.longestDrive.yards}y (hole ${best.longestDrive.hole}, ${isoDay(best.longestDrive.date)})`);
  if (best.longestFairwayDrive) add('Longest drive in the fairway', `${best.longestFairwayDrive.yards}y (hole ${best.longestFairwayDrive.hole}, ${isoDay(best.longestFairwayDrive.date)})`);
  if (best.closestApproach) add('Closest approach', `${Math.round(best.closestApproach.feet)}ft from ${best.closestApproach.from}y (hole ${best.closestApproach.hole}, ${isoDay(best.closestApproach.date)})`);
  if (best.longestPutt) add('Longest putt holed', `${Math.round(best.longestPutt.feet)}ft (hole ${best.longestPutt.hole}, ${isoDay(best.longestPutt.date)})`);
  if (best.longestHoleOut) add('Longest hole-out', `${best.longestHoleOut.yards}y (hole ${best.longestHoleOut.hole}, ${isoDay(best.longestHoleOut.date)})`);
  if (best.bestRound) add('Best round', `${best.bestRound.score} (${toPar(best.bestRound.toPar)}) over ${best.bestRound.holes} holes at ${best.bestRound.course}, ${isoDay(best.bestRound.date)}`);
  if (best.bestSG) add('Best round by strokes gained', `${sg(best.bestSG.sg)} per 18 at ${best.bestSG.course}, ${isoDay(best.bestSG.date)}`);

  if (!rows.length) return '';
  return `## Career bests\n\n${table(['', ''], rows)}`;
}

/** Everything one player has logged, packaged for a conversation. */
export function careerBrief(player, allRounds, { baseline = 'tour' } = {}) {
  const rounds = allRounds
    .filter((r) => r.player === player && playedHoles(r).length)
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (!rounds.length) throw new Error(`No rounds logged for ${player} yet.`);
  const withShots = sgRounds(rounds);

  return join([
    careerHeader(player, rounds, withShots),
    HOW_TO_READ,
    careerSGBlock(withShots, baseline),
    ...careerDetailBlocks(withShots, baseline),
    roundLogBlock(rounds, baseline),
    bestsBlock(withShots, baseline),
    `## Going deeper

This file is the summary. Shot-by-shot detail for a single round is a separate
export from that round's page, and every shot across every round is available as
a CSV alongside this one.`,
    LIMITS,
  ]) + '\n';
}

/* --- Shots CSV --------------------------------------------------
   One row per shot, nothing summarised. Expected strokes before and
   after are included so the strokes-gained column can be checked
   rather than taken on faith — sg = before - after - strokes. */

export const CSV_COLUMNS = [
  'round_id', 'date', 'player', 'course', 'tee', 'layout',
  'hole', 'physical_nine', 'physical_hole', 'par', 'yards', 'hole_score', 'hole_sg',
  'shot', 'category', 'start_lie', 'start_dist', 'start_unit',
  'end_lie', 'end_dist', 'end_unit', 'holed', 'penalty', 'strokes',
  'miss', 'club', 'expected_before', 'expected_after', 'sg',
];

/** The rows behind the CSV, kept separate so they can be tested. */
export function shotRows(rounds, baseline = 'tour') {
  const rows = [];
  sgRounds(rounds).forEach((round) => {
    playedHoles(round).forEach((hole) => {
      const holeSG = holeTotals(hole, baseline).total;
      const score = holeScore(hole);
      hole.shots.forEach((shot) => {
        const { category, sg: value } = shotSG(shot, hole.par, baseline);
        rows.push({
          round_id: round.id,
          date: isoDay(round.date),
          player: round.player,
          course: round.courseName,
          tee: round.teeName,
          layout: round.layout || '',
          hole: hole.hole,
          physical_nine: hole.sourceNine || '',
          physical_hole: hole.sourceHole || hole.hole,
          par: hole.par,
          yards: hole.yards,
          hole_score: score,
          hole_sg: round3(holeSG),
          shot: shot.n,
          category,
          start_lie: shot.startLie,
          start_dist: shot.startDist,
          start_unit: shot.startUnit,
          end_lie: shot.holed ? '' : shot.endLie,
          end_dist: shot.holed ? '' : shot.endDist,
          end_unit: shot.holed ? '' : shot.endUnit,
          holed: shot.holed ? 'yes' : 'no',
          penalty: shot.penalty || 0,
          strokes: 1 + (shot.penalty || 0),
          miss: shot.miss || '',
          club: shot.club || '',
          expected_before: round3(expectedStrokes(shot.startLie, shot.startDist, baseline)),
          expected_after: round3(shot.holed ? 0 : expectedStrokes(shot.endLie, shot.endDist, baseline)),
          sg: round3(value),
        });
      });
    });
  });
  return rows;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

/** RFC 4180 quoting: a field only needs quotes when it could break the row. */
function csvField(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function shotsCsv(rounds, baseline = 'tour') {
  const rows = shotRows(rounds, baseline);
  const lines = [CSV_COLUMNS.join(',')];
  rows.forEach((row) => {
    lines.push(CSV_COLUMNS.map((c) => csvField(row[c])).join(','));
  });
  // A trailing newline, so appending or concatenating never joins rows.
  return lines.join('\n') + '\n';
}

/* --- File names -------------------------------------------------
   Whatever this lands in — a Files app, a Downloads folder, a chat
   attachment list — the name should say which round it is without
   opening it. */

function slug(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'ledger';
}

export function roundFilename(round, ext = 'md') {
  return `ledger-${isoDay(round.date)}-${slug(round.courseName)}-${slug(round.player)}.${ext}`;
}

export function careerFilename(player, ext = 'md') {
  return `ledger-${slug(player)}-all-rounds-${new Date().toISOString().slice(0, 10)}.${ext}`;
}
