/* ---------------------------------------------------------------
   import.js — bring a scorecard in from text.

   The workflow this exists for: photograph the card in the cart,
   hand the photo to any chat with the prompt below, paste what comes
   back. That beats an in-app lookup on every axis that matters —
   no API key, no proxy, no rate limit, and the numbers are on screen
   to check before anything is saved.

   The format is deliberately flat and forgiving, because it has to
   survive being produced by a model reading a photo at arm's length
   in a golf cart.
--------------------------------------------------------------- */

/** Paste this into a chat along with a photo of the scorecard. */
export const EXTRACTION_PROMPT = `Read this golf scorecard photo and return ONLY a JSON object, no commentary and no markdown fences, in exactly this shape:

{
  "name": "Course name",
  "city": "Town, ST",
  "tees": ["Black", "Blue", "White"],
  "nines": [
    {
      "name": "Front",
      "pars":  [4,4,3,5,4,4,3,4,5],
      "yards": {
        "Black": [400,410,170,520,390,380,160,400,510],
        "Blue":  [380,390,155,500,370,360,145,380,490],
        "White": [350,360,140,470,340,330,130,350,460]
      }
    }
  ],
  "combos": [["Front","Back"]]
}

Rules:
- One entry in "nines" per nine holes on the card. A standard 18-hole course has two ("Front" and "Back"). A 9-hole course has one. A 27-hole facility has three, named as the card names them.
- Every "pars" array and every array inside "yards" must have exactly 9 numbers, in hole order.
- "tees" lists the tee names exactly as printed. Include every tee on the card.
- "combos" lists which nines are played together as an 18. For a 9-hole course played twice, use [["Front","Front"]] with your single nine's name. Use [] if there is only ever one nine played once.
- Numbers only — no yard suffixes, no quotes around numbers.
- If a number is unreadable, use null rather than guessing.`;

/**
 * Parse pasted text into the internal course shape.
 * Throws with a message meant to be read by a person, not logged.
 */
export function parseCourseText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Nothing pasted.');

  // Tolerate markdown fences and any chatter around the JSON.
  const cleaned = trimmed.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in that text.');

  let raw;
  try {
    raw = JSON.parse(cleaned.slice(start, end + 1));
  } catch (err) {
    throw new Error('That is not valid JSON. ' + err.message);
  }

  return normalizeCourse(raw);
}

let counter = 0;
function makeId(prefix) {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

export function normalizeCourse(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Expected a JSON object.');
  if (!raw.name) throw new Error('Missing "name".');

  const tees = Array.isArray(raw.tees) ? raw.tees.map(String).filter(Boolean) : [];
  if (!tees.length) throw new Error('Missing "tees" — needs at least one tee name.');

  if (!Array.isArray(raw.nines) || !raw.nines.length) {
    throw new Error('Missing "nines" — needs at least one nine.');
  }

  const problems = [];
  const nines = raw.nines.map((nine, index) => {
    const label = nine.name || `Nine ${index + 1}`;

    if (!Array.isArray(nine.pars) || nine.pars.length !== 9) {
      problems.push(`${label}: "pars" must have exactly 9 numbers.`);
    }

    const holes = [];
    for (let i = 0; i < 9; i++) {
      const yards = {};
      tees.forEach((tee) => {
        const row = nine.yards ? nine.yards[tee] : null;
        if (!Array.isArray(row)) {
          if (i === 0) problems.push(`${label}: no yardages for the ${tee} tee.`);
          return;
        }
        if (row.length !== 9 && i === 0) {
          problems.push(`${label} ${tee}: ${row.length} yardages, expected 9.`);
        }
        const value = row[i];
        yards[tee] = value == null ? '' : Number(value);
      });
      holes.push({
        hole: i + 1,
        par: Number((nine.pars || [])[i]) || 4,
        yards,
      });
    }

    return { id: makeId('n'), name: String(label), holes };
  });

  if (problems.length) throw new Error(problems.slice(0, 3).join(' '));

  // Combos arrive as pairs of nine NAMES; store them as pairs of ids.
  const byName = new Map(nines.map((n) => [n.name.toLowerCase(), n.id]));
  const combos = [];
  (Array.isArray(raw.combos) ? raw.combos : []).forEach((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2) return;
    const first = byName.get(String(pair[0]).toLowerCase());
    const second = byName.get(String(pair[1]).toLowerCase());
    if (!first || !second) return;
    combos.push({
      id: makeId('k'),
      name: `${pair[0]} / ${pair[1]}`,
      nineIds: [first, second],
    });
  });

  // A single nine with no stated pairing is almost always played twice.
  if (!combos.length && nines.length === 1) {
    combos.push({
      id: makeId('k'),
      name: 'Full 18',
      nineIds: [nines[0].id, nines[0].id],
    });
  }

  return {
    id: makeId('c'),
    name: String(raw.name),
    city: raw.city ? String(raw.city) : '',
    teeNames: tees,
    nines,
    combos,
    // Imported, not read off paper by a human — so not verified until
    // somebody checks it in the editor.
    verified: false,
    source: 'import',
    createdAt: new Date().toISOString(),
  };
}

/** Render a stored course back out in the paste format. */
export function courseToText(course) {
  return JSON.stringify({
    name: course.name,
    city: course.city || '',
    tees: course.teeNames,
    nines: course.nines.map((nine) => {
      const yards = {};
      course.teeNames.forEach((tee) => {
        yards[tee] = nine.holes.map((hole) => Number(hole.yards[tee]) || null);
      });
      return {
        name: nine.name,
        pars: nine.holes.map((hole) => Number(hole.par)),
        yards,
      };
    }),
    combos: (course.combos || []).map((combo) =>
      combo.nineIds.map((id) => {
        const nine = course.nines.find((n) => n.id === id);
        return nine ? nine.name : '?';
      })
    ),
  }, null, 2);
}

/** A short summary to show before anything is written to storage. */
export function describeCourse(course) {
  return {
    name: course.name,
    city: course.city,
    nines: course.nines.map((nine) => ({
      name: nine.name,
      par: nine.holes.reduce((sum, h) => sum + h.par, 0),
      totals: course.teeNames.map((tee) => ({
        tee,
        yards: nine.holes.reduce((sum, h) => sum + (Number(h.yards[tee]) || 0), 0),
      })),
    })),
    combos: (course.combos || []).map((c) => c.name),
  };
}
