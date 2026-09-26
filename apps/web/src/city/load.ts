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
  // v6: '<tier>:<level>' while blessed by the legend of the day; 'f' = the friendship aura
  ...(typeof r[9] === 'string' && r[9] && r[9] !== 'f' ? { at: r[9] } : {}),
  // v7: merit (standing) and the house sign ('template|project')
  m: r[11] ?? 0,
  ...(r[12] ? { sg: r[12] } : {}),
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
  /** v7: merit lines for climbing into each tier; absent = climbing off (V7-D3, §5) */
  calibration?: Partial<Record<'legendary' | 'mythic' | 'epic' | 'rare', number>> | null;
}

/** a claimed player's house: their colour, how big it has grown, their sign (V7-D6) */
export interface Home {
  colour: string;
  band: 0 | 1 | 2;
  sign: string | null;
  id: number;
}
/** standing bands for houses: merit 35+ grows a storey, 60+ another (V7-D6) */
export const bandOf = (merit: number): 0 | 1 | 2 => (merit >= 60 ? 2 : merit >= 35 ? 1 : 0);
/** champion seats (V7-D4, V7-Q1) */
export const PLAZA_SEATS = 24;
export const MINI_SEATS = 6;

export function place(
  all: MapGitemon[],
  claimedAt: Map<number, string>,
  legends: MapGitemon[] = [],
  layout: DayLayout | null = null,
  day = dayOf(),
) {
  const woken = new Set(legends.filter((l) => !l.special!.sealed).map((l) => l.id));
  // v7 (V7-D1): players stand by MERIT — their own work, consistency over volume
  const players = all
    .filter((g) => !woken.has(g.id))
    .sort((a, b) => (b.m ?? 0) - (a.m ?? 0) || a.id - b.id);
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
  // every mini plaza keeps room for its region's champion seats
  for (const t of Object.keys(pops) as TypeId[]) {
    const c = (specials[t] ??= { mini: 0, rare: 0 });
    c.mini += MINI_SEATS;
  }
  // the day's frozen layout wins: players who join during the day slot into its spare room
  const city = island(layout?.pops ?? pops, PLAZA_SEATS + 30, layout?.specials ?? specials);
  const placed: Placed[] = [];
  const taken = new Set<number>();

  // v7 (V7-D3): climbing into the legend tiers — only once calibrated (thresholds in the layout).
  // A climber takes the seat of the lowest sealed legend of their tier; that legend leaves for now.
  const cal = layout?.calibration ?? null;
  let seated = legends;
  if (cal) {
    const tiers = ['legendary', 'mythic', 'epic', 'rare'] as const;
    const claimed = new Set<number>();
    seated = [];
    for (const tier of tiers) {
      const own = legends
        .filter((l) => l.special!.tier === tier)
        .sort((a, b) => a.special!.rank - b.special!.rank);
      const line = cal[tier];
      const climbers =
        line == null
          ? []
          : players.filter((g) => !claimed.has(g.id) && (g.m ?? 0) >= line && g.t1 !== 'machine');
      // The Origin and The Guardians stay influence-only (ranks 1–3)
      const open = own.filter((l) => l.special!.rank > 3 && l.special!.sealed);
      const n = Math.min(climbers.length, open.length);
      const out = new Set(open.slice(open.length - n).map((l) => l.id));
      seated.push(...own.filter((l) => !out.has(l.id)));
      for (let k = 0; k < n; k++) {
        const g = climbers[k]!;
        const seat = open[open.length - n + k]!;
        claimed.add(g.id);
        seated.push({ ...g, special: { ...seat.special!, sealed: false, earned: true } });
      }
    }
  }

  // the specials, in rank order: the plaza keeps the top ten; Mythic then Epic stand on their
  // region's mini plaza; each Rare stands at the heart of one of its type's groups in the wild
  const miniNext = new Map<TypeId, number>();
  const denNext = new Map<TypeId, number>();
  // the Rare move to new group hearts every day (V6-D5): a per-day order within each type
  const rareOrder = new Map<string, number>();
  for (const l of seated)
    if (l.special!.tier === 'rare') rareOrder.set(l.special!.key, dayShuffle(l.special!.key, day));
  const ordered = [...seated].sort((a, b) =>
    a.special!.tier === 'rare' && b.special!.tier === 'rare'
      ? rareOrder.get(a.special!.key)! - rareOrder.get(b.special!.key)!
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
    if (spot) {
      placed.push({ g: l, spot });
      if (l.special!.earned) taken.add(l.id);
    }
  }

  // houses are PROPERTY (V7-D7): claim order, nearest the plaza first; they grow with merit and
  // carry the sign — but where a Gitemon stands comes from its merit, like everyone else
  const homes = new Map<number, Home>();
  const houseOf = new Map<number, number>();
  const claimed = players
    .filter((g) => g.st === 'c')
    .sort((a, b) => (claimedAt.get(a.id) ?? '').localeCompare(claimedAt.get(b.id) ?? ''));
  claimed.forEach((g, k) => {
    if (!city.doors[k]) return;
    houseOf.set(g.id, k);
    homes.set(city.doorLots[k]!, {
      colour: TYPE_INFO[g.t1].colors[0],
      band: bandOf(g.m ?? 0),
      sign: g.sg ?? null,
      id: g.id,
    });
  });

  // champion seats (V7-D4): the top players by merit on the main plaza, then each type's best on
  // its mini plaza; everyone else in the wild, the stronger nearer the town
  let onPlaza = 0;
  const seatsUsed = new Map<TypeId, number>();
  const next = new Map<TypeId, number>();
  for (const g of players) {
    if (taken.has(g.id)) continue;
    if (onPlaza < PLAZA_SEATS && g.t1 !== 'machine' && city.plaza[onPlaza]) {
      placed.push({ g, spot: city.plaza[onPlaza++]! });
      continue;
    }
    const used = seatsUsed.get(g.t1) ?? 0;
    if (g.t1 !== 'machine' && used < MINI_SEATS) {
      const k = miniNext.get(g.t1) ?? 0;
      const spot = city.mini[BIOME_ORDER.indexOf(g.t1)]?.[k];
      if (spot) {
        miniNext.set(g.t1, k + 1);
        seatsUsed.set(g.t1, used + 1);
        placed.push({ g, spot });
        continue;
      }
    }
    const d = BIOME_ORDER.indexOf(g.t1);
    const k = next.get(g.t1) ?? 0;
    const spot = city.spots[d]?.[k];
    if (!spot) continue;
    next.set(g.t1, k + 1);
    placed.push({ g, spot });
  }
  const todayRank = legendOfDayRank(day);
  const today = seated.find((l) => l.special!.rank === todayRank)?.special!.key ?? null;
  return { city, placed, homes, today, pops, specials, houseOf };
}

