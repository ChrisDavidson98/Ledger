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

  {
    // Transcribed from the 2024 Overland Park scorecard PDF rather
    // than a golf directory, so all five tee complexes are included
    // even though the three of us stick to Black/Blue/White.
    id: 'seed_sykes',
    name: 'Sykes/Lady Overland Park',
    city: 'Overland Park, KS',
    teeNames: ['Black', 'Blue', 'White', 'Gold', 'Red'],
    verified: true,
    source: 'scorecard',
    nines: [
      {
        id: 'seed_sykes_west',
        name: 'West Links',
        holes: [
          { hole: 1, par: 5, yards: { Black: 550, Blue: 507, White: 479, Gold: 399, Red: 358 } },
          { hole: 2, par: 4, yards: { Black: 341, Blue: 331, White: 330, Gold: 271, Red: 240 } },
          { hole: 3, par: 3, yards: { Black: 156, Blue: 147, White: 140, Gold: 128, Red: 123 } },
          { hole: 4, par: 4, yards: { Black: 380, Blue: 367, White: 355, Gold: 293, Red: 265 } },
          { hole: 5, par: 3, yards: { Black: 208, Blue: 180, White: 169, Gold: 137, Red: 103 } },
          { hole: 6, par: 4, yards: { Black: 435, Blue: 412, White: 378, Gold: 342, Red: 306 } },
          { hole: 7, par: 3, yards: { Black: 177, Blue: 151, White: 147, Gold: 125, Red: 120 } },
          { hole: 8, par: 4, yards: { Black: 401, Blue: 363, White: 333, Gold: 272, Red: 224 } },
          { hole: 9, par: 5, yards: { Black: 540, Blue: 495, White: 463, Gold: 427, Red: 368 } },
        ],
      },
      {
        // South's par row was the one line that would not come out of
        // the PDF cleanly; these pars are read off the yardages and
        // are the only numbers here not taken straight from the card.
        id: 'seed_sykes_south',
        name: 'South Links',
        holes: [
          { hole: 1, par: 5, yards: { Black: 517, Blue: 517, White: 509, Gold: 467, Red: 331 } },
          { hole: 2, par: 3, yards: { Black: 150, Blue: 147, White: 136, Gold: 129, Red: 126 } },
          { hole: 3, par: 4, yards: { Black: 384, Blue: 374, White: 359, Gold: 235, Red: 225 } },
          { hole: 4, par: 4, yards: { Black: 431, Blue: 402, White: 350, Gold: 310, Red: 305 } },
          { hole: 5, par: 3, yards: { Black: 153, Blue: 150, White: 143, Gold: 133, Red: 130 } },
          { hole: 6, par: 5, yards: { Black: 543, Blue: 541, White: 531, Gold: 510, Red: 303 } },
          { hole: 7, par: 4, yards: { Black: 389, Blue: 382, White: 372, Gold: 362, Red: 314 } },
          { hole: 8, par: 3, yards: { Black: 177, Blue: 169, White: 147, Gold: 113, Red: 109 } },
          { hole: 9, par: 4, yards: { Black: 397, Blue: 378, White: 330, Gold: 215, Red: 207 } },
        ],
      },
      {
        id: 'seed_sykes_north',
        name: 'North Links',
        holes: [
          { hole: 1, par: 4, yards: { Black: 366, Blue: 355, White: 332, Gold: 299, Red: 277 } },
          { hole: 2, par: 3, yards: { Black: 191, Blue: 189, White: 167, Gold: 134, Red: 107 } },
          { hole: 3, par: 4, yards: { Black: 420, Blue: 405, White: 359, Gold: 286, Red: 238 } },
          { hole: 4, par: 4, yards: { Black: 404, Blue: 383, White: 370, Gold: 303, Red: 273 } },
          { hole: 5, par: 4, yards: { Black: 377, Blue: 356, White: 343, Gold: 290, Red: 238 } },
          { hole: 6, par: 5, yards: { Black: 535, Blue: 526, White: 517, Gold: 411, Red: 357 } },
          { hole: 7, par: 3, yards: { Black: 162, Blue: 151, White: 140, Gold: 118, Red: 106 } },
          { hole: 8, par: 4, yards: { Black: 436, Blue: 402, White: 363, Gold: 341, Red: 209 } },
          { hole: 9, par: 4, yards: { Black: 383, Blue: 344, White: 326, Gold: 308, Red: 280 } },
        ],
      },
    ],
    // The three pairings the course actually sells, confirmed by the
    // rating table on the card.
    combos: [
      { id: 'seed_sykes_sn', name: 'South / North', nineIds: ['seed_sykes_south', 'seed_sykes_north'] },
      { id: 'seed_sykes_nw', name: 'North / West', nineIds: ['seed_sykes_north', 'seed_sykes_west'] },
      { id: 'seed_sykes_ws', name: 'West / South', nineIds: ['seed_sykes_west', 'seed_sykes_south'] },
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
