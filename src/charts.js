/* ---------------------------------------------------------------
   charts.js — inline SVG chart primitives.

   WHY NOT A CHARTING LIBRARY. Three reasons, all of them structural
   rather than a matter of taste:

   1. The app has to open with no signal. sw.js caches the shell so
      the page works on the seventh tee; a script from a CDN is one
      more thing that has to be reachable, and the failure mode is a
      blank stats screen at exactly the moment nobody can fix it.

   2. render() replaces the whole of #app on every interaction. A
      canvas library holds a live instance per chart and expects to
      own its element; under a full re-render each one is orphaned
      and a new one built, every tap, forever.

   3. The theme is CSS custom properties, switched at runtime. SVG
      reads them for free — `fill="var(--flag)"` simply follows the
      theme. Canvas cannot, so a canvas chart has to re-read computed
      styles and redraw itself whenever the phone goes dark.

   Everything here returns a plain SVG string, inherits the theme,
   and costs nothing when it is not on screen. Numerals are set in
   IBM Plex Mono to line up with every other figure in the app.
--------------------------------------------------------------- */

import { CATEGORIES, CATEGORY_LABELS, CATEGORY_SHORT } from './baseline.js';

const MONO = 'IBM Plex Mono, monospace';

/** Positive is gained, negative is lost. Used for every bar fill. */
function barColour(value) {
  return value >= 0 ? 'var(--green-mid)' : 'var(--flag)';
}

function fmt(value, digits = 2) {
  const rounded = Number(value.toFixed(digits));
  if (rounded > 0) return '+' + rounded.toFixed(digits);
  if (rounded < 0) return '−' + Math.abs(rounded).toFixed(digits);
  return (0).toFixed(digits);
}

/**
 * A bar with its two outer corners rounded and its baseline end
 * square, so the zero line reads as a wall the bars grow out of
 * rather than a row of floating lozenges.
 */
function bar(x, y, w, h, radius, direction) {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  if (r === 0 || w <= 0 || h <= 0) {
    return `<rect x="${x}" y="${y}" width="${Math.max(w, 0)}" height="${Math.max(h, 0)}"></rect>`;
  }
  if (direction === 'right') {
    return `<path d="M${x},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r}`
      + ` V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x} Z"></path>`;
  }
  if (direction === 'left') {
    return `<path d="M${x + w},${y} H${x + r} A${r},${r} 0 0 0 ${x},${y + r}`
      + ` V${y + h - r} A${r},${r} 0 0 0 ${x + r},${y + h} H${x + w} Z"></path>`;
  }
  if (direction === 'up') {
    return `<path d="M${x},${y + h} V${y + r} A${r},${r} 0 0 1 ${x + r},${y}`
      + ` H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h} Z"></path>`;
  }
  // down
  return `<path d="M${x},${y} V${y + h - r} A${r},${r} 0 0 0 ${x + r},${y + h}`
    + ` H${x + w - r} A${r},${r} 0 0 0 ${x + w},${y + h - r} V${y} Z"></path>`;
}

/* --- Chart 1: strokes gained by category ------------------------- */

/**
 * The four parts of one round as bars either side of zero.
 *
 * This is the chart worth having above all the others. Four numbers
 * in a row of boxes have to be read and compared one at a time; the
 * same four as bars off a common zero answer "what went wrong today"
 * before you have finished looking at it.
 *
 * The scale is symmetric around zero on purpose. Letting each side
 * scale independently would make a −0.4 look the same size as a +3.1
 * on the other side of the line, which is the one comparison the
 * chart exists to make honest.
 */
