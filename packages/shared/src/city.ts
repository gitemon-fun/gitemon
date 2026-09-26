import type { TypeId } from './types.js';
import { BIOME_ORDER } from './world.js';
import { hash32 } from './hash.js';

/**
 * Gitemon City layout (GRANDPLAN v2 §4–§5). A pure, seeded function: district populations in,
 * streets / blocks / lots / spots out. Nothing here is stored — every client derives the same city.
 *
 *   plaza (centre) → canal ring → 18 district wedges, each a set of bands between ring roads,
 *   split by a middle avenue; band 1 of every district is its square (stars + landmark).
 *   Creatures stand on spots: plaza rings, squares, sidewalks (two rows), house doors.
 * Units are metres-ish; y is up in the renderer, this module works in the ground plane (x, z).
 */

export const PLAZA_R = 34;
export const CANAL_IN = 38;
export const CANAL_OUT = 45;
export const RING0 = 49; // first ring road
export const BAND = 26; // distance between ring roads
export const ROAD = 3.5; // road width (v3: narrower, G3)
export const AVENUE = 5; // radial avenue width
/** sidewalk width on each side of every road */
export const SW = 2.4;
/** depth of a row of buildings along a block edge (v3 §5) */
export const ROW = 5.6;
export const MAX_BANDS = 24;
/** how far a street resident walks either way from its spot */
export const WALK = 3.6;
const SPACING = 4.0;
const SQUARE_SPACING = 3.3;
const ROWS = [ROAD / 2 + 0.7, ROAD / 2 + 1.7];

export type SpotKind = 'plaza' | 'square' | 'street' | 'door' | 'court' | 'doorway';

export interface Spot {
  x: number;
  z: number;
  /** district index into BIOME_ORDER, or -1 for the plaza */
  d: number;
  kind: SpotKind;
  /** walking direction along the sidewalk (unit vector); 0,0 = stands still */
  tx: number;
  tz: number;
}

/**
 * One building plot in a row along a block edge (v3 §5). Rows share walls: the plots of a row
 * touch. The front faces the street (fx, fz); `w` runs along the street, `depth` away from it.
 */
export interface Lot {
  x: number;
  z: number;
  w: number;
  depth: number;
  /** unit vector the front faces (toward its street) */
  fx: number;
  fz: number;
  storeys: number;
  d: number;
  house: boolean;
  /** the plot at the end of a row, where two streets meet (tallest in its block, V3-D5) */
  corner: boolean;
  /** stable per-plot seed for the building kit */
  seed: number;
  /** the previous plot in the same row, or -1 (the kit keeps neighbours different, G1) */
  prev: number;
  /** band index (0 = next to the canal); band 1 is the square */
  band: number;
}

export interface Road {
  /** polyline points in the ground plane */
  pts: [number, number][];
  w: number;
  kind: 'ring' | 'avenue' | 'street';
}

export interface District {
  t: TypeId;
  index: number;
  a0: number;
  a1: number;
  bands: number;
  /** square centre + half-size */
  square: { x: number; z: number; r: number };
  labelAt: [number, number];
}

/** the open inside of a block, between its rows (an annular sector) */
export interface Court {
  d: number;
  r0: number;
  r1: number;
  a0: number;
  a1: number;
  tree: boolean;
}

export interface City {
  districts: District[];
  roads: Road[];
  lots: Lot[];
  /** spot lists: plaza (inner first), and per district: square first, then streets outward */
  plaza: Spot[];
  spots: Spot[][];
  /** house doors per district, nearest the square first (V2-D5: claim order fills them) */
  doors: Spot[][];
  /** for each door, the index of its house in `lots` */
  doorLots: number[][];
  courts: Court[];
  radius: number;
}

