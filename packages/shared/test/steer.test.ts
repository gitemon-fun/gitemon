import { describe, expect, it } from 'vitest';
import { CANAL_IN, CANAL_OUT, STREET_IN, STREET_OUT, TOWN_R, island } from '../src/index.js';
import { Walkable } from '../../../apps/web/src/city/walker.js';

// v8 G4: steering (keys / thumb stick) moves only where the v6 walk may go
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
const w = new Walkable(isl);
const at = (r: number, a: number) => [Math.cos(a) * r, Math.sin(a) * r] as const;

describe('steering collision (v8 G4)', () => {
  it('never walks on the open sea', () => {
    for (let k = 0; k < 24; k++)
      expect(w.walkable(...at(isl.radius + 40, (k / 24) * Math.PI * 2))).toBe(false);
  });
  it('crosses the canal only at a bridge', () => {
    const g = isl.regions[0]!;
    const mid = (CANAL_IN + CANAL_OUT) / 2;
    expect(w.walkable(...at(mid, g.mid))).toBe(true);
    expect(w.walkable(...at(mid, g.mid + 0.35))).toBe(false);
  });
  it('passes the rows of houses only through the gates', () => {
    const g = isl.regions[2]!;
    const row = (STREET_IN + STREET_OUT) / 2;
    expect(w.walkable(...at(row, g.mid))).toBe(true);
    expect(w.walkable(...at(row, g.mid + (g.a1 - g.a0) * 0.3))).toBe(false);
  });
  it('can walk out of the town onto the land', () => {
    const g = isl.regions[8]!;
    expect(w.walkable(...at(TOWN_R + 20, g.mid))).toBe(true);
  });
});
