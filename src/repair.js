/* ---------------------------------------------------------------
   repair.js — putting a round back in step with its scorecard.

   WHAT THIS IS ACTUALLY FOR, because the obvious guess is wrong.

   Strokes gained is never stored. It is recomputed from raw shots
   every time anything asks, so a better baseline improves every round
   ever logged and there is no such thing as an SG backfill here.

   What a round DOES store is its own copy of the hole yardages,
   snapshotted from the course when the round was started. That copy
   is the record of what the card said at the time, which is normally
   the right thing to keep — but when the card itself was wrong, the
   round keeps being wrong after the course is fixed. Correcting the
   course does nothing for a round already played on it.

   So this does not touch strokes gained. It corrects the yardages a
   round is carrying, and strokes gained then comes out right on its
   own, the same way it always did.

   THE BLAST RADIUS IS ONE SHOT PER HOLE. relinkHole derives the first
   shot's starting distance from the hole yardage; every shot after it
   starts where the previous one finished, and those were entered by
   hand. So a wrong yardage is wrong for the tee shot and nothing else
   — which also means it lands on off-the-tee for a par 4 or 5, and on
   approach for a par 3.

   It is also, quietly, the staleness detector. Anything this reports
   as differing is a round out of step with its course, which is a
   better signal than a version stamp: a stamp changes when the city
   name is edited, and this only speaks up when a number that feeds a
   calculation actually moved.
--------------------------------------------------------------- */

import { relinkHole, roundTotals, holeTotals, playedHoles } from './model.js';
import { CATEGORIES } from './baseline.js';
import { playOptions, buildRoundHoles } from './courses.js';

/**
 * Work out which nine or pairing a round was played on.
 *
 * The obvious way would be to read it off the round, and for a round
 * still on the phone that logged it, `layout` and `sourceNine` are
 * both there. They do NOT survive the sheet: the shots tab has no
 * column for them, so anybody else's round arrives without them. A
 * repair that only worked on your own rounds would be no use at all
 * here, since the whole problem is three players sharing one bad card.
 *
 * So it is inferred from the sequence of pars, which is data we know
 * is right — the pars were correct, only the yardages were wrong —
 * and which is specific enough to identify a layout on any course
 * that does not have two nines with identical pars in the same order.
 * When it is not specific enough, that is reported rather than
 * guessed at.
 */
export function inferPlayOption(course, round) {
  const pars = round.holes.map((h) => Number(h.par));
  const matches = playOptions(course).filter((option) => {
    const holes = buildRoundHoles(course, option, round.teeName);
    if (holes.length !== pars.length) return false;
    return holes.every((h, i) => Number(h.par) === pars[i]);
  });

  if (matches.length === 1) return { option: matches[0], status: 'exact' };
  if (matches.length > 1) return { option: null, status: 'ambiguous', candidates: matches };
  return { option: null, status: 'none', candidates: [] };
}

/** Totals for every category plus the total, as plain numbers. */
function totalsOf(round, benchmark) {
  const totals = roundTotals(round, benchmark);
  const out = { total: totals.total };
  CATEGORIES.forEach((c) => { out[c] = totals[c]; });
  return out;
}

/**
 * What repairing one round would change, without changing anything.
 *
 * Always returns a verdict. A round that cannot be repaired says why
 * rather than being dropped silently, because a repair tool that
 * quietly skips things is worse than one that refuses loudly.
 */
export function planRoundRepair(round, course, { benchmark = 'tour' } = {}) {
  const base = {
    roundId: round.id,
    player: round.player,
    date: round.date,
    courseName: round.courseName,
    teeName: round.teeName,
    holes: [],
    parMismatches: [],
    changed: false,
  };

  if (!course) {
    return { ...base, ok: false, reason: 'That course is not saved on this device.' };
  }

  const found = inferPlayOption(course, round);
  if (!found.option) {
    return {
      ...base,
      ok: false,
      reason: found.status === 'ambiguous'
        ? 'More than one layout on this course fits these pars, so which nine was played cannot be told apart.'
        : 'No layout on this course matches this round, so the pars or the tee must have changed since it was played.',
    };
  }

  const correct = buildRoundHoles(course, found.option, round.teeName);
  if (correct.some((h) => !Number.isFinite(h.yards) || h.yards <= 0)) {
    return {
      ...base,
      ok: false,
      reason: `The ${round.teeName} tee is not filled in on this course, so there is nothing to correct against.`,
    };
  }

  round.holes.forEach((hole, i) => {
    const want = correct[i];
    if (!want) return;
    if (Number(hole.yards) !== Number(want.yards)) {
      // Per-hole strokes gained is carried because the round-level
      // figure can hide the whole thing. Two holes transposed move by
      // the same amount in opposite directions and cancel exactly, so
      // a report that only showed round totals would say a real error
      // had no effect. It had an effect on both holes.
      const fixed = { ...JSON.parse(JSON.stringify(hole)), yards: Number(want.yards) };
      if (fixed.shots && fixed.shots.length) relinkHole(fixed);
      base.holes.push({
        hole: hole.hole,
        from: Number(hole.yards),
        to: Number(want.yards),
        sgBefore: holeTotals(hole, benchmark).total,
        sgAfter: holeTotals(fixed, benchmark).total,
      });
    }
    // Par is REPORTED and never rewritten. Changing par rewrites the
    // score-to-par of a round somebody actually played, and that is a
    // deliberate act, not a side effect of fixing a yardage.
    if (Number(hole.par) !== Number(want.par)) {
      base.parMismatches.push({ hole: hole.hole, from: Number(hole.par), to: Number(want.par) });
    }
  });

  if (!base.holes.length) {
    return { ...base, ok: true, changed: false, reason: 'Already matches the scorecard.' };
  }

  const after = applyRepair(round, correct);
  return {
    ...base,
    ok: true,
    changed: true,
    layout: found.option.label,
    before: totalsOf(round, benchmark),
    after: totalsOf(after, benchmark),
    repaired: after,
  };
}

