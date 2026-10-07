/* ---------------------------------------------------------------
   recap.js — one round as one image, for the group chat.

   Drawn on a canvas on the phone rather than rendered anywhere else,
   so it works in the car park with no signal, which is exactly when
   somebody wants to send it. Light paper unless the phone asks for dark:
   the image outlives this phone's theme, so it is a choice, not a mirror.
--------------------------------------------------------------- */

import { CATEGORIES, CATEGORY_LABELS } from './baseline.js';
import {
  roundTotals, holeTotals, holeScore, playedHoles,
  roundScore, roundToPar, isScoreOnly,
} from './model.js';

export const W = 1080;
export const H = 1350;

/* The yardage-book light palette, and the default: an image lives on in
   other people's chats long after this phone's theme is known. */
export const C = {
  paper: '#f7f4ec',
  grid: '#ece7da',
  ink: '#16150f',
  soft: '#5d5a50',
  faint: '#8a8676',
  rule: '#d9d3c3',
  gain: '#1f5fbf',
  loss: '#b8431b',
};

/* The app's dark theme, for anyone who would rather send that. Paper
   stays the default; which one is a choice made per phone. */
export const DARK = {
  paper: '#141816',
  grid: '#191e1c',
  ink: '#e8eae7',
  soft: '#a4ada8',
  faint: '#79837e',
  rule: '#2e3833',
  gain: '#7fc39b',
  loss: '#e8785a',
};

/**
 * Everything the image says, worked out without a canvas so it can be
 * tested. Best and worst hole are by strokes gained when there are
 * shots, by score against par when there are only scores.
 */
export function recapData(round, baseline = 'tour') {
  const holes = playedHoles(round);
  const scoreOnly = isScoreOnly(round);
  const totals = scoreOnly ? null : roundTotals(round, baseline);

  const rate = (h) => (scoreOnly ? -(holeScore(h) - h.par) : holeTotals(h, baseline).total);
  const ranked = holes.slice().sort((a, b) => rate(b) - rate(a));

  return {
    player: round.player,
    course: round.courseName,
    tee: round.teeName,
    date: round.date,
    holes: holes.length,
    score: roundScore(round),
    toPar: roundToPar(round),
    scoreOnly,
    categories: scoreOnly ? [] : CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABELS[c], sg: totals[c] })),
    total: scoreOnly ? null : totals.total,
    best: holes.length > 1 ? describeHole(ranked[0], scoreOnly, baseline) : null,
    worst: holes.length > 1 ? describeHole(ranked[ranked.length - 1], scoreOnly, baseline) : null,
  };
}

function describeHole(hole, scoreOnly, baseline) {
  return {
    hole: hole.hole,
    par: hole.par,
    score: holeScore(hole),
    sg: scoreOnly ? null : holeTotals(hole, baseline).total,
  };
}

export function fmtSG(v) {
  const r = Math.round(v * 100) / 100;
  if (r > 0) return '+' + r.toFixed(2);
  if (r < 0) return '−' + Math.abs(r).toFixed(2);
  return '0.00';
}

function fmtToPar(d) {
  return d === 0 ? 'E' : d > 0 ? '+' + d : '−' + Math.abs(d);
}

function fmtDay(value) {
  // A bare day key is a local day; new Date() would read it as UTC
  // midnight and put anyone west of Greenwich on the day before.
  const key = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  const d = key ? new Date(+key[1], +key[2] - 1, +key[3]) : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || '');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Fits text to a width by shrinking it, never by cutting a course name off. */
export function fitFont(ctx, text, style, size, family, maxWidth) {
  let s = size;
  ctx.font = `${style} ${s}px ${family}`;
  while (s > 24 && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `${style} ${s}px ${family}`;
  }
}

export const SERIF = '"Instrument Serif", Georgia, serif';
export const MONO = '"Martian Mono", ui-monospace, monospace';
export const SANS = '"Public Sans", -apple-system, sans-serif';

