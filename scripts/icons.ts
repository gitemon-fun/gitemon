/** Generates favicon + default share image from a fixed creature. Output goes to apps/web/public. */
import { writeFileSync, existsSync } from 'node:fs';
import {
  compose,
  encodeIndexedPng,
  scaleIndexed,
  SIZE,
  placeholderArt,
  type ArtSet,
} from '@gitemon/creature-gen';
import { ogPng } from '../apps/api/src/og.ts';

const realPath = new URL('../packages/creature-gen/art-real/index.ts', import.meta.url);
const art: ArtSet = existsSync(realPath) ? (await import(realPath.href)).realArt : placeholderArt;
const mascot = { id: 1, t1: 'prism', t2: null, sh: 'steady', f: 2, s: 0 } as const;
const sp = compose(art, mascot);
const out = 'apps/web/public/';
writeFileSync(out + 'favicon.png', encodeIndexedPng(32, 32, pad(sp.px, 1, 32), sp.palette));
writeFileSync(
  out + 'apple-touch-icon.png',
  encodeIndexedPng(180, 180, pad(sp.px, 7, 180, 2), ['#1f2b3d', ...sp.palette.slice(1)], false),
);
// SVG favicon: one rect per pixel run
let rects = '';
for (let y = 0; y < SIZE; y++)
  for (let x = 0; x < SIZE; x++) {
    const v = sp.px[y * SIZE + x]!;
    if (v) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${sp.palette[v]}"/>`;
  }
writeFileSync(
  out + 'favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" shape-rendering="crispEdges">${rects}</svg>`,
);
writeFileSync(
  out + 'og-default.png',
  ogPng({ ...mascot, login: 'every developer', level: 1 }, art),
);
console.log('icons written with', art.id);

/** Scale then centre on an n×n canvas; index 0 = background. */
function pad(px: Uint8Array, scale: number, n: number, off = 0): Uint8Array {
  const s = scaleIndexed(px, SIZE, scale);
  const w = SIZE * scale;
  const outp = new Uint8Array(n * n);
  const o = Math.floor((n - w) / 2) + off;
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++)
      if (y + o < n && x + o < n) outp[(y + o) * n + x + o] = s[y * w + x]!;
  return outp;
}
