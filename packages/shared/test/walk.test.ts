import { describe, expect, it } from 'vitest';
import { auraLevel, dayBefore, legendOfDayRank, nextStreak, walkBudget } from '../src/index.js';

const snap = (prs: number, reviews: number, activeWeeks: number) => ({
  contrib: { commits: 9999, prs, reviews, issues: 0, restricted: 0, activeWeeks },
});

describe('walk rules (v6)', () => {
  it('budget grows with confirmed work, not raw commits, and is capped', () => {
    expect(walkBudget(null)).toBe(250);
    expect(walkBudget(snap(0, 0, 0))).toBe(250);
    expect(walkBudget(snap(10, 5, 20))).toBe(250 + 150 + 40 + 240);
    expect(walkBudget(snap(999, 999, 52))).toBe(2000);
  });
  it('counts a streak across days and resets after a gap', () => {
    expect(nextStreak(0, null, '2026-09-27')).toBe(1);
    expect(nextStreak(4, '2026-09-26', '2026-09-27')).toBe(5);
    expect(nextStreak(4, '2026-09-27', '2026-09-27')).toBe(4);
    expect(nextStreak(9, '2026-09-20', '2026-09-27')).toBe(1);
    expect(dayBefore('2026-10-01')).toBe('2026-09-30');
    expect([auraLevel(6), auraLevel(7), auraLevel(30)]).toEqual([0, 1, 2]);
  });
  it('picks the legend of the day from the top 50, the same for everyone', () => {
    const r = legendOfDayRank('2026-09-27');
    expect(r).toBeGreaterThanOrEqual(1);
    expect(r).toBeLessThanOrEqual(50);
    expect(legendOfDayRank('2026-09-27')).toBe(r);
  });
});
