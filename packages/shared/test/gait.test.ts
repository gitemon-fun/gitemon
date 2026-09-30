import { describe, expect, it } from 'vitest';
import { PATROL_K, gaitPose, legSteps, patrolDistance, patrolSteps } from '../src/gait.js';

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

// v16: the CPU copy of the crowd shader's gait pose (pixel-block creatures move in step with sprites)
describe('gaitPose (v16)', () => {
  it('lands with feet down on whole steps and rises between them', () => {
    for (const g of ['hop', 'waddle', 'trot'] as const) {
      expect(gaitPose(g, 3, 1, 2).lift).toBeCloseTo(0);
      expect(gaitPose(g, g === 'trot' ? 3.25 : 3.5, 1, 2).lift).toBeGreaterThan(0);
    }
  });
  it('does nothing while standing, except the float that always hovers', () => {
    for (const g of ['hop', 'waddle', 'trot', 'slither'] as const) {
      const p = gaitPose(g, 3.5, 0, 2);
      expect([p.lift, p.roll, p.lean, p.sway, p.sx, p.sy].map((v) => v + 0)).toEqual([
        0, 0, 0, 0, 1, 1,
      ]);
    }
    expect(gaitPose('float', 3.5, 0, 2).lift).toBeGreaterThan(0.3);
  });
  it('a waddle rolls from foot to foot and a hop squashes as it lands', () => {
    expect(gaitPose('waddle', 0.5, 1, 2).roll).toBeCloseTo(0.15);
    expect(gaitPose('waddle', 1.5, 1, 2).roll).toBeCloseTo(-0.15);
    expect(gaitPose('hop', 0.02, 1, 2).sy).toBeLessThan(1);
  });
});

// v18 (V18-D3): the universal toy walk of the 3D bodies
describe('toy walk (v18)', () => {
  it('lands with feet down on whole steps and lifts between them', () => {
    expect(gaitPose('toy', 3, 1, 2).lift).toBeCloseTo(0);
    expect(gaitPose('toy', 3.5, 1, 2).lift).toBeCloseTo(0.16);
  });
  it('squashes as it lands and rocks to a new side each step', () => {
    expect(gaitPose('toy', 4.02, 1, 2).sy).toBeLessThan(1);
    expect(gaitPose('toy', 4.02, 1, 2).sx).toBeGreaterThan(1);
    expect(gaitPose('toy', 0.5, 1, 2).roll).toBeCloseTo(0.09);
    expect(gaitPose('toy', 1.5, 1, 2).roll).toBeCloseTo(-0.09);
  });
  it('stands still with no motion at all', () => {
    const p = gaitPose('toy', 3.5, 0, 2);
    expect([p.lift, p.roll, p.lean, p.sway, p.sx, p.sy].map((v) => v + 0)).toEqual([
      0, 0, 0, 0, 1, 1,
    ]);
  });
});
