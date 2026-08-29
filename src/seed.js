/* ---------------------------------------------------------------
   seed.js — scorecards transcribed from the physical cards.

   Everything in here was read off the paper card, not looked up.
   That distinction matters: for Gardner, the published hole-by-hole
   yardages on GolfLink were wrong on all nine holes, while the total
   quoted by GolfPass happened to be right. Only `verified: true`
   cards have been checked against the card itself.

   Add one with `verified: false` if it came from the web and has not
   been proofread yet, so it is obvious which numbers to trust.
--------------------------------------------------------------- */

export const SEED_COURSES = [
  {
    id: 'seed_gardner',
    name: 'Gardner Golf Course',
    city: 'Gardner, KS',
    teeNames: ['Blue', 'White', 'Red'],
    verified: true,
    source: 'scorecard',
    nines: [
      {
        id: 'seed_gardner_main',
        name: 'Main',
        holes: [
          { hole: 1, par: 4, yards: { Blue: 398, White: 353, Red: 304 } },
          { hole: 2, par: 3, yards: { Blue: 158, White: 144, Red: 135 } },
          { hole: 3, par: 4, yards: { Blue: 421, White: 366, Red: 316 } },
          { hole: 4, par: 5, yards: { Blue: 476, White: 461, Red: 396 } },
          { hole: 5, par: 4, yards: { Blue: 383, White: 358, Red: 301 } },
          { hole: 6, par: 4, yards: { Blue: 340, White: 322, Red: 247 } },
          { hole: 7, par: 3, yards: { Blue: 140, White: 125, Red: 93 } },
          { hole: 8, par: 4, yards: { Blue: 330, White: 310, Red: 252 } },
          { hole: 9, par: 5, yards: { Blue: 510, White: 456, Red: 400 } },
        ],
      },
    ],
    // The same nine twice is how a full round here is actually played.
    combos: [
      { id: 'seed_gardner_18', name: 'Full 18', nineIds: ['seed_gardner_main', 'seed_gardner_main'] },
    ],
  },
];

/** Seed courses not already present, matched on id. */
export function missingSeeds(existing) {
  const have = new Set(existing.map((c) => c.id));
  return SEED_COURSES.filter((c) => !have.has(c.id));
}

/** Deep copy, so the seed constant is never mutated by the editor. */
export function cloneSeed(course) {
  return JSON.parse(JSON.stringify(course));
}
