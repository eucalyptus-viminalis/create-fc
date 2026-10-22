// The create-fc mark: the keys you press to type "createfc" on a QWERTY
// keyboard, in their real positions. E R T F C touch and merge into one
// shape; A sits alone on the home row to the left.
//
// Units: 40 per key. Every key edge lands on a quarter key (10 units).
// The keys grow by 2 units on every side, with round outer corners, which
// is the shape picked in brand/mockups/keyboard-mark.html (variant D).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import opentype from 'opentype.js';

export const INK = '#17151f';
export const WHITE = '#ffffff';
const KEY = 40, GROW = 2, R = 2;

// Clockwise outline of E R T + F + C, in keys (x from the A key's left edge).
const CLUSTER = [[1.75, 0], [4.75, 0], [4.75, 1], [4, 1], [4, 2], [3.5, 2], [3.5, 3], [2.5, 3], [2.5, 2], [3, 2], [3, 1], [1.75, 1]];
const A = [[0, 1], [1, 1], [1, 2], [0, 2]];

// Push every edge out by GROW, then round the outer corners by R.
// Inner corners stay sharp, like a stroke with round joins.
function outline(keys, dx = 0, dy = 0) {
  const p = keys.map(([x, y]) => [x * KEY, y * KEY]), n = p.length;
  const dir = (a, b) => [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
  const grown = p.map((v, i) => {
    const d1 = dir(p[(i - 1 + n) % n], v), d2 = dir(v, p[(i + 1) % n]);
    // outward normal of a clockwise edge in y-down space is (dy, -dx)
    return [v[0] + GROW * (d1[1] + d2[1]), v[1] - GROW * (d1[0] + d2[0])];
  });
  const f = v => `${+(v[0] + dx).toFixed(2)} ${+(v[1] + dy).toFixed(2)}`;
  let d = '';
  grown.forEach((v, i) => {
    const prev = grown[(i - 1 + n) % n], next = grown[(i + 1) % n];
    const d1 = dir(prev, v), d2 = dir(v, next);
    const convex = d1[0] * d2[1] - d1[1] * d2[0] > 0;
    if (!convex) { d += (i ? 'L' : 'M') + f(v); return; }
    const a = [v[0] - d1[0] * R, v[1] - d1[1] * R], b = [v[0] + d2[0] * R, v[1] + d2[1] * R];
    d += (i ? 'L' : 'M') + f(a) + `A${R} ${R} 0 0 1 ` + f(b);
  });
  return d + 'Z';
}

// The mark's own box, before any padding.
export const MARK_W = 4.75 * KEY + GROW * 2, MARK_H = 3 * KEY + GROW * 2;

// Path data for the mark with its top-left corner at (x, y).
export const markPath = (x = 0, y = 0) => outline(A, x + GROW, y + GROW) + outline(CLUSTER, x + GROW, y + GROW);

// The bare mark, tight to its edges.
export const mark = (fill = INK) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_W} ${MARK_H}"><path fill="${fill}" d="${markPath()}"/></svg>`;

// Favicon: the mark on a square, ink in light mode and white in dark mode.
export const favicon = () => {
  const pad = (MARK_W - MARK_H) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_W} ${MARK_W}"><style>path{fill:${INK}}@media (prefers-color-scheme:dark){path{fill:${WHITE}}}</style><path d="${markPath(0, pad)}"/></svg>`;
};

// App icon / avatar: white mark centred on an ink square. `round` gives the
// tile its own corners; leave it off where the platform rounds (iOS, Farcaster).
export const icon = ({ size = 512, round = false } = {}) => {
  const w = size * 0.62, s = w / MARK_W, x = (size - w) / 2, y = (size - MARK_H * s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${round ? size * 0.22 : 0}" fill="${INK}"/><path fill="${WHITE}" transform="translate(${x} ${y}) scale(${s})" d="${markPath()}"/></svg>`;
};

// Lockup: mark + "create-fc" in JetBrains Mono Bold, letters as outlines so it
// renders the same without the font. Spacing matches the mockup: the mark is
// 1.24× the font size, 72 units of gap at size 100, tracking -0.02em, and the
// mark centred where a flexbox would centre it against the text's line.
const require = createRequire(import.meta.url);
const font = opentype.parse(fs.readFileSync(require.resolve('@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff')).buffer);

export function lockup(fill = INK, text = 'create-fc') {
  const size = 100, track = -0.02 * size, gap = 72, upm = font.unitsPerEm;
  const asc = font.tables.hhea.ascender / upm * size, desc = -font.tables.hhea.descender / upm * size;
  // line-height 1.5: the baseline sits this far below the line's centre
  const baselineBelowCentre = (asc - desc) / 2;
  const markCentre = MARK_H / 2, baseline = markCentre + baselineBelowCentre;
  let x = MARK_W + gap, d = '';
  for (const g of font.stringToGlyphs(text)) {
    d += g.getPath(x, baseline, size).toPathData(2);
    x += g.advanceWidth / upm * size + track;
  }
  const bb = font.getPath(text, 0, 0, size).getBoundingBox();
  const width = Math.ceil(x - track), top = Math.min(0, baseline + bb.y1), bottom = Math.max(MARK_H, baseline + bb.y2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${+top.toFixed(2)} ${width} ${+(bottom - top).toFixed(2)}"><g fill="${fill}"><path d="${markPath()}"/><path d="${d}"/></g></svg>`;
}
