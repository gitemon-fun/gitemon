import type { TypeId } from './types.js';
import { REGIONS } from './island.js';
import { HOUSE_FLOOR } from './standing.js';

/**
 * v9 The Town (GRANDPLAN v9 §3): pure rules for guilds and Merit Houses. No I/O — the daily job,
 * the Worker and the map all use these, so they always agree.
 */

/** V9-D2: a player's guild is the region of their Gitemon's type; machine has the quarter (-1) */
export function guildOf(t: TypeId): number {
  return REGIONS.findIndex((r) => r.types.includes(t));
}

export interface MeritPlayer {
  id: number;
  t: TypeId;
  /** V7 merit, 0–100 */
  m: number;
}

/**
 * V9-D3: the top 3 players by merit in each region hold its Merit Houses (v11: only at merit ≥ 50). A holder keeps the house
 * while they stay in the region's top 5, so the edge does not flip every day. `prev` = yesterday's
 * holders per region (slot order kept, so nobody moves house). Returns region → 3 ids (0 = empty).
 */
export function meritHouses(players: MeritPlayer[], prev: number[][] = []): number[][] {
  const byRegion: MeritPlayer[][] = REGIONS.map(() => []);
  for (const p of players) {
    const g = guildOf(p.t);
    // v11 (V11-D3): a house is earned — below the floor nobody holds one, even in a thin region
    if (g >= 0 && p.m >= HOUSE_FLOOR) byRegion[g]!.push(p);
  }
  return byRegion.map((list, g) => {
    // merit, then the lower id on a tie (stable, and older accounts first)
    const ranked = [...list].sort((a, b) => b.m - a.m || a.id - b.id);
    const top5 = new Set(ranked.slice(0, 5).map((p) => p.id));
    const slots = [0, 0, 0];
    (prev[g] ?? []).forEach((id, k) => {
      if (k < 3 && id && top5.has(id)) slots[k] = id;
    });
    for (const p of ranked) {
      if (!slots.includes(0)) break;
      if (slots.includes(p.id)) continue;
      slots[slots.indexOf(0)] = p.id;
    }
    return slots;
  });
}

/** Monday of the UTC week (YYYY-MM-DD): the guild week starts here (V9-D7) */
export function weekStart(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
