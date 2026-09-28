/**
 * v6 daily job (GRANDPLAN v6 §3): once a UTC day, freeze the island's layout and store every legend's
 * spot, so the Worker can check "within 10 m" without recomputing the island. Called from drain.ts.
 */
import { dayOf, meritHouses } from '@gitemon/shared';
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
    layout?: {
      houses?: number[][] | null;
      calibration?: Partial<Record<'legendary' | 'mythic' | 'epic' | 'rare', number>> | null;
    } | null;
  };
  const claimedAt = new Map(data.g.filter((x) => x[10]).map((x) => [x[0], x[10]!]));
  // v11 (V11-D4): plan with the calibration, so the island makes room for earned places
  const cal = data.layout?.calibration ?? null;
  const r = place(
    data.g.map(fromRow),
    claimedAt,
    (data.l ?? []).map(fromLegend),
    cal ? { day, calibration: cal } : null,
    day,
  );
  // v9 (V9-D3): today's Merit House holders — the top 3 by merit per region, kept while top 5
  const prev = data.layout?.houses ?? [];
  const joined = data.g.map(fromRow).filter((g) => g.st === 'c');
  const houses = meritHouses(
    joined.map((g) => ({ id: g.id, t: g.t1, m: g.m ?? 0 })),
    prev,
  );
  const spots = r.placed
    .filter((p) => p.g.special && !p.g.special.earned)
    .map((p) => ({ key: p.g.special!.key, x: +p.spot.x.toFixed(2), z: +p.spot.z.toFixed(2) }));
  await internal('/internal/layout', { day, pops: r.pops, specials: r.specials, spots, houses });
  console.log(
    `daily: layout for ${day}, ${spots.length} legend spots, legend of the day ${r.today}, ${houses.flat().filter(Boolean).length} Merit Houses held`,
  );
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) await daily(process.argv.includes('--force'));
