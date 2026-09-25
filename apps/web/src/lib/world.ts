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
  biomeOrigin,
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
 * The map (DECISIONS D24, D29): one floating continent. Each language owns a region — Magma
 * Fields, Miasma Marsh, Frost Tundra… — and the regions flow into each other along organic borders.
 * A region's village sits at its centre; its Gitemon live around it.
 *   World  (u < 1.2 px):  the whole continent, region banners, only notable Gitemon
 *   Town   (1.2 ≤ u < 8): the continent in more detail, every Gitemon as a dot
 *   Street (u ≥ 8):       every tile, prop, house and Gitemon, animated
 * `u` is the screen size of half a tile's width. A tile is 2u wide and u tall.
 */
export const STREET_U = 8;
export const TOWN_U = 1.2;
const MAX_U = 40;
const MID_RES = 2; // pre-render scale for the town band
const CLIFF = 40; // max cliff depth under the continent edge (half-tiles)

type Dot = [number, number, number, number];
type Band = 'world' | 'town' | 'street';

// ---- fast deterministic randomness (numbers only; no strings on the hot path) --------------------

function mix(h: number) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}
const rnd = (seed: number, x: number, y: number) =>
  mix(seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) / 4294967296;

function noise(seed: number, x: number, y: number, cell: number) {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = x / cell - gx;
  const fy = y / cell - gy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = rnd(seed, gx, gy);
  const b = rnd(seed, gx + 1, gy);
  const c = rnd(seed, gx, gy + 1);
  const d = rnd(seed, gx + 1, gy + 1);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

const S_COAST = 11;
const S_RX = 23;
const S_RY = 37;
const S_VAR = 41;
const S_PROP = 53;
const S_KIND = 67;
const S_CLIFF = 71;

/** Is (X, Y) on the continent? The coast wanders 8–30 tiles in from the world's edge. */
function landAt(X: number, Y: number) {
  if (X < 0 || Y < 0 || X >= WORLD_W || Y >= WORLD_H) return false;
  const d = Math.min(X, Y, WORLD_W - 1 - X, WORLD_H - 1 - Y);
  return d > 8 + noise(S_COAST, X, Y, 14) * 22;
}

/** Which region a tile looks like: the biome grid, with borders pushed around by noise. */
function regionAt(X: number, Y: number): number {
  const jx = Math.max(0, Math.min(WORLD_W - 1, Math.round(X + (noise(S_RX, X, Y, 22) - 0.5) * 70)));
  const jy = Math.max(0, Math.min(WORLD_H - 1, Math.round(Y + (noise(S_RY, X, Y, 22) - 0.5) * 70)));
  return Math.floor(jy / BIOME) * COLS + Math.floor(jx / BIOME);
}

// ---- one biome square of the continent -----------------------------------------------------------

interface Square {
  t: TypeId;
  ox: number;
  oy: number;
  land: Uint8Array;
  region: Uint8Array;
  /** 0 = none, else prop index+1 of the tile's region; HOUSE / LANDMARK */
  obj: Uint8Array;
  variant: Uint8Array;
  cliff: Uint8Array;
  roofs: Map<number, string>;
  pre: Map<number, HTMLCanvasElement>;
}

const HOUSE = 250;
const LANDMARK = 251;
const ROOFS = ['#c24b2a', '#2a6fc2', '#3a8a4a', '#8a3ac2', '#c2a02a', '#2aa0a0'];

function buildSquare(t: TypeId, towns: Town[]): Square {
  const N = BIOME;
  const { x: ox, y: oy } = biomeOrigin(t);
  const own = BIOME_ORDER.indexOf(t);
  const land = new Uint8Array(N * N);
  const region = new Uint8Array(N * N);
  const obj = new Uint8Array(N * N);
  const variant = new Uint8Array(N * N);
  const cliff = new Uint8Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const X = ox + x;
      const Y = oy + y;
      if (!landAt(X, Y)) continue;
      const i = y * N + x;
      land[i] = 1;
      const r = zoneOf(x, y) === 'wild' ? regionAt(X, Y) : own;
      region[i] = r;
      // shade comes in soft patches, with a little per-tile grain
      variant[i] = Math.min(2, Math.floor(noise(S_VAR, X, Y, 6) * 2.4 + rnd(S_VAR, X, Y) * 0.6));
      if (!landAt(X + 1, Y) || !landAt(X, Y + 1))
        cliff[i] = 6 + Math.floor(noise(S_CLIFF, X, Y, 4) * (CLIFF - 6));
      const T = TERRAIN[BIOME_ORDER[r]];
      // props on the odd checkerboard colour only: Gitemon stand on the even one
      if ((X + Y) % 2 === 1 && zoneOf(x, y) === 'wild' && rnd(S_PROP, X, Y) < T.density)
        obj[i] = 1 + Math.floor(rnd(S_KIND, X, Y) * T.props.length);
    }
  const roofs = new Map<number, string>();
  for (let k = 0; k < VILLAGE; k += 5)
    for (const [x, y] of [
      [VILLAGE_MIN + k, VILLAGE_MIN - 1],
      [VILLAGE_MIN - 1, VILLAGE_MIN + k],
      [VILLAGE_MIN + k + 1, VILLAGE_MIN + VILLAGE],
      [VILLAGE_MIN + VILLAGE, VILLAGE_MIN + k + 1],
    ])
      if ((x + y) % 2 === 1) {
        obj[y * N + x] = HOUSE;
        roofs.set(y * N + x, ROOFS[mix(own * 977 + x * 31 + y) % ROOFS.length]);
      }
  obj[(N / 2 - 1) * N + N / 2] = LANDMARK;
  for (const town of towns.filter((tw) => tw.biome === t)) {
    const r = plotRect(t, town.plot);
    const roof = town.kind === 'official' ? '#d8a83a' : ROOFS[town.id % ROOFS.length];
    for (const [x, y] of [
      [r.x - ox, r.y - oy + 1],
      [r.x - ox + PLOT - 1, r.y - oy],
      [r.x - ox + 1, r.y - oy + PLOT - 2],
      [r.x - ox + PLOT - 2, r.y - oy + PLOT - 1],
    ]) {
      obj[y * N + x] = HOUSE;
      roofs.set(y * N + x, roof);
    }
  }
  return { t, ox, oy, land, region, obj, variant, cliff, roofs, pre: new Map() };
}

