/** Generates favicon + default share image from a fixed creature. Output goes to apps/web/public. */
import { copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { compose, encodeIndexedPng, placeholderArt, type ArtSet } from '@gitemon/creature-gen';
import { ogPng } from '../apps/api/src/og.ts';

const realPath = new URL('../packages/creature-gen/art-real/index.ts', import.meta.url);
const art: ArtSet = existsSync(realPath) ? (await import(realPath.href)).realArt : placeholderArt;
const mascot = { id: 1, t1: 'prism', t2: null, sh: 'steady', f: 2, s: 0 } as const;
const sp = compose(art, mascot);
const out = 'apps/web/public/';
// v14: creatures are sp.size pixels (80 since v10, not SIZE); icons are cut to the creature itself
const S = sp.size;
let x0 = S,
  y0 = S,
  x1 = -1,
  y1 = -1;
for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++)
    if (sp.px[y * S + x]) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
const m = Math.max(x1 - x0, y1 - y0) + 1;
const cx = x0 - Math.floor((m - (x1 - x0 + 1)) / 2);
const cy = y0 - Math.floor((m - (y1 - y0 + 1)) / 2);
/** the creature's square, resampled (nearest) to n×n with `margin` pixels round it */
function fit(n: number, margin: number): Uint8Array {
  const o = new Uint8Array(n * n);
  const inner = n - margin * 2;
  for (let y = 0; y < inner; y++)
    for (let x = 0; x < inner; x++) {
      const sx = cx + Math.floor((x * m) / inner);
      const sy = cy + Math.floor((y * m) / inner);
      if (sx >= 0 && sy >= 0 && sx < S && sy < S)
        o[(y + margin) * n + x + margin] = sp.px[sy * S + sx]!;
    }
  return o;
}
writeFileSync(out + 'favicon.png', encodeIndexedPng(32, 32, fit(32, 1), sp.palette));
writeFileSync(
  out + 'apple-touch-icon.png',
  encodeIndexedPng(180, 180, fit(180, 16), ['#1f2b3d', ...sp.palette.slice(1)], false),
);
// SVG favicon: one rect per run of same-colour pixels
let rects = '';
for (let y = 0; y < m; y++)
  for (let x = 0; x < m;) {
    const sx = cx + x;
    const sy = cy + y;
    const v = sx >= 0 && sy >= 0 && sx < S && sy < S ? sp.px[sy * S + sx]! : 0;
    let w = 1;
    while (x + w < m && cx + x + w < S && sp.px[sy * S + cx + x + w] === v) w++;
    if (v)
      rects += `<rect x="${x}" y="${y}" width="${w + 0.02}" height="1.02" fill="${sp.palette[v]}"/>`;
    x += w;
  }
writeFileSync(
  out + 'favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m} ${m}" shape-rendering="crispEdges">${rects}</svg>`,
);
// The default share image and the landing's still pictures (v14) are captures of the island with the
// real art, kept in the private art repo; a fresh clone falls back to the mascot card and no picture.
const city = '../gitemon-art/og-city.png';
if (existsSync(city)) copyFileSync(city, out + 'og-default.png');
else
  writeFileSync(
    out + 'og-default.png',
    ogPng({ ...mascot, login: 'every developer', level: 1 }, art),
  );
for (const f of ['poster-wide.webp', 'poster-tall.webp', 'poster-lqip.json'])
  if (existsSync('../gitemon-art/' + f)) copyFileSync('../gitemon-art/' + f, out + f);
console.log('icons written with', art.id);
