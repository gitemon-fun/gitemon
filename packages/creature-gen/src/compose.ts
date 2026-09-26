import { hash32, rng, TYPE_INFO, type Shape, type TypeId } from '@gitemon/shared';
import { HALF, SIZE, decodePx, type ArtSet, type PixelSprite } from './art.js';

export interface SpriteParams {
  id: number;
  t1: TypeId;
  t2: TypeId | null;
  sh: Shape;
  f: 1 | 2 | 3;
  s: 0 | 1;
  /** v5: a one-of-one species key (The Origin, The Guardians) that overrides the type's species */
  sp?: string | null;
}

/** Palette indices. 0 is transparent. */
export const P = {
  none: 0,
  outline: 1,
  base: 2,
  light: 3,
  dark: 4,
  accent: 5,
  accentDark: 6,
  eye: 7,
  pupil: 8,
  mouth: 9,
  feature: 10,
  featureDark: 11,
} as const;

export interface Sprite {
  size: number;
  /** SIZE*SIZE palette indices, row-major */
  px: Uint8Array;
  /** RGB hex per palette index (index 0 unused) */
  palette: string[];
}

// ---- colour helpers -------------------------------------------------------------------------

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function toHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
function shift(hex: string, dh: number, ds = 0, dl = 0): string {
  const [h, s, l] = toHsl(hexToRgb(hex));
  return fromHsl(h + dh, Math.max(0, Math.min(1, s + ds)), Math.max(0, Math.min(1, l + dl)));
}

function paletteFor(p: SpriteParams): string[] {
  const a = TYPE_INFO[p.t1].colors;
  const b = TYPE_INFO[p.t2 ?? p.t1].colors;
  let base = a[0];
  let accent = p.t2 ? b[0] : a[1];
  let feature = p.t2 ? b[1] : a[2];
  if (p.s) {
    // Shiny: a whole different colourway, seeded but fixed per creature.
    const turn = 120 + (hash32(`hue:${p.id}`) % 120);
    base = shift(base, turn, 0.1);
    accent = shift(accent, turn, 0.1);
    feature = shift(feature, turn, 0.1);
  }
  const out = new Array<string>(12).fill('#000000');
  out[P.outline] = shift(base, 0, -0.2, -0.45);
  out[P.base] = base;
  out[P.light] = shift(base, -6, 0, 0.14);
  out[P.dark] = shift(base, 8, 0, -0.16);
  out[P.accent] = accent;
  out[P.accentDark] = shift(accent, 8, 0, -0.18);
  out[P.eye] = '#f7f7f2';
  out[P.pupil] = '#15151b';
  out[P.mouth] = shift(base, 0, -0.2, -0.38);
  out[P.feature] = feature;
  out[P.featureDark] = shift(feature, 8, 0, -0.2);
  return out;
}

// ---- type patterns: which body cells take the accent colour ---------------------------------

const PATTERNS: Record<TypeId, (x: number, y: number) => boolean> = {
  forge: (x, y) => (x + y * 2) % 7 === 0,
  iron: (x) => x % 4 === 0,
  serpent: (x, y) => (x * 3 + y * 5) % 11 === 0,
  spark: (x, y) => (x + y) % 6 === 0,
  prism: (x, y) => (x + y) % 2 === 0 && y % 4 === 0,
  tide: (_x, y) => y % 4 === 0,
  frost: (x, y) => (x % 5 === 0 && y % 3 === 0) || (x % 5 === 2 && y % 3 === 1),
  garnet: (x, y) => (x * 7 + y * 3) % 13 === 0,
  moss: (x, y) => (x * 2 + y) % 9 === 0,
  wing: (x, y) => y % 5 === 0 && x % 2 === 0,
  rune: (x, y) => (x * y) % 7 === 3,
  shade: (_x, y) => y % 6 === 0,
  bloom: (x, y) => (x * 5 + y * 3) % 8 === 0,
  coral: (x, y) => (x + y * 3) % 8 === 0,
  quill: (_x, y) => y % 3 === 0,
  stone: (x, y) => (x * 11 + y * 7) % 10 === 0,
  wild: (x, y) => (x * 13 + y * 17) % 19 === 0,
  machine: (x, y) => x % 3 === 0 && y % 3 === 0,
};

// ---- composition ------------------------------------------------------------------------------

