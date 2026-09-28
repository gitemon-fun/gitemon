import { describe, expect, it } from 'vitest';
import {
  CANAL_OUT,
  DECK_END,
  DECK_TOP,
  RIVER_HALF,
  bridgeLift,
  bridgesOf,
  inTownRiver,
  island,
  townRivers,
} from '../src/index.js';

describe('bridges (V10-D6, G5)', () => {
  const isl = island({ spark: 40, serpent: 40, prism: 30, iron: 20 }, 60, {});
  const bs = bridgesOf(isl);

  it('lists a gate bridge per region plus the river bridges', () => {
    expect(bs.length).toBe(isl.regions.length + isl.bridges.length);
  });

  it('the deck is an arch: low at the ends, highest in the middle, no step', () => {
    const b = bs[0]!;
    const at = (u: number) => bridgeLift(bs, b.x + b.dx * u, b.z + b.dz * u);
    expect(at(0)).toBeCloseTo(DECK_TOP);
    expect(at(b.span / 2 - 1e-6)).toBeCloseTo(DECK_END, 2);
    let last = at(-b.span / 2 + 1e-6);
    for (let u = -b.span / 2 + 0.1; u <= 0; u += 0.1) {
      const h = at(u);
      expect(h).toBeGreaterThanOrEqual(last - 1e-9);
      expect(h - last).toBeLessThan(0.1);
      last = h;
    }
  });

  it('off the bridges nothing lifts', () => {
    expect(bridgeLift(bs, 0, 0)).toBe(0);
    expect(bridgeLift(bs, 200, 0)).toBe(0);
  });

  it('every river bridge stands on a town river, and the channel is only as wide as the river', () => {
    const rivers = townRivers(isl);
    for (const b of isl.bridges) expect(inTownRiver(rivers, b.x, b.z)).toBe(true);
    const a0 = rivers[0];
    if (a0 === undefined) return;
    const r = CANAL_OUT + 10;
    const at = (off: number) =>
      inTownRiver(
        rivers,
        Math.cos(a0) * r - Math.sin(a0) * off,
        Math.sin(a0) * r + Math.cos(a0) * off,
      );
    expect(at(0)).toBe(true);
    expect(at(RIVER_HALF - 0.2)).toBe(true);
    expect(at(RIVER_HALF + 0.3)).toBe(false);
    expect(
      inTownRiver(rivers, Math.cos(a0) * (CANAL_OUT - 3), Math.sin(a0) * (CANAL_OUT - 3)),
    ).toBe(false);
  });
});
