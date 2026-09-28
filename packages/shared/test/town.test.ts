import { describe, expect, it } from 'vitest';
import { island, meritHouses, guildOf, weekStart, SERVICES, type TownPlot } from '../src/index.js';
import { Walkable } from '../../../apps/web/src/city/walker.js';

// v9 The Town: 9 halls, 27 Merit Houses, 6 services — detached, reachable; Merit House rules
const pops: Record<string, number> = {
  serpent: 1268,
  spark: 746,
  frost: 711,
  prism: 691,
  iron: 633,
  wing: 550,
  bloom: 502,
  stone: 453,
  forge: 442,
  shade: 418,
  rune: 416,
  garnet: 411,
  tide: 396,
  coral: 263,
  moss: 206,
  wild: 127,
  quill: 79,
  machine: 40,
};
const isl = island(pops, 190);

describe('the town layout (v9 G1)', () => {
  it('holds 9 guild halls, 27 Merit Houses and 6 services', () => {
    const n = (k: TownPlot['kind']) => isl.town.filter((p) => p.kind === k).length;
    expect(n('hall')).toBe(9);
    expect(n('house')).toBe(27);
    expect(n('service')).toBe(SERVICES.length);
    for (let g = 0; g < 9; g++)
      expect(isl.town.filter((p) => p.kind === 'house' && p.region === g)).toHaveLength(3);
  });
  it('keeps every building detached (no overlaps)', () => {
    for (let i = 0; i < isl.town.length; i++)
      for (let j = i + 1; j < isl.town.length; j++) {
        const a = isl.town[i]!;
        const b = isl.town[j]!;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        // same row: centres further apart than half widths; different rows are 5.6 m apart
        if (Math.abs(Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)) < 1)
          expect(d).toBeGreaterThan((a.w + b.w) / 2);
      }
  });
  it('can walk to every door from the plaza', () => {
    const w = new Walkable(isl);
    for (const p of isl.town)
      expect(w.path(0, 22, p.door.x, p.door.z), p.kind + p.slot).not.toBeNull();
  });
});

describe('Merit Houses (v9 G2)', () => {
  const t = 'frost' as const; // Frost Peaks = region 0
  const ps = (ms: number[]) => ms.map((m, k) => ({ id: k + 1, t, m }));
  it('go to the top 3 by merit in each region', () => {
    expect(meritHouses(ps([50, 90, 70, 80, 10]))[guildOf(t)]).toEqual([2, 4, 3]);
  });
  it('are kept while the holder stays in the top 5', () => {
    // yesterday: 1, 2, 3 held; today 1 has dropped to 5th (still above the v11 floor) — kept
    const prev = [[1, 2, 3]];
    const now = ps([60, 90, 80, 95, 85, 10]);
    expect(meritHouses(now, prev)[0]).toEqual([1, 2, 3]);
  });
  it('need merit ≥ 50 (v11, V11-D3): below it nobody holds one, even in a thin region', () => {
    expect(meritHouses(ps([49, 12]))[0]).toEqual([0, 0, 0]);
    const prev = [[1, 2, 3]];
    expect(meritHouses(ps([40, 90, 80, 95, 85]), prev)[0]).toEqual([4, 2, 3]);
  });
  it('are lost at 6th or lower', () => {
    const prev = [[1, 2, 3]];
    const now = ps([5, 90, 80, 95, 85, 70]);
    expect(meritHouses(now, prev)[0]).toEqual([4, 2, 3]);
  });
  it('stay empty (0) when a region has fewer than 3 players', () => {
    expect(meritHouses(ps([55]))[0]).toEqual([1, 0, 0]);
  });
  it('leave machine players out (the quarter is their guild)', () => {
    expect(guildOf('machine')).toBe(-1);
    expect(
      meritHouses([{ id: 9, t: 'machine', m: 99 }])
        .flat()
        .includes(9),
    ).toBe(false);
  });
  it('start the guild week on Monday (UTC)', () => {
    expect(weekStart(new Date('2026-09-27T10:00:00Z'))).toBe('2026-09-21');
  });
});
