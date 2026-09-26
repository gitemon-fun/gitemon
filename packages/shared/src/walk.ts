import type { Snapshot } from './types.js';
import { hash32 } from './hash.js';

/**
 * Walk the Island (GRANDPLAN v6) — the pure rules shared by the client, the Worker and the daily job.
 */

/** the game's day: a UTC date, YYYY-MM-DD (V6-Q2) */
export const dayOf = (t: Date | number = Date.now()) => new Date(t).toISOString().slice(0, 10);
export const dayBefore = (day: string) =>
  new Date(Date.parse(day + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);

/** Sighting and blessing range (V6-D3, V6-D4), catch range (V6-D2), aura length, idle time. */
export const SIGHT_M = 10;
export const CATCH_M = 8;
export const AURA_H = 6;
export const IDLE_MS = 3 * 60_000;

/**
 * Today's walking budget in metres (V6-D6, §4): a base plus confirmed work — PRs and reviews in the
 * last year, and weeks with any activity — never raw commit counts (D6). Walking home is free.
 */
export function walkBudget(s: Pick<Snapshot, 'contrib'> | null | undefined): number {
  if (!s) return 250;
  const c = s.contrib;
  return Math.min(2000, Math.round(250 + 15 * c.prs + 8 * c.reviews + 12 * c.activeWeeks));
}

/** the streak after a sighting or blessing on `today` (V6-D5) */
export function nextStreak(streak: number, streakDay: string | null, today: string): number {
  if (streakDay === today) return Math.max(1, streak);
  if (streakDay === dayBefore(today)) return streak + 1;
  return 1;
}
/** aura strength from the streak: 0 below 7 days, 1 from 7, 2 from 30 */
export const auraLevel = (streak: number) => (streak >= 30 ? 2 : streak >= 7 ? 1 : 0);

/** the legend of the day: a rank from 1 to 50, picked by date (V6-D5) */
export const legendOfDayRank = (day: string) => (hash32(`legend-of-the-day:${day}`) % 50) + 1;

/** a stable per-day order for moving the Rare to new group hearts (V6-D5) */
export const dayShuffle = (key: string, day: string) => hash32(`rare:${key}:${day}`);
