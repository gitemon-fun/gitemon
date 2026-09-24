import { describe, expect, it } from 'vitest';
import {
  BIOME,
  PLOTS,
  PLOT,
  biomeAt,
  biomeOrigin,
  plotRect,
  rectCandidates,
  villageRect,
  wildCandidates,
  zoneOf,
  TYPES,
  typeForLanguage,
} from '../src/index.js';

describe('world layout', () => {
  it('every type has its own biome', () => {
    const seen = new Set<string>();
    for (const t of TYPES) {
      const o = biomeOrigin(t);
      expect(biomeAt(o.x + 5, o.y + 5)).toBe(t);
      seen.add(`${o.x},${o.y}`);
    }
    expect(seen.size).toBe(TYPES.length);
  });

  it('town plots never overlap the starter village', () => {
    expect(PLOTS.length).toBe(60);
    const v = villageRect('forge');
    for (let i = 0; i < PLOTS.length; i++) {
      const r = plotRect('forge', i);
      const overlap = r.x < v.x + v.w && r.x + PLOT > v.x && r.y < v.y + v.h && r.y + PLOT > v.y;
      expect(overlap).toBe(false);
    }
  });

  it('wild slots are stable, inside the biome, and in the wild zone', () => {
    const o = biomeOrigin('tide');
    const a = [...take(wildCandidates('tide', 42), 5)];
    const b = [...take(wildCandidates('tide', 42), 5)];
    expect(a).toEqual(b);
    for (const c of a) {
      expect(biomeAt(c.x, c.y)).toBe('tide');
      expect(zoneOf(c.x - o.x, c.y - o.y)).toBe('wild');
    }
  });

  it('village candidates cover the whole village exactly once', () => {
    const v = villageRect('serpent');
    const all = new Set([...rectCandidates(v, 7)].map((c) => `${c.x},${c.y}`));
    expect(all.size).toBe(v.w * v.h);
  });

  it('maps languages to types', () => {
    expect(typeForLanguage('Rust')).toBe('forge');
    expect(typeForLanguage('typescript')).toBe('prism');
    expect(typeForLanguage('Brainfuck')).toBe('wild');
    expect(typeForLanguage(null)).toBe('wild');
    expect(BIOME).toBe(256);
  });
});

function* take<T>(g: Iterable<T>, n: number) {
  let i = 0;
  for (const v of g) {
    if (i++ >= n) return;
    yield v;
  }
}
