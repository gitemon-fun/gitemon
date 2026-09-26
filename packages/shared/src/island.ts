import type { TypeId } from './types.js';
import { BIOME_ORDER } from './world.js';
import { hash32 } from './hash.js';

/**
 * Gitemon Island layout (GRANDPLAN v4 §4–§8). A pure, seeded function: type populations in; the
 * land, its nine climate regions, rivers, habitats, the centre town and every spot out. Nothing is
 * stored — every client derives the same island.
 *
 *   centre town (plaza, canal, two rows of houses, gates) → nine regions as lobes from the town
 *   to the coast; borders are warped (never straight) and are either a river or a ridge.
 *   Rank = distance to the centre (V4-D3): habitats nearest the town fill first.
 * Units are metres; y is up; this module works in the ground plane (x, z) plus `height(x, z)`.
 */

export const PLAZA_R = 34;
export const CANAL_IN = 38;
export const CANAL_OUT = 45;
export const TOWN_R = 72;
export const COAST = 246;
export const TOWN_Y = 0.6;
/** the one water plane: sea, rivers, lakes and the canal are wherever the land is below it */
export const WATER_Y = 0.15;
export const ROAD = 3.5;
export const SW = 2.4;
export const ROW = 5.6;
export const WALK = 3.6;
/** town streets (ring roads) and house rows */
export const STREET_IN = 48;
export const STREET_OUT = 64.6;

export type ClimateId =
  'frost' | 'marsh' | 'bloom' | 'tide' | 'jungle' | 'volcano' | 'canyon' | 'crystal' | 'savanna';

/** the nine regions, clockwise from north on screen (§4); `river` = its clockwise border is a river */
export const REGIONS: { climate: ClimateId; name: string; types: TypeId[]; river: boolean }[] = [
  { climate: 'frost', name: 'Frost Peaks', types: ['frost', 'stone'], river: true },
  { climate: 'marsh', name: 'Mist Marsh', types: ['shade', 'rune'], river: false },
  { climate: 'bloom', name: 'Bloom Cliffs', types: ['bloom', 'wing'], river: true },
  { climate: 'tide', name: 'Tide Coast', types: ['tide', 'coral'], river: false },
  { climate: 'jungle', name: 'Green Jungle', types: ['serpent', 'moss'], river: true },
  { climate: 'volcano', name: 'Ember Volcano', types: ['forge', 'iron'], river: false },
  { climate: 'canyon', name: 'Red Canyon', types: ['garnet', 'quill'], river: false },
  { climate: 'crystal', name: 'Crystal Flats', types: ['prism', 'spark'], river: true },
  { climate: 'savanna', name: 'Wild Savanna', types: ['wild'], river: false },
];

export type SpotKind = 'plaza' | 'door' | 'wild' | 'street';

export interface Spot {
  x: number;
  z: number;
  y: number;
  /** type index into BIOME_ORDER, or -1 for the plaza */
  d: number;
  kind: SpotKind;
  /** walking direction (unit vector); 0,0 = stands still */
  tx: number;
  tz: number;
}

/** a house plot in a town row (the v3 kit builds on it) */
export interface Lot {
  x: number;
  z: number;
  y: number;
  w: number;
  depth: number;
  fx: number;
  fz: number;
  storeys: number;
  /** the skin: a type index into BIOME_ORDER */
  d: number;
  house: boolean;
  corner: boolean;
  seed: number;
  prev: number;
  band: number;
}

export interface Region {
  climate: ClimateId;
  name: string;
  types: TypeId[];
  /** base angles of its two borders (the warp is added by `borderAngle`) */
  a0: number;
  a1: number;
  /** base angle where its first type's half ends (paired regions) */
  split: number;
  mid: number;
  river: boolean;
}

export interface Habitat {
  x: number;
  z: number;
  y: number;
  t: TypeId;
  n: number;
}

