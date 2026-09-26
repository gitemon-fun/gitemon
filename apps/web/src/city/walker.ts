import {
  CANAL_IN,
  CANAL_OUT,
  ROAD,
  STREET_IN,
  STREET_OUT,
  SW,
  TOWN_R,
  WATER_Y,
  gridHeight,
  type Island,
} from '@gitemon/shared';

/**
 * Walking (GRANDPLAN v6 §3, V6-D1): a path over the island for the player's own Gitemon — open
 * ground, roads, streets and bridges; never water, cliffs or the town's rows of houses. A* on the
 * layout's height grid, then the corners are cut where the straight line is walkable.
 */

export interface Path {
  pts: [number, number][];
  length: number;
}

const wrapPi = (a: number) => Math.abs(((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);

export class Walkable {
  private open: Uint8Array;
  private N: number;
  private E: number;
  private cell: number;
  /** gates and bridges: the angles where a path may cross the canal, the rows and the rivers */
  private gateList: number[];

  constructor(private isl: Island) {
    const g = isl.grid;
    this.gateList = [...isl.regions.map((r) => r.mid), ...isl.bridges.map((b) => b.a)];
    this.N = g.N;
    this.E = g.E;
    this.cell = g.cell;
    this.open = new Uint8Array((g.N + 1) * (g.N + 1));
    for (let j = 0; j <= g.N; j++)
      for (let i = 0; i <= g.N; i++) {
        const x = -g.E + i * g.cell;
        const z = -g.E + j * g.cell;
        this.open[j * (g.N + 1) + i] = this.walkable(x, z) ? 1 : 0;
      }
  }

  walkable(x: number, z: number): boolean {
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const nearGate = (half: number) => this.gateList.some((g) => wrapPi(a - g) * r < half);
    if (r < TOWN_R) {
      if (r > CANAL_IN - 0.5 && r < CANAL_OUT + 0.5) return nearGate(2.2); // canal: bridges only
      const rowIn = STREET_IN + ROAD / 2 + SW;
      const rowOut = STREET_OUT - ROAD / 2 - SW;
      if (r > rowIn && r < rowOut) return nearGate(4.5); // the house rows: through the gates
      if (r > STREET_OUT + ROAD / 2 + SW + 1 && r < TOWN_R - 0.6) return true; // the lawn
      return true; // plaza, streets
    }
    const h = gridHeight(this.isl.grid, x, z);
    if (h < WATER_Y + 0.35) return nearGate(3) && r < TOWN_R + 4; // rivers: the town bridges only
    const e = 1.6;
    const sl =
      Math.hypot(
        gridHeight(this.isl.grid, x + e, z) - gridHeight(this.isl.grid, x - e, z),
        gridHeight(this.isl.grid, x, z + e) - gridHeight(this.isl.grid, x, z - e),
      ) /
      (2 * e);
    return sl < 1.25;
  }

  private idx(x: number, z: number) {
    const i = Math.max(0, Math.min(this.N, Math.round((x + this.E) / this.cell)));
    const j = Math.max(0, Math.min(this.N, Math.round((z + this.E) / this.cell)));
    return [i, j] as const;
  }

  /** A* from (x0, z0) to (x1, z1); null when there is no way (the target is over water, say) */
  path(x0: number, z0: number, x1: number, z1: number): Path | null {
    const N1 = this.N + 1;
    const [si, sj] = this.idx(x0, z0);
    let [ti, tj] = this.idx(x1, z1);
    // a tap on a blocked cell walks to the nearest open cell around it
    if (!this.open[tj * N1 + ti]) {
      let best = -1;
      for (let d = 1; d < 5 && best < 0; d++)
        for (let dj = -d; dj <= d; dj++)
          for (let di = -d; di <= d; di++) {
            const k = (tj + dj) * N1 + (ti + di);
            if (k >= 0 && k < this.open.length && this.open[k]) {
              best = k;
              break;
            }
          }
      if (best < 0) return null;
      ti = best % N1;
      tj = Math.floor(best / N1);
    }
    const start = sj * N1 + si;
    const goal = tj * N1 + ti;
    const g = new Float32Array(N1 * N1).fill(Infinity);
    const from = new Int32Array(N1 * N1).fill(-1);
    const heap: [number, number][] = [];
    const push = (k: number, f: number) => {
      heap.push([f, k]);
      let n = heap.length - 1;
      while (n > 0) {
        const p = (n - 1) >> 1;
        if (heap[p]![0] <= heap[n]![0]) break;
        [heap[p], heap[n]] = [heap[n]!, heap[p]!];
        n = p;
      }
    };
    const pop = () => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let n = 0;
        for (;;) {
          const l = 2 * n + 1;
          const r = l + 1;
          let m = n;
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
          if (m === n) break;
          [heap[m], heap[n]] = [heap[n]!, heap[m]!];
          n = m;
        }
      }
      return top[1];
    };
    const hEst = (k: number) => Math.hypot((k % N1) - ti, Math.floor(k / N1) - tj);
    g[start] = 0;
    push(start, hEst(start));
    let found = false;
    let guard = 0;
    while (heap.length && guard++ < 60_000) {
      const k = pop();
      if (k === goal) {
        found = true;
        break;
      }
      const ci = k % N1;
      const cj = Math.floor(k / N1);
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni > this.N || nj > this.N) continue;
          const nk = nj * N1 + ni;
          if (!this.open[nk] && nk !== goal) continue;
          const cost = g[k]! + (di && dj ? Math.SQRT2 : 1);
          if (cost < g[nk]!) {
            g[nk] = cost;
            from[nk] = k;
            push(nk, cost + hEst(nk));
          }
        }
    }
    if (!found) return null;
    const cells: [number, number][] = [];
    for (let k = goal; k !== -1; k = from[k]!)
      cells.push([-this.E + (k % N1) * this.cell, -this.E + Math.floor(k / N1) * this.cell]);
    cells.reverse();
    cells[0] = [x0, z0];
    if (goal === ti + tj * N1 && this.walkable(x1, z1)) cells[cells.length - 1] = [x1, z1];
    // cut corners where the straight line stays walkable
    const pts: [number, number][] = [cells[0]!];
    let a = 0;
    while (a < cells.length - 1) {
      let b = cells.length - 1;
      while (b > a + 1 && !this.clear(cells[a]!, cells[b]!)) b--;
      pts.push(cells[b]!);
      a = b;
    }
    let length = 0;
    for (let i = 1; i < pts.length; i++)
      length += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    return { pts, length };
  }

  private clear(p: [number, number], q: [number, number]) {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const n = Math.ceil(d / (this.cell * 0.5));
    for (let s = 1; s < n; s++) {
      const t = s / n;
      if (!this.walkable(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)) return false;
    }
    return true;
  }
}

/** a walker moving along a path at a steady pace; `at` gives where it is now */
export class Walk {
  private seg = 0;
  private along = 0;
  done = false;
  constructor(
    readonly path: Path,
    readonly speed = 7,
  ) {}
  step(dt: number): [number, number, number, number] {
    const pts = this.path.pts;
    let left = this.speed * dt;
    while (!this.done && left > 0) {
      const a = pts[this.seg]!;
      const b = pts[this.seg + 1];
      if (!b) {
        this.done = true;
        break;
      }
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const room = len - this.along;
      if (left < room) {
        this.along += left;
        left = 0;
      } else {
        left -= room;
        this.seg++;
        this.along = 0;
      }
    }
    const a = pts[Math.min(this.seg, pts.length - 1)]!;
    const b = pts[this.seg + 1] ?? a;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t = this.along / len;
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      (b[0] - a[0]) / len,
      (b[1] - a[1]) / len,
    ];
  }
}
