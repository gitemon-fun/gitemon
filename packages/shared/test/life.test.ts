import { describe, expect, it } from 'vitest';
import { lifeCheer, lifeInit, lifeStep, type Life } from '../src/life.js';

/** run `secs` of life at 30 frames a second; `moving` and `want` may change with time */
function run(
  s: Life,
  from: number,
  secs: number,
  moving: (t: number) => number = () => 0,
  want: (t: number) => number = () => 0,
) {
  const dt = 1 / 30;
  const out: Life[] = [];
  for (let t = from; t < from + secs; t += dt) {
    lifeStep(s, { dt, time: t, moving: moving(t), want: want(t), camYaw: 0.5, steps: t * 3 });
    out.push({ ...s });
  }
  return out;
}

// v18 build 08 (V18-D13): the brain of a 3D Gitemon
describe('life (v18 build 08)', () => {
  it('is the same for the same seed', () => {
    const a = run(lifeInit(7, 0), 0, 20).map((s) => [s.blink, s.headYaw, s.tail, s.sit]);
    const b = run(lifeInit(7, 0), 0, 20).map((s) => [s.blink, s.headYaw, s.tail, s.sit]);
    expect(a).toEqual(b);
  });
  it('eases into a walk instead of jumping to it', () => {
    const f = run(lifeInit(1, 0), 0, 1, () => 1);
    expect(f[0]!.mov).toBeLessThan(0.3);
    expect(f.at(-1)!.mov).toBeGreaterThan(0.95);
  });
  it('blinks every few seconds, briefly', () => {
    const f = run(lifeInit(3, 0), 0, 30);
    const closed = f.filter((s) => s.blink > 0.5).length / f.length;
    expect(closed).toBeGreaterThan(0.005);
    expect(closed).toBeLessThan(0.08);
  });
  it('never turns its head further than it can', () => {
    const f = run(
      lifeInit(5, 0),
      0,
      40,
      () => 0,
      (t) => (t < 20 ? 0 : 3),
    );
    for (const s of f) expect(Math.abs(s.headYaw)).toBeLessThanOrEqual(0.7 + 1e-9);
  });
  it('sits after standing a while, and walking cancels it', () => {
    const s = lifeInit(11, 0);
    const f = run(s, 0, 60);
    expect(f.some((x) => x.action !== 'none')).toBe(true);
    s.action = 'sit';
    s.actionAt = 60;
    s.actionLen = 5;
    run(s, 60, 0.2, () => 1);
    expect(s.action).toBe('none');
  });
  it('a tap makes it wag and hop', () => {
    const s = lifeInit(2, 0);
    run(s, 0, 1);
    lifeCheer(s, 1);
    const f = run(s, 1, 0.6);
    expect(Math.max(...f.map((x) => x.lift))).toBeGreaterThan(0.15);
    expect(Math.max(...f.map((x) => Math.abs(x.tail)))).toBeGreaterThan(0.25);
  });
});
