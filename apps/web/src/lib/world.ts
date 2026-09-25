import {
  BIOME,
  BIOME_ORDER,
  CHUNK,
  COLS,
  PLOT,
  TOWN_MAX,
  TOWN_MIN,
  TYPE_INFO,
  VILLAGE,
  VILLAGE_MIN,
  WORLD_H,
  WORLD_W,
  bandRadius,
  biomeOrigin,
  hash32,
  plotRect,
  zoneOf,
  type MapGitemon,
  type TypeId,
} from '@gitemon/shared';
import { decodePx } from '@gitemon/creature-gen';
import { art } from '@gitemon/art';
import { api, type Town } from './api';
import { house, prop, tower, TERRAIN, type PropKind } from './props';
import { sprite } from './sprites';

/**
 * The map (DECISIONS D24): an isometric world where every language biome is a floating island.
 *   World  (u < 1.2 px):  islands, bridges, clouds, island banners, only notable Gitemon
 *   Town   (1.2 ≤ u < 8): islands in more detail, every Gitemon as a dot, notable ones as sprites
 *   Street (u ≥ 8):       every tile, prop, house and Gitemon, animated
 * `u` is the screen size of half a tile's width. A tile is 2u wide and u tall.
 * Being visible from the far zoom is the status reward (D5, D6).
 */
export const STREET_U = 8;
export const TOWN_U = 1.2;
const MAX_U = 40;
const HI_RES = 4; // island pre-render scale for the town band

type Dot = [number, number, number, number];
type Band = 'world' | 'town' | 'street';

const rnd = (a: string, x: number, y: number) => hash32(`${a}:${x},${y}`) / 4294967296;

/** Coarse value noise for organic island edges. */
function noise(seed: string, x: number, y: number, cell = 9) {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = x / cell - gx;
  const fy = y / cell - gy;
  const v = (i: number, j: number) => rnd(seed, gx + i, gy + j);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  return (v(0, 0) * (1 - sx) + v(1, 0) * sx) * (1 - sy) + (v(0, 1) * (1 - sx) + v(1, 1) * sx) * sy;
}

interface Island {
  t: TypeId;
  pop: number;
  radius: number;
  /** 1 = land, per local tile (BIOME × BIOME) */
  land: Uint8Array;
  /** 0 = none, else index+1 into TERRAIN[t].props; HOUSE / LANDMARK */
  obj: Uint8Array;
  variant: Uint8Array;
  /** cliff length below front-edge tiles, 0 = not an edge */
  cliff: Uint8Array;
  lo: Map<number, HTMLCanvasElement>;
  roofs: Map<number, string>;
  falls: number[];
}

const HOUSE = 250;
const LANDMARK = 251;
const ROOFS = ['#c24b2a', '#2a6fc2', '#3a8a4a', '#8a3ac2', '#c2a02a', '#2aa0a0'];

function buildIsland(t: TypeId, pop: number, towns: Town[]): Island {
  const N = BIOME;
  const land = new Uint8Array(N * N);
  const obj = new Uint8Array(N * N);
  const variant = new Uint8Array(N * N);
  const cliff = new Uint8Array(N * N);
  const radius = Math.min(N / 2 - 3, 64 + bandRadius(pop) + 10);
  const T = TERRAIN[t];
  const c = (N - 1) / 2;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = Math.abs(x - c);
      const dy = Math.abs(y - c);
      const d = Math.pow(dx ** 4 + dy ** 4, 0.25);
      const edge = radius + (noise(t, x, y) - 0.5) * 12 + (noise(t + '2', x, y, 3) - 0.5) * 3;
      if (d < edge || zoneOf(x, y) !== 'wild') land[y * N + x] = 1;
    }
  const roofs = new Map<number, string>();
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (!land[i]) continue;
      variant[i] = Math.floor(rnd(t + 'v', x, y) * 3);
      const front = x === N - 1 || y === N - 1 || !land[i + 1] || !land[i + N];
      if (front) cliff[i] = 6 + Math.floor(noise(t + 'c', x, y, 4) * 30);
      // props only on the odd checkerboard colour: Gitemon stand on the even one
      if ((x + y) % 2 === 1 && zoneOf(x, y) === 'wild' && rnd(t + 'p', x, y) < T.density)
        obj[i] = 1 + Math.floor(rnd(t + 'k', x, y) * T.props.length);
    }
  // village: houses on its rim, landmark in the middle
  for (let k = 0; k < VILLAGE; k += 5) {
    for (const [x, y] of [
      [VILLAGE_MIN + k, VILLAGE_MIN - 1],
      [VILLAGE_MIN - 1, VILLAGE_MIN + k],
      [VILLAGE_MIN + k + 1, VILLAGE_MIN + VILLAGE],
      [VILLAGE_MIN + VILLAGE, VILLAGE_MIN + k + 1],
    ]) {
      if ((x + y) % 2 === 1) {
        obj[y * N + x] = HOUSE;
        roofs.set(y * N + x, ROOFS[hash32(`${t}${x},${y}`) % ROOFS.length]);
      }
    }
  }
  obj[(N / 2 - 1) * N + N / 2] = LANDMARK;
  // town plots: a house on each corner
  const o = biomeOrigin(t);
  for (const town of towns.filter((tw) => tw.biome === t)) {
    const r = plotRect(t, town.plot);
    const roof = town.kind === 'official' ? '#d8a83a' : ROOFS[town.id % ROOFS.length];
    for (const [x, y] of [
      [r.x - o.x, r.y - o.y + 1],
      [r.x - o.x + PLOT - 1, r.y - o.y],
      [r.x - o.x + 1, r.y - o.y + PLOT - 2],
      [r.x - o.x + PLOT - 2, r.y - o.y + PLOT - 1],
    ]) {
      obj[y * N + x] = HOUSE;
      roofs.set(y * N + x, roof);
    }
  }
  // waterfalls off a few front edges
  const falls: number[] = [];
  if (T.waterfall) {
    const edges: number[] = [];
    for (let i = 0; i < N * N; i++) if (cliff[i] > 20) edges.push(i);
    for (let k = 0; k < Math.min(3, edges.length); k++)
      falls.push(edges[hash32(t + 'f' + k) % edges.length]);
  }
  return { t, pop, radius, land, obj, variant, cliff, lo: new Map(), roofs, falls };
}

