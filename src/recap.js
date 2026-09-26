/* ---------------------------------------------------------------
   recap.js — one round as one image, for the group chat.

   Drawn on a canvas on the phone rather than rendered anywhere else,
   so it works in the car park with no signal, which is exactly when
   somebody wants to send it. Always the light palette: an image lives
   on in other people's chats long after this phone's theme is known.
--------------------------------------------------------------- */

import { CATEGORIES, CATEGORY_LABELS } from './baseline.js';
import {
  roundTotals, holeTotals, holeScore, playedHoles,
  roundScore, roundToPar, isScoreOnly,
} from './model.js';

const W = 1080;
const H = 1350;

const C = {
  cream: '#f6f3ea',
  paper: '#fffefb',
  ink: '#1e2621',
  soft: '#5b6660',
  faint: '#8b9590',
  green: '#173b2e',
  mid: '#3e6b57',
  line: '#b9c9bc',
  flag: '#a8391f',
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
  return d === 0 ? 'E' : d > 0 ? '+' + d : String(d);
}

function fmtDay(value) {
  // A bare day key is a local day; new Date() would read it as UTC
  // midnight and put anyone west of Greenwich on the day before.
  const key = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  const d = key ? new Date(+key[1], +key[2] - 1, +key[3]) : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || '');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/** Fits text to a width by shrinking it, never by cutting a course name off. */
function fitFont(ctx, text, weight, size, family, maxWidth) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > 24 && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
}

const SLAB = '"Zilla Slab", Georgia, serif';
const SANS = '"IBM Plex Sans", -apple-system, sans-serif';

/** Draws the recap and resolves to a PNG blob. */
export async function drawRecap(data, { benchLabel = 'tour' } = {}) {
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (err) { /* system fonts are fine */ }
  }

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const pad = 80;

  ctx.fillStyle = C.cream;
  ctx.fillRect(0, 0, W, H);

  // Header band.
  ctx.fillStyle = C.green;
  ctx.fillRect(0, 0, W, 300);
  ctx.fillStyle = C.flag;
  ctx.fillRect(0, 300, W, 10);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#b9c9bc';
  ctx.font = `600 30px ${SANS}`;
  ctx.fillText(String(data.player || '').toUpperCase(), pad, 100);

  ctx.fillStyle = '#ffffff';
  fitFont(ctx, data.course || 'Round', 700, 72, SLAB, W - pad * 2);
  ctx.fillText(data.course || 'Round', pad, 185);

  ctx.fillStyle = '#d3e2d7';
  ctx.font = `400 32px ${SANS}`;
  const sub = [fmtDay(data.date), data.tee ? `${data.tee} tees` : '', `${data.holes} holes`].filter(Boolean).join('  ·  ');
  ctx.fillText(sub, pad, 250);

  // Score.
  let y = 450;
  ctx.fillStyle = C.ink;
  ctx.font = `700 150px ${SLAB}`;
  ctx.fillText(String(data.score), pad, y);
  const scoreW = ctx.measureText(String(data.score)).width;
  ctx.fillStyle = data.toPar <= 0 ? C.mid : C.flag;
  ctx.font = `600 64px ${SLAB}`;
  ctx.fillText(fmtToPar(data.toPar), pad + scoreW + 30, y);

  if (data.total != null) {
    ctx.textAlign = 'right';
    ctx.fillStyle = C.soft;
    ctx.font = `500 28px ${SANS}`;
    ctx.fillText('STROKES GAINED', W - pad, y - 90);
    ctx.fillStyle = data.total >= 0 ? C.mid : C.flag;
    ctx.font = `700 84px ${SLAB}`;
    ctx.fillText(fmtSG(data.total), W - pad, y);
    ctx.fillStyle = C.faint;
    ctx.font = `400 24px ${SANS}`;
    ctx.fillText(`vs. ${benchLabel} baseline`, W - pad, y + 38);
    ctx.textAlign = 'left';
  }

  y += 90;

  if (data.categories.length) {
    // Four bars off a shared zero, same reading as the round screen.
    const labelW = 230;
    const valueW = 140;
    const zeroX = pad + labelW + (W - pad * 2 - labelW - valueW) / 2;
    const half = (W - pad * 2 - labelW - valueW) / 2 - 10;
    const scale = Math.max(2, ...data.categories.map((c) => Math.abs(c.sg)));
    const rowH = 100;

    ctx.strokeStyle = C.line;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(zeroX, y + 10);
    ctx.lineTo(zeroX, y + rowH * data.categories.length);
    ctx.stroke();

    data.categories.forEach((c, i) => {
      const cy = y + i * rowH + rowH / 2 + 10;
      ctx.fillStyle = C.ink;
      ctx.font = `500 34px ${SANS}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(c.label, pad, cy);

      const len = (Math.abs(c.sg) / scale) * half;
      ctx.fillStyle = c.sg >= 0 ? C.mid : C.flag;
      const x = c.sg >= 0 ? zeroX : zeroX - len;
      roundRect(ctx, x, cy - 24, Math.max(len, 4), 48, 8);

      ctx.textAlign = 'right';
      ctx.font = `700 38px ${SLAB}`;
      ctx.fillText(fmtSG(c.sg), W - pad, cy);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    });
    y += rowH * data.categories.length + 70;
  } else {
    ctx.fillStyle = C.soft;
    ctx.font = `400 32px ${SANS}`;
    ctx.fillText('Score only — no shots logged for this one.', pad, y + 40);
    y += 140;
  }

  // Best and worst hole.
  if (data.best && data.worst) {
    const boxW = (W - pad * 2 - 30) / 2;
    holeBox(ctx, pad, y, boxW, 'BEST HOLE', data.best, C.mid);
    holeBox(ctx, pad + boxW + 30, y, boxW, 'TOUGHEST HOLE', data.worst, C.flag);
  }

  // Footer.
  ctx.fillStyle = C.faint;
  ctx.font = `500 26px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('LEDGER  ·  STROKES GAINED', W / 2, H - 60);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the image.'))), 'image/png');
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fill();
}

function holeBox(ctx, x, y, w, title, hole, accent) {
  const h = 230;
  ctx.fillStyle = C.paper;
  roundRect(ctx, x, y, w, h, 22);
  ctx.fillStyle = accent;
  ctx.fillRect(x, y + 22, 8, h - 44);

  ctx.fillStyle = C.soft;
  ctx.font = `600 24px ${SANS}`;
  ctx.fillText(title, x + 40, y + 55);

  ctx.fillStyle = C.ink;
  ctx.font = `700 64px ${SLAB}`;
  ctx.fillText(`#${hole.hole}`, x + 40, y + 135);

  ctx.fillStyle = C.soft;
  ctx.font = `400 30px ${SANS}`;
  ctx.fillText(`Par ${hole.par}  ·  ${hole.score}`, x + 40, y + 185);

  if (hole.sg != null) {
    ctx.textAlign = 'right';
    ctx.fillStyle = accent;
    ctx.font = `700 40px ${SLAB}`;
    ctx.fillText(fmtSG(hole.sg), x + w - 30, y + 135);
    ctx.textAlign = 'left';
  }
}

/**
 * Hands the image to the phone's share sheet, or saves it where there
 * is no share sheet (a laptop). Resolves to what happened.
 */
export async function shareRecap(blob, filename, title) {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      // Fall through to saving it.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'saved';
}
