import {
  BIOME,
  BIOME_ORDER,
  CHUNK,
  COLS,
  ROWS,
  TYPE_INFO,
  WORLD_H,
  WORLD_W,
  plotRect,
  villageRect,
  type MapGitemon,
  type TypeId,
} from '@gitemon/shared';
import { api, type Town } from './api';
import { sprite } from './sprites';

/**
 * The map: one canvas, three zoom bands.
 *   World  (s < 2.5 px per slot): biomes, towns, and only notable Gitemon
 *   Town   (2.5 ≤ s < 14):        every Gitemon as a dot, notable ones as sprites
 *   Street (s ≥ 14):              every Gitemon as a sprite (loaded per 32×32 chunk)
 * Being visible at World zoom is the status reward (DECISIONS D5, D6).
 */
export const STREET = 14;
export const TOWN = 2.5;
const MAX_S = 64;

type Dot = [number, number, number, number];

export class WorldView {
  x = WORLD_W / 2;
  y = WORLD_H / 2;
  s = 1;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private dirty = true;
  private raf = 0;
  private chunks = new Map<number, MapGitemon[] | 'loading'>();
  private biomes = new Map<TypeId, Dot[] | 'loading'>();
  private notable: MapGitemon[] = [];
  towns: Town[] = [];
  private bySlot = new Map<string, MapGitemon>();
  selected: MapGitemon | null = null;
  me: number | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; s: number } | null = null;
  private moved = 0;
  private anim: {
    x: number;
    y: number;
    s: number;
    t0: number;
    from: { x: number; y: number; s: number };
  } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private onPick: (g: MapGitemon | null) => void,
    private onZoom: (band: 'world' | 'town' | 'street') => void,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
    this.fit();
    this.bind();
    this.loop();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  get band() {
    return this.s >= STREET ? 'street' : this.s >= TOWN ? 'town' : 'world';
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.dirty = true;
  }

  fit() {
    this.s = Math.min(this.w / WORLD_W, this.h / WORLD_H) * 0.96;
    this.x = WORLD_W / 2;
    this.y = WORLD_H / 2;
    this.dirty = true;
  }

  get minS() {
    return Math.min(this.w / WORLD_W, this.h / WORLD_H) * 0.9;
  }

  setNotable(g: MapGitemon[], towns: Town[]) {
    this.notable = g;
    this.towns = towns;
    for (const n of g) this.bySlot.set(`${n.x},${n.y}`, n);
    this.dirty = true;
  }

  /** Put or replace one Gitemon (after a search, a catch, a move). */
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
    for (const n of this.notable) this.bySlot.set(`${n.x},${n.y}`, n);
    this.dirty = true;
  }

  flyTo(x: number, y: number, s = 40) {
    const target = Math.min(MAX_S, s);
    // On phones the info sheet covers the lower half: keep the creature in the upper part.
    const lift = this.w < 760 ? (this.h * 0.2) / target : 0;
    this.anim = {
      x: x + 0.5,
      y: y + 0.5 + lift,
      s: Math.min(MAX_S, s),
      t0: performance.now(),
      from: { x: this.x, y: this.y, s: this.s },
    };
    this.dirty = true;
  }

  zoomBy(f: number, cx = this.w / 2, cy = this.h / 2) {
    const [wx, wy] = this.toWorld(cx, cy);
    const prevBand = this.band;
    this.s = Math.max(this.minS, Math.min(MAX_S, this.s * f));
    this.x = wx - (cx - this.w / 2) / this.s;
    this.y = wy - (cy - this.h / 2) / this.s;
    this.clamp();
    if (this.band !== prevBand) this.onZoom(this.band);
    this.dirty = true;
  }

  private clamp() {
    this.x = Math.max(0, Math.min(WORLD_W, this.x));
    this.y = Math.max(0, Math.min(WORLD_H, this.y));
  }

  toWorld(px: number, py: number): [number, number] {
    return [this.x + (px - this.w / 2) / this.s, this.y + (py - this.h / 2) / this.s];
  }
  toScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.x) * this.s + this.w / 2, (wy - this.y) * this.s + this.h / 2];
  }

  // ---- input ----------------------------------------------------------------------------------

  private bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.moved = 0;
      this.anim = null;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), s: this.s };
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
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const r = c.getBoundingClientRect();
        const target = Math.max(this.minS, Math.min(MAX_S, (this.pinch.s * d) / this.pinch.d));
        this.zoomBy(target / this.s, (a!.x + b!.x) / 2 - r.left, (a!.y + b!.y) / 2 - r.top);
        this.moved += 10;
        return;
      }
      this.moved += Math.abs(dx) + Math.abs(dy);
      this.x -= dx / this.s;
      this.y -= dy / this.s;
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

  private pick(px: number, py: number) {
    const [wx, wy] = this.toWorld(px, py);
    let best: MapGitemon | null = null;
    if (this.band === 'street') {
      best = this.bySlot.get(`${Math.floor(wx)},${Math.floor(wy)}`) ?? null;
    }
    if (!best) {
      // notable sprites are drawn larger than their slot when zoomed out
      const r = 16 / this.s;
      let bd = Infinity;
      for (const n of this.visibleNotable()) {
        const d = Math.hypot(n.x + 0.5 - wx, n.y + 0.5 - wy);
        if (d < r && d < bd) {
          bd = d;
          best = n;
        }
      }
    }
    this.selected = best;
    this.onPick(best);
    this.dirty = true;
  }

  // ---- data -----------------------------------------------------------------------------------

  private visibleRect() {
    const [x0, y0] = this.toWorld(0, 0);
    const [x1, y1] = this.toWorld(this.w, this.h);
    return {
      x0: Math.max(0, x0),
      y0: Math.max(0, y0),
      x1: Math.min(WORLD_W, x1),
      y1: Math.min(WORLD_H, y1),
    };
  }

  private visibleNotable() {
    const v = this.visibleRect();
    return this.notable.filter(
      (n) => n.x >= v.x0 - 2 && n.x <= v.x1 + 2 && n.y >= v.y0 - 2 && n.y <= v.y1 + 2,
    );
  }

  private loadChunks() {
    const v = this.visibleRect();
    const per = WORLD_W / CHUNK;
    for (let cy = Math.floor(v.y0 / CHUNK); cy <= Math.floor((v.y1 - 0.001) / CHUNK); cy++)
      for (let cx = Math.floor(v.x0 / CHUNK); cx <= Math.floor((v.x1 - 0.001) / CHUNK); cx++) {
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

  private loadBiomes() {
    const v = this.visibleRect();
    for (let by = Math.floor(v.y0 / BIOME); by <= Math.floor((v.y1 - 0.001) / BIOME); by++)
      for (let bx = Math.floor(v.x0 / BIOME); bx <= Math.floor((v.x1 - 0.001) / BIOME); bx++) {
        const t = BIOME_ORDER[by * COLS + bx];
        if (!t || this.biomes.has(t)) continue;
        this.biomes.set(t, 'loading');
        api
          .biome(t)
          .then(({ data }) => {
            this.biomes.set(t, data.d);
            this.dirty = true;
          })
          .catch(() => this.biomes.delete(t));
      }
  }

  // ---- drawing --------------------------------------------------------------------------------

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.anim) {
      const k = Math.min(1, (performance.now() - this.anim.t0) / 700);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const f = this.anim.from;
      const prevBand = this.band;
      this.x = f.x + (this.anim.x - f.x) * e;
      this.y = f.y + (this.anim.y - f.y) * e;
      this.s = Math.exp(Math.log(f.s) + (Math.log(this.anim.s) - Math.log(f.s)) * e);
      if (this.band !== prevBand) this.onZoom(this.band);
      if (k >= 1) this.anim = null;
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.draw();
  };

  private draw() {
    const { ctx, s } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, this.w, this.h);
    const band = this.band;
    if (band === 'street') this.loadChunks();
    else if (band === 'town') this.loadBiomes();

    // biomes
    for (let i = 0; i < BIOME_ORDER.length; i++) {
      const t = BIOME_ORDER[i]!;
      const bx = (i % COLS) * BIOME;
      const by = Math.floor(i / COLS) * BIOME;
      const [sx, sy] = this.toScreen(bx, by);
      const size = BIOME * s;
      if (sx > this.w || sy > this.h || sx + size < 0 || sy + size < 0) continue;
      ctx.fillStyle = TYPE_INFO[t].ground;
      ctx.fillRect(sx, sy, size + 0.5, size + 0.5);
      // starter village
      const v = villageRect(t);
      const [vx, vy] = this.toScreen(v.x, v.y);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(vx, vy, v.w * s, v.h * s);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.strokeRect(vx + 0.5, vy + 0.5, v.w * s, v.h * s);
    }
    // grid lines between biomes
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(1, s * 0.6);
    for (let i = 0; i <= COLS; i++) {
      const [x] = this.toScreen(i * BIOME, 0);
      ctx.beginPath();
      ctx.moveTo(x, this.toScreen(0, 0)[1]);
      ctx.lineTo(x, this.toScreen(0, WORLD_H)[1]);
      ctx.stroke();
    }
    for (let j = 0; j <= ROWS; j++) {
      const [, y] = this.toScreen(0, j * BIOME);
      ctx.beginPath();
      ctx.moveTo(this.toScreen(0, 0)[0], y);
      ctx.lineTo(this.toScreen(WORLD_W, 0)[0], y);
      ctx.stroke();
    }
    // town plots
    ctx.lineWidth = 1.5;
    for (const town of this.towns) {
      const r = plotRect(town.biome, town.plot);
      const [tx, ty] = this.toScreen(r.x, r.y);
      if (tx > this.w || ty > this.h || tx + r.w * s < 0 || ty + r.h * s < 0) continue;
      ctx.fillStyle = town.kind === 'official' ? 'rgba(255,215,90,0.10)' : 'rgba(255,255,255,0.07)';
      ctx.fillRect(tx, ty, r.w * s, r.h * s);
      ctx.strokeStyle = town.kind === 'official' ? 'rgba(255,215,90,0.5)' : 'rgba(255,255,255,0.3)';
      ctx.strokeRect(tx + 0.5, ty + 0.5, r.w * s, r.h * s);
      if (s >= 1.2)
        this.label(
          town.name,
          tx + (r.w * s) / 2,
          ty - 4,
          Math.min(14, 8 + s),
          'rgba(255,255,255,0.85)',
        );
    }

    if (band === 'town') {
      for (const [t, dots] of this.biomes) {
        if (dots === 'loading') continue;
        const col = TYPE_INFO[t].colors[1];
        const r = Math.max(1.2, s * 0.55);
        for (const [x, y, , c] of dots) {
          const [px, py] = this.toScreen(x + 0.5, y + 0.5);
          if (px < -4 || py < -4 || px > this.w + 4 || py > this.h + 4) continue;
          ctx.fillStyle = c ? '#ffffff' : col;
          ctx.fillRect(px - r / 2, py - r / 2, r, r);
        }
      }
    }

    if (band === 'street') {
      const labels = s >= 26;
      for (const c of this.chunks.values()) {
        if (c === 'loading') continue;
        for (const g of c) this.drawGitemon(g, s, labels);
      }
    }

    if (band !== 'street') {
      const size = band === 'world' ? 26 : 30;
      for (const n of this.visibleNotable()) this.drawNotable(n, size);
    }

    // biome names
    if (band !== 'street') {
      for (let i = 0; i < BIOME_ORDER.length; i++) {
        const t = BIOME_ORDER[i]!;
        const [cx, cy] = this.toScreen(
          (i % COLS) * BIOME + BIOME / 2,
          Math.floor(i / COLS) * BIOME + (band === 'world' ? 30 : BIOME / 2 - 20),
        );
        this.label(
          TYPE_INFO[t].biome.toUpperCase(),
          cx,
          cy,
          band === 'world' ? 11 : 16,
          'rgba(255,255,255,0.72)',
          true,
        );
      }
    }
  }

  private label(text: string, x: number, y: number, size: number, color: string, bold = false) {
    const ctx = this.ctx;
    ctx.font = `${bold ? 700 : 600} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(text, x + 1, y + 1);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  private drawGitemon(g: MapGitemon, s: number, labels: boolean) {
    const [px, py] = this.toScreen(g.x, g.y);
    if (px < -s || py < -s || px > this.w || py > this.h) return;
    const ctx = this.ctx;
    if (g.a) {
      ctx.fillStyle = 'rgba(255, 214, 102, 0.25)';
      ctx.beginPath();
      ctx.arc(px + s / 2, py + s / 2, s * 0.62, 0, Math.PI * 2);
      ctx.fill();
    }
    if (g.st === 'c') {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(px + s / 2, py + s * 0.9, s * 0.32, s * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const pad = s * 0.06;
    ctx.drawImage(sprite(g), px + pad, py + pad, s - 2 * pad, s - 2 * pad);
    if (this.selected?.id === g.id || this.me === g.id) {
      ctx.strokeStyle = this.selected?.id === g.id ? '#ffffff' : '#ffd666';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, s - 2, s - 2);
    }
    if (labels)
      this.label(
        g.login,
        px + s / 2,
        py + s + 11,
        10,
        g.st === 'c' ? '#ffffff' : 'rgba(255,255,255,0.7)',
      );
  }

  private drawNotable(n: MapGitemon, size: number) {
    const [cx, cy] = this.toScreen(n.x + 0.5, n.y + 0.5);
    if (cx < -size || cy < -size || cx > this.w + size || cy > this.h + size) return;
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + size * 0.42, size * 0.3, size * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(sprite(n), cx - size / 2, cy - size / 2, size, size);
    if (this.selected?.id === n.id) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
    }
  }
}
