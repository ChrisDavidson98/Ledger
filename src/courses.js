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

export function findPlayOption(course, key) {
  return playOptions(course).find((o) => o.key === key) || null;
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

export function listCourses() {
  return getCourses().slice().sort((a, b) => a.name.localeCompare(b.name));
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
