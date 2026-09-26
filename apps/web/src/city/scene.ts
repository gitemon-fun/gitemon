import * as THREE from 'three';
import type { Island } from '@gitemon/shared';
import { Crowd, type Placed } from './crowd';
import { buildTown } from './town';

/**
 * Gitemon City renderer (GRANDPLAN v2 §3, v3 §3): a fixed isometric camera with 4 snap rotations
 * over the kit-built town (town.ts). One shadow map, rendered once when the city is built — the
 * city never moves. The crowd is one instanced draw of pixel sprites (crowd.ts). Frames are capped
 * at 30 fps, and the loop idles when nothing moves on screen or the tab is hidden.
 */

export type { Placed };

export class CityScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private target = new THREE.Vector3(0, 0, 0);
  private turn = 0; // 0..3 snap rotations
  private yaw = Math.PI / 4;
  zoom = 1;
  private dirty = true;
  private raf = 0;
  private crowd: Crowd | null = null;
  private clock = 0;
  private last = 0;
  private ring: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private detail: THREE.Object3D[] = [];
  private labels = new THREE.Group();
  private detailOn = true;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; z: number } | null = null;
  private moved = 0;
  private anim: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    z0: number;
    z1: number;
    t0: number;
  } | null = null;

  constructor(
    private host: HTMLElement,
    private onPick: (p: Placed | null) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.setClearColor('#bfdcf0');
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3000);
    // the camera sits 1200 units out: fog must start beyond it or the whole city goes pale
    this.scene.fog = new THREE.Fog('#bfdcf0', 1500, 2800);
    this.scene.add(new THREE.HemisphereLight('#fff6e8', '#7f8aa0', 1.75));
    const sun = new THREE.DirectionalLight('#fff1d6', 1.9);
    sun.position.set(-160, 300, 110);
    this.scene.add(sun, sun.target);
    this.sun = sun;
    // static city: the shadow map is drawn once after build (v3 §3, G5), never per frame
    const big = this.renderer.capabilities.maxTextureSize >= 4096;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    sun.castShadow = true;
    sun.shadow.mapSize.set(big ? 4096 : 2048, big ? 4096 : 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.35;
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.1, 0.12, 6, 24),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);
    this.resize();
    this.bind();
    window.addEventListener('resize', () => this.resize());
    this.loop();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }

  // ---- camera ------------------------------------------------------------------------------------

  private resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.dirty = true;
  }

  /** world units visible vertically at zoom 1 */
  private get span() {
    return 150 / this.zoom;
  }

  private placeCamera() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const s = this.span;
    this.camera.left = (-s * w) / h / 2;
    this.camera.right = (s * w) / h / 2;
    this.camera.top = s / 2;
    this.camera.bottom = -s / 2;
    this.camera.updateProjectionMatrix();
    const dir = new THREE.Vector3(Math.cos(this.yaw), 1.55, Math.sin(this.yaw)).normalize();
    this.camera.position.copy(this.target).addScaledVector(dir, 1200);
    this.camera.lookAt(this.target);
  }

  rotate(step: number) {
    this.turn = (this.turn + step + 4) % 4;
    this.yaw = Math.PI / 4 + (this.turn * Math.PI) / 2;
    this.dirty = true;
  }

  zoomBy(f: number) {
    this.zoom = Math.max(0.12, Math.min(6, this.zoom * f));
    this.dirty = true;
  }

  flyTo(x: number, z: number, zoom = 2.6) {
    this.anim = {
      from: this.target.clone(),
      to: new THREE.Vector3(x, 0, z),
      z0: this.zoom,
      z1: zoom,
      t0: performance.now(),
    };
  }

  fitCity(radius: number) {
    this.target.set(0, 0, 0);
    this.zoom = 150 / (radius * 1.9);
    this.dirty = true;
  }

  // ---- input -------------------------------------------------------------------------------------

  private groundAt(px: number, py: number): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((px - r.left) / r.width) * 2 - 1,
      -((py - r.top) / r.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit) ? hit : null;
  }

  private bind() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.moved = 0;
      this.anim = null;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.zoom };
      }
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (this.pointers.size === 2 && this.pinch) {
        p.x = e.clientX;
        p.y = e.clientY;
        const [a, b] = [...this.pointers.values()];
        this.zoom = Math.max(
          0.12,
          Math.min(6, (this.pinch.z * Math.hypot(a.x - b.x, a.y - b.y)) / this.pinch.d),
        );
        this.moved += 10;
        this.dirty = true;
        return;
      }
      const g0 = this.groundAt(p.x, p.y);
      const g1 = this.groundAt(e.clientX, e.clientY);
      p.x = e.clientX;
      p.y = e.clientY;
      if (g0 && g1) {
        this.target.x -= g1.x - g0.x;
        this.target.z -= g1.z - g0.z;
        this.moved += Math.abs(e.movementX) + Math.abs(e.movementY) + 1;
        this.dirty = true;
      }
    });
    const up = (e: PointerEvent) => {
      const was = this.pointers.size;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (was === 1 && this.moved < 6 && e.type === 'pointerup') this.pick(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.anim = null;
        this.zoomBy(Math.exp(-e.deltaY * 0.0018));
      },
      { passive: false },
    );
  }

  private pick(px: number, py: number) {
    const c = this.crowd;
    const r = this.renderer.domElement.getBoundingClientRect();
    if (c) {
      // nearest resident on screen whose sprite covers the tap (sprites are upright standees)
      const v = new THREE.Vector3();
      const top = new THREE.Vector3();
      let best = -1;
      let bestD = Infinity;
      const grow = this.grow;
      for (let i = 0; i < c.size; i++) {
        c.positionOf(i, this.clock, v);
        const h = c.heightOf(i, grow) * this.upScale * 0.55;
        top.copy(v).setY(v.y + h);
        v.setY(v.y + h * 0.45).project(this.camera);
        top.project(this.camera);
        const sx = ((v.x + 1) / 2) * r.width + r.left;
        const sy = ((1 - v.y) / 2) * r.height + r.top;
        const rad = Math.max(14, Math.abs(((top.y - v.y) / 2) * r.height) * 1.3);
        const d = Math.hypot(sx - px, sy - py);
        // prefer the one nearest the camera when sprites overlap
        const score = d / rad - v.z * 0.001;
        if (d < rad && score < bestD) {
          bestD = score;
          best = i;
        }
      }
      if (best >= 0) {
        c.stop(best, this.clock);
        const p = c.at(best);
        this.select(p);
        this.onPick(p);
        return;
      }
    }
    // tapping the ground zooms toward it
    const g = this.groundAt(px, py);
    if (g) this.flyTo(g.x, g.z, Math.min(4, this.zoom * 2.2));
  }

  /** stop a resident where it is (used for ?focus=login) and return where it stopped */
  hold(p: Placed): Placed {
    const c = this.crowd;
    if (!c) return p;
    for (let i = 0; i < c.size; i++)
      if (c.at(i) === p) {
        c.stop(i, this.clock);
        return c.at(i);
      }
    return p;
  }

  select(p: Placed | null) {
    this.ring.visible = !!p;
    if (p) this.ring.position.set(p.spot.x, p.spot.y + 0.08, p.spot.z);
    this.dirty = true;
  }

  // ---- building the city ---------------------------------------------------------------------------

  /** homes: lot index → the owner's colour (claimed players, V2-D5 / V3-D2) */
  build(city: Island, homes = new Map<number, string>()) {
    const t0 = performance.now();
    const town = buildTown(city, homes);
    this.stats.townMs = Math.round(performance.now() - t0);
    this.stats.buildMs = Math.round(performance.now() - t0);
    this.stats.homes = homes.size;
    this.scene.add(town.group);
    this.detail = town.detail;
    this.buildLabels(city);
    const cam = this.sun.shadow.camera;
    const r = city.radius + 40;
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = 1;
    cam.far = 1200;
    cam.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
  }

  /** region names, shown only when zoomed out (v4 Q1) */
  private buildLabels(city: Island) {
    this.labels.clear();
    for (const g of city.regions) {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 96;
      const ctx = c.getContext('2d')!;
      ctx.font = '600 52px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(30,34,44,0.75)';
      ctx.strokeText(g.name, 256, 50);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(g.name, 256, 50);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }),
      );
      sp.scale.set(80, 15, 1);
      sp.position.set(Math.cos(g.mid) * 165, 40, Math.sin(g.mid) * 165);
      sp.renderOrder = 10;
      this.labels.add(sp);
    }
    this.labels.visible = false;
    this.scene.add(this.labels);
  }

  // ---- creatures -------------------------------------------------------------------------------------

  setCreatures(placed: Placed[]) {
    if (this.crowd) {
      this.scene.remove(this.crowd.sprites, this.crowd.shadows);
      this.crowd.dispose();
    }
    this.crowd = new Crowd(placed);
    this.scene.add(this.crowd.shadows, this.crowd.sprites);
    this.dirty = true;
  }

  /** sprites grow a little when zoomed far out, so the crowd still reads (Transit does the same) */
  private get grow() {
    return Math.max(1, Math.min(2, 1.1 / this.zoom));
  }
  /** upright sprites are foreshortened by the camera pitch; stretch them back to true proportions */
  private get upScale() {
    return Math.hypot(1, 1.55) / 1;
  }

  // ---- loop --------------------------------------------------------------------------------------------

  private loop = (now = 0) => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    // walkers only matter when they are big enough to see: animate at street and district zoom
    const animate = this.crowd && this.zoom > 0.45;
    if (!animate && !this.dirty && !this.anim) return;
    if (now - this.last < 32) return; // ~30 fps is plenty for a city and kind to phones
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (animate) this.clock += dt;
    if (this.anim) {
      const k = Math.min(1, (performance.now() - this.anim.t0) / 700);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.target.lerpVectors(this.anim.from, this.anim.to, e);
      this.zoom = Math.exp(
        Math.log(this.anim.z0) + (Math.log(this.anim.z1) - Math.log(this.anim.z0)) * e,
      );
      if (k >= 1) this.anim = null;
    }
    this.dirty = false;
    this.placeCamera();
    // LOD: windows, add-ons and street furniture only where they can be seen (v3 build file 08)
    const near = this.zoom > 0.42;
    this.labels.visible = this.zoom < 0.55;
    if (near !== this.detailOn) {
      this.detailOn = near;
      for (const o of this.detail) o.visible = near;
    }
    if (this.crowd) {
      const right = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.crowd.update(this.clock, right, this.grow, this.upScale);
    }
    const t = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.stats.frames++;
    this.stats.ms += performance.now() - t;
  };

  /** render counters for ?debug and the perf check (v3 build file 08) */
  readonly stats = { frames: 0, ms: 0, buildMs: 0, townMs: 0, layoutMs: 0, homes: 0 };
  get info() {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles, ...this.stats };
  }
}