export interface Island {
  regions: Region[];
  height: (x: number, z: number) => number;
  /** region index + type at a ground point (null = town or sea) */
  at: (x: number, z: number) => { region: number; type: TypeId } | null;
  roads: [number, number][][];
  /** bridges: where a river border crosses a town street (x, z, angle) */
  bridges: { x: number; z: number; a: number }[];
  lots: Lot[];
  plaza: Spot[];
  /** per type (BIOME_ORDER index): wild habitats, or the industrial quarter for machine */
  spots: Spot[][];
  /** town house doors, nearest the plaza first; doorLots[k] = its plot in `lots` */
  doors: Spot[];
  doorLots: number[];
  habitats: Habitat[];
  landmarks: { t: TypeId; region: number; x: number; z: number; y: number }[];
  /** v5: The Origin's spot on the monument, the two Guardians' plinths, Legendary 4–10's ring */
  monument: Spot;
  plinths: Spot[];
  legendRing: Spot[];
  /** v5: one mini plaza per region (Epic inner rings, Rare outer), at its landmark */
  miniPlazas: { x: number; z: number; y: number; r: number; region: number }[];
  /** per type (BIOME_ORDER index): its mini-plaza spots, inner ring first */
  mini: Spot[][];
  /** the machine quarter's angular window in the outer town row */
  quarter: { a0: number; a1: number };
  volcano: { x: number; z: number };
  /** the land sampled once on a grid (renderers and props read this, not `height`) */
  grid: HeightGrid;
  radius: number;
}

export interface HeightGrid {
  /** half-extent (m), cells per side, cell size (m) */
  E: number;
  N: number;
  cell: number;
  /** (N+1)² heights, row-major from (-E, -E) */
  h: Float32Array;
  /** (N+1)² region index; -1 town, -2 sea */
  region: Int16Array;
}

/** bilinear height from the grid */
export function gridHeight(g: HeightGrid, x: number, z: number): number {
  const fx = (x + g.E) / g.cell;
  const fz = (z + g.E) / g.cell;
  const i = Math.max(0, Math.min(g.N - 1, Math.floor(fx)));
  const j = Math.max(0, Math.min(g.N - 1, Math.floor(fz)));
  const tx = Math.min(1, Math.max(0, fx - i));
  const tz = Math.min(1, Math.max(0, fz - j));
  const k = j * (g.N + 1) + i;
  const a = g.h[k]!;
  const b = g.h[k + 1]!;
  const c = g.h[k + g.N + 1]!;
  const d = g.h[k + g.N + 2]!;
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}
/** region index at the nearest grid vertex */
export function gridRegion(g: HeightGrid, x: number, z: number): number {
  const i = Math.max(0, Math.min(g.N, Math.round((x + g.E) / g.cell)));
  const j = Math.max(0, Math.min(g.N, Math.round((z + g.E) / g.cell)));
  return g.region[j * (g.N + 1) + i]!;
}

// ---- noise ---------------------------------------------------------------------------------------

