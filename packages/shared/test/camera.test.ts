import { describe, expect, it } from 'vitest';
import {
  FOLLOW_DIST_MAX,
  FOLLOW_DIST_MIN,
  FOLLOW_PITCH,
  clampFollowDist,
  followLook,
  snapQuarter,
  FOLLOW_OFFSET,
  PITCH_MAX,
  PITCH_MIN,
  approach,
  approachAngle,
  clampPitch,
  decay,
  followYaw,
  offBehind,
  PAPER_MAX,
  paperTurn,
  springArm,
  twoFingerMode,
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

  it('two fingers: a pinch zooms, a level push up or down tilts, a small wobble waits (v13.1)', () => {
    const a0 = { x: 100, y: 400 };
    const b0 = { x: 260, y: 400 };
    // spread apart: zoom
    expect(twoFingerMode(a0, b0, { x: 80, y: 402 }, { x: 290, y: 398 })).toBe('zoom');
    // both up together, still side by side: tilt
    expect(twoFingerMode(a0, b0, { x: 101, y: 370 }, { x: 259, y: 372 })).toBe('tilt');
    // a few pixels of wobble: not decided yet
    expect(twoFingerMode(a0, b0, { x: 103, y: 404 }, { x: 258, y: 397 })).toBeNull();
    // a twist: zoom (which turns)
    expect(twoFingerMode(a0, b0, { x: 100, y: 430 }, { x: 260, y: 370 })).toBe('zoom');
    // a sideways slide: zoom (which pans)
    expect(twoFingerMode(a0, b0, { x: 140, y: 400 }, { x: 300, y: 400 })).toBe('zoom');
  });

  it('walk view: the spring arm comes in before a hill behind, and stays out on flat ground (v13.2)', () => {
    const flat = () => 0;
    // looking down 14° from a focus 1.5 m up: a flat island never shortens the arm
    const dy = Math.sin(0.24);
    const dx = Math.cos(0.24);
    expect(springArm(0, 1.5, 0, dx, dy, 0, 9, flat)).toBe(9);
    // a 4 m bank from 3 m behind: the camera stops in front of it
    const bank = (x: number) => (x > 3 ? 4 : 0);
    const d = springArm(0, 1.5, 0, dx, dy, 0, 9, bank);
    expect(d).toBeLessThan(3.5);
    expect(d).toBeGreaterThanOrEqual(2.2);
  });

  it('walk view: the paper turn follows the walk, never past its limit (v13.2)', () => {
    // camera right = +x; walking a little off +x: the cut-out turns all the way to it
    const [ax, az] = paperTurn(1, 0, Math.cos(0.3), Math.sin(0.3), 1, PAPER_MAX, 1);
    expect(Math.atan2(az, ax)).toBeCloseTo(0.3, 6);
    // walking straight into the picture (+z here): it turns only as far as the limit
    const [bx, bz] = paperTurn(1, 0, 0, 1, 1, PAPER_MAX, 1);
    expect(Math.atan2(bz, bx)).toBeCloseTo(PAPER_MAX, 6);
    // in the map view (k = 0) it stays flat to the camera
    expect(paperTurn(1, 0, 0, 1, 1, PAPER_MAX, 0)).toEqual([1, 0]);
    // facing left on screen, walking left and a little in: it turns toward the walk, not away
    const [cx, cz] = paperTurn(1, 0, -Math.cos(0.3), Math.sin(0.3), -1, PAPER_MAX, 1);
    expect(Math.atan2(cz, cx)).toBeCloseTo(-0.3, 6);
  });
});

// v17: the close follow camera — quarter turns only, and your Gitemon below the middle of the screen
describe('follow camera (v17)', () => {
  it('snaps any heading to the quarter-turn grid it started from', () => {
    const base = 0.7;
    for (const y of [0.7, 0.9, 2.1, -1.0, 7.3]) {
      const s = snapQuarter(y, base);
      const k = (s - base) / (Math.PI / 2);
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
      expect(Math.abs(s - y)).toBeLessThanOrEqual(Math.PI / 4 + 1e-9);
    }
  });
  it('looks a little beyond your Gitemon, away from the camera', () => {
    const yaw = 1.1;
    const [lx, , lz] = followLook(10, 1, -4, yaw, 12);
    // the camera stands at +(cos, sin) · dist; the look point is on the other side of the focus
    const toCam = [Math.cos(yaw), Math.sin(yaw)];
    expect((lx - 10) * toCam[0]! + (lz + 4) * toCam[1]!).toBeLessThan(0);
    expect(Math.hypot(lx - 10, lz + 4)).toBeCloseTo(12 * 0.12);
  });
  it('keeps the distance in range and the angle high enough', () => {
    expect(clampFollowDist(2)).toBe(FOLLOW_DIST_MIN);
    expect(clampFollowDist(99)).toBe(FOLLOW_DIST_MAX);
    expect(FOLLOW_PITCH).toBeGreaterThan((30 * Math.PI) / 180);
  });
});