export function compose(art: ArtSet, p: SpriteParams): Sprite {
  const drawn =
    (p.sp ? art.species?.[p.sp] : undefined) ??
    art.species?.[`${p.t1}-${p.f}`] ??
    art.species?.[`${p.t1}-1`];
  if (drawn) return composeSpecies(drawn, p);
  const rand = rng(hash32(`sprite:${p.id}`));
  const tpl = art.shapes[p.sh];
  // 1. resolve the half template (seeded '?' cells) into a full grid of codes
  const grid: string[] = new Array(SIZE * SIZE).fill('.');
  for (let y = 0; y < SIZE; y++) {
    const row = tpl[y] ?? '';
    for (let x = 0; x < HALF; x++) {
      let c = row[x] ?? '.';
      if (c === '?') c = rand() < 0.55 ? '#' : '.';
      grid[y * SIZE + x] = c;
      grid[y * SIZE + (SIZE - 1 - x)] = c;
    }
  }
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= SIZE || y >= SIZE ? '.' : grid[y * SIZE + x]!;
  const set = (x: number, y: number, c: string) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    if (grid[y * SIZE + x] === '.') {
      grid[y * SIZE + x] = c;
      grid[y * SIZE + (SIZE - 1 - x)] = c;
    }
  };
  const solid = (c: string) => c !== '.';

  // 2. evolution features, grown from the body edge so they always attach
  let top = SIZE;
  let bottom = 0;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < HALF; x++)
      if (solid(at(x, y))) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  const leftEdge = (y: number) => {
    for (let x = 0; x < HALF; x++) if (solid(at(x, y))) return x;
    return -1;
  };
  if (p.f >= 2) {
    // horns / ears from the top row, leaning out
    const hornStyle = hash32(`horn:${p.id}`) % 3;
    const lx = leftEdge(top);
    if (lx >= 0) {
      const hx = Math.min(HALF - 2, lx + 1);
      const len = 2 + hornStyle;
      for (let i = 1; i <= len; i++)
        set(hx - (hornStyle === 2 ? Math.floor(i / 2) : i - 1), top - i, 'F');
    }
  }
  if (p.f >= 3) {
    // wings from the middle band, plus a crest on the centre line
    const mid = Math.floor((top + bottom) / 2);
    const profile = [1, 2, 3, 4, 4, 3, 2, 1];
    profile.forEach((w, i) => {
      const y = mid - 3 + i;
      const lx = leftEdge(y);
      if (lx < 0) return;
      for (let k = 1; k <= w; k++) set(lx - k, y, k === w ? 'f' : 'F');
    });
    for (let i = 1; i <= 2; i++) set(HALF - 1, top - i, 'F');
  }

  // 3. paint: body shading, type pattern, eyes, outline
  const px = new Uint8Array(SIZE * SIZE);
  const pattern = PATTERNS[p.t2 ?? p.t1];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const c = at(x, y);
      let v: number = P.none;
      if (c === '#') {
        const hx = x < HALF ? x : SIZE - 1 - x; // pattern symmetric
        const outer = x < HALF ? x - 1 : x + 1; // mirror-safe: light from above and outside
        if (!solid(at(x, y - 1))) v = P.light;
        else if (!solid(at(x, y + 1))) v = P.dark;
        else if (!solid(at(outer, y))) v = y < SIZE / 2 ? P.light : P.dark;
        else v = pattern(hx, y) ? P.accent : P.base;
      } else if (c === 'a') v = solid(at(x, y + 1)) ? P.accent : P.accentDark;
      else if (c === 'e') v = P.eye;
      else if (c === 'p') v = P.pupil;
      else if (c === 'm') v = P.mouth;
      else if (c === 'F') v = P.feature;
      else if (c === 'f') v = P.featureDark;
      px[y * SIZE + x] = v;
    }
  // outline: empty cells touching the creature
  const out = px.slice();
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      if (px[y * SIZE + x] !== P.none) continue;
      const n = (xx: number, yy: number) =>
        xx >= 0 && yy >= 0 && xx < SIZE && yy < SIZE && px[yy * SIZE + xx] !== P.none;
      if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1)) out[y * SIZE + x] = P.outline;
    }
  return { size: SIZE, px: out, palette: paletteFor(p) };
}