// ---- landmark sprites ------------------------------------------------------------------------------

const landmarkCache = new Map<TypeId, HTMLCanvasElement>();
function landmark(t: TypeId): HTMLCanvasElement {
  let c = landmarkCache.get(t);
  if (c) return c;
  const src = art.landmarks?.[t];
  if (src) {
    c = document.createElement('canvas');
    c.width = src.w;
    c.height = src.h;
    const g = c.getContext('2d')!;
    const idx = decodePx(src);
    const img = g.createImageData(src.w, src.h);
    for (let i = 0; i < idx.length; i++) {
      const v = idx[i];
      if (!v) continue;
      const n = parseInt(src.palette[v].slice(1), 16);
      img.data.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], i * 4);
    }
    g.putImageData(img, 0, 0);
  } else c = tower(TYPE_INFO[t].colors[0], TERRAIN[t].glow);
  landmarkCache.set(t, c);
  return c;
}

// ---- the view ----------------------------------------------------------------------------------------

interface Cloud {
  x: number;
  y: number;
  w: number;
  speed: number;
  layer: number;
}

export class WorldView {
  x = WORLD_W / 2;
  y = WORLD_H / 2;
  u = 1;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private raf = 0;
  private t0 = performance.now();
  private chunks = new Map<number, MapGitemon[] | 'loading'>();
  private biomes = new Map<TypeId, Dot[] | 'loading'>();
  private notable: MapGitemon[] = [];
  private pops: Record<string, number> = {};
  private islands = new Map<TypeId, Island>();
  private tiles = new Map<string, HTMLCanvasElement>();
  private tileU = 0;
  towns: Town[] = [];
  private bySlot = new Map<string, MapGitemon>();
  selected: MapGitemon | null = null;
  me: number | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; u: number } | null = null;
  private moved = 0;
  private anim: {
    x: number;
    y: number;
    u: number;
    t0: number;
    from: { x: number; y: number; u: number };
  } | null = null;
  private clouds: Cloud[] = [];
  private visible = true;

  constructor(
    private canvas: HTMLCanvasElement,
    private onPick: (g: MapGitemon | null) => void,
    private onZoom: (band: Band) => void,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    for (let i = 0; i < 22; i++)
      this.clouds.push({
        x: rnd('cx', i, 0),
        y: rnd('cy', i, 0),
        w: 60 + rnd('cw', i, 0) * 140,
        speed: 4 + rnd('cs', i, 0) * 10,
        layer: i % 2,
      });
    this.resize();
    this.fit();
    this.bind();
    document.addEventListener('visibilitychange', () => (this.visible = !document.hidden));
    this.loop();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  get band(): Band {
    return this.u >= STREET_U ? 'street' : this.u >= TOWN_U ? 'town' : 'world';
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
  }

  /** The world diamond is (W+H)·u wide and (W+H)·u/2 tall. */
  get fitU() {
    return Math.min(this.w / (WORLD_W + WORLD_H), (this.h * 2) / (WORLD_W + WORLD_H)) * 1.9;
  }
  get minU() {
    return this.fitU * 0.7;
  }

  fit() {
    this.anim = null;
    this.u = this.fitU;
    this.x = WORLD_W / 2;
    this.y = WORLD_H / 2;
  }

  setNotable(g: MapGitemon[], towns: Town[], pops: Record<string, number> = {}) {
    this.notable = g;
    this.towns = towns;
    this.pops = pops;
    this.islands.clear();
    for (const n of g) this.bySlot.set(`${n.x},${n.y}`, n);
  }

  upsert(g: MapGitemon) {
    for (const [k, v] of this.bySlot)
      if (v.id === g.id && k !== `${g.x},${g.y}`) this.bySlot.delete(k);
    this.bySlot.set(`${g.x},${g.y}`, g);
    const ck = Math.floor(g.y / CHUNK) * (WORLD_W / CHUNK) + Math.floor(g.x / CHUNK);
    const c = this.chunks.get(ck);
    if (Array.isArray(c)) {
      const i = c.findIndex((o) => o.id === g.id);
      if (i >= 0) c[i] = g;
      else c.push(g);
    }
  }

  invalidate() {
    this.chunks.clear();
    this.biomes.clear();
    this.bySlot.clear();
    this.islands.clear();
    for (const n of this.notable) this.bySlot.set(`${n.x},${n.y}`, n);
  }

  flyTo(x: number, y: number, u = 20) {
    const target = Math.min(MAX_U, u);
    // on phones the info sheet covers the lower half: aim below the creature so it sits higher
    const lift = this.w < 760 ? (this.h * 0.2) / target : 0;
    this.anim = {
      x: x + 0.5 + lift,
      y: y + 0.5 + lift,
      u: target,
      t0: performance.now(),
      from: { x: this.x, y: this.y, u: this.u },
    };
  }

  zoomBy(f: number, cx = this.w / 2, cy = this.h / 2) {
    const [wx, wy] = this.toWorld(cx, cy);
    const prev = this.band;
    this.u = Math.max(this.minU, Math.min(MAX_U, this.u * f));
    const [nx, ny] = this.toWorld(cx, cy);
    this.x += wx - nx;
    this.y += wy - ny;
    this.clamp();
    if (this.band !== prev) this.onZoom(this.band);
  }

  private clamp() {
    this.x = Math.max(0, Math.min(WORLD_W, this.x));
    this.y = Math.max(0, Math.min(WORLD_H, this.y));
  }

  toScreen(X: number, Y: number): [number, number] {
    const dx = X - this.x;
    const dy = Y - this.y;
    return [this.w / 2 + (dx - dy) * this.u, this.h / 2 + ((dx + dy) * this.u) / 2];
  }
  toWorld(sx: number, sy: number): [number, number] {
    const a = (sx - this.w / 2) / this.u;
    const b = (sy - this.h / 2) / (this.u / 2);
    return [this.x + (a + b) / 2, this.y + (b - a) / 2];
  }

  // ---- input ---------------------------------------------------------------------------------------

  private bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.moved = 0;
      this.anim = null;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), u: this.u };
      }
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const r = c.getBoundingClientRect();
        const target = Math.max(this.minU, Math.min(MAX_U, (this.pinch.u * d) / this.pinch.d));
        this.zoomBy(target / this.u, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        this.moved += 10;
        return;
      }
      this.moved += Math.abs(dx) + Math.abs(dy);
      const a = dx / this.u;
      const bb = dy / (this.u / 2);
      this.x -= (a + bb) / 2;
      this.y -= (bb - a) / 2;
      this.clamp();
    });
    const up = (e: PointerEvent) => {
      const was = this.pointers.size;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (was === 1 && this.moved < 6 && e.type === 'pointerup') {
        const r = c.getBoundingClientRect();
        this.pick(e.clientX - r.left, e.clientY - r.top);
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        this.anim = null;
        this.zoomBy(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );
    c.addEventListener('dblclick', (e) => {
      const r = c.getBoundingClientRect();
      this.zoomBy(2.5, e.clientX - r.left, e.clientY - r.top);
    });
    window.addEventListener('resize', () => this.resize());
  }

  private creatureSize() {
    // designed species carry their own size (babies small, final forms big) on one 80 px canvas
    return this.u * 3.4;
  }
  private creatureRect(g: MapGitemon): [number, number, number, number] {
    const [sx, sy] = this.toScreen(g.x + 0.5, g.y + 0.5);
    const size = this.creatureSize();
    return [sx - size / 2, sy - size * 0.92, size, size];
  }

  private pick(px: number, py: number) {
    let best: MapGitemon | null = null;
    if (this.band === 'street') {
      const [wx, wy] = this.toWorld(px, py);
      let bestDepth = -Infinity;
      for (let dx = -2; dx <= 4; dx++)
        for (let dy = -2; dy <= 4; dy++) {
          const g = this.bySlot.get(`${Math.floor(wx) + dx},${Math.floor(wy) + dy}`);
          if (!g) continue;
          const [x, y, w, h] = this.creatureRect(g);
          if (px >= x && px <= x + w && py >= y && py <= y + h && g.x + g.y > bestDepth) {
            best = g;
            bestDepth = g.x + g.y;
          }
        }
    } else {
      let bd = 22;
      for (const n of this.visibleNotable()) {
        const [sx, sy] = this.toScreen(n.x + 0.5, n.y + 0.5);
        const d = Math.hypot(sx - px, sy - 12 - py);
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      if (!best) {
        // tapping empty land zooms into it
        const [wx, wy] = this.toWorld(px, py);
        this.anim = {
          x: wx,
          y: wy,
          u: this.band === 'world' ? 4 : 14,
          t0: performance.now(),
          from: { x: this.x, y: this.y, u: this.u },
        };
        return;
      }
    }
    this.selected = best;
    this.onPick(best);
  }

  // ---- data ----------------------------------------------------------------------------------------

  private viewRect(margin = 4) {
    const pts = [
      this.toWorld(0, 0),
      this.toWorld(this.w, 0),
      this.toWorld(0, this.h),
      this.toWorld(this.w, this.h),
    ];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return {
      x0: Math.max(0, Math.floor(Math.min(...xs)) - margin),
      x1: Math.min(WORLD_W - 1, Math.ceil(Math.max(...xs)) + margin),
      y0: Math.max(0, Math.floor(Math.min(...ys)) - margin),
      y1: Math.min(WORLD_H - 1, Math.ceil(Math.max(...ys)) + margin),
    };
  }

  private visibleNotable() {
    return this.notable.filter((n) => {
      const [sx, sy] = this.toScreen(n.x, n.y);
      return sx > -40 && sy > -40 && sx < this.w + 40 && sy < this.h + 60;
    });
  }

  private loadChunks() {
    const v = this.viewRect(2);
    const per = WORLD_W / CHUNK;
    for (let cy = Math.floor(v.y0 / CHUNK); cy <= Math.floor(v.y1 / CHUNK); cy++)
      for (let cx = Math.floor(v.x0 / CHUNK); cx <= Math.floor(v.x1 / CHUNK); cx++) {
        const k = cy * per + cx;
        if (this.chunks.has(k)) continue;
        this.chunks.set(k, 'loading');
        api
          .chunk(cx, cy)
          .then(({ data }) => {
            this.chunks.set(k, data.g);
            for (const g of data.g) this.bySlot.set(`${g.x},${g.y}`, g);
          })
          .catch(() => this.chunks.delete(k));
      }
  }

  private loadBiome(t: TypeId) {
    if (this.biomes.has(t)) return;
    this.biomes.set(t, 'loading');
    api
      .biome(t)
      .then(({ data }) => this.biomes.set(t, data.d))
      .catch(() => this.biomes.delete(t));
  }

  private island(t: TypeId): Island {
    let is = this.islands.get(t);
    if (!is) this.islands.set(t, (is = buildIsland(t, this.pops[t] ?? 0, this.towns)));
    return is;
  }

  // ---- island pre-render (world + town bands) ------------------------------------------------------

  private islandCanvas(is: Island, u0: number): HTMLCanvasElement {
    let c = is.lo.get(u0);
    if (c) return c;
    const N = BIOME;
    const T = TERRAIN[is.t];
    const depth = 44 * u0;
    c = document.createElement('canvas');
    c.width = 2 * N * u0;
    c.height = N * u0 + depth;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    const P = (x: number, y: number): [number, number] => [(x - y + N) * u0, ((x + y) * u0) / 2];
    // underside first
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        if (!is.cliff[i]) continue;
        const [sx, sy] = P(x, y);
        g.fillStyle = T.side;
        g.fillRect(sx - u0, sy + u0 / 2, 2 * u0, Math.max(1, u0 * 1.5));
        g.fillStyle = T.under;
        g.fillRect(sx - u0 * 0.6, sy + u0 * 2, 1.2 * u0, (is.cliff[i] * u0) / 2);
      }
    for (const f of is.falls) {
      const [sx, sy] = P(f % N, Math.floor(f / N));
      g.fillStyle = T.waterfall!;
      g.fillRect(sx - u0 * 0.8, sy + u0, 1.6 * u0, depth - u0);
    }
    // tops, back to front
    for (let s = 0; s < 2 * N - 1; s++)
      for (let x = Math.max(0, s - N + 1); x <= Math.min(N - 1, s); x++) {
        const y = s - x;
        const i = y * N + x;
        if (!is.land[i]) continue;
        const [sx, sy] = P(x, y);
        g.fillStyle =
          zoneOf(x, y) === 'village' ? T.plaza[is.variant[i] % 2] : T.top[is.variant[i]];
        if (u0 <= 1) g.fillRect(sx - u0, sy, 2 * u0, u0);
        else {
          g.beginPath();
          g.moveTo(sx, sy);
          g.lineTo(sx + u0, sy + u0 / 2);
          g.lineTo(sx, sy + u0);
          g.lineTo(sx - u0, sy + u0 / 2);
          g.fill();
        }
      }
    // objects
    const k = u0 / 8;
    for (let s = 0; s < 2 * N - 1; s++)
      for (let x = Math.max(0, s - N + 1); x <= Math.min(N - 1, s); x++) {
        const y = s - x;
        const i = y * N + x;
        const ob = is.obj[i];
        if (!ob) continue;
        const [sx, sy] = P(x + 0.5, y + 0.5);
        if (u0 <= 1 && ob !== LANDMARK) {
          g.fillStyle = ob === HOUSE ? (is.roofs.get(i) ?? ROOFS[0]) : 'rgba(0,0,0,0.3)';
          g.fillRect(Math.round(sx), Math.round(sy - 1), 1, 1);
          continue;
        }
        const img =
          ob === LANDMARK
            ? landmark(is.t)
            : ob === HOUSE
              ? house(is.roofs.get(i) ?? ROOFS[0])
              : prop(T.props[ob - 1] as PropKind);
        const scale = ob === LANDMARK ? Math.max(k * 2.6, 0.5) : k;
        const w = img.width * scale;
        const h = img.height * scale;
        g.drawImage(img, sx - w / 2, sy - h + u0 * 0.3, w, h);
      }
    is.lo.set(u0, c);
    // keep memory bounded: at most 5 hi-res islands at a time
    if (u0 === HI_RES) {
      const hi = [...this.islands.values()].filter((o) => o.lo.has(HI_RES));
      if (hi.length > 5) hi[0].lo.delete(HI_RES);
    }
    return c;
  }

  // ---- tile sprites for the street band --------------------------------------------------------------

  private tile(color: string, edge: string | null): HTMLCanvasElement {
    const U = Math.max(2, Math.round(this.u * this.dpr));
    if (U !== this.tileU) {
      this.tiles.clear();
      this.tileU = U;
    }
    const key = color + (edge ?? '');
    let c = this.tiles.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = 2 * U;
    c.height = U + (edge ? Math.ceil(U * 0.7) : 0);
    const g = c.getContext('2d')!;
    if (edge) {
      g.fillStyle = edge;
      g.beginPath();
      g.moveTo(0, U / 2);
      g.lineTo(U, U);
      g.lineTo(2 * U, U / 2);
      g.lineTo(2 * U, U / 2 + U * 0.7);
      g.lineTo(U, U + U * 0.7);
      g.lineTo(0, U / 2 + U * 0.7);
      g.fill();
    }
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(U, 0);
    g.lineTo(2 * U, U / 2);
    g.lineTo(U, U);
    g.lineTo(0, U / 2);
    g.fill();
    this.tiles.set(key, c);
    return c;
  }

  // ---- drawing ---------------------------------------------------------------------------------------

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.visible) return;
    if (this.anim) {
      const k = Math.min(1, (performance.now() - this.anim.t0) / 800);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const f = this.anim.from;
      const prev = this.band;
      this.x = f.x + (this.anim.x - f.x) * e;
      this.y = f.y + (this.anim.y - f.y) * e;
      this.u = Math.exp(Math.log(f.u) + (Math.log(this.anim.u) - Math.log(f.u)) * e);
      if (this.band !== prev) this.onZoom(this.band);
      if (k >= 1) this.anim = null;
    }
    this.draw();
  };

  private draw() {
    const { ctx } = this;
    const time = (performance.now() - this.t0) / 1000;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const sky = ctx.createLinearGradient(0, 0, 0, this.h);
    sky.addColorStop(0, '#8ec5ee');
    sky.addColorStop(0.65, '#cfe6f5');
    sky.addColorStop(1, '#fbe3cf');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.w, this.h);
    this.drawClouds(time, 0);
    const band = this.band;
    this.drawBridges();
    if (band === 'street') this.drawStreet(time);
    else this.drawIslands(band, time);
    if (band !== 'street') this.drawClouds(time, 1);
  }

  private drawClouds(time: number, layer: number) {
    const ctx = this.ctx;
    const par = layer ? 0.35 : 0.12;
    for (const c of this.clouds) {
      if (c.layer !== layer) continue;
      const span = this.w + 400;
      const x = ((((c.x * span + time * c.speed - this.x * par * 2) % span) + span) % span) - 200;
      const y =
        ((((c.y * (this.h + 100) - this.y * par) % (this.h + 100)) + this.h + 100) %
          (this.h + 100)) -
        20;
      ctx.fillStyle = layer ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.8)';
      const h = c.w * 0.28;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(c.w), Math.round(h * 0.5));
      ctx.fillRect(
        Math.round(x + c.w * 0.15),
        Math.round(y - h * 0.35),
        Math.round(c.w * 0.5),
        Math.round(h * 0.5),
      );
      ctx.fillRect(
        Math.round(x + c.w * 0.45),
        Math.round(y - h * 0.2),
        Math.round(c.w * 0.35),
        Math.round(h * 0.4),
      );
    }
  }

  /** Rope bridges between neighbouring islands, along the biome centre lines. */
  private drawBridges() {
    const ctx = this.ctx;
    for (let i = 0; i < BIOME_ORDER.length; i++) {
      const t = BIOME_ORDER[i];
      const o = biomeOrigin(t);
      const is = this.island(t);
      const mid = BIOME / 2;
      const right = i % COLS < COLS - 1 ? BIOME_ORDER[i + 1] : null;
      const down = BIOME_ORDER[i + COLS] ?? null;
      for (const [nb, axis] of [
        [right, 'x'],
        [down, 'y'],
      ] as const) {
        if (!nb) continue;
        const ni = this.island(nb);
        const a = mid + is.radius - 4;
        const b = BIOME + mid - ni.radius + 4;
        const p0 =
          axis === 'x' ? this.toScreen(o.x + a, o.y + mid) : this.toScreen(o.x + mid, o.y + a);
        const p1 =
          axis === 'x' ? this.toScreen(o.x + b, o.y + mid) : this.toScreen(o.x + mid, o.y + b);
        if (Math.max(p0[0], p1[0]) < -50 || Math.min(p0[0], p1[0]) > this.w + 50) continue;
        if (Math.max(p0[1], p1[1]) < -50 || Math.min(p0[1], p1[1]) > this.h + 50) continue;
        const wdt = Math.max(1.5, this.u * 1.6);
        const sag = this.u * 3;
        const mx = (p0[0] + p1[0]) / 2;
        const my = (p0[1] + p1[1]) / 2 + sag;
        ctx.strokeStyle = '#7a5230';
        ctx.lineWidth = wdt;
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]);
        ctx.quadraticCurveTo(mx, my, p1[0], p1[1]);
        ctx.stroke();
        if (this.u >= 2) {
          ctx.strokeStyle = '#b8864f';
          ctx.lineWidth = Math.max(1, wdt * 0.55);
          ctx.setLineDash([this.u * 0.5, this.u * 0.35]);
          ctx.beginPath();
          ctx.moveTo(p0[0], p0[1]);
          ctx.quadraticCurveTo(mx, my, p1[0], p1[1]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }

  private drawIslands(band: Band, time: number) {
    const ctx = this.ctx;
    const u0 = band === 'town' ? HI_RES : 1;
    const labels: [string, string, number, number][] = [];
    for (const t of BIOME_ORDER) {
      const o = biomeOrigin(t);
      const [lx] = this.toScreen(o.x, o.y + BIOME);
      const [, ty] = this.toScreen(o.x, o.y);
      const wdt = 2 * BIOME * this.u;
      const hgt = BIOME * this.u + 44 * this.u;
      if (lx > this.w || ty > this.h || lx + wdt < 0 || ty + hgt < 0) continue;
      const is = this.island(t);
      ctx.drawImage(this.islandCanvas(is, u0), lx, ty, wdt, hgt);
      if (band === 'town') this.loadBiome(t);
      const [cx, cy] = this.toScreen(o.x + BIOME / 2 - is.radius, o.y + BIOME / 2 - is.radius);
      const langs =
        TYPE_INFO[t].langs.slice(0, 3).join(' · ') ||
        (t === 'machine' ? 'agents' : 'everything else');
      labels.push([
        TYPE_INFO[t].biome.toUpperCase(),
        `${langs} · ${is.pop.toLocaleString('en-US')}`,
        cx,
        cy,
      ]);
    }
    if (band === 'town') {
      const r = Math.max(1.5, this.u * 0.9);
      for (const [t, dots] of this.biomes) {
        if (dots === 'loading') continue;
        const col = TYPE_INFO[t].colors[0];
        for (const [x, y, , c] of dots) {
          const [px, py] = this.toScreen(x + 0.5, y + 0.5);
          if (px < -4 || py < -4 || px > this.w + 4 || py > this.h + 4) continue;
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(px - r / 2, py - r * 0.3, r, r * 0.6);
          ctx.fillStyle = c ? '#ffffff' : col;
          ctx.fillRect(px - r / 2, py - r * 1.6, r, r * 1.3);
        }
      }
      for (const town of this.towns) {
        const rr = plotRect(town.biome, town.plot);
        const [sx, sy] = this.toScreen(rr.x + PLOT / 2, rr.y + PLOT / 2);
        if (sx < -80 || sy < -20 || sx > this.w + 80 || sy > this.h + 20) continue;
        this.banner(
          town.name,
          sx,
          sy - this.u * 6,
          11,
          town.kind === 'official' ? '#ffd76a' : '#ffffff',
        );
      }
    }
    const size = band === 'world' ? Math.max(20, Math.min(36, this.u * 30)) : 36;
    const ns = this.visibleNotable().sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const n of ns) this.drawNotable(n, size, time);
    for (const [name, sub, x, y] of labels)
      this.banner(name, x, y - 8, band === 'world' ? 12 : 16, '#ffffff', sub);
  }

  private drawStreet(time: number) {
    const ctx = this.ctx;
    this.loadChunks();
    const v = this.viewRect(6);
    const U = this.u;
    const objs: { depth: number; draw: () => void }[] = [];
    for (const t of BIOME_ORDER) {
      const o = biomeOrigin(t);
      if (o.x > v.x1 || o.y > v.y1 || o.x + BIOME < v.x0 || o.y + BIOME < v.y0) continue;
      const is = this.island(t);
      const T = TERRAIN[t];
      const x0 = Math.max(v.x0, o.x) - o.x;
      const x1 = Math.min(v.x1, o.x + BIOME - 1) - o.x;
      const y0 = Math.max(v.y0, o.y) - o.y;
      const y1 = Math.min(v.y1, o.y + BIOME - 1) - o.y;
      for (let s = x0 + y0; s <= x1 + y1; s++)
        for (let x = Math.max(x0, s - y1); x <= Math.min(x1, s - y0); x++) {
          const y = s - x;
          const i = y * BIOME + x;
          if (!is.land[i]) continue;
          const [sx, sy] = this.toScreen(o.x + x, o.y + y);
          if (sx < -2 * U || sx > this.w + 2 * U || sy < -2 * U || sy > this.h + U) continue;
          if (is.cliff[i]) {
            ctx.fillStyle = T.under;
            ctx.fillRect(sx - U * 0.7, sy + U, U * 1.4, (is.cliff[i] * U) / 2);
          }
          const z = zoneOf(x, y);
          const col =
            z === 'village'
              ? T.plaza[is.variant[i] % 2]
              : z === 'town' && this.inTown(t, x, y)
                ? T.plaza[1]
                : T.top[is.variant[i]];
          const img = this.tile(col, is.cliff[i] ? T.side : null);
          ctx.drawImage(img, sx - U, sy, 2 * U, img.height / this.dpr);
          const ob = is.obj[i];
          if (ob) {
            const [cx, cy] = this.toScreen(o.x + x + 0.5, o.y + y + 0.5);
            const im =
              ob === LANDMARK
                ? landmark(t)
                : ob === HOUSE
                  ? house(is.roofs.get(i) ?? ROOFS[0])
                  : prop(T.props[ob - 1] as PropKind);
            const scale = (U / 8) * (ob === LANDMARK ? 2.6 : 1);
            const w = im.width * scale;
            const h = im.height * scale;
            objs.push({
              depth: o.x + x + o.y + y,
              draw: () => ctx.drawImage(im, cx - w / 2, cy - h + U * 0.3, w, h),
            });
          }
        }
      for (const f of is.falls) {
        const [sx, sy] = this.toScreen(o.x + (f % BIOME), o.y + Math.floor(f / BIOME));
        if (sx < -U * 2 || sx > this.w + U * 2 || sy > this.h) continue;
        ctx.fillStyle = T.waterfall!;
        ctx.fillRect(sx - U * 0.7, sy + U, U * 1.4, U * 30);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        for (let k = 0; k < 6; k++)
          ctx.fillRect(
            sx - U * 0.5 + (k % 3) * U * 0.4,
            sy + U + ((time * 60 + k * 37) % (U * 30)),
            U * 0.15,
            U * 1.2,
          );
      }
    }
    for (const c of this.chunks.values()) {
      if (c === 'loading') continue;
      for (const g of c)
        objs.push({ depth: g.x + g.y + 0.5, draw: () => this.drawGitemon(g, time) });
    }
    objs.sort((a, b) => a.depth - b.depth);
    for (const ob of objs) ob.draw();
    for (const town of this.towns) {
      const rr = plotRect(town.biome, town.plot);
      const [sx, sy] = this.toScreen(rr.x + PLOT / 2, rr.y + PLOT / 2);
      if (sx < -100 || sy < -40 || sx > this.w + 100 || sy > this.h + 40) continue;
      this.banner(town.name, sx, sy - U * 4, 13, town.kind === 'official' ? '#ffd76a' : '#ffffff');
    }
  }

  private inTown(t: TypeId, x: number, y: number) {
    if (x < TOWN_MIN || y < TOWN_MIN || x >= TOWN_MAX || y >= TOWN_MAX) return false;
    const o = biomeOrigin(t);
    return this.towns.some((tw) => {
      if (tw.biome !== t) return false;
      const r = plotRect(t, tw.plot);
      return x + o.x >= r.x && x + o.x < r.x + PLOT && y + o.y >= r.y && y + o.y < r.y + PLOT;
    });
  }

  private banner(text: string, x: number, y: number, size: number, color: string, sub?: string) {
    const ctx = this.ctx;
    ctx.font = `800 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let w = ctx.measureText(text).width + size * 1.2;
    if (sub) {
      ctx.font = `600 ${Math.round(size * 0.72)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      w = Math.max(w, ctx.measureText(sub).width + size * 1.2);
    }
    const h = size * 1.7 + (sub ? size * 1.1 : 0);
    ctx.fillStyle = 'rgba(24,20,30,0.72)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - size * 0.85, w, h, size * 0.5);
    ctx.fill();
    ctx.font = `800 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    if (sub) {
      ctx.font = `600 ${Math.round(size * 0.72)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.78)';
      ctx.fillText(sub, x, y + size * 1.15);
    }
  }

  private drawGitemon(g: MapGitemon, time: number) {
    const ctx = this.ctx;
    const [sx, sy] = this.toScreen(g.x + 0.5, g.y + 0.5);
    const size = this.creatureSize();
    if (sx < -size || sy < -size * 0.2 || sx > this.w + size || sy > this.h + size) return;
    const bob = Math.sin(time * 2.2 + (g.id % 97)) * this.u * 0.08;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, size * 0.3, size * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    if (this.selected?.id === g.id || this.me === g.id) {
      ctx.strokeStyle = this.selected?.id === g.id ? '#ffffff' : '#ffd666';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(sx, sy, size * 0.42, size * 0.14, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (g.f === 3 || g.a) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 3 + g.id);
      const grd = ctx.createRadialGradient(sx, sy - size * 0.4, 0, sx, sy - size * 0.4, size * 0.7);
      grd.addColorStop(
        0,
        g.a
          ? `rgba(255,214,102,${0.25 + pulse * 0.15})`
          : `rgba(255,255,255,${0.15 + pulse * 0.12})`,
      );
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(sx - size, sy - size * 1.2, size * 2, size * 1.4);
    }
    const [x, y, w, h] = this.creatureRect(g);
    ctx.drawImage(sprite(g), x, y + bob, w, h);
    if (g.s) this.sparkle(sx, sy - size * 0.6, size, time, g.id);
    if (this.u >= 30 || this.selected?.id === g.id || this.me === g.id) {
      ctx.font = `600 ${Math.min(13, 8 + this.u * 0.2)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(g.login, sx + 1, sy + size * 0.12 + 1);
      ctx.fillStyle = g.st === 'c' ? '#ffffff' : 'rgba(255,255,255,0.85)';
      ctx.fillText(g.login, sx, sy + size * 0.12);
    }
  }

  private sparkle(x: number, y: number, size: number, time: number, id: number) {
    const ctx = this.ctx;
    ctx.fillStyle = '#fff6b0';
    for (let k = 0; k < 3; k++) {
      const a = time * 1.5 + k * 2.1 + id;
      const r = size * 0.45;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r * 0.5;
      const s = Math.max(1, size * 0.04) * (1 + Math.sin(time * 6 + k));
      ctx.fillRect(px - s, py, s * 2 + 1, 1.5);
      ctx.fillRect(px, py - s, 1.5, s * 2 + 1);
    }
  }

  private drawNotable(n: MapGitemon, size: number, time: number) {
    const ctx = this.ctx;
    const [cx, cy] = this.toScreen(n.x + 0.5, n.y + 0.5);
    if (cx < -size || cy < -size || cx > this.w + size || cy > this.h + size) return;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, size * 0.3, size * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    if (n.f === 3) {
      const grd = ctx.createRadialGradient(
        cx,
        cy - size * 0.45,
        0,
        cx,
        cy - size * 0.45,
        size * 0.8,
      );
      grd.addColorStop(0, 'rgba(255,230,140,0.45)');
      grd.addColorStop(1, 'rgba(255,230,140,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(cx - size, cy - size * 1.3, size * 2, size * 1.6);
    }
    const bob = Math.sin(time * 2 + (n.id % 50)) * 1.2;
    ctx.drawImage(sprite(n), cx - size / 2, cy - size * 0.92 + bob, size, size);
    if (n.s) this.sparkle(cx, cy - size * 0.55, size, time, n.id);
    if (this.selected?.id === n.id) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, size * 0.42, size * 0.14, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
