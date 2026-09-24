/** Contact sheet of creatures → PNG, for eyeballing art. pnpm tsx scripts/sheet.ts [real] out.png */
import { writeFileSync, existsSync } from 'node:fs';
import { SHAPES, TYPES } from '@gitemon/shared';
import {
  compose,
  encodeIndexedPng,
  placeholderArt,
  SIZE,
  type ArtSet,
} from '@gitemon/creature-gen';

const useReal = process.argv[2] === 'real';
const out = process.argv[3] ?? 'scripts/.cache/sheet.png';
let art: ArtSet = placeholderArt;
if (useReal) {
  const p = new URL('../packages/creature-gen/art-real/index.ts', import.meta.url);
  if (!existsSync(p)) throw new Error('no real art checked out');
  art = (await import(p.href)).realArt;
}
const S = 4,
  PAD = 4,
  cell = SIZE * S + PAD;
const cols = 15,
  rows = 12;
const W = cols * cell,
  H = rows * cell;
// shared palette: 0 bg, then per-cell palettes can't share — so render RGBA via truecolor PNG instead
const rgba = new Uint8Array(W * H * 3).fill(40);
let k = 0;
for (let r = 0; r < rows; r++)
  for (let c = 0; c < cols; c++, k++) {
    const t1 = TYPES[k % TYPES.length]!;
    const sh = SHAPES[Math.floor(k / TYPES.length) % SHAPES.length]!;
    const f = ((Math.floor(k / 7) % 3) + 1) as 1 | 2 | 3;
    const sp = compose(art, {
      id: 1000 + k * 7919,
      t1,
      t2: k % 4 === 0 ? TYPES[(k * 5) % 16]! : null,
      sh,
      f,
      s: k % 23 === 0 ? 1 : 0,
    });
    for (let y = 0; y < SIZE * S; y++)
      for (let x = 0; x < SIZE * S; x++) {
        const i = sp.px[Math.floor(y / S) * SIZE + Math.floor(x / S)]!;
        if (!i) continue;
        const n = parseInt(sp.palette[i]!.slice(1), 16);
        const o = ((r * cell + y + 2) * W + (c * cell + x + 2)) * 3;
        rgba[o] = (n >> 16) & 255;
        rgba[o + 1] = (n >> 8) & 255;
        rgba[o + 2] = n & 255;
      }
  }
// quantise into a palette PNG (<=256 colours in practice)
const pal = new Map<number, number>();
const idx = new Uint8Array(W * H);
const palette: string[] = [];
for (let i = 0; i < W * H; i++) {
  const v = (rgba[i * 3]! << 16) | (rgba[i * 3 + 1]! << 8) | rgba[i * 3 + 2]!;
  let p = pal.get(v);
  if (p === undefined) {
    p = palette.length;
    pal.set(v, p);
    palette.push('#' + v.toString(16).padStart(6, '0'));
  }
  idx[i] = p;
}
if (palette.length > 256) throw new Error('too many colours ' + palette.length);
writeFileSync(out, encodeIndexedPng(W, H, idx, palette, false));
console.log('wrote', out, palette.length, 'colours');
