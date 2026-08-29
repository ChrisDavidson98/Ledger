/* ---------------------------------------------------------------
   courses.js — course records.

   A course holds the WHOLE scorecard grid: every tee set, all 18
   holes. That way looking a course up (or typing it in) once covers
   playing it from any tee, forever. The Phase 3 lookup writes into
   this same shape as a fallback for courses not already stored.
--------------------------------------------------------------- */

import { getCourses, saveCourse } from './storage.js';

/** Common par layout, used to seed a new course so you only edit exceptions. */
const DEFAULT_PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];

function defaultYards(par) {
  if (par === 3) return 160;
  if (par === 5) return 510;
  return 380;
}

export function blankTee(name = 'White') {
  return {
    name,
    holes: DEFAULT_PARS.map((par, i) => ({
      hole: i + 1,
      par,
      yards: defaultYards(par),
    })),
  };
}

export function newCourse(name) {
  return {
    id: 'c_' + Date.now().toString(36),
    name: name || 'New Course',
    tees: [blankTee()],
    verified: false,
    source: 'manual',
    createdAt: new Date().toISOString(),
  };
}

export function teeNames(course) {
  return (course.tees || []).map((t) => t.name);
}

export function findTee(course, teeName) {
  return (course.tees || []).find((t) => t.name === teeName) || course.tees[0];
}

export function teeYardage(tee) {
  return tee.holes.reduce((sum, h) => sum + (Number(h.yards) || 0), 0);
}

export function teePar(tee) {
  return tee.holes.reduce((sum, h) => sum + (Number(h.par) || 0), 0);
}

/** Courses sorted by name, for pickers. */
export function listCourses() {
  return getCourses().slice().sort((a, b) => a.name.localeCompare(b.name));
}

export function upsertCourse(course) {
  saveCourse(course);
  return course;
}

/**
 * Validate a scorecard before it can start a round. Catches the
 * transcription slips that would otherwise silently corrupt every
 * strokes-gained number computed from this course.
 */
export function validateTee(tee) {
  const problems = [];
  if (!tee.holes || tee.holes.length !== 18) {
    problems.push('Needs all 18 holes.');
    return problems;
  }
  tee.holes.forEach((h) => {
    if (![3, 4, 5, 6].includes(Number(h.par))) {
      problems.push(`Hole ${h.hole}: par ${h.par} looks wrong.`);
    }
    const y = Number(h.yards);
    if (!y || y < 60 || y > 700) {
      problems.push(`Hole ${h.hole}: ${h.yards} yards looks wrong.`);
    }
  });
  const par = teePar(tee);
  if (par < 66 || par > 76) {
    problems.push(`Total par of ${par} looks wrong.`);
  }
  return problems;
}
