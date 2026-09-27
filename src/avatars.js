/* ---------------------------------------------------------------
   avatars.js — the icons a player can choose for their marker.

   A marker is a circle; by default it holds the player's initial.
   Choosing an icon replaces the initial and nothing else — the
   solid / outline / dashed fill that tells players apart stays, so
   the markers never depend on the icon alone to be told apart.

   Line drawings on a 24-unit grid, stroked in the text colour, in the
   same hand as the tab bar icons.
--------------------------------------------------------------- */

export const AVATARS = {
  flag: { label: 'Flag', d: '<path d="M6 21V4"/><path d="M6 4h11l-2.5 4 2.5 4H6"/>' },
  tee: { label: 'Ball on a tee', d: '<circle cx="12" cy="8" r="4.5"/><path d="M8.5 14h7M12 14v7"/>' },
  driver: { label: 'Driver', d: '<path d="M6 3l8.5 12"/><path d="M14 15.5c2-1.5 5.5-1 5.5 1.5S16 21 13 20z"/>' },
  putter: { label: 'Putter', d: '<path d="M9 3v15"/><path d="M6 18h11v2.5H6z"/>' },
  rake: { label: 'Bunker rake', d: '<path d="M12 3v11M5 14h14M6.5 14v5M10 14v5M14 14v5M17.5 14v5"/>' },
  trophy: { label: 'Trophy', d: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6"/>' },
  sun: { label: 'Sun', d: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>' },
  star: { label: 'Star', d: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>' },
  bolt: { label: 'Lightning', d: '<path d="M13.5 2L5 13.5h6L10 22l9-12h-6z"/>' },
  crown: { label: 'Crown', d: '<path d="M4 18h16M4.5 18L3 8l5 4 4-7 4 7 5-4-1.5 10"/>' },
  cup: { label: 'The cup', d: '<ellipse cx="12" cy="19" rx="7" ry="2"/><path d="M12 19V4l6 2.5-6 2.5"/>' },
  tree: { label: 'Tree', d: '<path d="M12 3l5.5 8h-3.5l4.5 6.5H5.5L10 11H6.5z"/><path d="M12 17.5V21"/>' },
};

export function isAvatar(key) {
  return Object.prototype.hasOwnProperty.call(AVATARS, key);
}

/** An avatar as inline SVG, stroked in whatever colour the marker text is. */
export function avatarSvg(key, size = 16) {
  if (!isAvatar(key)) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${AVATARS[key].d}</svg>`;
}
