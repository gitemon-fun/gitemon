import { describe, expect, it } from 'vitest';
import { decide, problemOf } from '../src/index.js';

describe('the fetcher watches the site (V11-D10, G5)', () => {
  it('names the problem', () => {
    expect(problemOf(null)).toMatch(/not answering/);
    expect(problemOf({ ok: true, pendingOldestMin: 45 })).toMatch(/45 min/);
    expect(problemOf({ ok: true, pendingOldestMin: 3 })).toBeNull();
  });

  it('alerts once, repeats after 6 h, and says when it recovers', () => {
    const t = 1_000_000_000;
    const quiet = { problem: null, lastAlert: 0 };
    expect(decide(quiet, 'down', t)).toMatch(/down/);
    expect(decide({ problem: 'down', lastAlert: t }, 'down', t + 60_000)).toBeNull();
    expect(decide({ problem: 'down', lastAlert: t }, 'down', t + 7 * 3_600_000)).toMatch(/down/);
    expect(decide({ problem: 'down', lastAlert: t }, null, t + 60_000)).toMatch(/recovered/);
    expect(decide(quiet, null, t)).toBeNull();
  });
});
