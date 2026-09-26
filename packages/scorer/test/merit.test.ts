import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@gitemon/shared';
import { merit } from '../src/index.js';

const NOW = Date.parse('2026-09-27T00:00:00Z');
const old = '2024-01-01T00:00:00Z';
const fresh = '2026-09-25T00:00:00Z';
function snap(
  p: Partial<Snapshot['contrib']> & { merged?: number; repos?: Snapshot['repos']; bot?: boolean },
): Snapshot {
  return {
    v: 1,
    userId: 1,
    login: 'x',
    name: null,
    createdAt: old,
    isBot: !!p.bot,
    followers: 0,
    repos: p.repos ?? [],
    contrib: {
      commits: p.commits ?? 0,
      prs: p.prs ?? 0,
      reviews: p.reviews ?? 0,
      issues: p.issues ?? 0,
      restricted: 0,
      activeWeeks: p.activeWeeks ?? 0,
      activeDays: p.activeDays ?? 0,
    },
    mergedToOthers: { count: p.merged ?? 0, langs: {}, owners: [] },
    fetchedAt: new Date(NOW).toISOString(),
  };
}

// an honest, steady solo developer: codes most days on their own projects, a few stars
const steady = snap({
  commits: 900,
  activeDays: 220,
  activeWeeks: 48,
  issues: 10,
  repos: [{ name: 'app', stars: 40, lang: 'Go', fork: false, createdAt: old }],
});

describe('merit (v7, V7-D2)', () => {
  it('rewards a steady solo developer who only commits to their own repos', () => {
    expect(merit(steady, NOW)).toBeGreaterThan(40);
  });
  it('does not reward 10,000 commits pushed in one day', () => {
    const burst = snap({ commits: 10_000, activeDays: 1, activeWeeks: 1 });
    expect(merit(burst, NOW)).toBeLessThan(merit(steady, NOW) / 4);
  });
  it('gives nothing for stars on repos created in the last two weeks, or on forks', () => {
    const farm = snap({
      activeDays: 3,
      repos: Array.from({ length: 50 }, (_, i) => ({
        name: `r${i}`,
        stars: 200,
        lang: 'JS',
        fork: false,
        createdAt: fresh,
      })),
    });
    const forks = snap({
      activeDays: 3,
      repos: [{ name: 'linux', stars: 200_000, lang: 'C', fork: true, createdAt: old }],
    });
    const bare = snap({ activeDays: 3 });
    expect(merit(farm, NOW)).toBe(merit(bare, NOW));
    expect(merit(forks, NOW)).toBe(merit(bare, NOW));
  });
  it('gives bots nothing and stays within 0..100', () => {
    expect(merit(snap({ activeDays: 364, bot: true }), NOW)).toBe(0);
    const max = snap({
      activeDays: 364,
      merged: 5000,
      reviews: 5000,
      issues: 5000,
      repos: [{ name: 'big', stars: 1e6, lang: 'Rust', fork: false, createdAt: old }],
    });
    expect(merit(max, NOW)).toBe(100);
  });
  it('flattens: the first 30 active days are worth more than the next 300', () => {
    const d = (n: number) => merit(snap({ activeDays: n }), NOW);
    expect(d(30) - d(0)).toBeGreaterThan(d(330) - d(30));
  });
});
