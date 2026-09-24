import {
  compose,
  encodeIndexedPng,
  SIZE,
  type ArtSet,
  type SpriteParams,
} from '@gitemon/creature-gen';
import { art } from '@gitemon/art';
import { SHAPE_NAME, TYPE_INFO, type TypeId } from '@gitemon/shared';

// 5x7 pixel font, rows of 5 bits. Lowercase renders as uppercase.
const G: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 17, 25, 21, 19, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 12, 12],
  '-': [0, 0, 0, 31, 0, 0, 0],
  _: [0, 0, 0, 0, 0, 0, 31],
  ':': [0, 12, 12, 0, 12, 12, 0],
  '+': [0, 4, 4, 31, 4, 4, 0],
  '/': [1, 2, 2, 4, 8, 8, 16],
  '[': [14, 8, 8, 8, 8, 8, 14],
  ']': [14, 2, 2, 2, 2, 2, 14],
  '?': [14, 17, 1, 2, 4, 0, 4],
};

class Canvas {
  px: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
    fill: number,
  ) {
    this.px = new Uint8Array(w * h).fill(fill);
  }
  rect(x: number, y: number, w: number, h: number, c: number) {
    x = Math.floor(x);
    y = Math.floor(y);
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++)
      this.px.fill(c, yy * this.w + Math.max(0, x), yy * this.w + Math.min(this.w, x + w));
  }
  text(s: string, x: number, y: number, scale: number, c: number) {
    let cx = x;
    for (const ch of s.toUpperCase()) {
      const g = G[ch] ?? G['?']!;
      g.forEach((row, ry) => {
        for (let rx = 0; rx < 5; rx++)
          if (row & (1 << (4 - rx))) this.rect(cx + rx * scale, y + ry * scale, scale, scale, c);
      });
      cx += 6 * scale;
    }
    return cx;
  }
  static width(s: string, scale: number) {
    return s.length * 6 * scale - scale;
  }
}

export interface OgInput extends SpriteParams {
  login: string;
  level: number;
}

/** 600x315 share card (pixel art; kept small so it renders inside the Worker CPU budget). */
export function ogPng(o: OgInput, artSet: ArtSet = art): Uint8Array {
  const W = 600;
  const H = 315;
  const sp = compose(artSet, o);
  const info = TYPE_INFO[o.t1 as TypeId];
  const OFF = 6; // sprite palette offset
  const palette = [
    info.ground,
    '#0f1115',
    '#ffffff',
    '#aab2bd',
    info.colors[0],
    '#1a1d23',
    ...sp.palette,
  ];
  const c = new Canvas(W, H, 0);
  c.rect(0, H - 44, W, 44, 1);
  // sprite x8
  const S = 8;
  const sx = 36;
  const sy = Math.floor((H - 44 - SIZE * S) / 2);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const v = sp.px[y * SIZE + x]!;
      if (v) c.rect(sx + x * S, sy + y * S, S, S, OFF + v);
    }
  const tx = sx + SIZE * S + 28;
  const maxW = W - tx - 24;
  const login = o.login;
  const ls = Canvas.width(login, 4) <= maxW ? 4 : Canvas.width(login, 3) <= maxW ? 3 : 2;
  c.text(login.slice(0, Math.floor((maxW + ls) / (6 * ls))), tx, 48, ls, 2);
  c.text(`LV ${o.level}`, tx, 48 + 8 * ls + 16, 5, 4);
  const types = o.t2 ? `${TYPE_INFO[o.t1].name} / ${TYPE_INFO[o.t2].name}` : TYPE_INFO[o.t1].name;
  c.text(types, tx, 48 + 8 * ls + 16 + 50, 3, 2);
  c.text(
    `${SHAPE_NAME[o.sh]} - FORM ${o.f}${o.s ? ' - SHINY' : ''}`,
    tx,
    48 + 8 * ls + 16 + 50 + 32,
    2,
    3,
  );
  c.text('GITEMON.FUN', W - Canvas.width('GITEMON.FUN', 3) - 20, H - 32, 3, 2);
  c.text(info.biome, 20, H - 30, 2, 3);
  return encodeIndexedPng(W, H, c.px, palette, false, 6);
}

export function spritePng(p: SpriteParams, scale: number): Uint8Array {
  const sp = compose(art, p);
  const n = SIZE * scale;
  const out = new Uint8Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      out[y * n + x] = sp.px[Math.floor(y / scale) * SIZE + Math.floor(x / scale)]!;
  return encodeIndexedPng(n, n, out, sp.palette);
}
