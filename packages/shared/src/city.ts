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
export const ROAD = 5; // road width
export const AVENUE = 7; // radial avenue width
export const MAX_BANDS = 24;
/** how far a street resident walks either way from its spot */
export const WALK = 3.6;
const SPACING = 2.9;
const SQUARE_SPACING = 3.3;
const ROWS = [ROAD / 2 + 1.1, ROAD / 2 + 2.5];

export type SpotKind = 'plaza' | 'square' | 'street' | 'door';

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

export interface Lot {
  x: number;
  z: number;
  /** footprint along the road, across the road */
  w: number;
  depth: number;
  /** rotation around the vertical axis (radians) */
  rot: number;
  h: number;
  d: number;
  house: boolean;
  /** which road the front faces: 1 = the inner ring road, -1 = the outer one */
  face: 1 | -1;
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

export interface City {
  districts: District[];
  roads: Road[];
  lots: Lot[];
  /** spot lists: plaza (inner first), and per district: square first, then streets outward */
  plaza: Spot[];
  spots: Spot[][];
  doors: Spot[][];
  radius: number;
}

const N = BIOME_ORDER.length;
const WEDGE = (Math.PI * 2) / N;
const polar = (r: number, a: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
const rnd = (seed: string) => hash32(seed) / 4294967296;

export function layout(pops: Partial<Record<TypeId, number>>, plazaTarget = 60): City {
  const districts: District[] = [];
  const roads: Road[] = [];
  const lots: Lot[] = [];
  const spots: Spot[][] = [];
  const doors: Spot[][] = [];
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
    const street: (Spot & { r: number })[] = [];
    const door: Spot[] = [];

    const need = (pops[t] ?? 0) * 1.1 - sq.length;
    let bands = 0;
    for (let k = 0; k < MAX_BANDS && (k < 3 || street.length < need); k++) {
      bands = k + 1;
      if (k === 1) continue; // the square band
      const rIn = RING0 + k * BAND;
      const rOut = rIn + BAND;
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
            if (Math.abs(a - am) < 0.02) continue;
            const [x, z] = polar(rr, a);
            street.push({ x, z, d, kind: 'street', r: rr, tx: -Math.sin(a), tz: Math.cos(a) });
          }
        }
      }
      // sidewalks along the middle street and the two borders, inside the wedge
      for (const [a, sides] of [
        [am, [1, -1]],
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
              street.push({ x, z, d, kind: 'street', r, tx: Math.cos(a), tz: Math.sin(a) });
            }
          }
      }
      // lots: two rows per half-block, facing the ring roads
      for (const half of [0, 1]) {
        const ha0 = half ? am : a0;
        const ha1 = half ? a1 : am;
        for (const [row, face] of [
          [0, 1],
          [1, -1],
        ] as const) {
          const depth = BAND / 2 - ROAD / 2 - 4.2;
          const rC =
            row === 0 ? rIn + ROAD / 2 + 3.4 + depth / 2 : rOut - ROAD / 2 - 3.4 - depth / 2;
          // keep clear of the border avenue and the middle street (and their sidewalks)
          const m0 = (half ? ROAD / 2 : AVENUE / 2) + 3.4;
          const m1 = (half ? AVENUE / 2 : ROAD / 2) + 3.4;
          const arcLen = rC * (ha1 - ha0) - m0 - m1;
          const n = Math.max(1, Math.round(arcLen / 9));
          for (let s = 0; s < n; s++) {
            const a = ha0 + m0 / rC + ((s + 0.5) / n) * (arcLen / rC);
            const [x, z] = polar(rC, a);
            const seed = `${t}:${k}:${half}:${row}:${s}`;
            const house = k >= 2 && row === 0 && rnd(seed + 'h') < 0.45;
            const downtown = Math.max(0, 1 - k / 6);
            const h = house ? 4.5 : 5 + rnd(seed) * 9 + downtown * 7;
            lots.push({ x, z, w: (arcLen / n) * 0.82, depth, rot: -a, h, d, house, face });
            if (house) {
              const [dx, dz] = polar(rC - (depth / 2 + 1.2) * face, a);
              door.push({ x: dx, z: dz, d, kind: 'door', tx: 0, tz: 0 });
            }
          }
        }
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
    roads.push({ pts: [polar(CANAL_OUT - 1, a0), polar(rOuter, a0)], w: AVENUE, kind: 'avenue' });
    roads.push({ pts: [polar(RING0, am), polar(RING0 + BAND, am)], w: ROAD, kind: 'street' });
    if (bands > 2)
      roads.push({
        pts: [polar(RING0 + BAND * 2, am), polar(rOuter, am)],
        w: ROAD,
        kind: 'street',
      });
    street.sort((p, q) => p.r - q.r);
    list.push(...street.map(({ x, z, d: dd, kind, tx, tz }) => ({ x, z, d: dd, kind, tx, tz })));
    spots.push(list);
    doors.push(door);
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
  return { districts, roads, lots, plaza, spots, doors, radius };
}
