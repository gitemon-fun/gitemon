import { describe, expect, it } from 'vitest';
import { BIOME_ORDER, layout, PLAZA_R, CANAL_OUT } from '../src/index.js';

const pops = Object.fromEntries(BIOME_ORDER.map((t, i) => [t, 50 + i * 90]));

describe('city layout', () => {
  const city = layout(pops);

  it('is deterministic', () => {
    expect(JSON.stringify(layout(pops))).toBe(JSON.stringify(city));
  });

  it('has room for every district population', () => {
    city.districts.forEach((d, i) => {
      expect(city.spots[i]!.length).toBeGreaterThanOrEqual(pops[d.t]!);
    });
  });

  it('grows a district when its population grows', () => {
    const big = layout({ ...pops, forge: 3000 });
    expect(big.districts[0]!.bands).toBeGreaterThan(city.districts[0]!.bands);
  });

  it('keeps the plaza and canal clear of buildings and street spots', () => {
    for (const l of city.lots) expect(Math.hypot(l.x, l.z)).toBeGreaterThan(CANAL_OUT);
    for (const list of city.spots)
      for (const s of list) expect(Math.hypot(s.x, s.z)).toBeGreaterThan(CANAL_OUT);
    for (const s of city.plaza) expect(Math.hypot(s.x, s.z)).toBeLessThan(PLAZA_R);
  });

  it('never puts a spot inside a building', () => {
    let worst = Infinity;
    for (const l of city.lots) {
      const r = Math.min(l.w, l.depth) / 2 - 0.3;
      for (const s of city.spots[l.d]!) {
        const d = Math.hypot(s.x - l.x, s.z - l.z);
        if (d < r) worst = Math.min(worst, d - r);
      }
    }
    expect(worst).toBe(Infinity);
  });
});
