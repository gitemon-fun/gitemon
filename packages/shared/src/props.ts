import { hash32 } from './hash.js';
import {
  RIVER_HALF,
  ROAD,
  SERVICES,
  TOWN_R,
  TOWN_Y,
  WATER_Y,
  gridHeight,
  type Island,
  type TownPlot,
} from './island.js';

/**
 * v14.1 (V14-D15, Dedi picked C 2026-09-30): street props from the KayKit Medieval Hexagon Pack
 * (CC0) — market stalls and crates round the Market, barrels at the Inn, one small thing at every
 * Merit House door, a wooden fence along the back of every mini plaza. Pure and deterministic, so
 * every viewer sees the same town. Props are street furniture like the lamps: nobody is blocked.
 */

export type PropKey =
  | 'barrel'
  | 'crate-big'
  | 'crate-a'
  | 'crate-b'
  | 'crate-open'
  | 'sack'
  | 'bucket'
  | 'wheelbarrow'
  | 'tent'
  | 'pallet'
  | 'lumber'
  | 'fence';

/** world height (m) of each prop: the pack's own proportions × 5, the tent (a stall) and fence taller */
export const PROP_H: Record<PropKey, number> = {
  barrel: 1.05,
  'crate-big': 1.05,
  'crate-a': 0.7,
  'crate-b': 0.7,
  'crate-open': 1.05,
  sack: 0.3,
  bucket: 0.55,
  wheelbarrow: 0.95,
  tent: 3.2,
  pallet: 0.4,
  lumber: 1.05,
  fence: 1.2,
};
/** one fence panel's length at that height (the pack's panel is 1.16 long, 0.55 tall) */
export const FENCE_LEN = (1.16 * PROP_H.fence) / 0.55;

export interface Prop {
  key: PropKey;
  x: number;
  /** the ground it stands on (a stacked prop: the top of the one below) */
  y: number;
  z: number;
  /** turn about the vertical (front = +Z) */
  yaw: number;
}

const TAU = Math.PI * 2;
/** 0..1 from a seed; FNV's top bits barely move for short seeds (hk0, hk1 …), so mix them first */
const u = (s: string) => {
  let x = hash32(s);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;
/** distance from a point to a road's line (its points are 6 m apart, so test the segments) */
function roadDist(road: [number, number][], x: number, z: number) {
  let d = Infinity;
  for (let i = 1; i < road.length; i++) {
    const [ax, az] = road[i - 1]!;
    const [bx, bz] = road[i]!;
    const lx = bx - ax;
    const lz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * lx + (z - az) * lz) / (lx * lx + lz * lz || 1)));
    d = Math.min(d, Math.hypot(x - ax - lx * t, z - az - lz * t));
  }
  return d;
}

