/* ---------------------------------------------------------------
   courses.js — course records.

   A course is a facility made of NINES, not an 18-hole block. That
   is what the courses around here actually are:

     Gardner      one nine, played twice for a full round
     St Andrews   two nines
     Sykes/Lady   three nines, played as any of three pairings

   Modelling 18 holes as the unit could not represent Gardner at all
   and would have stored Sykes/Lady three times over. Nines also make
   a 9-hole weekday round a first-class thing rather than an eighteen
   somebody abandoned.

   Yardages hang off each hole keyed by tee name, which is the shape a
   paper scorecard already has: holes across, tees down.
--------------------------------------------------------------- */

import { getCourses, saveCourse } from './storage.js';

const DEFAULT_TEES = ['Blue', 'White', 'Red'];
const DEFAULT_PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5];

let idCounter = 0;
function makeId(prefix) {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function blankNine(name = 'Main', teeNames = DEFAULT_TEES) {
  return {
    id: makeId('n'),
    name,
    holes: DEFAULT_PARS.map((par, i) => {
      const yards = {};
      teeNames.forEach((tee) => { yards[tee] = par === 3 ? 160 : par === 5 ? 500 : 370; });
      return { hole: i + 1, par, yards };
    }),
  };
}

export function newCourse(name = '') {
  const nine = blankNine('Main');
  return {
    id: makeId('c'),
    name,
    city: '',
    teeNames: [...DEFAULT_TEES],
    nines: [nine],
    combos: defaultCombos([nine]),
    verified: false,
    source: 'manual',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Sensible 18-hole pairings. One nine pairs with itself, two nines
 * pair with each other. Three or more is genuinely ambiguous — Sykes
 * plays three of the six possible orderings — so those get added by
 * hand rather than guessed at.
 */
export function defaultCombos(nines) {
  if (nines.length === 1) {
    return [{ id: makeId('k'), name: 'Full 18', nineIds: [nines[0].id, nines[0].id] }];
  }
  if (nines.length === 2) {
    return [{
      id: makeId('k'),
      name: `${nines[0].name} / ${nines[1].name}`,
      nineIds: [nines[0].id, nines[1].id],
    }];
  }
  return [];
}

export function newCombo(course, firstId, secondId) {
  const first = findNine(course, firstId);
  const second = findNine(course, secondId);
  return {
    id: makeId('k'),
    name: `${first ? first.name : '?'} / ${second ? second.name : '?'}`,
    nineIds: [firstId, secondId],
  };
}

export function findNine(course, nineId) {
  return (course.nines || []).find((n) => n.id === nineId) || null;
}

export function ninePar(nine) {
  return nine.holes.reduce((sum, h) => sum + (Number(h.par) || 0), 0);
}

export function nineYardage(nine, teeName) {
  return nine.holes.reduce((sum, h) => sum + (Number(h.yards[teeName]) || 0), 0);
}

/* --- What you can actually go and play --------------------------- */

/**
 * Every playable configuration: each nine on its own, plus each
 * defined 18-hole pairing.
 */
export function playOptions(course) {
  const options = [];

  (course.nines || []).forEach((nine) => {
    options.push({
      key: `n:${nine.id}`,
      label: nine.name,
      holeCount: 9,
      nineIds: [nine.id],
    });
  });

  (course.combos || []).forEach((combo) => {
    if (!combo.nineIds.every((id) => findNine(course, id))) return;
    options.push({
      key: `k:${combo.id}`,
      label: combo.name,
      holeCount: 18,
      nineIds: combo.nineIds,
    });
  });

  return options;
}

const BACK_FIRST = ':back';

/**
 * The same eighteen played second nine first: a frost delay thaws the
 * 10th before the 1st, or the starter sends a group off the back. Not
 * a pairing of its own, so nobody has to set one up per course; the
 * key carries a suffix, which is all a tee time needs to sync it.
 */
export function backFirstOption(option) {
  if (!option || option.nineIds.length !== 2 || option.backFirst) return null;
  return {
    ...option,
    key: option.key + BACK_FIRST,
    label: `${option.label} (back nine first)`,
    nineIds: option.nineIds.slice().reverse(),
    backFirst: true,
  };
}

export function findPlayOption(course, key) {
  const k = String(key || '');
  if (k.endsWith(BACK_FIRST)) {
    return backFirstOption(findPlayOption(course, k.slice(0, -BACK_FIRST.length)));
  }
  return playOptions(course).find((o) => o.key === k) || null;
}

/**
 * Every layout a finished round could have been played on, back-first
 * eighteens after the rest so a layout listed in its own right still
 * wins when both orders happen to fit.
 */
export function layoutCandidates(course) {
  const options = playOptions(course);
  return options.concat(options.map(backFirstOption).filter(Boolean));
}

/**
 * Flatten a play option into the hole list a round needs, numbered
 * continuously. `sourceNine` and `sourceHole` are kept so a round on
 * the same nine twice can still say which physical hole it was.
 */
export function buildRoundHoles(course, option, teeName) {
  const holes = [];
  option.nineIds.forEach((nineId) => {
    const nine = findNine(course, nineId);
    if (!nine) return;
    nine.holes.forEach((hole) => {
      holes.push({
        hole: holes.length + 1,
        par: Number(hole.par),
        yards: Number(hole.yards[teeName]),
        sourceNine: nine.name,
        sourceHole: hole.hole,
      });
    });
  });
  return holes;
}

export function totalYards(course, option, teeName) {
  return buildRoundHoles(course, option, teeName)
    .reduce((sum, h) => sum + (h.yards || 0), 0);
}

export function totalPar(course, option, teeName) {
  return buildRoundHoles(course, option, teeName)
    .reduce((sum, h) => sum + (h.par || 0), 0);
}

/* --- Storage ----------------------------------------------------- */

/**
 * Every stored course, repaired into a shape the screens can render.
 *
 * A course arriving from the sheet, an import, or an older version of
 * this app may be missing fields the templates assume. One malformed
 * record used to throw partway through building the list, which left
 * the whole screen stale — courses that were still in storage looked
 * like they had been deleted. Nothing is dropped here; it is only
 * padded out so it can be seen and fixed.
 */
export function listCourses() {
  return getCourses()
    .map(repairCourse)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function repairCourse(course) {
  const nines = Array.isArray(course.nines) ? course.nines : [];
  const teeNames = Array.isArray(course.teeNames) && course.teeNames.length
    ? course.teeNames
    // Fall back to whatever tee names the holes themselves mention.
    : [...new Set(nines.flatMap((n) => (n.holes || []).flatMap((h) => Object.keys(h.yards || {}))))];

  return {
    ...course,
    name: course.name == null ? 'Untitled course' : String(course.name),
    city: course.city == null ? '' : String(course.city),
    teeNames: teeNames.length ? teeNames : ['White'],
    nines: nines.map((nine) => ({
      ...nine,
      name: nine.name == null ? 'Nine' : String(nine.name),
      holes: Array.isArray(nine.holes) ? nine.holes.map((h) => ({
        ...h,
        yards: h.yards && typeof h.yards === 'object' ? h.yards : {},
      })) : [],
    })),
    combos: Array.isArray(course.combos) ? course.combos : [],
  };
}

/** True when a course is missing something the screens need. */
export function isIncomplete(course) {
  return !Array.isArray(course.nines) || !course.nines.length
    || !Array.isArray(course.teeNames) || !course.teeNames.length;
}

export function upsertCourse(course) {
  saveCourse(course);
  return course;
}

/* --- Duplicate detection ------------------------------------------ */

/**
 * A fingerprint of the actual holes: pars plus every tee's yardages.
 * Tees are sorted by name so two people entering the same card in a
 * different tee order still match, and the course name is ignored
 * entirely — "Gardner GC" and "Gardner Golf Course" are the same 3,156
 * yards either way.
 */
export function nineFingerprint(nine, teeNames) {
  const pars = nine.holes.map((h) => Number(h.par) || 0).join(',');
  const tees = [...teeNames].sort().map((tee) => {
    const yards = nine.holes.map((h) => Number(h.yards[tee]) || 0).join(',');
    return `${tee}:${yards}`;
  }).join('|');
  return `${pars}#${tees}`;
}

/** Order-insensitive fingerprint of every nine at a course. */
export function courseFingerprint(course) {
  return (course.nines || [])
    .map((nine) => nineFingerprint(nine, course.teeNames || []))
    .sort()
    .join('||');
}

/**
 * Look for an existing course that is the same card. Returns an exact
 * hole-for-hole match if there is one, otherwise a name collision,
 * so the two cases can be reported differently — one is a duplicate,
 * the other is probably a correction.
 */
export function findDuplicate(course, existing = getCourses()) {
  const print = courseFingerprint(course);
  const others = existing.filter((c) => c.id !== course.id);

  const identical = others.find((c) => courseFingerprint(c) === print);
  if (identical) return { kind: 'identical', course: identical };

  const sameName = others.find(
    (c) => c.name.trim().toLowerCase() === String(course.name).trim().toLowerCase()
  );
  if (sameName) return { kind: 'name', course: sameName };

  return null;
}

/* --- Validation --------------------------------------------------- */

/**
 * Catches the transcription slips that would quietly corrupt every
 * strokes-gained number computed from this card.
 */
export function validateNine(nine, teeName) {
  const problems = [];
  if (!nine.holes || nine.holes.length !== 9) {
    problems.push(`${nine.name}: needs 9 holes.`);
    return problems;
  }

  nine.holes.forEach((hole) => {
    if (![3, 4, 5, 6].includes(Number(hole.par))) {
      problems.push(`${nine.name} hole ${hole.hole}: par ${hole.par} looks wrong.`);
    }
    const yards = Number(hole.yards[teeName]);
    if (!yards || yards < 60 || yards > 700) {
      problems.push(`${nine.name} hole ${hole.hole}: ${hole.yards[teeName] || 'no'} yards from ${teeName}.`);
    }
  });

  const par = ninePar(nine);
  if (par < 30 || par > 40) {
    problems.push(`${nine.name}: total par of ${par} looks wrong.`);
  }
  return problems;
}

export function validateCourse(course, teeName) {
  const problems = [];
  if (!course.name || !course.name.trim()) problems.push('Course needs a name.');
  (course.nines || []).forEach((nine) => {
    problems.push(...validateNine(nine, teeName));
  });
  return problems;
}

/** Add or remove a tee across every nine at once. */
export function addTee(course, teeName) {
  const name = teeName.trim();
  if (!name || course.teeNames.includes(name)) return course;
  course.teeNames.push(name);
  course.nines.forEach((nine) => {
    nine.holes.forEach((hole) => {
      if (hole.yards[name] == null) hole.yards[name] = '';
    });
  });
  return course;
}

export function removeTee(course, teeName) {
  if (course.teeNames.length <= 1) return course;
  course.teeNames = course.teeNames.filter((t) => t !== teeName);
  course.nines.forEach((nine) => {
    nine.holes.forEach((hole) => { delete hole.yards[teeName]; });
  });
  return course;
}

export function addNine(course, name) {
  const nine = blankNine(name || `Nine ${course.nines.length + 1}`, course.teeNames);
  course.nines.push(nine);
  if (course.nines.length === 2 && course.combos.length === 0) {
    course.combos = defaultCombos(course.nines);
  }
  return nine;
}

/* --- Sanity warnings ---------------------------------------------
   validateNine above decides whether a card can be SAVED. This is a
   softer pass that decides whether it looks believable, and it warns
   without ever blocking — real courses have a 93 yard par 3 and a 215
   yard par 4, and an editor that refused them would be wrong more
   often than the person typing.

   It exists because a par 4 was entered at 530 yards and a par 5 at
   306, the two having been transposed. Nothing objected, three people
   played the round against it, and the mistake only surfaced later in
   the strokes gained. A line reading "hole 8: 530y is unusual for a
   par 4" at the moment of typing would have cost nothing.

   TWO THINGS WERE TRIED AND DROPPED, both because they fired on cards
   known to be correct. Tight length bands flagged Gardner's forward
   tees, where a 93 yard par 3 and a 396 yard par 5 are both real. And
   duplicate yardages — proposed for catching a half-edited copy —
   turned out to be ordinary: St Andrews has two holes at 343 yards in
   the same nine off the same tee. Worse, a duplicate check cannot see
   a transposition at all, since swapping two numbers leaves the same
   set of numbers. A warning that cries wolf on a correct card is worse
   than no warning, because by the time it matters nobody reads it.
------------------------------------------------------------------ */

/* Deliberately loose. These are the bounds outside which a number is
   more likely to be a typo than a golf hole, not the bounds of what a
   golf hole can be — every one of them was widened after a seeded
   card, transcribed from paper, walked into it. */
const PLAUSIBLE = {
  3: { min: 70, max: 280 },
  4: { min: 200, max: 520 },
  5: { min: 290, max: 700 },
  6: { min: 500, max: 800 },
};

const ABSURD = { min: 60, max: 750 };

/*
 * How far a shorter-par hole has to out-measure a longer-par one
 * before it is worth mentioning.
 *
 * A small overlap is ordinary — Sykes off the Red tees has a 314 yard
 * par 4 and a 303 yard par 5, and both are correct. A swap is not
 * small: the transposition that prompted all this left a 530 yard par
 * 4 against a 306 yard par 5, an overlap of 224. Requiring a real gap
 * keeps the check silent on short forward tees, where par 4s and par
 * 5s genuinely run into each other.
 */
const SWAP_MARGIN = 50;

/**
 * Everything questionable about one tee's yardages, as sentences.
 *
 * The strongest signal here is the last one, and it is the one that
 * would actually have caught this: a par 4 longer than a par 5 on the
 * same card. Absolute bands have to stay loose enough for forward
 * tees, which blunts them; the comparison between pars does not,
 * because whatever the tee, the par 5s are the long holes. That is
 * exactly the shape a transposition leaves behind.
 */
export function yardageWarnings(course, teeName) {
  const warnings = [];
  const byPar = { 3: [], 4: [], 5: [], 6: [] };

  (course.nines || []).forEach((nine) => {
    (nine.holes || []).forEach((hole) => {
      const yards = Number(hole.yards ? hole.yards[teeName] : NaN);
      if (!Number.isFinite(yards) || yards <= 0) return;
      const par = Number(hole.par);
      const where = `${nine.name} hole ${hole.hole}`;
      if (byPar[par]) byPar[par].push({ where, yards });

      if (yards < ABSURD.min || yards > ABSURD.max) {
        warnings.push(`${where}: ${yards}y is not a length a golf hole comes in — check it.`);
        return;
      }

      const band = PLAUSIBLE[par];
      if (band && (yards < band.min || yards > band.max)) {
        warnings.push(`${where}: ${yards}y is unusual for a par ${par} — check this.`);
      }
    });
  });

  // A par 4 longer than a par 5 off the same tee. Rare enough on a
  // real card to be worth saying every time, and the precise shape
  // left behind when two holes get swapped.
  [[4, 5], [3, 4]].forEach(([shorter, longer]) => {
    if (!byPar[shorter].length || !byPar[longer].length) return;
    const longest = byPar[shorter].reduce((a, b) => (a.yards > b.yards ? a : b));
    const shortest = byPar[longer].reduce((a, b) => (a.yards < b.yards ? a : b));
    if (longest.yards > shortest.yards + SWAP_MARGIN) {
      warnings.push(
        `${longest.where} is a ${longest.yards}y par ${shorter}, longer than `
        + `${shortest.where} at ${shortest.yards}y for a par ${longer} — check whether these two are the right way round.`
      );
    }
  });

  return warnings;
}
