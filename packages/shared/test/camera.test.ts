import { describe, expect, it } from 'vitest';
import {
  FOLLOW_OFFSET,
  PITCH_MAX,
  PITCH_MIN,
  approach,
  approachAngle,
  clampPitch,
  decay,
  followYaw,
  offBehind,
  wrapAngle,
} from '../src/index.js';

describe('camera maths (v13)', () => {
  it('inertia settles within ~0.6 s (G2)', () => {
    let v = 10;
    for (let t = 0; t < 0.66; t += 1 / 30) v = decay(v, 1 / 30, 7);
    expect(Math.abs(v)).toBeLessThan(0.1);
  });

  it('approach never overshoots and is frame-rate independent', () => {
    const a = approach(0, 10, 0.5, 4);
    let b = 0;
    for (let k = 0; k < 10; k++) b = approach(b, 10, 0.05, 4);
    expect(a).toBeCloseTo(b, 6);
    expect(a).toBeLessThan(10);
    expect(wrapAngle(approachAngle(3.0, -3.0, 1, 50) - -3.0)).toBeCloseTo(0, 3); // short way round
  });

  it('tilt stays between 18° and 70° (G3)', () => {
    expect(clampPitch(0)).toBe(PITCH_MIN);
    expect(clampPitch(2)).toBe(PITCH_MAX);
  });

  it('the walk camera sits behind and to the side, never straight behind (V13-D5, G4)', () => {
    for (const travel of [0, 1, 2.5, -2]) {
      for (const cur of [0, 1.5, 3, -2.4]) {
        const y = followYaw(travel, cur);
        expect(offBehind(y, travel)).toBeCloseTo(FOLLOW_OFFSET, 6);
        expect(offBehind(y, travel)).toBeGreaterThan((30 * Math.PI) / 180);
      }
    }
    // keeps the side it is on: a camera already right of behind stays right of behind
    const travel = 0;
    const right = travel + Math.PI + 0.3;
    expect(wrapAngle(followYaw(travel, right) - (travel + Math.PI))).toBeGreaterThan(0);
  });
});