/** Small mono capitals, spaced out: the yardage-book label. */
export function eyebrow(ctx, text, x, y, colour = C.soft, align = 'left', size = 22) {
  ctx.save();
  ctx.font = `500 ${size}px ${MONO}`;
  ctx.fillStyle = colour;
  ctx.textAlign = align;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${size * 0.08}px`;
  ctx.fillText(String(text).toUpperCase(), x, y);
  ctx.restore();
}

export function rule(ctx, y, colour, width = 2) {
  ctx.fillStyle = colour;
  ctx.fillRect(PAD, y, W - PAD * 2, width);
}

export const PAD = 72;

/** The typefaces are web fonts; a canvas draws with a fallback unless they are loaded first. */
export async function loadFonts() {
  if (!document.fonts || !document.fonts.load) return;
  try {
    await Promise.all([
      document.fonts.load(`100px ${SERIF}`),
      document.fonts.load(`italic 100px ${SERIF}`),
      document.fonts.load(`500 20px ${MONO}`),
      document.fonts.load(`600 20px ${MONO}`),
      document.fonts.load(`500 20px ${SANS}`),
    ]);
  } catch (err) { /* offline without the fonts cached: the fallbacks are fine */ }
}

/** Draws the recap and resolves to a PNG blob. */
export async function drawRecap(data, { benchLabel = 'tour', theme = 'light' } = {}) {
  const P = theme === 'dark' ? DARK : C;
  await loadFonts();

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';

  // Paper and its faint grid.
  ctx.fillStyle = P.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = P.grid;
  for (let x = 0; x < W; x += 36) ctx.fillRect(x, 0, 2, H);
  for (let y = 0; y < H; y += 36) ctx.fillRect(0, y, W, 2);

  // Masthead.
  ctx.fillStyle = P.ink;
  ctx.font = `400 88px ${SERIF}`;
  ctx.fillText('Ledger', PAD, 132);
  const word = ctx.measureText('Ledger').width;
  ctx.fillStyle = P.loss;
  ctx.fillText('.', PAD + word, 132);
  eyebrow(ctx, `${data.player || ''} · ${fmtDay(data.date)}`, W - PAD, 124, P.soft, 'right');
  rule(ctx, 162, P.ink, 4);

  // The round.
  eyebrow(ctx, [data.tee ? `${data.tee} tees` : '', `${data.holes} holes`].filter(Boolean).join(' · '), PAD, 228, P.soft);
  ctx.fillStyle = P.ink;
  fitFont(ctx, data.course || 'Round', '400', 92, SERIF, W - PAD * 2);
  ctx.fillText(data.course || 'Round', PAD, 318);

  // Score, and strokes gained beside it.
  const scoreY = 560;
  ctx.fillStyle = P.ink;
  ctx.font = `400 250px ${SERIF}`;
  ctx.fillText(String(data.score), PAD - 6, scoreY);
  const scoreW = ctx.measureText(String(data.score)).width;
  ctx.font = `italic 400 96px ${SERIF}`;
  ctx.fillStyle = data.toPar <= 0 ? P.gain : P.ink;
  ctx.fillText(fmtToPar(data.toPar), PAD + scoreW + 20, scoreY);

  if (data.total != null) {
    eyebrow(ctx, 'Strokes gained', W - PAD, scoreY - 150, P.soft, 'right');
    ctx.textAlign = 'right';
    ctx.font = `400 120px ${SERIF}`;
    ctx.fillStyle = data.total >= 0 ? P.gain : P.loss;
    ctx.fillText(fmtSG(data.total), W - PAD, scoreY - 20);
    ctx.textAlign = 'left';
    eyebrow(ctx, `vs ${benchLabel}`, W - PAD, scoreY + 22, P.faint, 'right', 20);
  }

  let y = scoreY + 70;
  rule(ctx, y, P.ink, 3);

  if (data.categories.length) {
    // Four ruled rows, each with a bar off a shared zero.
    const rowH = 96;
    const labelW = 300;
    const valueW = 170;
    const barLeft = PAD + labelW;
    const barRight = W - PAD - valueW;
    const zeroX = (barLeft + barRight) / 2;
    const half = (barRight - barLeft) / 2 - 8;
    const scale = Math.max(2, ...data.categories.map((c) => Math.abs(c.sg)));

    data.categories.forEach((c, i) => {
      const top = y + i * rowH;
      const mid = top + rowH / 2;
      ctx.fillStyle = P.ink;
      ctx.font = `500 34px ${SANS}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(c.label, PAD, mid);

      ctx.fillStyle = P.rule;
      ctx.fillRect(zeroX - 1, top + 18, 2, rowH - 36);
      const len = (Math.abs(c.sg) / scale) * half;
      ctx.fillStyle = c.sg >= 0 ? P.gain : P.loss;
      ctx.fillRect(c.sg >= 0 ? zeroX : zeroX - len, mid - 9, Math.max(len, 3), 18);

      ctx.textAlign = 'right';
      ctx.font = `600 34px ${MONO}`;
      ctx.fillText(fmtSG(c.sg), W - PAD, mid);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      rule(ctx, top + rowH, P.rule, 2);
    });
    y += rowH * data.categories.length;
  } else {
    ctx.fillStyle = P.soft;
    ctx.font = `italic 400 44px ${SERIF}`;
    ctx.fillText('Score only — no shots logged for this one.', PAD, y + 80);
    y += 130;
    rule(ctx, y, P.rule, 2);
  }

  // Best and toughest hole, as two more ruled rows.
  if (data.best && data.worst) {
    y += 20;
    [['Best hole', data.best, P.gain], ['Toughest hole', data.worst, P.loss]].forEach(([title, hole, colour], i) => {
      const top = y + i * 104;
      const mid = top + 58;
      eyebrow(ctx, title, PAD, mid + 8, P.soft);
      ctx.fillStyle = P.ink;
      ctx.font = `400 64px ${SERIF}`;
      ctx.fillText(`No. ${hole.hole}`, PAD + 330, mid + 20);
      eyebrow(ctx, `Par ${hole.par} · ${hole.score}`, PAD + 580, mid + 8, P.soft);
      if (hole.sg != null) {
        ctx.textAlign = 'right';
        ctx.font = `600 34px ${MONO}`;
        ctx.fillStyle = colour;
        ctx.fillText(fmtSG(hole.sg), W - PAD, mid + 10);
        ctx.textAlign = 'left';
      }
      rule(ctx, top + 104, P.rule, 2);
    });
  }

  // Footer.
  rule(ctx, H - 110, P.ink, 3);
  eyebrow(ctx, 'Ledger · strokes gained', PAD, H - 58, P.soft);
  ctx.fillStyle = P.loss;
  ctx.fillRect(W - PAD - 26, H - 92, 4, 44);
  ctx.beginPath();
  ctx.moveTo(W - PAD - 22, H - 92);
  ctx.lineTo(W - PAD + 4, H - 83);
  ctx.lineTo(W - PAD - 22, H - 74);
  ctx.closePath();
  ctx.fill();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the image.'))), 'image/png');
  });
}

/**
 * Hands the image to the phone's share sheet, or saves it where there
 * is no share sheet (a laptop). Resolves to what happened.
 */
export function shareRecap(blob, filename, title) {
  return shareImages([{ blob, filename }], title);
}

/** The same for several images at once, attached to one share. */
export async function shareImages(images, title) {
  const files = images.map((i) => new File([i.blob], i.filename, { type: 'image/png' }));
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, title });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      // Fall through to saving them.
    }
  }
  images.forEach(({ blob, filename }, i) => {
    // Spaced out, or a browser keeps the first download and drops the rest.
    setTimeout(() => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, i * 250);
  });
  return 'saved';
}
