import { describe, expect, it } from 'vitest';
import { BIOME_ORDER, layout, PLAZA_R, CANAL_OUT, WALK, type Lot } from '../src/index.js';

/** how far (x, z) sits inside a plot's footprint, shrunk by `m` on every side; > 0 = inside */
const inside = (l: Lot, x: number, z: number, m = 0.3) => {
  const dx = x - l.x;
  const dz = z - l.z;
  const along = Math.abs(dx * -l.fz + dz * l.fx);
  const across = Math.abs(dx * l.fx + dz * l.fz);
  return Math.min(l.w / 2 - m - along, l.depth / 2 - m - across);
};

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
    let hits = 0;
    for (const l of city.lots)
      for (const s of city.spots[l.d]!) if (inside(l, s.x, s.z) > 0) hits++;
    expect(hits).toBe(0);
  });

  it('never walks a resident into a building', () => {
    let hits = 0;
    for (const l of city.lots)
      for (const s of city.spots[l.d]!) {
        if (!s.tx && !s.tz) continue;
        for (const k of [-1, 1])
          if (inside(l, s.x + s.tx * WALK * k, s.z + s.tz * WALK * k) > 0) hits++;
      }
    expect(hits).toBe(0);
  });

  it('builds rows that touch: neighbours share a wall (v3 §5)', () => {
    let gaps = 0;
    for (const l of city.lots) {
      if (l.prev < 0) continue;
      const p = city.lots[l.prev]!;
      const d = Math.hypot(l.x - p.x, l.z - p.z);
      if (Math.abs(d - (l.w + p.w) / 2) > 0.6) gaps++;
    }
    expect(gaps).toBe(0);
  });

  it('keeps neighbouring storeys within one step, corners tallest in their row', () => {
    for (const l of city.lots) {
      if (l.prev < 0) continue;
      expect(Math.abs(l.storeys - city.lots[l.prev]!.storeys)).toBeLessThanOrEqual(1);
    }
  });

  it('fills courts before doorways before sidewalks, band by band', () => {
    const order = { court: 0, doorway: 1, street: 2 } as Record<string, number>;
    city.spots.forEach((list) => {
      const rest = list.filter((s) => s.kind !== 'square');
      expect(rest.some((s) => s.kind === 'court')).toBe(true);
      expect(order[rest[0]!.kind]).toBe(0);
    });
  });

  it('gives every door a house, nearest the square first', () => {
    city.districts.forEach((d, i) => {
      const doors = city.doors[i]!;
      doors.forEach((door, k) => {
        const lot = city.lots[city.doorLots[i]![k]!]!;
        expect(lot.house).toBe(true);
        expect(Math.hypot(door.x - lot.x, door.z - lot.z)).toBeLessThan(lot.depth);
        if (k)
          expect(Math.hypot(door.x - d.square.x, door.z - d.square.z)).toBeGreaterThanOrEqual(
            Math.hypot(doors[k - 1]!.x - d.square.x, doors[k - 1]!.z - d.square.z),
          );
      });
    });
  });
});
