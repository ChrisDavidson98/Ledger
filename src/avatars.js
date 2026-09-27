/* ---------------------------------------------------------------
   avatars.js — what a player can put on their marker.

   A marker is a circle; by default it holds the player's initial.
   Choosing an icon or an emoji replaces the initial and nothing else —
   the solid / outline / dashed fill that tells players apart stays, so
   markers never depend on the picture alone to be told apart.

   Icons are line drawings on a 24-unit grid, stroked in the text
   colour, in the same hand as the tab bar icons. An emoji is stored
   as "emoji:" plus the character, in the same sheet column.
--------------------------------------------------------------- */

export const AVATARS = {
  flag: { label: 'Flag', d: '<path d="M6 21V4"/><path d="M6 4h11l-2.5 4 2.5 4H6"/>' },
  tee: { label: 'Ball on a tee', d: '<circle cx="12" cy="8" r="4.5"/><path d="M8.5 14h7M12 14v7"/>' },
  driver: { label: 'Driver', d: '<path d="M6 3l8.5 12"/><path d="M14 15.5c2-1.5 5.5-1 5.5 1.5S16 21 13 20z"/>' },
  putter: { label: 'Putter', d: '<path d="M9 3v15"/><path d="M6 18h11v2.5H6z"/>' },
  bird: { label: 'Bird', d: '<path d="M3 15.5c1.5 2 4 3 7 3 5 0 8.5-3.5 8.5-8V8.5L21 7l-2.8-.6C17.5 5 16.2 4 14.5 4 12 4 10 6 10 8.5v1.5C7.5 10 5 11.5 3 15.5z"/><path d="M9 14c1.5.4 3.5.2 5-1"/>' },
  rake: { label: 'Bunker rake', d: '<path d="M12 3v11M5 14h14M6.5 14v5M10 14v5M14 14v5M17.5 14v5"/>' },
  trophy: { label: 'Trophy', d: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6"/>' },
  sun: { label: 'Sun', d: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>' },
  star: { label: 'Star', d: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>' },
  bolt: { label: 'Lightning', d: '<path d="M13.5 2L5 13.5h6L10 22l9-12h-6z"/>' },
  crown: { label: 'Crown', d: '<path d="M4 18h16M4.5 18L3 8l5 4 4-7 4 7 5-4-1.5 10"/>' },
  cup: { label: 'The cup', d: '<ellipse cx="12" cy="19" rx="7" ry="2"/><path d="M12 19V4l6 2.5-6 2.5"/>' },
  tree: { label: 'Tree', d: '<path d="M12 3l5.5 8h-3.5l4.5 6.5H5.5L10 11H6.5z"/><path d="M12 17.5V21"/>' },
};

const EMOJI_PREFIX = 'emoji:';

/**
 * One emoji, cleaned, or null. Exactly one visible character that is
 * a pictograph (so letters, words and markup never get through), with
 * the joiners and skin tones that make up a single emoji allowed.
 */
export function cleanEmoji(input) {
  const text = String(input || '').trim();
  if (!text || text.length > 16) return null;
  let count = 1;
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    count = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length;
  }
  if (count !== 1) return null;
  if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text)) return null;
  if (/[<>&"'`\s]/.test(text)) return null;
  return text;
}

export function emojiAvatar(emoji) {
  const clean = cleanEmoji(emoji);
  return clean ? EMOJI_PREFIX + clean : '';
}

export function emojiOf(key) {
  return typeof key === 'string' && key.startsWith(EMOJI_PREFIX) ? cleanEmoji(key.slice(EMOJI_PREFIX.length)) : null;
}

export function isAvatar(key) {
  return Object.prototype.hasOwnProperty.call(AVATARS, key) || !!emojiOf(key);
}

/** An icon avatar as inline SVG, stroked in whatever colour the marker text is. */
export function avatarSvg(key, size = 16) {
  const emoji = emojiOf(key);
  if (emoji) return `<span class="pm-emoji" style="font-size:${Math.round(size * 0.95)}px">${emoji}</span>`;
  if (!Object.prototype.hasOwnProperty.call(AVATARS, key)) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${AVATARS[key].d}</svg>`;
}
