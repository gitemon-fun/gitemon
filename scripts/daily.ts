/**
 * v6 daily job (GRANDPLAN v6 §3): once a UTC day, freeze the island's layout and store every legend's
 * spot, so the Worker can check "within 10 m" without recomputing the island. Called from drain.ts.
 */
import { dayOf } from '@gitemon/shared';
import { fromLegend, fromRow, place, type LegendRow, type Row } from '../apps/web/src/city/load.ts';
import { ORIGIN, internal } from './lib.ts';

export async function daily(force = false) {
  const day = dayOf();
  const cur = await internal<{ day: string | null }>('/internal/layout-day');
  if (!force && cur.day === day) return false;
  // the live feed without the edge cache; its stored layout is ignored: today's is built fresh
  const data = (await (await fetch(`${ORIGIN}/api/city?daily=${Date.now()}`)).json()) as {
    g: Row[];
    l?: LegendRow[];
  };
  const claimedAt = new Map(data.g.filter((x) => x[10]).map((x) => [x[0], x[10]!]));
  const r = place(data.g.map(fromRow), claimedAt, (data.l ?? []).map(fromLegend), null, day);
  const spots = r.placed
    .filter((p) => p.g.special)
    .map((p) => ({ key: p.g.special!.key, x: +p.spot.x.toFixed(2), z: +p.spot.z.toFixed(2) }));
  await internal('/internal/layout', { day, pops: r.pops, specials: r.specials, spots });
  console.log(
    `daily: layout for ${day}, ${spots.length} legend spots, legend of the day ${r.today}`,
  );
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) await daily(process.argv.includes('--force'));
