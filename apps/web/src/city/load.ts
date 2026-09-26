import {
  BIOME_ORDER,
  TYPE_INFO,
  island,
  type Island,
  type MapGitemon,
  type Shape,
  type SpecialTier,
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
/** [key, rank, tier, title, species, t1, t2, shape, form, shiny, id|null, login|null] from /api/city */
export type LegendRow = [
  string,
  number,
  SpecialTier,
  string | null,
  string | null,
  TypeId,
  TypeId | null,
  Shape,
  1 | 2 | 3,
  number,
  number | null,
  string | null,
];
/** a special as a map resident: sealed ones get a negative id and no login (V5-D4) */
export const fromLegend = (l: LegendRow): MapGitemon => ({
  id: l[10] ?? -l[1],
  login: l[11] ?? '',
  x: 0,
  y: 0,
  t1: l[5],
  t2: l[6],
  sh: l[7],
  f: l[8],
  s: l[9] ? 1 : 0,
  lv: 0,
  st: l[10] ? 'c' : 'w',
  a: 0,
  special: { key: l[0], rank: l[1], tier: l[2], title: l[3], species: l[4], sealed: l[10] == null },
});

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
 * Placement (GRANDPLAN v5 §0 V5-D6, over v4 §7): the specials first — The Origin on the monument,
 * The Guardians on the plinths, Legendary 4–10 round them, Mythic on the plaza, Epic + Rare on their
 * region's mini plaza; then players — the most notable fill the rest of the plaza, claimed ones live
 * at a town house, machines in the industrial quarter, everyone else in their type's habitats,
 * nearest the town first (rank = distance to the centre, V4-D3).
 */
export function place(
  all: MapGitemon[],
  claimedAt: Map<number, string>,
  legends: MapGitemon[] = [],
) {
  const woken = new Set(legends.filter((l) => !l.special!.sealed).map((l) => l.id));
  const players = all.filter((g) => !woken.has(g.id));
  const pops: Partial<Record<TypeId, number>> = {};
  const specials: Partial<Record<TypeId, number>> = {};
  for (const g of players) pops[g.t1] = (pops[g.t1] ?? 0) + 1;
  for (const l of legends) {
    pops[l.t1] = (pops[l.t1] ?? 0) + 1;
    const tier = l.special!.tier;
    if (tier === 'epic' || tier === 'rare') specials[l.t1] = (specials[l.t1] ?? 0) + 1;
  }
  const plazaN = Math.max(24, Math.min(190, Math.round((players.length + legends.length) / 40)));
  const city = island(pops, plazaN + 50, specials);
  const placed: Placed[] = [];
  let onPlaza = 0;
  // the specials, in rank order (Epic before Rare inside each mini plaza)
  const miniNext = new Map<TypeId, number>();
  for (const l of [...legends].sort((a, b) => a.special!.rank - b.special!.rank)) {
    const { rank, tier } = l.special!;
    let spot;
    if (rank === 1) spot = city.monument;
    else if (rank <= 3) spot = city.plinths[rank - 2];
    else if (tier === 'legendary') spot = city.legendRing[rank - 4];
    else if (tier === 'mythic') spot = city.plaza[onPlaza++];
    else {
      const k = miniNext.get(l.t1) ?? 0;
      spot = city.mini[BIOME_ORDER.indexOf(l.t1)]?.[k];
      miniNext.set(l.t1, k + 1);
    }
    if (spot) placed.push({ g: l, spot });
  }
  const next = new Map<TypeId, number>();
  // houses go in claim order: the first to claim gets the house nearest the plaza
  const homes = new Map<number, string>();
  const doorOf = new Map<number, number>();
  const claimed = players
    .filter((g) => g.st === 'c')
    .sort((a, b) => (claimedAt.get(a.id) ?? '').localeCompare(claimedAt.get(b.id) ?? ''));
  claimed.forEach((g, k) => {
    if (!city.doors[k]) return;
    doorOf.set(g.id, k);
    homes.set(city.doorLots[k]!, TYPE_INFO[g.t1].colors[0]);
  });
  const plazaEnd = onPlaza + plazaN;
  for (const g of players) {
    if (onPlaza < plazaEnd && g.t1 !== 'machine' && city.plaza[onPlaza]) {
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
  const data = (await r.json()) as { g: Row[]; l?: LegendRow[] };
  const rows = data.g;
  const claimedAt = new Map(rows.filter((x) => x[10]).map((x) => [x[0], x[10]!]));
  const { city, placed, homes } = place(
    rows.map(fromRow),
    claimedAt,
    (data.l ?? []).map(fromLegend),
  );
  return { city, placed, homes, byId: new Map(placed.map((p) => [p.g.id, p])) };
}
