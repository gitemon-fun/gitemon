import { describe, expect, it } from 'vitest';
import { PATROL_K, legSteps, patrolDistance, patrolSteps } from '../src/gait.js';

const EDGE = Math.asin(1 / PATROL_K);

describe('gait by distance (V10-D3, G2)', () => {
  it('a full patrol cycle is 4 amplitudes, and it never goes backwards', () => {
    expect(patrolDistance(0)).toBeCloseTo(0);
    expect(patrolDistance(Math.PI * 2)).toBeCloseTo(4);
    expect(patrolDistance(Math.PI * 4)).toBeCloseTo(8);
    let last = -1;
    for (let t = 0; t < 20; t += 0.01) {
      const d = patrolDistance(t);
      expect(d).toBeGreaterThanOrEqual(last - 1e-9);
      last = d;
    }
  });

  it('a pausing resident has no step motion', () => {
    const a = patrolDistance(EDGE + 0.01);
    const b = patrolDistance(Math.PI - EDGE - 0.01);
    expect(a).toBeCloseTo(1);
    expect(b).toBeCloseTo(a);
    expect(patrolDistance(Math.PI + EDGE + 0.2)).toBeCloseTo(3);
  });

  it('every leg ends on a landing (a whole step) whatever the amplitude', () => {
    for (const amp of [0.7, 1.3, 2.9, 4.4]) {
      for (const pause of [EDGE + 0.05, Math.PI + EDGE + 0.05, 2 * Math.PI + EDGE + 0.05]) {
        const s = patrolSteps(pause, amp, 1.1);
        expect(Math.abs(s - Math.round(s))).toBeLessThan(1e-9);
      }
      expect(legSteps(amp, 1.1)).toBeGreaterThanOrEqual(1);
    }
  });
});