export interface LoadedCity {
  /** v6: the legend of the day's key (V6-D5) */
  today?: string | null;
  city: Island;
  placed: Placed[];
  homes: Map<number, Home>;
  byId: Map<number, Placed>;
}

/** Fetch every resident (/api/city, edge-cached) and place them. */
export async function loadCity(): Promise<LoadedCity | null> {
  const r = await fetch('/api/city');
  if (!r.ok) return null;
  const data = (await r.json()) as { g: Row[]; l?: LegendRow[]; layout?: DayLayout | null };
  const rows = data.g;
  // ?fake=N (and &climb): N made-up players in this browser only — to see seats, houses and signs
  // before real players exist. Nothing is sent anywhere.
  const fake = Number(new URLSearchParams(location.search).get('fake')) || 0;
  const types = BIOME_ORDER.filter((t) => t !== 'machine');
  const tpls = ['work', 'hiring', 'building|Gitemon', 'freelance', ''];
  for (let i = 0; i < fake; i++) {
    const t = types[i % types.length]!;
    const m = Math.round(95 * Math.pow(((i * 7919) % 1000) / 1000, 1.6));
    rows.push([
      -(100000 + i),
      `player${i}`,
      t,
      null,
      'steady',
      ((i % 3) + 1) as 1 | 2 | 3,
      0,
      20,
      1,
      '',
      `2026-09-2${i % 9}T00:00:00Z`,
      m,
      tpls[i % tpls.length] || null,
    ]);
  }
  if (fake && location.search.includes('climb') && data.layout)
    data.layout = {
      ...data.layout,
      calibration: { legendary: 92, mythic: 85, epic: 75, rare: 62 },
    };
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
