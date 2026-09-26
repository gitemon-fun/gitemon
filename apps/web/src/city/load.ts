import {
  BIOME_ORDER,
  TYPE_INFO,
  island,
  type Island,
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
 * Placement (GRANDPLAN v4 §7): the world's most notable stand on the central plaza; claimed
 * Gitemon live in the town at their tamer's house (claim order, nearest the plaza first); machines
 * live in the industrial quarter; every other Gitemon lives in its type's habitats in the wild,
 * nearest the town first (rank = distance to the centre, V4-D3).
 */
export function place(all: MapGitemon[], claimedAt: Map<number, string>) {
  const pops: Partial<Record<TypeId, number>> = {};
  for (const g of all) pops[g.t1] = (pops[g.t1] ?? 0) + 1;
  const plazaN = Math.max(24, Math.min(190, Math.round(all.length / 40)));
  const city = island(pops, plazaN);
  const placed: Placed[] = [];
  let onPlaza = 0;
  const next = new Map<TypeId, number>();
  // houses go in claim order: the first to claim gets the house nearest the plaza
  const homes = new Map<number, string>();
  const doorOf = new Map<number, number>();
  const claimed = all
    .filter((g) => g.st === 'c')
    .sort((a, b) => (claimedAt.get(a.id) ?? '').localeCompare(claimedAt.get(b.id) ?? ''));
  claimed.forEach((g, k) => {
    if (!city.doors[k]) return;
    doorOf.set(g.id, k);
    homes.set(city.doorLots[k]!, TYPE_INFO[g.t1].colors[0]);
  });
  for (const g of all) {
    if (onPlaza < plazaN && g.t1 !== 'machine' && city.plaza[onPlaza]) {
      placed.push({ g, spot: city.plaza[onPlaza++]! });
      continue;
    }
    const door = doorOf.get(g.id);
    if (door != null) {
      placed.push({ g, spot: city.doors[door]! });
      continue;
    }
    const d = BIOME_ORDER.indexOf(g.t1);
    const k = next.get(g.t1) ?? 0;
    const spot = city.spots[d]?.[k];
    if (!spot) continue;
    next.set(g.t1, k + 1);
    placed.push({ g, spot });
  }
  return { city, placed, homes };
}

export interface LoadedCity {
  city: Island;
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