export function townProps(isl: Island): Prop[] {
  const out: Prop[] = [];
  // the gate streets and the rivers cut the town rows: nothing stands in them
  const gaps = [
    ...isl.regions.map((g) => ({ a: g.mid, half: ROAD / 2 + 1 })),
    ...isl.bridges.map((b) => ({ a: b.a, half: RIVER_HALF + 1.5 })),
  ];
  /** `own` = the plot the props belong to: they may stand against its front, not inside it */
  const free = (x: number, z: number, rad: number, own?: TownPlot) => {
    const r = Math.hypot(x, z);
    if (r < TOWN_R) {
      const a = Math.atan2(z, x);
      for (const g of gaps)
        if (Math.abs(wrap(a - g.a + Math.PI) - Math.PI) * r < g.half + rad) return false;
    }
    for (const p of isl.town) {
      const dx = x - p.x;
      const dz = z - p.z;
      const across = dx * p.fx + dz * p.fz;
      const along = -dx * p.fz + dz * p.fx;
      const m = p === own ? 0 : rad + 0.3;
      if (Math.abs(along) < p.w / 2 + m && Math.abs(across) < p.d / 2 + m) return false;
      if (Math.hypot(x - p.door.x, z - p.door.z) < rad + 1) return false;
    }
    return true;
  };
  /** a point in a plot's frame: `along` its street, `across` toward the street */
  const at = (p: TownPlot, along: number, across: number): [number, number] => [
    p.x + p.fx * across - p.fz * along,
    p.z + p.fz * across + p.fx * along,
  ];
  const face = (p: TownPlot) => Math.atan2(p.fx, p.fz);
  /** a group of props round one point; the whole group stays or goes (never half a stall) */
  const group = (
    p: TownPlot,
    along: number,
    across: number,
    rad: number,
    items: [PropKey, number, number, number?, number?][],
    seed: string,
  ) => {
    const [cx, cz] = at(p, along, across);
    const spots = items.map(([, da, dc]) => at(p, along + da, across + dc));
    if (!free(cx, cz, rad, p) || spots.some(([x, z]) => !free(x, z, 0.4, p))) return false;
    items.forEach(([key, , , lift = 0, turn = 0], k) => {
      const [x, z] = spots[k]!;
      out.push({
        key,
        x,
        y: TOWN_Y + lift,
        z,
        yaw: face(p) + turn + (u(`${seed}${k}`) - 0.5) * 0.5,
      });
    });
    return true;
  };

  isl.town.forEach((p, i) => {
    const front = p.d / 2 + 0.7;
    const corner = p.w / 2 - 0.4;
    if (p.kind === 'service' && SERVICES[p.slot] === 'market') {
      // two stalls in the row either side, crates and sacks on their street side, a wheelbarrow by the door
      const st = p.w / 2 + 2.4;
      group(
        p,
        -st,
        0.6,
        1.9,
        [
          ['tent', 0, 0],
          ['crate-big', 0.9, 2.3],
          ['crate-a', 0.9, 2.3, PROP_H['crate-big']],
          ['sack', -0.5, 2.4, 0, 1.2],
        ],
        `mk${i}a`,
      );
      group(
        p,
        st,
        0.6,
        1.9,
        [
          ['tent', 0, 0],
          ['barrel', -0.8, 2.3],
          ['barrel', 0.3, 2.5],
          ['crate-open', 1.3, 2.2, 0, Math.PI],
        ],
        `mk${i}b`,
      );
      group(p, -corner, front + 0.3, 1, [['wheelbarrow', 0, 0, 0, Math.PI / 2]], `mk${i}c`);
      group(
        p,
        corner,
        front,
        0.8,
        [
          ['crate-b', 0, 0],
          ['sack', 0.6, 0.3, 0, 0.8],
        ],
        `mk${i}d`,
      );
    } else if (p.kind === 'service' && SERVICES[p.slot] === 'inn') {
      group(
        p,
        -corner,
        front,
        0.9,
        [
          ['barrel', 0, 0],
          ['barrel', 0.9, 0.1],
          ['barrel', 0.45, 0, PROP_H.barrel],
        ],
        `inn${i}a`,
      );
      group(
        p,
        corner,
        front,
        0.8,
        [
          ['barrel', 0, 0],
          ['bucket', -0.8, 0.2],
        ],
        `inn${i}b`,
      );
    } else if (p.kind === 'house') {
      // one small thing by each Merit House door, on a seeded side
      const side = u(`hs${i}`) < 0.5 ? -1 : 1;
      const kit: [PropKey, number, number, number?, number?][][] = [
        [['barrel', 0, 0]],
        [
          ['crate-a', 0, 0],
          ['crate-b', side * -0.8, 0.1],
        ],
        [
          ['bucket', 0, 0],
          ['sack', side * -0.7, 0.2, 0, 1],
        ],
        [
          ['barrel', 0, 0],
          ['crate-a', side * -0.9, 0],
        ],
      ];
      group(p, side * corner, front, 0.9, kit[Math.floor(u(`hk${i}`) * kit.length)]!, `h${i}`);
    }
  });

  // a wooden fence along the back of every mini plaza (the side away from the town), open where a
  // road comes in and wherever a wild group, water or a slope is
  const wild = [...isl.spots.flat(), ...isl.dens.flat()];
  for (const m of isl.miniPlazas) {
    const R = m.r + 2.6;
    const road = isl.roads[m.region] ?? [];
    const out0 = Math.atan2(m.z, m.x);
    const step = (FENCE_LEN * 0.98) / R;
    const n = Math.floor((Math.PI * 0.8) / step);
    const placed: number[] = [];
    for (let k = -n; k <= n; k++) {
      const a = out0 + k * step;
      const x = m.x + Math.cos(a) * R;
      const z = m.z + Math.sin(a) * R;
      const ends = [-1, 1].map((s) => [
        x - Math.sin(a) * s * (FENCE_LEN / 2),
        z + Math.cos(a) * s * (FENCE_LEN / 2),
      ]);
      const hs = ends.map(([ex, ez]) => gridHeight(isl.grid, ex!, ez!));
      if (hs.some((h) => h < WATER_Y + 0.3 || Math.abs(h - m.y) > 1.2)) continue;
      if (roadDist(road, x, z) < 4.5) continue;
      if (wild.some((s) => Math.hypot(s.x - x, s.z - z) < 2.5)) continue;
      out.push({ key: 'fence', x, y: Math.min(...hs) - 0.05, z, yaw: -a });
      placed.push(a);
    }
    // a lumber pile outside one end of the fence, off the road
    if (placed.length >= 3)
      for (const a of [placed[0]!, placed[placed.length - 1]!]) {
        const x = m.x + Math.cos(a) * (R + 2);
        const z = m.z + Math.sin(a) * (R + 2);
        const h = gridHeight(isl.grid, x, z);
        if (h < WATER_Y + 0.3 || Math.abs(h - m.y) > 1.5) continue;
        if (roadDist(road, x, z) < 4.5) continue;
        if (wild.some((s) => Math.hypot(s.x - x, s.z - z) < 3)) continue;
        out.push({ key: 'lumber', x, y: h - 0.05, z, yaw: -a + u(`lb${m.region}`) - 0.5 });
        break;
      }
  }
  return out;
}