// ---- cached images --------------------------------------------------------------------------------

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

const glowCache = new Map<string, HTMLCanvasElement>();
function glow(rgb: string): HTMLCanvasElement {
  let c = glowCache.get(rgb);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, `rgba(${rgb},0.5)`);
  grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(rgb, c);
  return c;
}

// ---- the view ----------------------------------------------------------------------------------------

interface Cloud {
  x: number;
  y: number;
  w: number;
  speed: number;
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
  private lastDraw = 0;
  private dirty = true;
  private chunks = new Map<number, MapGitemon[] | 'loading'>();
  private biomes = new Map<TypeId, Dot[] | 'loading'>();
  private notable: MapGitemon[] = [];
  private squares = new Map<TypeId, Square>();
  private tiles = new Map<string, HTMLCanvasElement>();
  private tileU = 0;
  towns: Town[] = [];
  private bySlot = new Map<string, MapGitemon>();
  private sel: MapGitemon | null = null;
  private meId: number | null = null;
  get selected() {
    return this.sel;
  }
  set selected(g: MapGitemon | null) {
    this.sel = g;
    this.dirty = true;
  }
  get me() {
    return this.meId;
  }
  set me(id: number | null) {
    this.meId = id;
    this.dirty = true;
  }
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
  private still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(
    private canvas: HTMLCanvasElement,
    private onPick: (g: MapGitemon | null) => void,
    private onZoom: (band: Band) => void,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    for (let i = 0; i < 16; i++)
      this.clouds.push({
        x: rnd(5, i, 0),
        y: rnd(6, i, 0),
        w: 70 + rnd(7, i, 0) * 150,
        speed: 3 + rnd(8, i, 0) * 7,
      });
    this.resize();
    this.fit();
    this.bind();
    document.addEventListener('visibilitychange', () => {
      this.visible = !document.hidden;
      this.dirty = true;
    });
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
    this.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.dirty = true;
  }

  get fitU() {
    return Math.min(this.w / (WORLD_W + WORLD_H), (this.h * 2) / (WORLD_W + WORLD_H)) * 1.05;
  }
  get minU() {
    return this.fitU * 0.8;
  }