export function sgByCategoryChart(totals, { label = 'tour' } = {}) {
  const rows = CATEGORIES.map((c) => ({
    key: c,
    label: CATEGORY_SHORT[c],
    full: CATEGORY_LABELS[c],
    value: totals[c] || 0,
  }));

  const W = 320;
  const rowH = 30;
  const barH = 18;
  const padT = 6;
  const padB = 16;
  const labelW = 42;
  const valueW = 46;
  const H = padT + rows.length * rowH + padB;

  const plotL = labelW;
  const plotR = W - valueW;
  const mid = (plotL + plotR) / 2;
  const halfSpan = (plotR - plotL) / 2;

  // A floor on the scale keeps a nearly level round from drawing four
  // enormous bars out of four trivial numbers.
  const peak = Math.max(0.75, ...rows.map((r) => Math.abs(r.value)));
  const scale = (v) => (v / peak) * halfSpan;

  const bars = rows.map((row, i) => {
    const y = padT + i * rowH + (rowH - barH) / 2;
    const length = Math.abs(scale(row.value));
    const positive = row.value >= 0;
    const x = positive ? mid : mid - length;
    const shape = bar(x, y, length, barH, 4, positive ? 'right' : 'left');

    return `<g>
      <text x="${plotL - 6}" y="${y + barH / 2}" text-anchor="end" dominant-baseline="middle"
            font-size="11" font-weight="600" fill="var(--ink-soft)">${row.label}</text>
      <g fill="${barColour(row.value)}">${shape}</g>
      <text x="${plotR + 6}" y="${y + barH / 2}" dominant-baseline="middle"
            font-size="11" font-family="${MONO}" font-weight="600"
            fill="${barColour(row.value)}">${fmt(row.value)}</text>
    </g>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block"
       role="img" aria-label="Strokes gained by part of the game, against a ${label} baseline">
    <line x1="${mid}" y1="${padT - 2}" x2="${mid}" y2="${padT + rows.length * rowH}"
          stroke="var(--green-line)" stroke-width="1"></line>
    ${bars}
    <text x="${mid}" y="${H - 4}" text-anchor="middle" font-size="9"
          fill="var(--ink-faint)">${label} baseline</text>
  </svg>`;
}

/* --- Chart 3: approach strokes gained by distance ---------------- */

/**
 * Approach play banded by how far out the shot was.
 *
 * The single approach figure says the department is losing shots.
 * This says which yardage is losing them, which is the difference
 * between "practise approaches" and "practise the 120 to 150".
 *
 * Bar height is strokes gained PER SHOT, so a band played twice does
 * not look tiny beside one played thirty times. The count is printed
 * under each band instead, and thin bands are drawn faded rather than
 * hidden — an empty gap reads as "fine here", which is the opposite
 * of what one shot's worth of evidence means.
 */
export function approachByDistanceChart(buckets, { thinBelow = 5, label = 'tour' } = {}) {
  if (!buckets.length) return '';

  const W = 320;
  const H = 146;
  const padT = 10;
  // Room for two stacked labels under each bar — the distance band and
  // the shot count — and nothing else. An axis caption was tried here
  // and collided with the counts at narrow widths; the card's own text
  // says the same thing with room to say it.
  const padB = 30;
  const padL = 30;
  const padR = 6;

  const values = buckets.map((b) => b.sg / b.shots);
  const peak = Math.max(0.3, ...values.map(Math.abs));
  const plotH = H - padT - padB;
  const zeroY = padT + plotH / 2;
  const scale = (v) => (v / peak) * (plotH / 2);

  const slot = (W - padL - padR) / buckets.length;
  const barW = Math.min(24, slot * 0.62);

  const bars = buckets.map((bucket, i) => {
    const value = values[i];
    const centre = padL + slot * i + slot / 2;
    const x = centre - barW / 2;
    const height = Math.abs(scale(value));
    const y = value >= 0 ? zeroY - height : zeroY;
    const thin = bucket.shots < thinBelow;

    return `<g opacity="${thin ? 0.45 : 1}">
      <g fill="${barColour(value)}">${bar(x, y, barW, height, 3, value >= 0 ? 'up' : 'down')}</g>
      <text x="${centre}" y="${H - 16}" text-anchor="middle" font-size="8.5"
            fill="var(--ink-soft)" font-family="${MONO}">${bucket.label}</text>
      <text x="${centre}" y="${H - 5}" text-anchor="middle" font-size="8"
            fill="var(--ink-faint)" font-family="${MONO}">${bucket.shots}</text>
    </g>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block"
       role="img" aria-label="Approach strokes gained per shot by distance, against a ${label} baseline">
    <line x1="${padL - 4}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}"
          stroke="var(--green-line)" stroke-width="1"></line>
    <text x="${padL - 7}" y="${zeroY}" text-anchor="end" dominant-baseline="middle"
          font-size="9" font-family="${MONO}" fill="var(--ink-faint)">0</text>
    <text x="${padL - 7}" y="${padT + 4}" text-anchor="end"
          font-size="9" font-family="${MONO}" fill="var(--ink-faint)">${'+' + peak.toFixed(1)}</text>
    <text x="${padL - 7}" y="${padT + plotH}" text-anchor="end"
          font-size="9" font-family="${MONO}" fill="var(--ink-faint)">${'−' + peak.toFixed(1)}</text>
    ${bars}
  </svg>`;
}

/* --- Chart 2 support: rolling average ---------------------------- */

/**
 * Trailing mean over `window` points, for laying a smoothed line over
 * a noisy one.
 *
 * Trailing rather than centred: a centred window would let a round
 * played last week move the line drawn for a round played a month
 * ago, and the whole point of the smoothed line is to say what form
 * looked like AT each point in time.
 *
 * The first few points average over fewer values rather than being
 * dropped. Dropping them leaves the smoothed line starting somewhere
 * in the middle of the chart, which reads as though something was
 * hidden.
 */
export function rollingMean(values, window = 5) {
  return values.map((_, i) => {
    const from = Math.max(0, i - window + 1);
    const slice = values.slice(from, i + 1);
    return slice.reduce((sum, v) => sum + v, 0) / slice.length;
  });
}
