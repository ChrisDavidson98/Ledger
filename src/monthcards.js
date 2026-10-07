/* ---------------------------------------------------------------
   monthcards.js — the month as a set of images, one finding each.

   Drawn on a canvas like the round recap and for the same reasons:
   it works with no signal, and it needs nothing installed. The same
   light paper, the same type, so a month and a round sent to the same
   chat read as the same notebook. Nothing here works anything out —
   every figure comes from buildRecap in monthly.js.
--------------------------------------------------------------- */

import { CATEGORIES, CATEGORY_LABELS } from './baseline.js';
import {
  C as LIGHT, DARK, W, H, PAD, SERIF, MONO, SANS, eyebrow as paperEyebrow, rule, fitFont, loadFonts, fmtSG,
} from './recap.js';
import { signed } from './monthly.js';

let C = LIGHT;

/** The shared label, in whichever palette is being drawn. */
function eyebrow(ctx, text, x, y, colour = C.soft, align = 'left', size = 22) {
  paperEyebrow(ctx, text, x, y, colour, align, size);
}

const CARD_LABELS = {
  cover: 'Monthly recap',
  sg: 'Strokes gained',
  leak: 'Biggest leak',
  strength: 'Strength',
  penalties: 'Penalties',
  mom: 'Month over month',
  focus: 'Next month',
};

const FOOT = H - 110;

/** Near enough to the benchmark that colouring it would overstate it. */
function tone(v, thin = false) {
  if (thin) return C.faint;
  if (v >= 0.05) return C.gain;
  if (v <= -0.05) return C.loss;
  return C.soft;
}

function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  String(text).split(/\s+/).forEach((word) => {
    const trial = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(trial).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = trial;
    }
  });
  if (line) lines.push(line);
  return lines;
}

/**
 * A wrapped block of text, shrunk until it fits the lines it is given
 * rather than cut off. Returns the y just under its last line.
 */
function block(ctx, text, y, {
  size = 64, min = 36, maxLines = 3, style = '400', family = SERIF, colour = C.ink, leading = 1.14,
} = {}) {
  let s = size;
  let lines;
  do {
    ctx.font = `${style} ${s}px ${family}`;
    lines = wrap(ctx, text, W - PAD * 2);
    if (lines.length <= maxLines) break;
    s -= 2;
  } while (s > min);
  ctx.fillStyle = colour;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  lines.forEach((line, i) => ctx.fillText(line, PAD, y + i * s * leading));
  return y + (lines.length - 1) * s * leading + s * 0.3;
}

/** A bar off a zero line, the zero drawn so a short bar reads as "about level". */
function zeroBar(ctx, left, right, mid, value, scale, colour, height = 18) {
  const zeroX = (left + right) / 2;
  const half = (right - left) / 2 - 6;
  ctx.fillStyle = C.ink;
  ctx.fillRect(zeroX - 1, mid - height - 6, 2, height * 2 + 12);
  const len = Math.min(1, Math.abs(value) / scale) * half;
  ctx.fillStyle = colour;
  ctx.fillRect(value >= 0 ? zeroX + 1 : zeroX - 1 - len, mid - height / 2, Math.max(len, 3), height);
}

/** Which side of the zero is which, said once above a column of bars. */
function zeroKey(ctx, left, right, y) {
  const zeroX = (left + right) / 2;
  eyebrow(ctx, 'costing', zeroX - 14, y, C.loss, 'right', 18);
  eyebrow(ctx, 'gaining', zeroX + 14, y, C.gain, 'left', 18);
}

function text(ctx, value, x, y, font, colour, align = 'left', baseline = 'alphabetic') {
  ctx.font = font;
  ctx.fillStyle = colour;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(value, x, y);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function triangle(ctx, x, y, up, colour, size = 13) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(x - size, y + (up ? size * 0.7 : -size * 0.7));
  ctx.lineTo(x + size, y + (up ? size * 0.7 : -size * 0.7));
  ctx.lineTo(x, y + (up ? -size * 0.9 : size * 0.9));
  ctx.closePath();
  ctx.fill();
}

