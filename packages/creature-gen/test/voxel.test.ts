import { describe, expect, it } from 'vitest';
import { compose, placeholderArt, P, voxelize, depthMap } from '../src/index.js';

// v16 (V16-D1): pixel blocks — every drawn pixel covered once in front and once behind, walls only where
// the body gets shallower, a round middle, and few enough triangles for a phone
const disc = (w: number, r: number) => {
  const m = new Uint8Array(w * w);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++)
      m[y * w + x] = Math.hypot(x + 0.5 - w / 2, y + 0.5 - w / 2) <= r ? 1 : 0;
  return m;
};
/** area of the faces whose normal is n (from the positions, two triangles per quad) */
function area(mesh: ReturnType<typeof voxelize>, n: [number, number, number]) {
  let a = 0;
  const { positions: p, normals: nn, indices: ix } = mesh;
  for (let t = 0; t < ix.length; t += 3) {
    const [i, j, k] = [ix[t]!, ix[t + 1]!, ix[t + 2]!];
    if (nn[i * 3] !== n[0] || nn[i * 3 + 1] !== n[1] || nn[i * 3 + 2] !== n[2]) continue;
    const u = [p[j * 3]! - p[i * 3]!, p[j * 3 + 1]! - p[i * 3 + 1]!, p[j * 3 + 2]! - p[i * 3 + 2]!];
    const v = [p[k * 3]! - p[i * 3]!, p[k * 3 + 1]! - p[i * 3 + 1]!, p[k * 3 + 2]! - p[i * 3 + 2]!];
    a +=
      Math.hypot(
        u[1]! * v[2]! - u[2]! * v[1]!,
        u[2]! * v[0]! - u[0]! * v[2]!,
        u[0]! * v[1]! - u[1]! * v[0]!,
      ) / 2;
  }
  return a;
}

describe('voxelize (v16)', () => {
  it('covers every drawn pixel once in front and once behind', () => {
    const m = disc(40, 17);
    const mesh = voxelize(m, 40, 40, { maxDepth: 7 });
    const opaque = m.reduce((s, v) => s + v, 0);
    expect(area(mesh, [0, 0, 1])).toBeCloseTo(opaque, 5);
    expect(area(mesh, [0, 0, -1])).toBeCloseTo(opaque, 5);
  });
  it('grows in layers when asked, the outline still one cube', () => {
    const d = depthMap(disc(60, 28), 60, 60, 11, 2);
    expect(d[30 * 60 + 2]).toBe(1);
    for (const v of d) if (v > 1) expect(v % 2 === 0 || v === 11).toBe(true);
  });
  it('is round and deep enough in the middle, one pixel deep at the outline', () => {
    const d = depthMap(disc(60, 28), 60, 60, 11);
    expect(d[30 * 60 + 30]).toBe(11);
    expect(d[30 * 60 + 2]).toBe(1);
    // the body's middle is at least 25 % as deep (front to back) as the creature is wide
    expect((2 * d[30 * 60 + 30]!) / 56).toBeGreaterThanOrEqual(0.25);
  });
  it('puts walls only where the body gets shallower, facing out', () => {
    const w = 6;
    const m = new Uint8Array(w * w).fill(1);
    const mesh = voxelize(m, w, w, { maxDepth: 1 });
    // a flat slab 1 deep each way: 4 outer walls of 6 × 2 and nothing inside
    for (const n of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
    ] as [number, number, number][])
      expect(area(mesh, n)).toBeCloseTo(12, 5);
    // every triangle winds toward its own normal
    const { positions: p, normals: nn, indices: ix } = mesh;
    for (let t = 0; t < ix.length; t += 3) {
      const [i, j, k] = [ix[t]!, ix[t + 1]!, ix[t + 2]!];
      const u = [
        p[j * 3]! - p[i * 3]!,
        p[j * 3 + 1]! - p[i * 3 + 1]!,
        p[j * 3 + 2]! - p[i * 3 + 2]!,
      ];
      const v = [
        p[k * 3]! - p[i * 3]!,
        p[k * 3 + 1]! - p[i * 3 + 1]!,
        p[k * 3 + 2]! - p[i * 3 + 2]!,
      ];
      const c = [
        u[1]! * v[2]! - u[2]! * v[1]!,
        u[2]! * v[0]! - u[0]! * v[2]!,
        u[0]! * v[1]! - u[1]! * v[0]!,
      ];
      expect(c[0]! * nn[i * 3]! + c[1]! * nn[i * 3 + 1]! + c[2]! * nn[i * 3 + 2]!).toBeGreaterThan(
        0,
      );
    }
  });
  it('stands on the ground, centred, and is the same every time', () => {
    const sp = compose(placeholderArt, { id: 3, t1: 'bloom', t2: null, sh: 'steady', f: 2, s: 0 });
    const m = Uint8Array.from(sp.px, (v) => (v === P.none ? 0 : 1));
    const a = voxelize(m, sp.size, sp.size, { maxDepth: 3 });
    const b = voxelize(m, sp.size, sp.size, { maxDepth: 3 });
    expect(a.positions).toEqual(b.positions);
    let minY = Infinity;
    for (let i = 1; i < a.positions.length; i += 3) minY = Math.min(minY, a.positions[i]!);
    expect(minY).toBeGreaterThanOrEqual(0);
  });
  it('stays light enough for a phone at the real drawing size', () => {
    const mesh = voxelize(disc(64, 30), 64, 64, { maxDepth: 11, step: 2 });
    const tris = mesh.indices.length / 3;
    expect(tris).toBeLessThan(6000);
  });
});