/**
 * A copy of the round with the corrected yardages, relinked.
 *
 * Relinking is the whole job: it pushes the new hole yardage into the
 * first shot's starting distance and re-chains everything after it,
 * which is exactly the one value that was wrong.
 *
 * A hole with no shots on it — a score-only round — still gets its
 * yardage corrected, since the card should be right even where there
 * is nothing to recompute from it.
 */
export function applyRepair(round, correctHoles) {
  const copy = JSON.parse(JSON.stringify(round));
  copy.holes.forEach((hole, i) => {
    const want = correctHoles[i];
    if (!want) return;
    hole.yards = Number(want.yards);
    if (hole.shots && hole.shots.length) relinkHole(hole);
  });
  return copy;
}

/**
 * Plan a repair across many rounds.
 *
 * Deliberately multi-player. Three people played the same bad card,
 * and asking each of them to run this on their own phone would mean
 * two of them never did. Whoever runs it repairs every round they
 * hold and pushes them; everyone else picks the corrections up on
 * their next pull.
 *
 * That is the one place in this app where somebody writes to a round
 * they did not play, and it is worth naming as the exception it is.
 * It is safe here because the shots are untouched — only the card
 * they were played against changes, and it changes to what the course
 * record now says.
 */
export function planRepair(rounds, courseFor, {
  roundId = null,
  courseId = null,
  from = null,
  to = null,
  benchmark = 'tour',
} = {}) {
  const inScope = rounds.filter((round) => {
    if (roundId) return round.id === roundId;
    if (courseId && round.courseId !== courseId) return false;
    const day = String(round.date).slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });

  const plans = inScope
    .filter((round) => playedHoles(round).length)
    .map((round) => planRoundRepair(round, courseFor(round), { benchmark }));

  return {
    considered: inScope.length,
    plans,
    changed: plans.filter((p) => p.ok && p.changed),
    unchanged: plans.filter((p) => p.ok && !p.changed),
    blocked: plans.filter((p) => !p.ok),
  };
}

/**
 * The diff, as text. Printed to the console and shown on screen,
 * because the point is that somebody eyeballs it before trusting it.
 */
export function describePlan(result) {
  const lines = [];
  const sg = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);

  lines.push(`${result.considered} round${result.considered === 1 ? '' : 's'} in scope: `
    + `${result.changed.length} to correct, ${result.unchanged.length} already right, `
    + `${result.blocked.length} could not be read.`);

  result.changed.forEach((plan) => {
    lines.push('');
    lines.push(`${plan.player} — ${plan.courseName} ${String(plan.date).slice(0, 10)} (${plan.teeName})`);
    plan.holes.forEach((h) => lines.push(
      `  hole ${String(h.hole).padStart(2)}: ${h.from}y → ${h.to}y`
      + `   SG ${sg(h.sgBefore)} → ${sg(h.sgAfter)}  (${sg(h.sgAfter - h.sgBefore)})`
    ));

    const moved = ['total', ...CATEGORIES].filter(
      (key) => Math.abs(plan.after[key] - plan.before[key]) >= 0.005
    );
    moved.forEach((key) => {
      const delta = plan.after[key] - plan.before[key];
      lines.push(`  ${key.padEnd(5)} ${sg(plan.before[key])} → ${sg(plan.after[key])}  (${sg(delta)})`);
    });
    if (!moved.length) {
      // Worth saying out loud rather than leaving as a blank space.
      lines.push('  round totals unchanged — the holes moved by equal and opposite amounts');
    }
    plan.parMismatches.forEach((p) => lines.push(
      `  NOTE hole ${p.hole} par is ${p.from} here and ${p.to} on the course — left alone`
    ));
  });

  result.blocked.forEach((plan) => {
    lines.push('');
    lines.push(`${plan.player} — ${plan.courseName} ${String(plan.date).slice(0, 10)}: ${plan.reason}`);
  });

  return lines.join('\n');
}