function shortDay(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Paper, masthead and footer: the part every card shares. */
function frame(ctx, recap, key, handle) {
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.grid;
  for (let x = 0; x < W; x += 36) ctx.fillRect(x, 0, 2, H);
  for (let y = 0; y < H; y += 36) ctx.fillRect(0, y, W, 2);

  text(ctx, 'Ledger', PAD, 132, `400 88px ${SERIF}`, C.ink);
  const word = ctx.measureText('Ledger').width;
  text(ctx, '.', PAD + word, 132, `400 88px ${SERIF}`, C.loss);
  eyebrow(ctx, CARD_LABELS.cover, W - PAD, 124, C.soft, 'right');
  rule(ctx, 162, C.ink, 4);

  rule(ctx, FOOT, C.ink, 3);
  eyebrow(ctx, `Ledger · ${recap.player} · ${recap.monthLabel}`, PAD, H - 58, C.soft);
  if (handle) eyebrow(ctx, handle, W - PAD - 48, H - 58, C.faint, 'right');
  ctx.fillStyle = C.loss;
  ctx.fillRect(W - PAD - 26, H - 92, 4, 44);
  ctx.beginPath();
  ctx.moveTo(W - PAD - 22, H - 92);
  ctx.lineTo(W - PAD + 4, H - 83);
  ctx.lineTo(W - PAD - 22, H - 74);
  ctx.closePath();
  ctx.fill();
  return key;
}

/** The label and the finding: what every card after the cover opens with. */
function opening(ctx, label, sentence) {
  eyebrow(ctx, label, PAD, 228);
  return block(ctx, sentence, 306, { size: 62, maxLines: 4 });
}

/** A ruled row: a name on the left, a figure on the right. */
function ruledRow(ctx, top, height, name, value, colour = C.ink, sub = '') {
  const mid = top + height / 2;
  text(ctx, name, PAD, sub ? mid - 12 : mid, `500 34px ${SANS}`, C.ink, 'left', 'middle');
  if (sub) eyebrow(ctx, sub, PAD, mid + 32, C.faint, 'left', 18);
  text(ctx, value, W - PAD, mid, `600 34px ${MONO}`, colour, 'right', 'middle');
  rule(ctx, top + height, C.rule, 2);
}

const CARDS = {
  cover(ctx, recap) {
    const { cover, sg } = recap;
    eyebrow(ctx, `Strokes gained vs ${recap.benchLabel}`, PAD, 228);
    ctx.fillStyle = C.ink;
    fitFont(ctx, recap.monthLabel, '400', 132, SERIF, W - PAD * 2);
    ctx.fillText(recap.monthLabel, PAD - 4, 358);
    text(ctx, recap.player, PAD, 446, `italic 400 76px ${SERIF}`, C.soft);

    let y = 500;
    rule(ctx, y, C.ink, 3);
    const scoring = Math.abs(cover.toParPer18) < 0.05 ? 'E' : signed(cover.toParPer18);
    const rows = [
      ['Rounds', String(cover.rounds), C.ink,
        cover.shotRounds < cover.rounds ? `${cover.rounds - cover.shotRounds} score only` : ''],
      ['Holes', String(cover.holes), C.ink, ''],
      ['To par, per 18', scoring, C.ink, ''],
    ];
    if (sg) rows.push(['Strokes gained, per 18', signed(sg.per18.total), tone(sg.per18.total), `over ${sg.holes} holes with shots`]);
    rows.push(['Measured against', recap.benchLabel, C.ink, '']);
    if (cover.playsLike) rows.push(['Plays like', cover.playsLike, C.ink, 'handicap · recent rounds']);
    const rowH = rows.length > 5 ? 90 : 104;
    rows.forEach(([name, value, colour, sub]) => {
      ruledRow(ctx, y, rowH, name, value, colour, sub);
      y += rowH;
    });

    block(ctx, recap.captions.cover, y + 84, { size: 46, style: 'italic 400', colour: C.soft, maxLines: 2 });
  },

  sg(ctx, recap) {
    const { sg } = recap;
    let y = Math.max(opening(ctx, 'Strokes gained per 18', recap.captions.sg) + 70, 560);

    const rowH = 112;
    const barLeft = PAD + 300;
    const barRight = W - PAD - 170;
    const scale = Math.max(2, ...CATEGORIES.map((c) => Math.abs(sg.per18[c])));
    zeroKey(ctx, barLeft, barRight, y - 18);
    rule(ctx, y, C.ink, 3);

    CATEGORIES.forEach((c, i) => {
      const top = y + i * rowH;
      const mid = top + rowH / 2;
      const thin = sg.thin[c];
      text(ctx, CATEGORY_LABELS[c], PAD, mid - 12, `500 34px ${SANS}`, thin ? C.faint : C.ink, 'left', 'middle');
      eyebrow(ctx, `${sg.shots[c]} shot${sg.shots[c] === 1 ? '' : 's'}${thin ? ' · too few to read' : ''}`, PAD, mid + 32, C.faint, 'left', 18);
      zeroBar(ctx, barLeft, barRight, mid, sg.per18[c], scale, thin ? C.rule : tone(sg.per18[c]));
      text(ctx, signed(sg.per18[c]), W - PAD, mid, `600 34px ${MONO}`, tone(sg.per18[c], thin), 'right', 'middle');
      rule(ctx, top + rowH, C.rule, 2);
    });
    y += rowH * CATEGORIES.length;

    rule(ctx, y, C.ink, 3);
    text(ctx, 'Total', PAD, y + 96, `400 76px ${SERIF}`, C.ink);
    text(ctx, signed(sg.per18.total), W - PAD, y + 92, `600 60px ${MONO}`, tone(sg.per18.total), 'right');
    eyebrow(ctx, `The line is ${recap.benchLabel} · over ${sg.holes} holes`, PAD, y + 150, C.faint, 'left', 18);
  },

  leak(ctx, recap) { breakdown(ctx, recap, recap.leak, 'Biggest leak'); },
  strength(ctx, recap) { breakdown(ctx, recap, recap.strength, 'Strength'); },

  penalties(ctx, recap) {
    const p = recap.penalties;
    let y = Math.max(opening(ctx, 'Penalties', recap.captions.penalties) + 40, 560);

    rule(ctx, y, C.ink, 3);
    text(ctx, String(p.count), PAD - 6, y + 186, `400 210px ${SERIF}`, C.loss);
    const numW = ctx.measureText(String(p.count)).width;
    eyebrow(ctx, `shot${p.count === 1 ? '' : 's'} that took a penalty`, PAD + numW + 28, y + 116);
    eyebrow(ctx, `${p.strokes} stroke${p.strokes === 1 ? '' : 's'} added`, PAD + numW + 28, y + 158, C.faint);
    y += 226;
    rule(ctx, y, C.rule, 2);
    ruledRow(ctx, y, 88, 'What those shots cost', fmtSG(p.sgCost), tone(p.sgCost));
    ruledRow(ctx, y + 88, 88, 'Per 18', signed(p.costPer18), tone(p.costPer18));
    y += 176;

    if (p.ottCount) {
      const barLeft = PAD + 380;
      const barRight = W - PAD - 150;
      const scale = Math.max(2, Math.abs(p.ottPer18), Math.abs(p.ottCleanPer18));
      eyebrow(ctx, 'Off the tee, per 18', PAD, y + 56);
      zeroKey(ctx, barLeft, barRight, y + 56);
      [['As played', p.ottPer18], ['Without them', p.ottCleanPer18]].forEach(([name, value], i) => {
        const mid = y + 110 + i * 80;
        text(ctx, name, PAD, mid, `500 32px ${SANS}`, C.ink, 'left', 'middle');
        zeroBar(ctx, barLeft, barRight, mid, value, scale, tone(value));
        text(ctx, signed(value), W - PAD, mid, `600 32px ${MONO}`, tone(value), 'right', 'middle');
      });
    }
  },

  mom(ctx, recap) {
    const { mom } = recap;
    let y = Math.max(opening(ctx, `Month over month · vs ${mom.label}`, recap.captions.mom) + 70, 560);

    const then = W - PAD - 420;
    const now = W - PAD - 220;
    const short = (label) => label.split(' ')[0].slice(0, 3);
    eyebrow(ctx, short(mom.label), then, y - 18, C.faint, 'right', 18);
    eyebrow(ctx, short(recap.monthLabel), now, y - 18, C.soft, 'right', 18);
    eyebrow(ctx, 'change', W - PAD, y - 18, C.soft, 'right', 18);
    rule(ctx, y, C.ink, 3);

    const line = (top, height, name, row, big) => {
      const mid = top + height / 2;
      const thin = Boolean(row.thin);
      text(ctx, name, PAD, mid, big ? `400 64px ${SERIF}` : `500 34px ${SANS}`, thin ? C.faint : C.ink, 'left', 'middle');
      text(ctx, signed(row.prev), then, mid, `500 30px ${MONO}`, C.faint, 'right', 'middle');
      text(ctx, signed(row.now), now, mid, `600 30px ${MONO}`, tone(row.now, thin), 'right', 'middle');
      const moved = Math.abs(row.delta) >= 0.05;
      const colour = thin || !moved ? C.faint : row.delta > 0 ? C.gain : C.loss;
      text(ctx, moved ? Math.abs(row.delta).toFixed(1) : 'same', W - PAD, mid, `600 30px ${MONO}`, colour, 'right', 'middle');
      if (moved) triangle(ctx, W - PAD - ctx.measureText(Math.abs(row.delta).toFixed(1)).width - 26, mid, row.delta > 0, colour);
    };

    mom.rows.forEach((row, i) => {
      line(y + i * 108, 108, row.label, row, false);
      rule(ctx, y + (i + 1) * 108, C.rule, 2);
    });
    y += 108 * mom.rows.length;
    rule(ctx, y, C.ink, 3);
    line(y, 140, 'Total', mom.total, true);
    eyebrow(ctx, 'Per 18 holes · up is better', PAD, y + 172, C.faint, 'left', 18);
  },

  focus(ctx, recap) {
    const { focus } = recap;
    eyebrow(ctx, 'Next month', PAD, 228);
    let y = block(ctx, recap.captions.focus, 338, { size: 96, maxLines: 2 }) + 60;
    [['Practice', focus.practice], ['On the course', focus.rule]].forEach(([label, words]) => {
      if (!words) return;
      rule(ctx, y, C.ink, 3);
      eyebrow(ctx, label, PAD, y + 62);
      y = block(ctx, words, y + 140, { size: 60, min: 34, maxLines: 4, style: 'italic 400' }) + 56;
    });
  },
};

/** The leak and the strength share a layout: one category, opened up. */
function breakdown(ctx, recap, part, label) {
  const scale18 = 18 / recap.sg.holes;
  let y = opening(ctx, `${label} · ${part.label}`, part.caption) + 62;
  text(ctx, `${signed(part.per18)} per 18`, PAD, y, `600 30px ${MONO}`, tone(part.per18));
  eyebrow(ctx, `${part.shots} shots`, PAD + ctx.measureText(`${signed(part.per18)} per 18`).width + 24, y, C.faint, 'left', 18);
  y += 64;

  const best = part.bestShot || null;
  const factsH = part.facts.length * 46 + (part.facts.length ? 24 : 0);
  const bestH = best ? 204 : 0;
  const rowH = Math.max(58, Math.min(92, Math.floor((FOOT - 24 - bestH - factsH - y) / Math.max(part.rows.length, 1))));

  const barLeft = PAD + 500;
  const barRight = W - PAD - 150;
  const scale = Math.max(1, ...part.rows.map((r) => Math.abs(r.sg * scale18)));
  zeroKey(ctx, barLeft, barRight, y - 16);
  eyebrow(ctx, 'per 18', W - PAD, y - 16, C.soft, 'right', 18);
  rule(ctx, y, C.ink, 3);

  part.rows.forEach((row, i) => {
    const top = y + i * rowH;
    const mid = top + rowH / 2;
    const value = row.sg * scale18;
    text(ctx, row.label, PAD, mid, `500 32px ${SANS}`, row.thin ? C.faint : C.ink, 'left', 'middle');
    text(ctx, row.text, PAD + 235, mid, `500 22px ${MONO}`, row.thin ? C.faint : C.soft, 'left', 'middle');
    zeroBar(ctx, barLeft, barRight, mid, value, scale, row.thin ? C.rule : tone(value), 14);
    text(ctx, signed(value), W - PAD, mid, `600 30px ${MONO}`, tone(value, row.thin), 'right', 'middle');
    rule(ctx, top + rowH, C.rule, 2);
  });
  y += rowH * part.rows.length + 24;

  part.facts.forEach((fact, i) => {
    text(ctx, fact, PAD, y + 32 + i * 46, `400 30px ${SANS}`, C.soft);
  });

  if (best) {
    const top = FOOT - bestH;
    rule(ctx, top, C.ink, 3);
    eyebrow(ctx, 'Best shot of the month', PAD, top + 52);
    ctx.fillStyle = C.ink;
    fitFont(ctx, best.text, '400', 60, SERIF, W - PAD * 2 - 210);
    ctx.fillText(best.text, PAD, top + 122);
    text(ctx, fmtSG(best.sg), W - PAD, top + 118, `600 40px ${MONO}`, tone(best.sg), 'right');
    eyebrow(ctx, [`No. ${best.hole}`, best.course, shortDay(best.date)].filter(Boolean).join(' · '), PAD, top + 164, C.faint, 'left', 18);
  }
}

/** One card on its own canvas. */
export function drawCard(recap, key, { handle = '', theme = 'light' } = {}) {
  C = theme === 'dark' ? DARK : LIGHT;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  frame(ctx, recap, key, handle);
  CARDS[key](ctx, recap);
  return canvas;
}

function toBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the image.'))), 'image/png');
  });
}

/**
 * Every card the month has, in order, as PNGs. The same blobs are what
 * the screen shows and what the share sheet is handed, so what is
 * posted is exactly what was looked at.
 */
// Cards are drawn one after another, so the palette set by drawCard holds for each.
export async function drawRecapCards(recap, options = {}) {
  await loadFonts();
  const slug = String(recap.player || 'ledger').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const cards = [];
  for (let i = 0; i < recap.cards.length; i++) {
    const key = recap.cards[i];
    cards.push({
      key,
      label: CARD_LABELS[key],
      caption: recap.captions[key] || '',
      filename: `${slug}-${recap.month}-${i + 1}-${key}.png`,
      blob: await toBlob(drawCard(recap, key, options)),
    });
  }
  return cards;
}
