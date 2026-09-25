import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@gitemon/shared';
import { levelOf, score, computeStats, isShiny, TUNING } from '../src/index.js';

type SnapInput = Omit<Partial<Snapshot>, 'contrib'> & { contrib?: Partial<Snapshot['contrib']> };

function snap(p: SnapInput = {}): Snapshot {
  return {
    v: 1,
    userId: 1000,
    login: 'dev',
    name: null,
    createdAt: '2018-01-01T00:00:00Z',
    isBot: false,
    followers: 0,
    repos: [],
    mergedToOthers: { count: 0, langs: {}, owners: [] },
    fetchedAt: '2026-09-24T00:00:00Z',
    ...p,
    contrib: {
      commits: 0,
      prs: 0,
      reviews: 0,
      issues: 0,
      restricted: 0,
      activeWeeks: 0,
      ...p.contrib,
    },
  };
}

describe('scorer', () => {
  it('is deterministic', () => {
    const s = snap({ mergedToOthers: { count: 12, langs: { Rust: 12 }, owners: ['a'] } });
    expect(score(s)).toEqual(score(structuredClone(s)));
  });

  it('ignores commit volume to own repos (power is not size)', () => {
    const base = snap({
      contrib: { commits: 300, activeWeeks: 40 },
      repos: [{ name: 'x', stars: 3, lang: 'Go', fork: false }],
    });
    const spam = snap({
      contrib: { commits: 30000, activeWeeks: 40 },
      repos: [{ name: 'x', stars: 3, lang: 'Go', fork: false }],
    });
    expect(Math.abs(score(spam).level - score(base).level)).toBeLessThan(2);
  });

  it('stats are bounded 0..100 even for extreme input', () => {
    const s = snap({
      repos: [{ name: 'huge', stars: 10_000_000, lang: 'Rust', fork: false }],
      mergedToOthers: { count: 1_000_000, langs: { Rust: 100 }, owners: [] },
      contrib: { reviews: 1_000_000, activeWeeks: 99 },
    });
    const r = score(s);
    for (const v of Object.values(r.stats)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(r.level).toBeLessThanOrEqual(100);
  });

  it('is monotonic in confirmed work', () => {
    let prev = 0;
    for (const n of [0, 1, 5, 20, 100, 400]) {
      const l = score(
        snap({ mergedToOthers: { count: n, langs: { Python: n }, owners: [] } }),
      ).level;
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });

  it('forks and unstarred repos do not make a type', () => {
    const r = score(
      snap({
        repos: [
          { name: 'fork', stars: 900, lang: 'Java', fork: true },
          { name: 'mine', stars: 4, lang: 'Go', fork: false },
        ],
      }),
    );
    expect(r.type1).toBe('tide');
  });

  it('gives a dual type when the second language is big enough', () => {
    const r = score(
      snap({ mergedToOthers: { count: 10, langs: { TypeScript: 6, Rust: 4 }, owners: [] } }),
    );
    expect([r.type1, r.type2]).toEqual(['prism', 'forge']);
    const r2 = score(
      snap({ mergedToOthers: { count: 10, langs: { TypeScript: 9, Rust: 1 }, owners: [] } }),
    );
    expect(r2.type2).toBeNull();
  });

  it('newcomers still get a type and level 1+', () => {
    const r = score(snap({ repos: [{ name: 'hello', stars: 0, lang: 'Python', fork: false }] }));
    expect(r.type1).toBe('serpent');
    expect(r.level).toBeGreaterThanOrEqual(1);
    expect(r.form).toBe(1);
  });

  it('empty profile is wild, steady, level 1', () => {
    const r = score(snap());
    expect(r).toMatchObject({ type1: 'wild', type2: null, shape: 'steady', level: 1, form: 1 });
  });

  it('bots are machines and never ranked', () => {
    const r = score(
      snap({ isBot: true, mergedToOthers: { count: 5000, langs: { Go: 5000 }, owners: [] } }),
    );
    expect(r).toMatchObject({ machine: true, type1: 'machine', level: 1, notable: 0 });
  });

  it('shape follows the shape of work, not the amount', () => {
    const reviewer = score(
      snap({
        contrib: { reviews: 400, activeWeeks: 20 },
        mergedToOthers: { count: 3, langs: { Go: 3 }, owners: [] },
      }),
    );
    expect(reviewer.shape).toBe('reviewer');
    const builder = score(
      snap({
        contrib: { reviews: 2, activeWeeks: 20 },
        mergedToOthers: { count: 80, langs: { Go: 80 }, owners: [] },
      }),
    );
    expect(builder.shape).toBe('builder');
    const poly = score(
      snap({
        mergedToOthers: {
          count: 12,
          langs: { Go: 2, Rust: 2, Python: 2, Ruby: 2, PHP: 2, Swift: 2 },
          owners: [],
        },
      }),
    );
    expect(poly.shape).toBe('polyglot');
  });

  it('evolution is rare and needs work other people accepted', () => {
    const noMerged = score(
      snap({
        contrib: { activeWeeks: 52, reviews: 800 },
        repos: [{ name: 'x', stars: 90000, lang: 'Go', fork: false }],
      }),
    );
    expect(noMerged.form).toBe(1);
    const top = score(
      snap({
        contrib: { activeWeeks: 52, reviews: 700 },
        mergedToOthers: {
          count: 900,
          langs: { Go: 500, Rust: 200, Python: 100, C: 100 },
          owners: [],
        },
        repos: [{ name: 'lib', stars: 90000, lang: 'Go', fork: false }],
      }),
    );
    expect(top.level).toBeGreaterThanOrEqual(TUNING.form3Level);
    expect(top.form).toBe(3);
    const mid = score(
      snap({
        contrib: { activeWeeks: 30 },
        mergedToOthers: { count: 3, langs: { Go: 3 }, owners: [] },
      }),
    );
    expect(mid.form).toBe(1);
  });

  it('shiny is about 1 in 256 and fixed per user', () => {
    let n = 0;
    for (let id = 1; id <= 256_000; id++) if (isShiny(id)) n++;
    expect(n).toBeGreaterThan(800);
    expect(n).toBeLessThan(1250);
    expect(isShiny(42)).toBe(isShiny(42));
  });

  it('level weights sum to 1', () => {
    const w = TUNING.weights;
    expect(w.might + w.insight + w.renown + w.grit + w.range).toBeCloseTo(1);
    expect(levelOf(computeStats(snap(), 0))).toBe(1);
  });
});
