import {
  BIOME_ORDER,
  TYPE_INFO,
  dayOf,
  dayShuffle,
  island,
  legendOfDayRank,
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
  number | string,
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
  // v6: '<tier>:<level>' while blessed by the legend of the day; 'f' = the friendship aura
  ...(typeof r[9] === 'string' && r[9] && r[9] !== 'f' ? { at: r[9] } : {}),
});

/**
 * Placement (GRANDPLAN v5 §0 V5-D6, over v4 §7): the specials first — The Origin on the monument,
 * The Guardians on the plinths, Legendary 4–10 round them, Mythic on the plaza, Epic + Rare on their
 * region's mini plaza; then players — the most notable fill the rest of the plaza, claimed ones live
 * at a town house, machines in the industrial quarter, everyone else in their type's habitats,
 * nearest the town first (rank = distance to the centre, V4-D3).
 */
/** v6: the day's frozen layout from the daily job — every client builds the same island all day */
export interface DayLayout {
  day: string;
  pops: Partial<Record<TypeId, number>>;
  specials: Partial<Record<TypeId, { mini: number; rare: number }>>;
}

export function place(
  all: MapGitemon[],
  claimedAt: Map<number, string>,
  legends: MapGitemon[] = [],
  layout: DayLayout | null = null,
  day = dayOf(),
) {
  const woken = new Set(legends.filter((l) => !l.special!.sealed).map((l) => l.id));
  const players = all.filter((g) => !woken.has(g.id));
  const pops: Partial<Record<TypeId, number>> = {};
  const specials: Partial<Record<TypeId, { mini: number; rare: number }>> = {};
  for (const g of players) pops[g.t1] = (pops[g.t1] ?? 0) + 1;
  for (const l of legends) {
    pops[l.t1] = (pops[l.t1] ?? 0) + 1;
    const tier = l.special!.tier;
    const c = (specials[l.t1] ??= { mini: 0, rare: 0 });
    if (tier === 'mythic' || tier === 'epic') c.mini++;
    else if (tier === 'rare') c.rare++;
  }
  const plazaN = Math.max(24, Math.min(190, Math.round((players.length + legends.length) / 40)));
  // the day's frozen layout wins: players who join during the day slot into its spare room
  const city = island(layout?.pops ?? pops, plazaN, layout?.specials ?? specials);
  const placed: Placed[] = [];
  let onPlaza = 0;
  // the specials, in rank order: the plaza keeps the top ten; Mythic then Epic stand on their
  // region's mini plaza; each Rare stands at the heart of one of its type's groups in the wild
  const miniNext = new Map<TypeId, number>();
  const denNext = new Map<TypeId, number>();
  // the Rare move to new group hearts every day (V6-D5): a per-day order within each type
  const rareOrder = new Map<number, number>();
  for (const l of legends)
    if (l.special!.tier === 'rare') rareOrder.set(l.id, dayShuffle(l.special!.key, day));
  const ordered = [...legends].sort((a, b) =>
    a.special!.tier === 'rare' && b.special!.tier === 'rare'
      ? rareOrder.get(a.id)! - rareOrder.get(b.id)!
      : a.special!.rank - b.special!.rank,
  );
  for (const l of ordered) {
    const { rank, tier } = l.special!;
    let spot;
    if (rank === 1) spot = city.monument;
    else if (rank <= 3) spot = city.plinths[rank - 2];
    else if (tier === 'legendary') spot = city.legendRing[rank - 4];
    else if (
      tier === 'rare' &&
      (denNext.get(l.t1) ?? 0) < (city.dens[BIOME_ORDER.indexOf(l.t1)]?.length ?? 0)
    ) {
      const k = denNext.get(l.t1) ?? 0;
      spot = city.dens[BIOME_ORDER.indexOf(l.t1)]![k];
      denNext.set(l.t1, k + 1);
    } else {
      // Mythic, Epic — and a Rare whose type ran out of group hearts — stand on the mini plaza
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
  const todayRank = legendOfDayRank(day);
  const today = legends.find((l) => l.special!.rank === todayRank)?.special!.key ?? null;
  return { city, placed, homes, today, pops, specials };
}

export interface LoadedCity {
  /** v6: the legend of the day's key (V6-D5) */
  today?: string | null;
  city: Island;
  placed: Placed[];
  homes: Map<number, string>;
  byId: Map<number, Placed>;
}

/** Fetch every resident (/api/city, edge-cached) and place them. */
export async function loadCity(): Promise<LoadedCity | null> {
  const r = await fetch('/api/city');
  if (!r.ok) return null;
  const data = (await r.json()) as { g: Row[]; l?: LegendRow[]; layout?: DayLayout | null };
  const rows = data.g;
  const day = data.layout?.day ?? dayOf();
  const claimedAt = new Map(rows.filter((x) => x[10]).map((x) => [x[0], x[10]!]));
  const { city, placed, homes, today } = place(
    rows.map(fromRow),
    claimedAt,
    (data.l ?? []).map(fromLegend),
    data.layout ?? null,
    day,
  );
  return { city, placed, homes, today, byId: new Map(placed.map((p) => [p.g.id, p])) };
}
