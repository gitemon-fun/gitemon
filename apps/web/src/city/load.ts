import {
  BIOME_ORDER,
  TYPE_INFO,
  layout,
  type City,
  type MapGitemon,
  type Shape,
  type TypeId,
} from '@gitemon/shared';
import type { Placed } from './crowd';

/** [id, login, t1, t2, shape, form, shiny, level, claimed, aura, claimedAt] from /api/city */
export type Row = [
  number,
  string,
  TypeId,
  TypeId | null,
  Shape,
  1 | 2 | 3,
  number,
  number,
  number,
  number,
  string | null,
];
export const fromRow = (r: Row): MapGitemon => ({
  id: r[0],
  login: r[1],
  x: 0,
  y: 0,
  t1: r[2],
  t2: r[3],
  sh: r[4],
  f: r[5],
  s: r[6] ? 1 : 0,
  lv: r[7],
  st: r[8] ? 'c' : 'w',
  a: r[9] ? 1 : 0,
});

/**
 * Placement (GRANDPLAN v2 §5): the world's most notable stand on the central plaza; each
 * district's own best fill its square; claimed players live at a house door; everyone else
 * lines the streets outward by rank. Agents never stand on the plaza.
 */
export function place(all: MapGitemon[], claimedAt: Map<number, string>) {
  const pops: Partial<Record<TypeId, number>> = {};
  for (const g of all) pops[g.t1] = (pops[g.t1] ?? 0) + 1;
  const plazaN = Math.max(24, Math.min(190, Math.round(all.length / 40)));
  const city = layout(pops, plazaN);
  const placed: Placed[] = [];
  let onPlaza = 0;
  const next = new Map<TypeId, number>();
  // houses go in claim order: the first to claim gets the house nearest the square
  const homes = new Map<number, string>();
  const doorOf = new Map<number, number>();
  const claimed = all
    .filter((g) => g.st === 'c')
    .sort((a, b) => (claimedAt.get(a.id) ?? '').localeCompare(claimedAt.get(b.id) ?? ''));
  const used = new Map<TypeId, number>();
  for (const g of claimed) {
    const d = BIOME_ORDER.indexOf(g.t1);
    const k = used.get(g.t1) ?? 0;
    if (!city.doors[d]?.[k]) continue;
    used.set(g.t1, k + 1);
    doorOf.set(g.id, k);
    homes.set(city.doorLots[d]![k]!, TYPE_INFO[g.t1].colors[0]);
  }
  for (const g of all) {
    if (onPlaza < plazaN && g.t1 !== 'machine' && city.plaza[onPlaza]) {
      placed.push({ g, spot: city.plaza[onPlaza++]! });
      continue;
    }
    const d = BIOME_ORDER.indexOf(g.t1);
    const door = doorOf.get(g.id);
    if (door != null) {
      placed.push({ g, spot: city.doors[d]![door]! });
      continue;
    }
    const k = next.get(g.t1) ?? 0;
    const spot = city.spots[d]?.[k];
    if (!spot) continue;
    next.set(g.t1, k + 1);
    placed.push({ g, spot });
  }
  return { city, placed, homes };
}

export interface LoadedCity {
  city: City;
  placed: Placed[];
  homes: Map<number, string>;
  byId: Map<number, Placed>;
}

/** Fetch every resident (/api/city, edge-cached) and place them. */
export async function loadCity(): Promise<LoadedCity | null> {
  const r = await fetch('/api/city');
  if (!r.ok) return null;
  const rows = ((await r.json()) as { g: Row[] }).g;
  const claimedAt = new Map(rows.filter((x) => x[10]).map((x) => [x[0], x[10]!]));
  const { city, placed, homes } = place(rows.map(fromRow), claimedAt);
  return { city, placed, homes, byId: new Map(placed.map((p) => [p.g.id, p])) };
}
