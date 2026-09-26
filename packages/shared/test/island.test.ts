import { describe, expect, it } from 'vitest';
import { BIOME_ORDER, island, COAST, TOWN_R, PLAZA_R, WATER_Y } from '../src/index.js';

// the live world on 2026-09-26 (8,312 across 17 types; no machine yet) plus a few machines
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

describe('island layout', () => {
  const isl = island(pops, 190);

  it('is deterministic', () => {
    const again = island(pops, 190);
    expect(JSON.stringify(again.spots)).toBe(JSON.stringify(isl.spots));
    expect(JSON.stringify(again.lots)).toBe(JSON.stringify(isl.lots));
    expect(again.height(120.5, -80.25)).toBe(isl.height(120.5, -80.25));
  });

  it('has room for 1.3× every population', () => {
    BIOME_ORDER.forEach((t, d) => {
      expect(isl.spots[d]!.length, t).toBeGreaterThanOrEqual(Math.ceil(pops[t]! * 1.3));
    });
  });

  it('puts every wild spot on dry, open land of its own type', () => {
    BIOME_ORDER.forEach((t, d) => {
      if (t === 'machine') return;
      for (const s of isl.spots[d]!) {
        expect(s.y).toBeGreaterThan(WATER_Y + 0.4);
        expect(isl.at(s.x, s.z)?.type).toBe(t);
        expect(Math.hypot(s.x, s.z)).toBeGreaterThan(TOWN_R);
        expect(Math.hypot(s.x, s.z)).toBeLessThan(COAST);
      }
    });
  });

  it('ranks by distance: habitats fill nearest the town first (V4-D3, G5)', () => {
    BIOME_ORDER.forEach((t, d) => {
      if (t === 'machine') return;
      const list = isl.spots[d]!;
      // compare the first and last tenth: the average distance must rise
      const k = Math.max(1, Math.floor(list.length / 10));
      const avg = (a: typeof list) => a.reduce((s, p) => s + Math.hypot(p.x, p.z), 0) / a.length;
      expect(avg(list.slice(0, k)), t).toBeLessThan(avg(list.slice(-k)));
    });
  });

  it('keeps groups between 6 and 40 (G4)', () => {
    for (const h of isl.habitats) {
      expect(h.n).toBeGreaterThanOrEqual(6);
      expect(h.n).toBeLessThanOrEqual(40);
    }
  });

  it('never draws a straight border (G3)', () => {
    // sample each border's position along the radius; it must wander > 8 m off a straight ray
    for (let b = 0; b < isl.regions.length; b++) {
      const g = isl.regions[b]!;
      let worst = 0;
      for (let r = TOWN_R + 60; r < COAST - 10; r += 4) {
        // find the border by scanning across it
        let prev = isl.at(Math.cos(g.a0 - 0.3) * r, Math.sin(g.a0 - 0.3) * r)?.region;
        for (let a = g.a0 - 0.3; a < g.a0 + 0.3; a += 0.004) {
          const here = isl.at(Math.cos(a) * r, Math.sin(a) * r)?.region;
          if (here === b && prev !== b) {
            worst = Math.max(worst, Math.abs(a - g.a0) * r);
            break;
          }
          prev = here;
        }
      }
      expect(worst, g.name).toBeGreaterThan(8);
    }
  });

  it('keeps the plaza inside the canal and doors next to their houses, nearest first', () => {
    for (const s of isl.plaza) expect(Math.hypot(s.x, s.z)).toBeLessThan(PLAZA_R);
    isl.doors.forEach((door, k) => {
      const lot = isl.lots[isl.doorLots[k]!]!;
      expect(lot.house).toBe(true);
      expect(Math.hypot(door.x - lot.x, door.z - lot.z)).toBeLessThan(lot.depth);
      if (k)
        expect(Math.round(Math.hypot(door.x, door.z))).toBeGreaterThanOrEqual(
          Math.round(Math.hypot(isl.doors[k - 1]!.x, isl.doors[k - 1]!.z)),
        );
    });
  });

  it('gives every special a place: monument, plinths, legend ring, mini plazas (V5-D6)', () => {
    // 450 Epic + Rare spread like the live list (uneven per type)
    // the live Legends list on 2026-09-26: Mythic + Epic on the mini plaza, Rare in the wild
    const specials: Record<string, { mini: number; rare: number }> = {
      serpent: { mini: 50, rare: 68 },
      spark: { mini: 39, rare: 64 },
      iron: { mini: 31, rare: 24 },
      prism: { mini: 7, rare: 31 },
      bloom: { mini: 13, rare: 23 },
      tide: { mini: 9, rare: 20 },
      frost: { mini: 8, rare: 18 },
      shade: { mini: 4, rare: 13 },
      garnet: { mini: 6, rare: 5 },
      wing: { mini: 2, rare: 9 },
      coral: { mini: 4, rare: 7 },
      wild: { mini: 6, rare: 5 },
      forge: { mini: 3, rare: 7 },
      moss: { mini: 2, rare: 4 },
      stone: { mini: 3, rare: 2 },
      rune: { mini: 2, rare: 0 },
      quill: { mini: 1, rare: 0 },
    };
    const v5 = island(pops, 190, specials);
    expect(v5.plinths).toHaveLength(2);
    expect(v5.legendRing).toHaveLength(7);
    expect(Math.hypot(v5.monument.x, v5.monument.z)).toBeLessThan(6);
    for (const [t, n] of Object.entries(specials)) {
      const d = BIOME_ORDER.indexOf(t as never);
      expect(v5.mini[d]!.length, t).toBeGreaterThanOrEqual(n.mini);
      // every Rare has a group heart of its own type, nearest the town first
      expect(v5.dens[d]!.length, t).toBeGreaterThanOrEqual(n.rare);
      for (const h of v5.dens[d]!) expect(v5.at(h.x, h.z)?.type).toBe(t);
    }
    // the plaza holds players only now, clear of the plinths and the legend ring
    expect(v5.plaza.length).toBeGreaterThanOrEqual(130);
    for (const s of v5.plaza)
      for (const p of v5.plinths) expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeGreaterThan(2);
    // mini plazas stand on level, dry ground, and no wild habitat sits on one
    for (const m of v5.miniPlazas) {
      expect(m.y).toBeGreaterThan(WATER_Y + 0.5);
      for (const h of v5.habitats) expect(Math.hypot(h.x - m.x, h.z - m.z)).toBeGreaterThan(m.r);
    }
  });
});
