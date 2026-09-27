import { CANAL_IN, CANAL_OUT, ROAD, type Island } from './island.js';

/**
 * v10 bridges (V10-D6, walking polish #1): every bridge is an arch, and creatures walk ON it. One
 * list feeds the geometry (apps/web/src/city/town.ts) and the walker's height, so they never disagree.
 */
export interface Bridge {
  x: number;
  z: number;
  /** unit direction of the span (the way you cross) */
  dx: number;
  dz: number;
  span: number;
  width: number;
}

/** deck height above the town ground at the ends and at the top of the arch */
export const DECK_END = 0.12;
export const DECK_TOP = 0.95;

export function bridgesOf(isl: Pick<Island, 'regions' | 'bridges'>): Bridge[] {
  const out: Bridge[] = [];
  const r = (CANAL_IN + CANAL_OUT) / 2;
  // over the canal at every gate
  for (const g of isl.regions)
    out.push({
      x: Math.cos(g.mid) * r,
      z: Math.sin(g.mid) * r,
      dx: Math.cos(g.mid),
      dz: Math.sin(g.mid),
      span: CANAL_OUT - CANAL_IN + 3,
      width: 4.2,
    });
  // over each river where it crosses a ring street (the span runs along the street)
  for (const b of isl.bridges)
    out.push({
      x: b.x,
      z: b.z,
      dx: Math.cos(b.a + Math.PI / 2),
      dz: Math.sin(b.a + Math.PI / 2),
      span: 7.5,
      width: ROAD + 1,
    });
  return out;
}

/** the arch: DECK_END at both ends, DECK_TOP in the middle; u runs −span/2 … span/2 */
export const archHeight = (u: number, span: number) =>
  DECK_END + (DECK_TOP - DECK_END) * Math.max(0, 1 - ((2 * u) / span) ** 2);

/** how high the deck lifts a walker standing at (x, z); 0 off every bridge */
export function bridgeLift(bridges: Bridge[], x: number, z: number): number {
  for (const b of bridges) {
    const px = x - b.x;
    const pz = z - b.z;
    const u = px * b.dx + pz * b.dz;
    const v = -px * b.dz + pz * b.dx;
    if (Math.abs(u) <= b.span / 2 && Math.abs(v) <= b.width / 2) return archHeight(u, b.span);
  }
  return 0;
}