/** RGBA pixels, scaled by an integer factor (nearest neighbour). */
export function toRgba(sp: Sprite, scale = 1): Uint8ClampedArray<ArrayBuffer> {
  const n = sp.size * scale;
  const out = new Uint8ClampedArray(n * n * 4);
  const rgb = sp.palette.map(hexToRgb);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = sp.px[Math.floor(y / scale) * sp.size + Math.floor(x / scale)]!;
      if (i === P.none) continue;
      const c = rgb[i]!;
      const o = (y * n + x) * 4;
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
      out[o + 3] = 255;
    }
  return out;
}

// ---- designed species (DECISIONS D25) -----------------------------------------------------------

/** Canvas for designed species: the creature (≤48 px) plus room for accessories. */
export const SPECIES_CANVAS = 80;

/** Small drawn accessories that show the work-shape. Codes index ACC_COLORS. */
const ACC_COLORS = [
  '#000000',
  '#1e1a24',
  '#8a5a36',
  '#b8c0c8',
  '#f2c94c',
  '#7fd4ff',
  '#3fa060',
  '#ff6fb5',
  '#35e0d0',
];
const ACCESSORY: Record<
  Shape,
  { rows: string[]; anchor: 'right' | 'left' | 'top' | 'leftLow' | 'topWide' }
> = {
  builder: {
    anchor: 'right',
    rows: ['11111', '13331', '13331', '11211', '..2..', '..2..', '..2..', '..2..', '..1..'],
  },
  reviewer: {
    anchor: 'left',
    rows: ['.111.', '15551', '15551', '15551', '.111.', '...21', '....2'],
  },
  maintainer: { anchor: 'top', rows: ['1.1.1', '14141', '14441', '11111'] },
  steady: { anchor: 'leftLow', rows: ['11111', '16661', '16461', '16661', '.161.', '..1..'] },
  polyglot: { anchor: 'topWide', rows: ['8.....7.....4', '.............', '...8.....4...'] },
};

function shiftHex(hex: string, dh: number, dl = 0): string {
  const [h, s, l] = toHsl(hexToRgb(hex));
  if (l < 0.16) return hex; // keep outlines and pupils
  return fromHsl(h + dh, s, Math.max(0, Math.min(1, l + dl)));
}

function composeSpecies(src: PixelSprite, p: SpriteParams): Sprite {
  const N = SPECIES_CANVAS;
  const idx = decodePx(src);
  // individual variation: a small seeded hue/lightness jitter; shiny = a whole other colourway
  const hv = hash32(`hue:${p.id}`);
  const dh = p.s ? 150 + (hv % 60) : ((hv % 21) - 10) * 1.2;
  const dl = p.s ? 0.04 : (((hv >>> 8) % 9) - 4) * 0.01;
  const palette = ['#000000', ...src.palette.slice(1).map((c) => shiftHex(c, dh, dl))];
  const accBase = palette.length;
  palette.push(...ACC_COLORS.slice(1));
  const px = new Uint8Array(N * N);
  const ox = Math.floor((N - src.w) / 2);
  const oy = N - src.h - 1;
  let x0 = N,
    y0 = N,
    x1 = 0,
    y1 = 0;
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const v = idx[y * src.w + x]!;
      if (!v) continue;
      px[(oy + y) * N + ox + x] = v;
      x0 = Math.min(x0, ox + x);
      x1 = Math.max(x1, ox + x);
      y0 = Math.min(y0, oy + y);
      y1 = Math.max(y1, oy + y);
    }
  const acc = ACCESSORY[p.sh];
  const aw = acc.rows[0]!.length;
  const ah = acc.rows.length;
  const midY = Math.floor((y0 + y1) / 2);
  const [ax, ay] =
    acc.anchor === 'right'
      ? [Math.min(N - aw, x1 - 1), midY - 2]
      : acc.anchor === 'left'
        ? [Math.max(0, x0 - aw + 2), midY - 1]
        : acc.anchor === 'leftLow'
          ? [Math.max(0, x0 - 2), y1 - ah - 1]
          : acc.anchor === 'top'
            ? [Math.floor((x0 + x1 - aw) / 2), Math.max(0, y0 - ah + 1)]
            : [Math.floor((x0 + x1 - aw) / 2), Math.max(0, y0 - ah - 2)];
  acc.rows.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      const ch = row[rx]!;
      if (ch === '.') continue;
      const x = ax + rx;
      const y = ay + ry;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      px[y * N + x] = accBase + Number(ch) - 1;
    }
  });
  return { size: N, px, palette };
}
