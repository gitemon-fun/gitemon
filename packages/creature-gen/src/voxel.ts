/**
 * v16 (V16-D1): a sprite becomes pixel blocks. Every drawn pixel is a column of cubes, deeper the
 * further it sits from the outline (a rounded profile), so the body has real sides and a back while
 * the drawing stays exactly as drawn. Pure: pixels in, typed arrays out, no three.js.
 *
 * Units are sprite pixels. x runs left to right from the drawing's centre, y up from its bottom row
 * (the creature stands on y = 0), z toward the viewer; the body is symmetric in z. UVs follow the
 * canvas the pixels came from, top row at v = 1 (three.js flips canvas textures by default), and every
 * face samples the pixel it belongs to, so one texture colours the fronts and the sides alike.
 */

export interface VoxelMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** per pixel (row-major, w × h): how many cubes deep it is toward the viewer (0 = empty) */
  depth: Uint8Array;
  w: number;
  h: number;
}

export interface VoxelOptions {
  /** the deepest a pixel goes toward the viewer (and again away from it), in pixels */
  maxDepth: number;
  /** depth grows in layers of this many cubes (fewer layers, fewer faces); the outline stays one cube */
  step?: number;
}

/**
 * Per opaque pixel: its distance to the outline (8-neighbour, an empty pixel or the canvas edge is
 * distance 0), shaped into a dome that reaches `maxDepth` a little inside the outline.
 */
export function depthMap(
  mask: Uint8Array,
  w: number,
  h: number,
  maxDepth: number,
  step = 1,
): Uint8Array {
  const INF = 1 << 20;
  const d = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]!);
  // two-pass chessboard distance transform
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(
        d[i]!,
        at(x - 1, y) + 1,
        at(x, y - 1) + 1,
        at(x - 1, y - 1) + 1,
        at(x + 1, y - 1) + 1,
      );
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(
        d[i]!,
        at(x + 1, y) + 1,
        at(x, y + 1) + 1,
        at(x + 1, y + 1) + 1,
        at(x - 1, y + 1) + 1,
      );
    }
  const out = new Uint8Array(w * h);
  const R = Math.max(1, maxDepth * 1.2);
  for (let i = 0; i < w * h; i++) {
    if (!d[i]) continue;
    // a dome (ease-out): one cube at the outline, so thin legs and tails stay thin, rounding to full
    // depth in the middle of the body
    const t = Math.min(1, (d[i]! - 0.5) / R);
    const raw = maxDepth * (1 - (1 - t) * (1 - t));
    out[i] = raw < 1.5 ? 1 : Math.min(maxDepth, Math.max(step, step * Math.round(raw / step)));
  }
  return out;
}

