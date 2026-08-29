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

  {
    id: 'seed_standrews',
    name: 'St. Andrews Golf Club',
    city: 'Overland Park, KS',
    // Gold is on the card but nobody here plays it.
    teeNames: ['Black', 'Blue', 'White'],
    verified: true,
    source: 'scorecard',
    nines: [
      {
        id: 'seed_standrews_front',
        name: 'Front',
        holes: [
          { hole: 1, par: 5, yards: { Black: 560, Blue: 518, White: 484 } },
          { hole: 2, par: 4, yards: { Black: 354, Blue: 332, White: 310 } },
          { hole: 3, par: 4, yards: { Black: 343, Blue: 313, White: 313 } },
          { hole: 4, par: 3, yards: { Black: 161, Blue: 155, White: 137 } },
          { hole: 5, par: 4, yards: { Black: 330, Blue: 323, White: 312 } },
          { hole: 6, par: 3, yards: { Black: 178, Blue: 158, White: 128 } },
          { hole: 7, par: 5, yards: { Black: 524, Blue: 503, White: 483 } },
          { hole: 8, par: 4, yards: { Black: 384, Blue: 373, White: 343 } },
          { hole: 9, par: 4, yards: { Black: 386, Blue: 368, White: 343 } },
        ],
      },
      {
        // Numbered 10-18 the way the card reads, so a shot logged on
        // the 13th says so rather than calling it the 4th.
        id: 'seed_standrews_back',
        name: 'Back',
        holes: [
          { hole: 10, par: 5, yards: { Black: 577, Blue: 541, White: 517 } },
          { hole: 11, par: 4, yards: { Black: 384, Blue: 358, White: 311 } },
          { hole: 12, par: 3, yards: { Black: 168, Blue: 155, White: 144 } },
          { hole: 13, par: 4, yards: { Black: 328, Blue: 304, White: 284 } },
          // 14 really is 158 from both Blue and White — checked twice.
          { hole: 14, par: 3, yards: { Black: 178, Blue: 158, White: 158 } },
          { hole: 15, par: 5, yards: { Black: 498, Blue: 474, White: 444 } },
          { hole: 16, par: 4, yards: { Black: 419, Blue: 391, White: 365 } },
          { hole: 17, par: 3, yards: { Black: 193, Blue: 174, White: 150 } },
          { hole: 18, par: 4, yards: { Black: 397, Blue: 388, White: 372 } },
        ],
      },
    ],
    combos: [
      {
        id: 'seed_standrews_18',
        name: 'Front / Back',
        nineIds: ['seed_standrews_front', 'seed_standrews_back'],
      },
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