  fit() {
    this.anim = null;
    this.u = this.fitU;
    this.x = WORLD_W / 2;
    this.y = WORLD_H / 2;
    this.dirty = true;
  }

  setNotable(g: MapGitemon[], towns: Town[]) {
    this.notable = g;
    this.towns = towns;
    this.squares.clear();
    for (const n of g) this.bySlot.set(`${n.x},${n.y}`, n);
    this.dirty = true;
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
    this.dirty = true;
  }

  invalidate() {
    this.chunks.clear();
    this.biomes.clear();
    this.bySlot.clear();
    this.squares.clear();
    for (const n of this.notable) this.bySlot.set(`${n.x},${n.y}`, n);
    this.dirty = true;
  }

  flyTo(x: number, y: number, u = 20) {
    const target = Math.min(MAX_U, u);
    if (target >= STREET_U) this.prefetch(x, y);
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
    this.dirty = true;
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
      this.dirty = true;
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
    // designed species carry their own size (babies small, final forms big) on one canvas
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
          u: this.band === 'world' ? 3 : 14,
          t0: performance.now(),
          from: { x: this.x, y: this.y, u: this.u },
        };
        return;
      }
    }
    this.selected = best;
    this.onPick(best);
    this.dirty = true;
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
            this.dirty = true;
          })
          .catch(() => this.chunks.delete(k));
      }
  }

  /** Start loading the chunks around a destination before the camera gets there. */
  private prefetch(x: number, y: number) {
    const per = WORLD_W / CHUNK;
    const cx0 = Math.floor(x / CHUNK);
    const cy0 = Math.floor(y / CHUNK);
    for (let cy = cy0 - 1; cy <= cy0 + 1; cy++)
      for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) {
        if (cx < 0 || cy < 0 || cx >= per || cy >= WORLD_H / CHUNK) continue;
        const k = cy * per + cx;
        if (this.chunks.has(k)) continue;
        this.chunks.set(k, 'loading');
        api
          .chunk(cx, cy)
          .then(({ data }) => {
            this.chunks.set(k, data.g);
            for (const g of data.g) this.bySlot.set(`${g.x},${g.y}`, g);
            this.dirty = true;
          })
          .catch(() => this.chunks.delete(k));
      }
  }

  private loadBiome(t: TypeId) {
    if (this.biomes.has(t)) return;
    this.biomes.set(t, 'loading');
    api
      .biome(t)
      .then(({ data }) => {
        this.biomes.set(t, data.d);
        this.dirty = true;
      })
      .catch(() => this.biomes.delete(t));
  }

  /** Squares are built lazily, a few per frame, so opening the map never stalls. */
  private square(t: TypeId, budget: { n: number }): Square | null {
    let s = this.squares.get(t);
    if (s) return s;
    if (budget.n <= 0) {
      this.dirty = true;
      return null;
    }
    budget.n--;
    s = buildSquare(t, this.towns);
    this.squares.set(t, s);
    this.dirty = true;
    return s;
  }

  // ---- pre-render of a square (world + town bands) ------------------------------------------------

  private squareCanvas(s: Square, u0: number): HTMLCanvasElement {
    let c = s.pre.get(u0);
    if (c) return c;
    const N = BIOME;
    c = document.createElement('canvas');
    c.width = 2 * N * u0;
    c.height = N * u0 + CLIFF * u0;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    const P = (x: number, y: number): [number, number] => [(x - y + N) * u0, ((x + y) * u0) / 2];
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        if (!s.cliff[i]) continue;
        const T = TERRAIN[BIOME_ORDER[s.region[i]]];
        const [sx, sy] = P(x, y);
        g.fillStyle = T.side;
        g.fillRect(sx - u0, sy + u0 / 2, 2 * u0, Math.max(1, u0 * 1.5));
        g.fillStyle = T.under;
        g.fillRect(sx - u0 * 0.6, sy + u0 * 2, 1.2 * u0, (s.cliff[i] * u0) / 2);
      }
    for (let d = 0; d < 2 * N - 1; d++)
      for (let x = Math.max(0, d - N + 1); x <= Math.min(N - 1, d); x++) {
        const y = d - x;
        const i = y * N + x;
        if (!s.land[i]) continue;
        const T = TERRAIN[BIOME_ORDER[s.region[i]]];
        const [sx, sy] = P(x, y);
        g.fillStyle = zoneOf(x, y) === 'village' ? T.plaza[s.variant[i] % 2] : T.top[s.variant[i]];
        g.fillRect(sx - u0, sy, 2 * u0, u0);
      }
    const k = u0 / 8;
    for (let d = 0; d < 2 * N - 1; d++)
      for (let x = Math.max(0, d - N + 1); x <= Math.min(N - 1, d); x++) {
        const y = d - x;
        const i = y * N + x;
        const ob = s.obj[i];
        if (!ob) continue;
        const [sx, sy] = P(x + 0.5, y + 0.5);
        if (u0 <= 1 && ob !== LANDMARK) {
          g.fillStyle = ob === HOUSE ? (s.roofs.get(i) ?? ROOFS[0]) : 'rgba(0,0,0,0.28)';
          g.fillRect(Math.round(sx), Math.round(sy - 1), 1, 1);
          continue;
        }
        const T = TERRAIN[BIOME_ORDER[s.region[i]]];
        const img =
          ob === LANDMARK
            ? landmark(s.t)
            : ob === HOUSE
              ? house(s.roofs.get(i) ?? ROOFS[0])
              : prop(T.props[(ob - 1) % T.props.length] as PropKind);
        const scale = ob === LANDMARK ? Math.max(k * 2.6, 0.6) : k;
        g.drawImage(
          img,
          sx - (img.width * scale) / 2,
          sy - img.height * scale + u0 * 0.3,
          img.width * scale,
          img.height * scale,
        );
      }
    s.pre.set(u0, c);
    if (u0 === MID_RES) {
      const hi = [...this.squares.values()].filter((o) => o.pre.has(MID_RES));
      if (hi.length > 8) hi[0].pre.delete(MID_RES);
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
    // the diamond is grown by half a pixel so neighbouring tiles overlap and leave no seams
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(U, -0.5);
    g.lineTo(2 * U + 1, U / 2);
    g.lineTo(U, U + 0.5);
    g.lineTo(-1, U / 2);
    g.fill();
    this.tiles.set(key, c);
    return c;
  }

  // ---- drawing ---------------------------------------------------------------------------------------

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.visible) return;
    const now = performance.now();
    if (this.anim) {
      const k = Math.min(1, (now - this.anim.t0) / 800);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const f = this.anim.from;
      const prev = this.band;
      this.x = f.x + (this.anim.x - f.x) * e;
      this.y = f.y + (this.anim.y - f.y) * e;
      this.u = Math.exp(Math.log(f.u) + (Math.log(this.anim.u) - Math.log(f.u)) * e);
      if (this.band !== prev) this.onZoom(this.band);
      if (k >= 1) this.anim = null;
      this.dirty = true;
    }
    // idle animation (bobbing, clouds, sparkles) runs slowly: 20 fps close up, 8 fps far away
    const idle = this.still ? Infinity : this.band === 'street' ? 50 : 125;
    if (!this.dirty && now - this.lastDraw < idle) return;
    this.dirty = false;
    this.lastDraw = now;
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
    const band = this.band;
    if (band === 'street') this.drawStreet(time);
    else {
      this.drawClouds(time);
      this.drawContinent(band, time);
    }
  }

  private drawClouds(time: number) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const c of this.clouds) {
      const span = this.w + 400;
      const x = ((((c.x * span + time * c.speed - this.x * 0.2) % span) + span) % span) - 200;
      const y =
        ((((c.y * (this.h + 100) - this.y * 0.1) % (this.h + 100)) + this.h + 100) %
          (this.h + 100)) -
        20;
      const h = c.w * 0.28;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(c.w), Math.round(h * 0.5));
      ctx.fillRect(
        Math.round(x + c.w * 0.15),
        Math.round(y - h * 0.35),
        Math.round(c.w * 0.5),
        Math.round(h * 0.5),
      );
    }
  }

  private drawContinent(band: Band, time: number) {
    const ctx = this.ctx;
    const u0 = band === 'town' ? MID_RES : 1;
    const budget = { n: 3 };
    // back to front: squares by (row + col)
    const order = BIOME_ORDER.map((t, i) => ({ t, d: (i % COLS) + Math.floor(i / COLS) })).sort(
      (a, b) => a.d - b.d,
    );
    for (const { t } of order) {
      const o = biomeOrigin(t);
      const [lx] = this.toScreen(o.x, o.y + BIOME);
      const [, ty] = this.toScreen(o.x, o.y);
      const wdt = 2 * BIOME * this.u;
      const hgt = BIOME * this.u + CLIFF * this.u;
      if (lx > this.w || ty > this.h || lx + wdt < 0 || ty + hgt < 0) continue;
      const s = this.square(t, budget);
      if (!s) {
        // not built yet: a plain diamond in the region colour
        const p = [
          this.toScreen(o.x, o.y),
          this.toScreen(o.x + BIOME, o.y),
          this.toScreen(o.x + BIOME, o.y + BIOME),
          this.toScreen(o.x, o.y + BIOME),
        ];
        ctx.fillStyle = TERRAIN[t].top[0];
        ctx.beginPath();
        ctx.moveTo(p[0][0], p[0][1]);
        for (const q of p.slice(1)) ctx.lineTo(q[0], q[1]);
        ctx.fill();
        continue;
      }
      ctx.drawImage(this.squareCanvas(s, u0), lx, ty, wdt, hgt);
      if (band === 'town') this.loadBiome(t);
    }
    if (band === 'town') {
      const r = Math.max(1.5, this.u * 0.9);
      for (const [t, dots] of this.biomes) {
        if (dots === 'loading') continue;
        const col = TYPE_INFO[t].colors[0];
        for (const [x, y, , c] of dots) {
          const [px, py] = this.toScreen(x + 0.5, y + 0.5);
          if (px < -4 || py < -4 || px > this.w + 4 || py > this.h + 4) continue;
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
    const size = band === 'world' ? Math.max(18, Math.min(34, this.u * 40)) : 34;
    const ns = this.visibleNotable().sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const n of ns) this.drawNotable(n, size, time);
    for (const t of BIOME_ORDER) {
      const o = biomeOrigin(t);
      const [cx, cy] = this.toScreen(o.x + BIOME / 2, o.y + BIOME / 2);
      if (cx < -100 || cy < -40 || cx > this.w + 100 || cy > this.h + 40) continue;
      const langs =
        TYPE_INFO[t].langs.slice(0, 3).join(' · ') ||
        (t === 'machine' ? 'agents' : 'everything else');
      this.banner(
        TYPE_INFO[t].biome.toUpperCase(),
        cx,
        cy - (band === 'world' ? 34 : this.u * 40),
        band === 'world' ? 12 : 15,
        '#ffffff',
        langs,
      );
    }
  }

  private drawStreet(time: number) {
    const ctx = this.ctx;
    this.loadChunks();
    const v = this.viewRect(6);
    const U = this.u;
    const budget = { n: 2 };
    const objs: { depth: number; draw: () => void }[] = [];
    for (const t of BIOME_ORDER) {
      const o = biomeOrigin(t);
      if (o.x > v.x1 || o.y > v.y1 || o.x + BIOME < v.x0 || o.y + BIOME < v.y0) continue;
      const s = this.square(t, budget);
      if (!s) continue;
      const x0 = Math.max(v.x0, o.x) - o.x;
      const x1 = Math.min(v.x1, o.x + BIOME - 1) - o.x;
      const y0 = Math.max(v.y0, o.y) - o.y;
      const y1 = Math.min(v.y1, o.y + BIOME - 1) - o.y;
      for (let d = x0 + y0; d <= x1 + y1; d++)
        for (let x = Math.max(x0, d - y1); x <= Math.min(x1, d - y0); x++) {
          const y = d - x;
          const i = y * BIOME + x;
          if (!s.land[i]) continue;
          const [sx, sy] = this.toScreen(o.x + x, o.y + y);
          if (sx < -2 * U || sx > this.w + 2 * U || sy < -2 * U || sy > this.h + U) continue;
          const T = TERRAIN[BIOME_ORDER[s.region[i]]];
          if (s.cliff[i]) {
            ctx.fillStyle = T.under;
            ctx.fillRect(sx - U * 0.7, sy + U, U * 1.4, (s.cliff[i] * U) / 2);
          }
          const z = zoneOf(x, y);
          const col =
            z === 'village'
              ? T.plaza[s.variant[i] % 2]
              : z === 'town' && this.inTown(t, x, y)
                ? T.plaza[1]
                : T.top[s.variant[i]];
          const img = this.tile(col, s.cliff[i] ? T.side : null);
          ctx.drawImage(img, sx - U, sy, 2 * U, img.height / this.dpr);
          const ob = s.obj[i];
          if (ob) {
            const [cx, cy] = this.toScreen(o.x + x + 0.5, o.y + y + 0.5);
            const im =
              ob === LANDMARK
                ? landmark(t)
                : ob === HOUSE
                  ? house(s.roofs.get(i) ?? ROOFS[0])
                  : prop(T.props[(ob - 1) % T.props.length] as PropKind);
            const scale = (U / 8) * (ob === LANDMARK ? 2.6 : 1);
            const w = im.width * scale;
            const h = im.height * scale;
            objs.push({
              depth: o.x + x + o.y + y,
              draw: () => ctx.drawImage(im, cx - w / 2, cy - h + U * 0.3, w, h),
            });
          }
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
    const f1 = `800 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    const f2 = `600 ${Math.round(size * 0.72)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = f1;
    let w = ctx.measureText(text).width + size * 1.2;
    if (sub) {
      ctx.font = f2;
      w = Math.max(w, ctx.measureText(sub).width + size * 1.2);
    }
    const h = size * 1.7 + (sub ? size * 1.1 : 0);
    ctx.fillStyle = 'rgba(24,20,30,0.72)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - size * 0.85, w, h, size * 0.5);
    ctx.fill();
    ctx.font = f1;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    if (sub) {
      ctx.font = f2;
      ctx.fillStyle = 'rgba(255,255,255,0.78)';
      ctx.fillText(sub, x, y + size * 1.15);
    }
  }

  private drawGitemon(g: MapGitemon, time: number) {
    const ctx = this.ctx;
    const [sx, sy] = this.toScreen(g.x + 0.5, g.y + 0.5);
    const size = this.creatureSize();
    if (sx < -size || sy < -size * 0.2 || sx > this.w + size || sy > this.h + size) return;
    const bob = this.still ? 0 : Math.sin(time * 2.2 + (g.id % 97)) * this.u * 0.08;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, size * 0.22, size * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    if (this.selected?.id === g.id || this.me === g.id) {
      ctx.strokeStyle = this.selected?.id === g.id ? '#ffffff' : '#ffd666';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(sx, sy, size * 0.34, size * 0.11, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (g.f === 3 || g.a) {
      const im = glow(g.a ? '255,214,102' : '255,255,255');
      ctx.drawImage(im, sx - size * 0.6, sy - size, size * 1.2, size * 1.2);
    }
    const [x, y, w, h] = this.creatureRect(g);
    ctx.drawImage(sprite(g), x, y + bob, w, h);
    if (g.s) this.sparkle(sx, sy - size * 0.5, size, time, g.id);
    if (this.u >= 30 || this.selected?.id === g.id || this.me === g.id) {
      ctx.font = `600 ${Math.min(13, 8 + this.u * 0.2)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(g.login, sx + 1, sy + size * 0.1 + 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(g.login, sx, sy + size * 0.1);
    }
  }

  private sparkle(x: number, y: number, size: number, time: number, id: number) {
    const ctx = this.ctx;
    ctx.fillStyle = '#fff6b0';
    for (let k = 0; k < 3; k++) {
      const a = time * 1.5 + k * 2.1 + id;
      const px = x + Math.cos(a) * size * 0.4;
      const py = y + Math.sin(a) * size * 0.2;
      const s = Math.max(1, size * 0.035) * (1 + Math.sin(time * 6 + k));
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
    ctx.ellipse(cx, cy, size * 0.25, size * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    if (n.f === 3)
      ctx.drawImage(glow('255,230,140'), cx - size * 0.7, cy - size * 1.1, size * 1.4, size * 1.4);
    const bob = this.still ? 0 : Math.sin(time * 2 + (n.id % 50)) * 1.2;
    ctx.drawImage(sprite(n), cx - size / 2, cy - size * 0.92 + bob, size, size);
    if (n.s) this.sparkle(cx, cy - size * 0.5, size, time, n.id);
    if (this.selected?.id === n.id) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, size * 0.36, size * 0.12, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