const TAU = Math.PI * 2;
/** integer lattice hash (no strings: the height field is sampled ~10^5 times per build) */
const lattice = (ix: number, iz: number, s: number) => {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(s, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const fade = (t: number) => t * t * (3 - 2 * t);
function vnoise(x: number, z: number, s: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = lattice(ix, iz, s);
  const b = lattice(ix + 1, iz, s);
  const c = lattice(ix, iz + 1, s);
  const d = lattice(ix + 1, iz + 1, s);
  return (a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz) * 2 - 1;
}
function fbm(x: number, z: number, s: number, oct = 3): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < oct; o++) {
    v += vnoise(x * f, z * f, s + o * 101) * amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return v;
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const polar = (r: number, a: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
/** wrap an angle into [0, TAU) */
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;
const rnd = (seed: string) => hash32(seed) / 4294967296;

// ---- the island ------------------------------------------------------------------------------------

export function island(
  pops: Partial<Record<TypeId, number>>,
  plazaTarget = 60,
  /** v5: how many Epic + Rare specials each type holds (sizes its mini plaza) */
  specials: Partial<Record<TypeId, number>> = {},
): Island {
  // region widths ∝ population (min 22°), frost centred at the top of the screen (-3π/4)
  const MIN = (22 / 180) * Math.PI;
  const weight = REGIONS.map((r) => r.types.reduce((s, t) => s + (pops[t] ?? 0), 0) + 1);
  const total = weight.reduce((s, w) => s + w, 0);
  let widths = weight.map((w) => (w / total) * TAU);
  const small = widths.filter((w) => w < MIN).length;
  if (small) {
    const spare = TAU - small * MIN;
    const bigSum = widths.filter((w) => w >= MIN).reduce((s, w) => s + w, 0);
    widths = widths.map((w) => (w < MIN ? MIN : (w / bigSum) * spare));
  }
  const start = -Math.PI * 0.75 - widths[0]! / 2;
  const regions: Region[] = [];
  let acc = start;
  REGIONS.forEach((def, i) => {
    const a0 = acc;
    const a1 = acc + widths[i]!;
    acc = a1;
    const [t0, t1] = def.types;
    const p0 = (pops[t0!] ?? 0) + 1;
    const p1 = t1 ? (pops[t1] ?? 0) + 1 : 0;
    regions.push({
      ...def,
      a0,
      a1,
      split: t1 ? a0 + (a1 - a0) * Math.min(0.72, Math.max(0.28, p0 / (p0 + p1))) : a1,
      mid: (a0 + a1) / 2,
    });
  });
  const N = regions.length;

  /** a border's angle at radius r: warped by noise, straight inside the town (G3) */
  const borderAngle = (b: number, r: number) =>
    regions[b]!.a0 + 0.15 * vnoise(r / 38 + b * 7.3, b * 3.1, 11) * smooth(TOWN_R, TOWN_R + 50, r);
  const splitAngle = (i: number, r: number) =>
    regions[i]!.split + 0.06 * vnoise(r / 30 + i * 5.1, 2.7, 17) * smooth(TOWN_R, TOWN_R + 40, r);
  const coastR = (a: number) => COAST + 11 * fbm(Math.cos(a) * 2.2 + 5, Math.sin(a) * 2.2 + 5, 23);

  const regionOf = (r: number, a: number) => {
    const b0 = borderAngle(0, r);
    const rel = wrap(a - b0);
    for (let i = N - 1; i >= 1; i--) if (rel >= wrap(borderAngle(i, r) - b0)) return i;
    return 0;
  };
  /** distance (m) to the nearest region border and which border it is */
  const nearBorder = (r: number, a: number, i: number) => {
    const d0 = Math.abs(wrap(a - borderAngle(i, r) + Math.PI) - Math.PI) * r;
    const j = (i + 1) % N;
    const d1 = Math.abs(wrap(a - borderAngle(j, r) + Math.PI) - Math.PI) * r;
    return d0 < d1 ? { d: d0, b: i } : { d: d1, b: j };
  };

  // ponds: 2–3 per region (frozen lake, oasis, marsh pools, water holes) — basins in the relief
  const ponds: { x: number; z: number; r: number; region: number }[] = [];
  regions.forEach((g, i) => {
    const n = g.climate === 'marsh' ? 4 : g.climate === 'crystal' ? 1 : 2;
    for (let k = 0; k < n; k++) {
      const u = rnd(`pond${i}:${k}`);
      const v = rnd(`pondr${i}:${k}`);
      const a = g.a0 + (g.a1 - g.a0) * (0.25 + 0.5 * u);
      const r = TOWN_R + 45 + v * (COAST - TOWN_R - 90);
      const [x, z] = polar(r, a);
      ponds.push({ x, z, r: 7 + rnd(`pondz${i}:${k}`) * 5, region: i });
    }
  });
  const volcanoIdx = regions.findIndex((g) => g.climate === 'volcano');
  const [vx, vz] = polar(165, regions[volcanoIdx]!.mid);

  /** the land shape of one region at a point (before the town ramp and coast) */
  const relief = (i: number, x: number, z: number, r: number): number => {
    const s = i * 37;
    switch (regions[i]!.climate) {
      case 'frost': {
        const n = 1 - Math.abs(fbm(x / 38, z / 38, s, 4));
        return 3 + n * n * 30 * smooth(120, 200, r);
      }
      case 'marsh':
        return fbm(x / 22, z / 22, s) < -0.22 ? -0.5 : 0.35 + 1.1 * fbm(x / 30, z / 30, s + 1);
      case 'bloom':
        return 2.2 + 8 * (0.5 + fbm(x / 34, z / 34, s));
      case 'tide':
        return 0.9 + 2 * (0.5 + fbm(x / 40, z / 40, s));
      case 'jungle':
        return 3 + 12 * Math.abs(fbm(x / 30, z / 30, s, 4));
      case 'volcano': {
        const d = Math.hypot(x - vx, z - vz);
        let cone = Math.max(0, 48 * (1 - d / 62));
        if (d < 8) cone = 48 * (1 - 8 / 62) - (8 - d) * 2.4;
        return 1.8 + 2.5 * (0.5 + fbm(x / 20, z / 20, s)) + cone;
      }
      case 'canyon': {
        const n = fbm(x / 44, z / 44, s);
        return 1.2 + 9 * smooth(0.02, 0.06, n) + 8 * smooth(0.3, 0.34, n);
      }
      case 'crystal':
        return 0.95 + 0.6 * (0.5 + fbm(x / 50, z / 50, s));
      case 'savanna':
        return 1.4 + 4 * (0.5 + fbm(x / 60, z / 60, s));
    }
  };

  const roadAngle = (i: number, r: number) =>
    regions[i]!.mid + 0.07 * vnoise(r / 35 + i * 9.7, 1.3, 29) * smooth(TOWN_R, TOWN_R + 30, r);

  // v5 mini plazas (V5-D6): one per region beside its road just outside the gate, sized by the
  // Epic + Rare specials it holds; rings of spots round the region's landmark in the middle
  const MP_RINGS = [6.2, 8.6, 11, 13.4, 15.8, 18.2, 20.6];
  const MP_GAP = 2.5;
  const ringCap = (rr: number) => Math.floor((TAU * rr) / MP_GAP);
  const miniDefs = regions.map((g, i) => {
    const need = g.types.map((t) => specials[t] ?? 0);
    // rings until every type's share of the circle holds its specials
    let rings = 1;
    const share = g.types.length > 1 ? 0.5 : 1;
    while (
      rings < MP_RINGS.length &&
      need.some(
        (n) =>
          MP_RINGS.slice(0, rings).reduce((a, rr) => a + Math.floor(ringCap(rr) * share), 0) < n,
      )
    )
      rings++;
    const r = MP_RINGS[rings - 1]! + 2.4;
    const dist = TOWN_R + 4 + r;
    const off = (r + 4.5) / dist;
    const [x, z] = polar(dist, roadAngle(i, dist) + off);
    return { x, z, r, rings, region: i, plateau: NaN };
  });
  /** region of the last `height` call (-1 town, -2 sea): lets the grid pass skip `at` */
  let lastRegion = -1;
  const heightRaw = (x: number, z: number): number => {
    const r = Math.hypot(x, z);
    if (r < TOWN_R) {
      lastRegion = -1;
      if (r > CANAL_IN && r < CANAL_OUT) return -0.8;
      // rivers leave the canal straight through the town (under the street bridges)
      if (r > CANAL_OUT) {
        const a = Math.atan2(z, x);
        for (let i = 0; i < N; i++) {
          if (!regions[(i + N - 1) % N]!.river) continue;
          if (Math.abs(wrap(a - regions[i]!.a0 + Math.PI) - Math.PI) * r < 2.6) return -0.8;
        }
      }
      return TOWN_Y;
    }
    const a = Math.atan2(z, x);
    const i = regionOf(r, a);
    const nb = nearBorder(r, a, i);
    let rel = relief(i, x, z, r);
    // blend with the neighbour across the nearest border so relief never steps at a seam
    if (nb.d < 14) {
      const j = nb.b === i ? (i + N - 1) % N : (i + 1) % N;
      rel = rel + (relief(j, x, z, r) - rel) * 0.5 * (1 - nb.d / 14);
    }
    const ramp = smooth(TOWN_R, TOWN_R + 40, r);
    let h = TOWN_Y + (1.2 + rel) * ramp;
    // borders: a river bed or a ridge line (G3)
    const river = regions[(nb.b + N - 1) % N]!.river;
    if (river) h = Math.min(h, -0.8 + (h + 0.8) * smooth(2.8, 11, nb.d));
    else h += 5 * (1 - smooth(0, 10, nb.d)) * ramp;
    // the stream between the two types of a paired region
    if (regions[i]!.types.length > 1 && r > TOWN_R + 25) {
      const ds = Math.abs(wrap(a - splitAngle(i, r) + Math.PI) - Math.PI) * r;
      if (ds < 5) h = Math.min(h, -0.4 + (h + 0.4) * smooth(1, 5, ds));
    }
    // ponds
    for (const p of ponds) {
      if (p.region !== i) continue;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r * 1.8) {
        const floor = regions[i]!.climate === 'frost' ? 0.35 : -0.4; // frost: a frozen lake
        h = Math.min(h, floor + (h - floor) * smooth(p.r * 0.7, p.r * 1.8, d));
      }
    }
    // coast: beaches, or cliffs on Bloom Cliffs
    const edge = coastR(a) - r;
    lastRegion = edge < 0 ? -2 : i;
    const cliff = regions[i]!.climate === 'bloom';
    h = -2.5 + (h + 2.5) * (cliff ? smooth(-1, 3, edge) : smooth(-8, 20, edge));
    return h;
  };
  /** the land, with each mini plaza levelled to a flat terrace (blended over 6 m) */
  const height = (x: number, z: number): number => {
    let h = heightRaw(x, z);
    const reg = lastRegion;
    for (const m of miniDefs) {
      const d = Math.hypot(x - m.x, z - m.z);
      if (d > m.r + 6) continue;
      if (Number.isNaN(m.plateau)) m.plateau = Math.max(WATER_Y + 0.8, heightRaw(m.x, m.z));
      h = m.plateau + (h - m.plateau) * smooth(m.r, m.r + 6, d);
    }
    lastRegion = reg;
    return h;
  };

  const at = (x: number, z: number) => {
    const r = Math.hypot(x, z);
    if (r < TOWN_R) return null;
    const a = Math.atan2(z, x);
    if (r > coastR(a)) return null;
    const i = regionOf(r, a);
    const g = regions[i]!;
    const second = g.types.length > 1 && wrap(a - splitAngle(i, r)) < Math.PI;
    return { region: i, type: (second ? g.types[1] : g.types[0])! };
  };

  // sample the land once: every later check reads the grid (the height field is costly)
  const GN = 170;
  const GE = COAST + 44;
  const grid: HeightGrid = {
    E: GE,
    N: GN,
    cell: (2 * GE) / GN,
    h: new Float32Array((GN + 1) * (GN + 1)),
    region: new Int16Array((GN + 1) * (GN + 1)),
  };
  for (let j = 0; j <= GN; j++)
    for (let i = 0; i <= GN; i++) {
      const x = -GE + i * grid.cell;
      const z = -GE + j * grid.cell;
      const k = j * (GN + 1) + i;
      grid.h[k] = height(x, z);
      grid.region[k] = lastRegion;
    }
  const hq = (x: number, z: number) => gridHeight(grid, x, z);
  const slope = (x: number, z: number) => {
    const e = 1.5;
    return Math.hypot(hq(x + e, z) - hq(x - e, z), hq(x, z + e) - hq(x, z - e)) / (2 * e);
  };

  // ---- roads: one from each gate out into its region, along the valley ---------------------------
  const roads: [number, number][][] = [];
  regions.forEach((g, i) => {
    const pts: [number, number][] = [];
    for (let r = STREET_OUT; r <= COAST - 45; r += 6) pts.push(polar(r, roadAngle(i, r)));
    roads.push(pts);
  });
  /** distance (m) to the road of region `i` (roads run down each region's middle, far from others) */
  const nearRoad = (x: number, z: number, i: number) => {
    const r = Math.hypot(x, z);
    if (r > COAST - 40) return Infinity;
    return Math.abs(wrap(Math.atan2(z, x) - roadAngle(i, r) + Math.PI) - Math.PI) * r;
  };

  // ---- the town: plaza, two rows of houses between two ring streets, gates, machine quarter --------
  const lots: Lot[] = [];
  const doors: (Spot & { lot: number })[] = [];
  const gaps: { a: number; half: number }[] = [
    ...regions.map((g) => ({ a: g.mid, half: 5 })),
    ...regions.filter((g, i) => regions[(i + N - 1) % N]!.river).map((g) => ({ a: g.a0, half: 6 })),
  ];
  const volcanoMid = regions[volcanoIdx]!.mid;
  const canyon = regions[(volcanoIdx + 1) % N]!;
  // the machine quarter sits in the outer row between the volcano gate and the canyon gate
  const quarter = { a0: volcanoMid + 6 / STREET_OUT, a1: canyon.mid - 6 / STREET_OUT };
  const machineD = BIOME_ORDER.indexOf('machine');
  for (const [rC, face, band] of [
    [STREET_IN + ROAD / 2 + SW + ROW / 2, -1, 0],
    [STREET_OUT - ROAD / 2 - SW - ROW / 2, 1, 1],
  ] as const) {
    // walk the ring, cutting it at the gates and river crossings
    const cuts = gaps
      .map((g) => ({ lo: wrap(g.a - g.half / rC), hi: wrap(g.a + g.half / rC) }))
      .sort((p, q) => p.lo - q.lo);
    cuts.forEach((c, k) => {
      const next = cuts[(k + 1) % cuts.length]!;
      const from = c.hi;
      let to = next.lo;
      if (to <= from) to += TAU;
      const span = (to - from) * rC;
      const widths = splitRow(span, `town${band}:${k}`);
      let at0 = 0;
      let prev = -1;
      widths.forEach((w, s) => {
        const a = from + (at0 + w / 2) / rC;
        at0 += w;
        const [x, z] = polar(rC, a);
        const seed = hash32(`town${band}:${k}:${s}`);
        const corner = s === 0 || s === widths.length - 1;
        const inQuarter = band === 1 && wrap(a - quarter.a0) < wrap(quarter.a1 - quarter.a0);
        const region = regionOf(TOWN_R + 1, a);
        const skinType = inQuarter ? 'machine' : regions[region]!.types[0]!;
        const storeys = Math.min(3, 1 + band + (rnd(`${seed}st`) < 0.5 ? 1 : 0) + (corner ? 1 : 0));
        lots.push({
          x,
          z,
          y: TOWN_Y,
          w: w + 0.12,
          depth: ROW,
          fx: Math.cos(a) * face,
          fz: Math.sin(a) * face,
          storeys:
            prev >= 0
              ? Math.max(lots[prev]!.storeys - 1, Math.min(lots[prev]!.storeys + 1, storeys))
              : storeys,
          d: BIOME_ORDER.indexOf(skinType),
          house: !corner && !inQuarter,
          corner,
          seed,
          prev,
          band,
        });
        prev = lots.length - 1;
        if (!corner && !inQuarter) {
          const [dx, dz] = polar(rC + face * (ROW / 2 + 0.9), a);
          doors.push({
            x: dx,
            z: dz,
            y: TOWN_Y,
            d: -1,
            kind: 'door',
            tx: 0,
            tz: 0,
            lot: lots.length - 1,
          });
        }
      });
    });
  }
  // doors nearest the plaza first (inner row), then round the ring from the top of the screen
  const topA = -Math.PI * 0.75;
  doors.sort(
    (p, q) =>
      Math.round(Math.hypot(p.x, p.z)) - Math.round(Math.hypot(q.x, q.z)) ||
      wrap(Math.atan2(p.z, p.x) - topA) - wrap(Math.atan2(q.z, q.x) - topA),
  );
  // bridges where a river border crosses the town streets
  const bridges: Island['bridges'] = [];
  regions.forEach((g, i) => {
    if (!regions[(i + N - 1) % N]!.river) return;
    for (const r of [STREET_IN, STREET_OUT]) {
      const [x, z] = polar(r, g.a0);
      bridges.push({ x, z, a: g.a0 });
    }
  });

  // plaza rings, inner first; plaza residents stroll their ring
  // v5 (V5-D6): The Origin on the monument's base, facing the opening camera; the two Guardians on
  // plinths either side of it; Legendary 4–10 on the ring round them; everyone else from r = 17
  const FRONT = Math.PI / 4;
  const mon = polar(4.3, FRONT);
  const monument: Spot = {
    x: mon[0],
    z: mon[1],
    y: TOWN_Y + 2,
    d: -1,
    kind: 'plaza',
    tx: 0,
    tz: 0,
  };
  const plinths: Spot[] = [-0.95, 0.95].map((da) => {
    const [x, z] = polar(10.5, FRONT + da);
    return { x, z, y: TOWN_Y + 1.2, d: -1, kind: 'plaza' as const, tx: 0, tz: 0 };
  });
  const legendRing: Spot[] = Array.from({ length: 7 }, (_, k) => {
    const [x, z] = polar(14.2, FRONT + Math.PI + ((k - 3) * TAU) / 8.5);
    return { x, z, y: TOWN_Y, d: -1, kind: 'plaza' as const, tx: 0, tz: 0 };
  });
  const plaza: Spot[] = [];
  for (let r = 18; r <= PLAZA_R - 3 && plaza.length < plazaTarget * 2; r += 3) {
    // v5: the plaza now also holds the 40 Mythic specials — a little denser than v4
    const n = Math.floor((TAU * r) / 3.2);
    for (let s = 0; s < n; s++) {
      const a = (s / n) * TAU + r;
      const [x, z] = polar(r, a);
      plaza.push({ x, z, y: TOWN_Y, d: -1, kind: 'plaza', tx: -Math.sin(a), tz: Math.cos(a) });
    }
  }

  // ---- habitats: groups of spots at open ground, nearest the town first (V4-D3, G4) ------------------
  const spots: Spot[][] = BIOME_ORDER.map(() => []);
  const habitats: Habitat[] = [];
  const RINGS = [0, 2.2, 4.4, 6.4];
  const CAP = 30;
  const wildTypes = new Map<TypeId, number>();
  regions.forEach((g, i) => g.types.forEach((t) => wildTypes.set(t, i)));
  for (const [t, i] of wildTypes) {
    const d = BIOME_ORDER.indexOf(t);
    const rugged = ['frost', 'volcano', 'canyon'].includes(regions[i]!.climate);
    const maxSlope = rugged ? 1.1 : 0.55;
    const need = Math.ceil((pops[t] ?? 0) * 1.3) + 12;
    let step = 17;
    let list: Spot[] = [];
    let habs: Habitat[] = [];
    for (let attempt = 0; attempt < 4 && list.length < need; attempt++, step *= 0.84) {
      list = [];
      habs = [];
      const cands: { x: number; z: number; r: number }[] = [];
      for (let r = TOWN_R + 14; r < COAST - 10; r += step) {
        const g = regions[i]!;
        const n = Math.ceil(((g.a1 - g.a0) * r) / step) + 2;
        for (let k = 0; k <= n; k++) {
          const a = g.a0 - 0.05 + ((g.a1 - g.a0 + 0.1) * k) / n;
          const jr = (rnd(`hr${t}${r}${k}${attempt}`) - 0.5) * step * 0.85;
          const ja = (rnd(`ha${t}${r}${k}${attempt}`) - 0.5) * step * 0.85;
          const [x0, z0] = polar(r + jr, a);
          const x = x0 - Math.sin(a) * ja;
          const z = z0 + Math.cos(a) * ja;
          const here = at(x, z);
          if (!here || here.type !== t) continue;
          if (hq(x, z) < 0.9 || slope(x, z) > maxSlope || nearRoad(x, z, i) < 6) continue;
          if (miniDefs.some((m) => Math.hypot(x - m.x, z - m.z) < m.r + 7)) continue;
          cands.push({ x, z, r: Math.hypot(x, z) });
        }
      }
      cands.sort((p, q) => p.r - q.r);
      for (const c of cands) {
        // stop once this type has room enough: further-out habitats are never used
        if (list.length >= need) break;
        const group: Spot[] = [];
        for (const rr of RINGS) {
          const n = rr ? Math.round((TAU * rr) / 2.2) : 1;
          // an uneven group: the outer ring is stretched one way and loses a few members
          const stretch = 0.75 + rnd(`st${t}${c.x}`) * 0.6;
          const turn = rnd(`tu${t}${c.z}`) * TAU;
          for (let s = 0; s < n && group.length < CAP; s++) {
            if (rr > 4 && rnd(`gap${t}${c.x}${s}`) < 0.3) continue;
            const a = (s / n) * TAU + rr * 1.7 + (rnd(`ja${t}${c.x}${s}`) - 0.5) * 0.5;
            const lr = rr + (rnd(`jr${t}${c.z}${s}`) - 0.5) * 0.8;
            const ex = Math.cos(a) * lr * stretch;
            const ez = Math.sin(a) * lr;
            const x = c.x + ex * Math.cos(turn) - ez * Math.sin(turn);
            const z = c.z + ex * Math.sin(turn) + ez * Math.cos(turn);
            const y = hq(x, z);
            const here = at(x, z);
            if (
              !here ||
              here.type !== t ||
              y < 0.7 ||
              slope(x, z) > maxSlope + 0.3 ||
              nearRoad(x, z, i) < 3
            )
              continue;
            // the outer ring strolls round its group; the middle stands
            const walks = rr >= 3.8 && rnd(`w${t}${c.x}${s}`) < 0.5;
            group.push({
              x,
              z,
              y,
              d,
              kind: 'wild',
              tx: walks ? -Math.sin(a) : 0,
              tz: walks ? Math.cos(a) : 0,
            });
          }
        }
        if (group.length < 6) continue;
        habs.push({ x: c.x, z: c.z, y: hq(c.x, c.z), t, n: group.length });
        list.push(...group);
      }
    }
    spots[d] = list;
    habitats.push(...habs);
  }

  // machine: the industrial quarter — its sidewalk and the yard behind it
  {
    const list: Spot[] = [];
    const span = wrap(quarter.a1 - quarter.a0);
    for (const [r, walk] of [
      [STREET_OUT - ROAD / 2 - 0.8, true],
      [STREET_OUT + ROAD / 2 + 1, true],
      [STREET_OUT + ROAD / 2 + 3.2, false],
      [TOWN_R - 1.5, false],
    ] as const) {
      const n = Math.floor((span * r) / 2.4);
      for (let s = 0; s < n; s++) {
        const a = quarter.a0 + ((s + 0.5) / n) * span;
        const [x, z] = polar(r, a);
        list.push({
          x,
          z,
          y: TOWN_Y,
          d: machineD,
          kind: 'street',
          tx: walk ? -Math.sin(a) : 0,
          tz: walk ? Math.cos(a) : 0,
        });
      }
    }
    // overflow: machine habitats on the savanna's outer edge would break V4-D8; the quarter grows
    // outward in rings instead
    for (
      let r = TOWN_R + 4;
      list.length < (pops.machine ?? 0) * 1.3 + 12 && r < TOWN_R + 40;
      r += 2.4
    ) {
      const n = Math.floor((span * r) / 2.4);
      for (let s = 0; s < n; s++) {
        const a = quarter.a0 + ((s + 0.5) / n) * span;
        const [x, z] = polar(r, a);
        list.push({ x, z, y: height(x, z), d: machineD, kind: 'street', tx: 0, tz: 0 });
      }
    }
    spots[machineD] = list;
  }

  // landmarks: one per region, beside its road just outside the gate
  const landmarks = miniDefs.map((m) => ({
    t: regions[m.region]!.types[0]!,
    region: m.region,
    x: m.x,
    z: m.z,
    y: height(m.x, m.z),
  }));
  // mini-plaza spots: paired regions split the circle in two halves, one per type
  const mini: Spot[][] = BIOME_ORDER.map(() => []);
  for (const m of miniDefs) {
    const g = regions[m.region]!;
    const y = height(m.x, m.z);
    // the half facing the region's first border goes to its first type
    const toward = Math.atan2(m.z, m.x);
    for (const rr of MP_RINGS.slice(0, m.rings)) {
      const n = ringCap(rr);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + rr * 0.37;
        const x = m.x + Math.cos(a) * rr;
        const z = m.z + Math.sin(a) * rr;
        const side = g.types.length > 1 ? (wrap(a - toward) < Math.PI ? 1 : 0) : 0;
        const t = g.types[side]!;
        mini[BIOME_ORDER.indexOf(t)]!.push({
          x,
          z,
          y,
          d: BIOME_ORDER.indexOf(t),
          kind: 'plaza',
          tx: 0,
          tz: 0,
        });
      }
    }
  }
  const miniPlazas = miniDefs.map((m) => ({
    x: m.x,
    z: m.z,
    y: height(m.x, m.z),
    r: m.r,
    region: m.region,
  }));

  // nobody stands on a ruler line
  const loosen = (sp: Spot, k: string) => {
    const u = rnd(`jx${k}`) - 0.5;
    const v = rnd(`jz${k}`) - 0.5;
    sp.x += u * 0.7;
    sp.z += v * 0.7;
  };
  plaza.forEach((sp, i) => loosen(sp, `p${i}`));

  return {
    regions,
    height,
    at,
    roads,
    bridges,
    lots,
    plaza,
    spots,
    doors: doors.map((p) => ({ x: p.x, z: p.z, y: p.y, d: p.d, kind: p.kind, tx: p.tx, tz: p.tz })),
    doorLots: doors.map((p) => p.lot),
    habitats,
    landmarks,
    monument,
    plinths,
    legendRing,
    miniPlazas,
    mini,
    quarter,
    volcano: { x: vx, z: vz },
    grid,
    radius: COAST + 14,
  };
}

/** plot widths that touch end to end: narrow, standard and wide plots in a seeded mix */
function splitRow(len: number, seed: string): number[] {
  const MIN = 3.4;
  if (len < MIN * 1.5) return len > 2 ? [len] : [];
  const out: number[] = [];
  let left = len;
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
    const add = left / out.length;
    for (let i = 0; i < out.length; i++) out[i]! += add;
  }
  return out;
}