export function voxelize(mask: Uint8Array, w: number, h: number, opts: VoxelOptions): VoxelMesh {
  const depth = depthMap(mask, w, h, Math.max(1, Math.round(opts.maxDepth)), opts.step ?? 1);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const cx = w / 2;
  const dAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : depth[y * w + x]!;

  /** one quad; corners in (x right, y down, z) pixel space; the winding is set to face `n` */
  const quad = (
    c: [number, number, number][],
    n: [number, number, number],
    t: [number, number][],
  ) => {
    const base = pos.length / 3;
    for (let k = 0; k < 4; k++) {
      const [x, y, z] = c[k]!;
      pos.push(x - cx, h - y, z);
      nor.push(...n);
      uv.push(t[k]![0], t[k]![1]);
    }
    // world corners (y flipped) decide the winding: counter-clockwise seen from the normal's side
    const P = (k: number) => [
      pos[(base + k) * 3]!,
      pos[(base + k) * 3 + 1]!,
      pos[(base + k) * 3 + 2]!,
    ];
    const [a, b, e] = [P(0), P(1), P(2)];
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const v = [e[0]! - a[0]!, e[1]! - a[1]!, e[2]! - a[2]!];
    const cr = [
      u[1]! * v[2]! - u[2]! * v[1]!,
      u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!,
    ];
    const ok = cr[0]! * n[0] + cr[1]! * n[1] + cr[2]! * n[2] > 0;
    if (ok) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  const U = (x: number) => x / w;
  const V = (y: number) => 1 - y / h;

  // ---- fronts and backs: greedy rectangles of equal depth (the texture carries the colours) ----
  const seen = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dd = depth[y * w + x]!;
      if (!dd || seen[y * w + x]) continue;
      let x1 = x;
      while (x1 + 1 < w && depth[y * w + x1 + 1] === dd && !seen[y * w + x1 + 1]) x1++;
      let y1 = y;
      grow: while (y1 + 1 < h) {
        for (let k = x; k <= x1; k++)
          if (depth[(y1 + 1) * w + k] !== dd || seen[(y1 + 1) * w + k]) break grow;
        y1++;
      }
      for (let yy = y; yy <= y1; yy++) for (let k = x; k <= x1; k++) seen[yy * w + k] = 1;
      const [ax, bx, ay, by] = [x, x1 + 1, y, y1 + 1];
      const t: [number, number][] = [
        [U(ax), V(ay)],
        [U(bx), V(ay)],
        [U(bx), V(by)],
        [U(ax), V(by)],
      ];
      for (const s of [1, -1] as const)
        quad(
          [
            [ax, ay, s * dd],
            [bx, ay, s * dd],
            [bx, by, s * dd],
            [ax, by, s * dd],
          ],
          [0, 0, s],
          t,
        );
    }

  // ---- side walls: where a neighbour is shallower (or empty), merged along runs of equal depths ----
  /** the z spans of a wall between depths `a` (this pixel) and `b` (the neighbour), b < a */
  const spans = (a: number, b: number): [number, number][] =>
    b === 0
      ? [[-a, a]]
      : [
          [b, a],
          [-a, -b],
        ];
  // vertical walls (neighbour left / right), runs down a column
  for (const side of [1, -1] as const)
    for (let x = 0; x < w; x++) {
      let y = 0;
      while (y < h) {
        const a = dAt(x, y);
        const b = dAt(x + side, y);
        if (!a || b >= a) {
          y++;
          continue;
        }
        let y1 = y;
        while (y1 + 1 < h && dAt(x, y1 + 1) === a && dAt(x + side, y1 + 1) === b) y1++;
        const wx = side > 0 ? x + 1 : x;
        const u = U(x + 0.5);
        for (const [z0, z1] of spans(a, b))
          quad(
            [
              [wx, y, z0],
              [wx, y, z1],
              [wx, y1 + 1, z1],
              [wx, y1 + 1, z0],
            ],
            [side, 0, 0],
            [
              [u, V(y)],
              [u, V(y)],
              [u, V(y1 + 1)],
              [u, V(y1 + 1)],
            ],
          );
        y = y1 + 1;
      }
    }
  // horizontal walls (neighbour above / below in the drawing), runs along a row
  for (const side of [-1, 1] as const)
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        const a = dAt(x, y);
        const b = dAt(x, y + side);
        if (!a || b >= a) {
          x++;
          continue;
        }
        let x1 = x;
        while (x1 + 1 < w && dAt(x1 + 1, y) === a && dAt(x1 + 1, y + side) === b) x1++;
        const wy = side > 0 ? y + 1 : y;
        const v = V(y + 0.5);
        // world normal: the row above (side −1) faces up (+y), the row below faces down
        for (const [z0, z1] of spans(a, b))
          quad(
            [
              [x, wy, z0],
              [x1 + 1, wy, z0],
              [x1 + 1, wy, z1],
              [x, wy, z1],
            ],
            [0, -side, 0],
            [
              [U(x), v],
              [U(x1 + 1), v],
              [U(x1 + 1), v],
              [U(x), v],
            ],
          );
        x = x1 + 1;
      }
    }

  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    uvs: new Float32Array(uv),
    indices: new Uint32Array(idx),
    depth,
    w,
    h,
  };
}
