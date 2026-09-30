import { describe, expect, it } from 'vitest';
import { island, townProps, gridHeight, SERVICES, WATER_Y } from '../src/index.js';

// v14.1 (V14-D15): the KayKit street props stand where they read and never where someone must be
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
const props = townProps(isl);

describe('street props (v14.1)', () => {
  it('are the same for every viewer', () => {
    expect(townProps(island(pops, 190))).toEqual(props);
  });
  it('dress the market, the inn, most Merit Houses and every mini plaza', () => {
    const market = isl.town.find((p) => p.kind === 'service' && SERVICES[p.slot] === 'market')!;
    const near = (x: number, z: number, d: number) => Math.hypot(x - market.x, z - market.z) < d;
    expect(props.filter((p) => p.key === 'tent' && near(p.x, p.z, 12))).toHaveLength(2);
    const houses = isl.town.filter((p) => p.kind === 'house');
    const dressed = houses.filter((h) =>
      props.some((p) => Math.hypot(p.x - h.door.x, p.z - h.door.z) < 4.5),
    );
    expect(dressed.length).toBeGreaterThanOrEqual(24);
    for (const m of isl.miniPlazas)
      expect(
        props.filter((p) => p.key === 'fence' && Math.hypot(p.x - m.x, p.z - m.z) < m.r + 4).length,
      ).toBeGreaterThanOrEqual(3);
  });
  it('never stand in a building, on a doorstep, on a gate street or in water', () => {
    for (const pr of props) {
      for (const p of isl.town) {
        const dx = pr.x - p.x;
        const dz = pr.z - p.z;
        const inside =
          Math.abs(-dx * p.fz + dz * p.fx) < p.w / 2 && Math.abs(dx * p.fx + dz * p.fz) < p.d / 2;
        expect(inside, `${pr.key} in a plot`).toBe(false);
        expect(Math.hypot(pr.x - p.door.x, pr.z - p.door.z), `${pr.key} on a door`).toBeGreaterThan(
          1,
        );
      }
      const r = Math.hypot(pr.x, pr.z);
      if (r < 72)
        for (const g of isl.regions) {
          const da = Math.abs(
            ((Math.atan2(pr.z, pr.x) - g.mid + Math.PI * 3) % (Math.PI * 2)) - Math.PI,
          );
          expect(da * r, `${pr.key} on a gate street`).toBeGreaterThan(1.75);
        }
      expect(gridHeight(isl.grid, pr.x, pr.z), `${pr.key} in water`).toBeGreaterThan(WATER_Y);
    }
  });
});