const N = BIOME_ORDER.length;
const WEDGE = (Math.PI * 2) / N;
const polar = (r: number, a: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
const rnd = (seed: string) => hash32(seed) / 4294967296;

/**
 * Split a row of length `len` into plot widths that touch end to end: narrow, standard and wide
 * plots in a seeded mix. `corners` makes both ends square (ROW × ROW) corner plots.
 */
function splitRow(len: number, seed: string, corners: boolean): number[] {
  const MIN = 3.4;
  if (len < MIN * 1.5) return [Math.max(len, 1)];
  const out: number[] = [];
  let left = len;
  const endW = corners && len > ROW * 2 + MIN ? ROW : 0;
  if (endW) left -= endW * 2;
  for (let i = 0; left >= MIN; i++) {
    const u = rnd(`${seed}:${i}`);
    const w = u < 0.3 ? 3.4 + u * 2.6 : u < 0.75 ? 4.2 + (u - 0.3) * 2.2 : 5.2 + (u - 0.75) * 4;
    if (left - w < MIN) {
      out.push(left);
      left = 0;
      break;
    }
    out.push(w);
    left -= w;
  }
  if (left > 0 && out.length) {
    // spread a short remainder over the row so no sliver plot is left
    const add = left / out.length;
    for (let i = 0; i < out.length; i++) out[i]! += add;
  }
  return endW ? [endW, ...out, endW] : out;
}

/** storeys: taller next to the square (V3-D5), corners one more, neighbours step by ≤ 1 */
function storeysFor(band: number, corner: boolean, seed: number, prev: number): number {
  const near = band === 0 || band === 2 ? 1 : 0;
  let s = 1 + near + (rnd(`${seed}st`) < 0.45 ? 1 : 0);
  if (corner) s += 1;
  s = Math.min(3, s);
  if (prev) s = Math.max(prev - 1, Math.min(prev + 1, s));
  return s;
}

export function layout(pops: Partial<Record<TypeId, number>>, plazaTarget = 60): City {
  const districts: District[] = [];
  const roads: Road[] = [];
  const lots: Lot[] = [];
  const spots: Spot[][] = [];
  const doors: Spot[][] = [];
  const doorLots: number[][] = [];
  const courts: Court[] = [];
  let radius = RING0;

  BIOME_ORDER.forEach((t, d) => {
    // Machine Wastes sit last; wedges start at the top of the screen
    const a0 = -Math.PI / 2 + d * WEDGE;
    const a1 = a0 + WEDGE;
    const am = (a0 + a1) / 2;
    const sqR = BAND / 2 - ROAD / 2 - 1;
    const [sx, sz] = polar(RING0 + BAND * 1.5, am);
    // spots, square first
    const list: Spot[] = [];
    const sq: Spot[] = [];
    for (let gx = -sqR + 1.5; gx <= sqR - 1.5; gx += SQUARE_SPACING)
      for (let gz = -sqR + 1.5; gz <= sqR - 1.5; gz += SQUARE_SPACING) {
        if (Math.hypot(gx, gz) < 5) continue; // landmark
        sq.push({ x: sx + gx, z: sz + gz, d, kind: 'square', tx: 0, tz: 0 });
      }
    sq.sort((p, q) => Math.hypot(p.x - sx, p.z - sz) - Math.hypot(q.x - sx, q.z - sz));
    list.push(...sq);
    const street: (Spot & { r: number; k: number; p: number })[] = [];
    const door: (Spot & { lot: number })[] = [];

    const need = (pops[t] ?? 0) * 1.1 - sq.length;
    let bands = 0;
    for (let k = 0; k < MAX_BANDS && (k < 3 || street.length < need); k++) {
      bands = k + 1;
      if (k === 1) continue; // the square band
      const rIn = RING0 + k * BAND;
      const rOut = rIn + BAND;
      // inner bands are too narrow to split: the middle street starts where a half is still a block
      const split = (rIn + BAND / 2) * WEDGE > 48;
      if (split) roads.push({ pts: [polar(rIn, am), polar(rOut, am)], w: ROAD, kind: 'street' });
      // sidewalks along the two ring roads that bound the band (outer side of rIn, inner side of rOut)
      for (const [r, dir] of [
        [rIn, 1],
        [rOut, -1],
      ] as const) {
        for (const off of ROWS) {
          const rr = r + dir * off;
          const n = Math.floor((rr * (WEDGE - 0.04)) / SPACING);
          for (let s = 0; s < n; s++) {
            const a = a0 + 0.02 + ((s + 0.5) / n) * (WEDGE - 0.04);
            if (split && Math.abs(a - am) < 0.03) continue;
            const [x, z] = polar(rr, a);
            street.push({
              x,
              z,
              d,
              kind: 'street',
              r: rr,
              k,
              p: 2,
              tx: -Math.sin(a),
              tz: Math.cos(a),
            });
          }
        }
      }
      // sidewalks along the middle street and the two borders, inside the wedge
      for (const [a, sides] of [
        ...(split ? ([[am, [1, -1]]] as const) : []),
        [a0, [1]],
        [a1, [-1]],
      ] as const) {
        for (const side of sides)
          for (const off of ROWS) {
            const n = Math.floor((BAND - ROAD - 4) / SPACING);
            for (let s = 0; s < n; s++) {
              const r = rIn + ROAD / 2 + 2 + (s + 0.5) * SPACING;
              const perp = side * (off + (a === am ? 0 : AVENUE / 2 - ROAD / 2));
              const [x0, z0] = polar(r, a);
              const x = x0 - Math.sin(a) * perp;
              const z = z0 + Math.cos(a) * perp;
              street.push({
                x,
                z,
                d,
                kind: 'street',
                r,
                k,
                p: 2,
                tx: Math.cos(a),
                tz: Math.sin(a),
              });
            }
          }
      }
      // blocks: each half-band between the ring roads, the middle street and the border avenue.
      // Buildings stand in rows along every street edge; the inside is a court (v3 §5).
      const rB0 = rIn + ROAD / 2 + SW;
      const rB1 = rOut - ROAD / 2 - SW;
      for (const half of split ? [0, 1] : [2]) {
        const ha0 = half === 1 ? am : a0;
        const ha1 = half === 0 ? am : a1;
        const m0 = (half === 1 ? ROAD / 2 : AVENUE / 2) + SW;
        const m1 = (half === 0 ? ROAD / 2 : AVENUE / 2) + SW;
        const rM = (rB0 + rB1) / 2;
        const sides = rM * (ha1 - ha0) - m0 - m1 > ROW * 2 + 5;
        const bseed = `${t}:${k}:${half}`;
        // rows along the two ring roads: front faces the road, corners at both ends
        for (const [rC, face] of [
          [rB0 + ROW / 2, -1],
          [rB1 - ROW / 2, 1],
        ] as const) {
          const span = rC * (ha1 - ha0) - m0 - m1;
          const widths = splitRow(span, `${bseed}:${face}`, true);
          let at = 0;
          let prev = -1;
          widths.forEach((w, s) => {
            const a = ha0 + (m0 + at + w / 2) / rC;
            at += w;
            const [x, z] = polar(rC, a);
            const seed = hash32(`${bseed}:${face}:${s}`);
            const corner = s === 0 || s === widths.length - 1;
            const house = k >= 2 && !corner && rnd(`${seed}h`) < 0.7;
            const storeys = storeysFor(k, corner, seed, prev < 0 ? 0 : lots[prev]!.storeys);
            lots.push({
              x,
              z,
              w: w + 0.12,
              depth: ROW,
              fx: Math.cos(a) * face,
              fz: Math.sin(a) * face,
              storeys,
              d,
              house,
              corner,
              seed,
              prev,
              band: k,
            });
            const li = lots.length - 1;
            prev = li;
            const [ex, ez] = polar(rC + face * (ROW / 2 + 0.9), a);
            if (house) door.push({ x: ex, z: ez, d, kind: 'door', tx: 0, tz: 0, lot: li });
            else if (!corner && rnd(`${seed}w`) < 0.35) {
              const [wx, wz] = polar(rC + face * (ROW / 2 + 0.6), a);
              street.push({ x: wx, z: wz, d, kind: 'doorway', r: rC, k, p: 1, tx: 0, tz: 0 });
            }
          });
        }
        // side rows along the radial streets, between the two ring rows (wide blocks only)
        let c0 = ha0 + m0 / rM;
        let c1 = ha1 - m1 / rM;
        if (sides) {
          for (const side of [0, 1]) {
            const widths = splitRow(rB1 - rB0 - ROW * 2, `${bseed}:s${side}`, false);
            let at = rB0 + ROW;
            let prev = -1;
            widths.forEach((w, s) => {
              const r = at + w / 2;
              at += w;
              const a = side ? ha1 - (m1 + ROW / 2) / r : ha0 + (m0 + ROW / 2) / r;
              const [x, z] = polar(r, a);
              const dir = side ? 1 : -1;
              const seed = hash32(`${bseed}:s${side}:${s}`);
              lots.push({
                x,
                z,
                w: w + 0.12,
                depth: ROW,
                fx: -Math.sin(a) * dir,
                fz: Math.cos(a) * dir,
                storeys: storeysFor(k, false, seed, prev < 0 ? 0 : lots[prev]!.storeys),
                d,
                house: false,
                corner: false,
                seed,
                prev,
                band: k,
              });
              prev = lots.length - 1;
            });
          }
          c0 = ha0 + (m0 + ROW) / rM;
          c1 = ha1 - (m1 + ROW) / rM;
        }
        // the court: residents gather here first (v3 §8); a tree marks the middle of wide courts
        const cr0 = rB0 + ROW + 1.2;
        const cr1 = rB1 - ROW - 1.2;
        const courtW = (c1 - c0) * rM;
        const hasTree = courtW >= 8;
        const [tx0, tz0] = polar(rM, (c0 + c1) / 2);
        for (let r = cr0; r <= cr1 + 0.01; r += 2.4) {
          const n = Math.floor(((c1 - c0) * r - 2.4) / 2.6);
          for (let s = 0; s < n; s++) {
            const a = c0 + (1.2 + (s + 0.5) * (((c1 - c0) * r - 2.4) / n)) / r;
            const [x, z] = polar(r, a);
            if (hasTree && Math.hypot(x - tx0, z - tz0) < 2) continue;
            street.push({ x, z, d, kind: 'court', r, k, p: 0, tx: 0, tz: 0 });
          }
        }
        courts.push({ d, r0: rB0 + ROW, r1: rB1 - ROW, a0: c0, a1: c1, tree: hasTree });
      }
    }
    const rOuter = RING0 + bands * BAND;
    radius = Math.max(radius, rOuter);
    districts.push({
      t,
      index: d,
      a0,
      a1,
      bands,
      square: { x: sx, z: sz, r: sqR },
      labelAt: polar(rOuter + 10, am),
    });
    // roads: ring roads (as arcs), the border avenue at a0 (shared), the middle street (not through the square)
    for (let k = 0; k <= bands; k++) {
      const r = RING0 + k * BAND;
      const pts: [number, number][] = [];
      for (let s = 0; s <= 6; s++) pts.push(polar(r, a0 + (WEDGE * s) / 6));
      roads.push({ pts, w: ROAD, kind: 'ring' });
    }
    roads.push({ pts: [polar(CANAL_OUT + 3.5, a0), polar(rOuter, a0)], w: AVENUE, kind: 'avenue' });
    // courts first, then doorways, then sidewalks — band by band, outward (v3 §5)
    street.sort((p, q) => p.k - q.k || p.p - q.p || p.r - q.r);
    list.push(...street.map(({ x, z, d: dd, kind, tx, tz }) => ({ x, z, d: dd, kind, tx, tz })));
    spots.push(list);
    door.sort((p, q) => Math.hypot(p.x - sx, p.z - sz) - Math.hypot(q.x - sx, q.z - sz));
    doors.push(door.map(({ x, z, d: dd, kind, tx, tz }) => ({ x, z, d: dd, kind, tx, tz })));
    doorLots.push(door.map((p) => p.lot));
  });

  // plaza rings, inner first (the monument stands in the middle); plaza residents stroll their ring
  const plaza: Spot[] = [];
  for (let r = 9; r <= PLAZA_R - 3 && plaza.length < plazaTarget * 2; r += 3.4) {
    const n = Math.floor((Math.PI * 2 * r) / 4.2);
    for (let s = 0; s < n; s++) {
      const a = (s / n) * Math.PI * 2 + r;
      const [x, z] = polar(r, a);
      plaza.push({ x, z, d: -1, kind: 'plaza', tx: -Math.sin(a), tz: Math.cos(a) });
    }
  }
  // nobody stands on a ruler line: a small seeded offset along the walk (or anywhere, when standing)
  const loosen = (sp: Spot, k: string) => {
    const u = rnd(`jx${k}`) - 0.5;
    const v = rnd(`jz${k}`) - 0.5;
    if (sp.tx || sp.tz) {
      sp.x += sp.tx * u * SPACING * 0.7 - sp.tz * v * 0.5;
      sp.z += sp.tz * u * SPACING * 0.7 + sp.tx * v * 0.5;
    } else {
      sp.x += u * 1.1;
      sp.z += v * 1.1;
    }
  };
  plaza.forEach((sp, i) => loosen(sp, `p${i}`));
  spots.forEach((list, d) => list.forEach((sp, i) => loosen(sp, `${d}:${i}`)));
  return { districts, roads, lots, plaza, spots, doors, doorLots, courts, radius };
}
