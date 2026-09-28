import * as THREE from 'three';
import {
  TOWN_Y,
  bridgeLift,
  bridgesOf,
  gridHeight,
  type Bridge,
  type Island,
  type Spot,
} from '@gitemon/shared';
import { Walk, Walkable } from './walker';
import type { Home } from './load';
import { Crowd, type Placed } from './crowd';
import { buildTown, plotHeight, type Town } from './town';
import { airField } from './air';
import { recoverFromSkew, report } from '../lib/clientlog';

/**
 * Gitemon Island renderer (GRANDPLAN v2 §3, v3 §3, v8 §0 V8-D4): a perspective camera with 4 snap
 * rotations that tilts toward the ground as it zooms in, so close up the sky and the horizon show
 * (v8 build 03). The kit-built town comes from town.ts. One shadow map, rendered once when the city is built — the
 * city never moves. The crowd is one instanced draw of pixel sprites (crowd.ts). Frames are capped
 * at 30 fps, and the loop idles when nothing moves on screen or the tab is hidden.
 */

export type { Placed };

/** the view widens as the camera comes down, so the horizon enters the frame (V8-D4) */
const FOV_HIGH = 35;
const FOV_LOW = 50;
/** tilt-zoom: at zoom ≤ TILT_FROM the camera looks down at PITCH_HIGH; by TILT_TO it is at PITCH_LOW */
const TILT_FROM = 0.5;
const TILT_TO = 3.2;
const PITCH_HIGH = (58 * Math.PI) / 180;
const PITCH_LOW = (18 * Math.PI) / 180;
/** golden hour (V8-D7, V8-D11): the horizon colour is the haze colour, so the sea melts into the sky */
const HORIZON = '#f1e4cc';
const ZENITH = '#78aee0';

/** a gradient sky sphere that travels with the camera (no texture, never fogged) */
function skyDome() {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(ZENITH) },
      bottom: { value: new THREE.Color(HORIZON) },
    },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vY = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 bottom;
      varying float vY;
      void main() {
        float t = pow(clamp(vY, 0.0, 1.0), 0.55);
        gl_FragColor = vec4(mix(bottom, top, t), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), m);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return sky;
}

export class CityScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sky: THREE.Mesh;
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
  private town: Town | null = null;
  private cityRef: Island | null = null;
  private bob: { obj: THREE.Object3D; y: number }[] = [];
  private air: ReturnType<typeof airField> | null = null;
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
    this.renderer.setClearColor(HORIZON);
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';
    this.camera = new THREE.PerspectiveCamera(FOV_HIGH, 1, 1, 4000);
    // haze by distance (V8-D7): its range follows the camera (placeCamera), its colour is the horizon
    this.scene.fog = new THREE.Fog(HORIZON, 1500, 2800);
    this.sky = skyDome();
    this.scene.add(this.sky);
    this.scene.add(new THREE.HemisphereLight('#fff6e8', '#7f8aa0', 1.75));
    const sun = new THREE.DirectionalLight('#fff1d6', 1.9);
    sun.position.set(-160, 300, 110);
    this.scene.add(sun, sun.target);
    this.sun = sun;
    // static city: the shadow map is drawn once after build (v3 §3, G5), never per frame
    // v11 (V11-D9): a phone gets the 2048 map — the one frame that redraws it stays cheap
    const phone =
      Math.min(screen.width, screen.height) < 700 && matchMedia('(pointer: coarse)').matches;
    const big = this.renderer.capabilities.maxTextureSize >= 4096 && !phone;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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

  /** world units visible vertically at the target at zoom 1 */
  private get span() {
    return 150 / this.zoom;
  }

  /** 0 over the whole island … 1 down near the ground (V8-D4 tilt-zoom) */
  private get tilt() {
    const t = Math.min(
      1,
      Math.max(0, Math.log(this.zoom / TILT_FROM) / Math.log(TILT_TO / TILT_FROM)),
    );
    return t * t * (3 - 2 * t);
  }
  /** camera elevation (radians) */
  private get pitch() {
    return PITCH_HIGH + (PITCH_LOW - PITCH_HIGH) * this.tilt;
  }

  /** the island's height grid, so the camera never dips under a hill */
  private groundGrid: Island['grid'] | null = null;

  private placeCamera() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const fov = FOV_HIGH + (FOV_LOW - FOV_HIGH) * this.tilt;
    const d = this.span / (2 * Math.tan(((fov / 2) * Math.PI) / 180));
    const e = this.pitch;
    this.camera.fov = fov;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.near = Math.max(0.5, d * 0.02);
    this.camera.far = d * 4 + 1500;
    this.camera.updateProjectionMatrix();
    const dir = new THREE.Vector3(
      Math.cos(this.yaw) * Math.cos(e),
      Math.sin(e),
      Math.sin(this.yaw) * Math.cos(e),
    );
    // aim at the real ground (the volcano is 50 m up), then lift the camera until no hill is in the way
    if (this.groundGrid) {
      const g = gridHeight(this.groundGrid, this.target.x, this.target.z);
      this.target.y += (Math.max(TOWN_Y, g) - this.target.y) * (this.anim ? 1 : 0.25);
    }
    this.camera.position.copy(this.target).addScaledVector(dir, d);
    if (this.groundGrid) {
      const t = this.target;
      const c = this.camera.position;
      let y = c.y;
      for (let k = 1; k <= 10; k++) {
        const f = k / 10;
        const h = gridHeight(this.groundGrid, t.x + (c.x - t.x) * f, t.z + (c.z - t.z) * f) + 2.5;
        y = Math.max(y, t.y + (h - t.y) / f);
      }
      c.y = y;
    }
    // low down, aim a little above the target so the land ahead fills the frame, not the ground at our feet
    this.camera.lookAt(this.target.x, this.target.y + d * 0.14 * this.tilt, this.target.z);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = d * 0.9;
    fog.far = d * 4.2 + 300;
    this.sky.position.copy(this.camera.position);
    this.sky.scale.setScalar(this.camera.far * 0.9);
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
    // v9: a town building opens its panel
    const k = this.buildingAt(px, py);
    if (k >= 0 && this.onBuilding) {
      this.onBuilding(k);
      return;
    }
    // tapping the ground zooms toward it
    const g = this.groundAt(px, py);
    // v6: a signed-in player's tap on the ground walks their Gitemon there
    if (g && this.onGround?.(g.x, g.z)) return;
    if (g) this.flyTo(g.x, g.z, Math.min(4, this.zoom * 2.2));
  }

  /** v9: set by the app — a town building was tapped (index into island.town) */
  onBuilding: ((k: number) => void) | null = null;
  private plotH: number[] = [];
  /** which town building is under the tap: the tap's ray, tested at several heights of each one */
  private buildingAt(px: number, py: number): number {
    const city = this.walkCity ?? this.cityRef;
    if (!city) return -1;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1),
      this.camera,
    );
    const hit = new THREE.Vector3();
    let best = -1;
    let bestD = Infinity;
    city.town.forEach((p, k) => {
      const h = this.plotH[k] ?? 8;
      for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(p.y + h * t));
        if (!ray.ray.intersectPlane(plane, hit)) continue;
        const dx = hit.x - p.x;
        const dz = hit.z - p.z;
        const across = dx * p.fx + dz * p.fz;
        const along = -dx * p.fz + dz * p.fx;
        if (Math.abs(along) < p.w / 2 + 0.4 && Math.abs(across) < p.d / 2 + 0.4) {
          const d = hit.distanceTo(this.camera.position);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
          break;
        }
      }
    });
    return best;
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

  /** homes: lot index → the owner's house (claimed players, V2-D5 / V3-D2 / V7-D6) */
  build(city: Island, homes = new Map<number, Home>()) {
    const t0 = performance.now();
    const town = buildTown(city, homes, () => {
      // props arrived: they cast shadows too, so the static map is drawn once more
      this.renderer.shadowMap.needsUpdate = true;
      this.dirty = true;
    });
    this.stats.townMs = Math.round(performance.now() - t0);
    this.stats.buildMs = Math.round(performance.now() - t0);
    this.stats.homes = homes.size;
    this.scene.add(town.group);
    this.town = town;
    this.detail = town.detail;
    this.air = airField(city, town.grid);
    this.scene.add(this.air.points);
    this.buildLabels(city);
    this.groundGrid = city.grid;
    this.cityRef = city;
    this.plotH = city.town.map((p, k) => plotHeight(p.kind, homes.get(k)?.band ?? 0));
    const cam = this.sun.shadow.camera;
    const r = city.radius + 40;
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = 1;
    cam.far = 1200;
    cam.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
    // the frame check (v10 debugging) now runs only on request: ?diag
    if (location.search.includes('diag'))
      setTimeout(() => {
        this.probeDue = true;
        this.dirty = true;
      }, 1500);
  }

  // ---- frame check (debugging a blank map on some GPUs) ------------------------------------------------

  private probeDue = false;
  /** once per visit, after the island is built: did anything draw? Sent to the client log. */
  private probe() {
    this.probeDue = false;
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    const pts: number[][] = [];
    for (const [fx, fy] of [
      [0.5, 0.5],
      [0.3, 0.4],
      [0.7, 0.4],
      [0.35, 0.65],
      [0.65, 0.65],
    ]) {
      gl.readPixels(Math.floor(w * fx!), Math.floor(h * fy!), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      pts.push([...px]);
    }
    // the clear colour as the canvas shows it (sRGB bytes), which is also the fog colour
    const clear = [1, 3, 5].map((i) => parseInt(HORIZON.slice(i, i + 2), 16));
    const same = pts.filter((p) => p.slice(0, 3).every((v, i) => Math.abs(v - clear[i]!) <= 4));
    const r = (v: number) => Math.round(v * 10) / 10;
    const cam = this.camera;
    const fog = this.scene.fog as THREE.Fog;
    const bad = this.renderer.info.programs
      ?.filter(
        (p) => (p as { diagnostics?: { runnable: boolean } }).diagnostics?.runnable === false,
      )
      .map((p) => p.name);
    report(
      'frame',
      JSON.stringify({
        blank: same.length === pts.length,
        pts,
        calls: this.renderer.info.render.calls,
        tris: this.renderer.info.render.triangles,
        programs: this.renderer.info.programs?.length,
        bad,
        lost: gl.isContextLost(),
        err: gl.getError(),
        buf: [w, h],
        css: [this.host.clientWidth, this.host.clientHeight],
        dpr: window.devicePixelRatio,
        aa: gl.getContextAttributes()?.antialias,
        cam: [cam.position.x, cam.position.y, cam.position.z].map(r),
        tgt: [this.target.x, this.target.y, this.target.z].map(r),
        zoom: r(this.zoom),
        fov: r(cam.fov),
        nf: [r(cam.near), r(cam.far)],
        fog: [r(fog.near), r(fog.far)],
        maxTex: this.renderer.capabilities.maxTextureSize,
        vtex: this.renderer.capabilities.maxVertexTextures,
      }),
    );
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

  // ---- walking (v6 §3, V6-D1) ------------------------------------------------------------------------

  /** set by the app: return true when a ground tap was used for walking */
  onGround: ((x: number, z: number) => boolean) | null = null;
  private walkable: Walkable | null = null;
  private solids: { x: number; z: number; r: number }[] = [];
  private walker: { i: number; home: Spot; walk: Walk | null; x: number; z: number } | null = null;
  private walkCity: Island | null = null;
  /** called about twice a second while walking, with where the walker is */
  onWalk: ((x: number, z: number, arrived: boolean) => void) | null = null;
  private lastWalkPing = 0;

  // ---- steering (v8 §0 V8-D5, build file 06) --------------------------------------------------------

  /** screen-relative stick: x = right, y = up the screen; length ≤ 1 */
  private stick = { x: 0, y: 0 };
  /** set by the app: may the walker take another `m` metres? (the v6 step budget) */
  canSteer: ((m: number) => boolean) | null = null;
  /** called with the metres just steered */
  onSteer: ((m: number) => void) | null = null;
  steer(x: number, y: number) {
    const l = Math.hypot(x, y);
    this.stick = l > 1 ? { x: x / l, y: y / l } : { x, y };
    if (l > 0 && this.walker) {
      this.walker.walk = null; // steering takes over from a tapped walk
      if (this.zoom < 2.2) this.flyTo(this.walker.x, this.walker.z, 2.6);
    }
    this.dirty = true;
  }
  get steering() {
    return this.stick.x !== 0 || this.stick.y !== 0;
  }
  private stepSteer(dt: number) {
    const w = this.walker;
    if (!w || !this.walkable || !this.crowd || !this.walkCity || !this.steering) return;
    // up the screen = away from the camera along the ground
    const fx = -Math.cos(this.yaw);
    const fz = -Math.sin(this.yaw);
    const rx = Math.sin(this.yaw);
    const rz = -Math.cos(this.yaw);
    const dx = fx * this.stick.y + rx * this.stick.x;
    const dz = fz * this.stick.y + rz * this.stick.x;
    const step = 7 * dt * Math.hypot(this.stick.x, this.stick.y);
    if (this.canSteer && !this.canSteer(step)) return;
    const l = Math.hypot(dx, dz) || 1;
    let nx = w.x + (dx / l) * step;
    let nz = w.z + (dz / l) * step;
    // blocked (water, cliff, house row): slide along whichever axis is open
    if (!this.walkable.walkable(nx, nz)) {
      if (this.walkable.walkable(nx, w.z)) nz = w.z;
      else if (this.walkable.walkable(w.x, nz)) nx = w.x;
      else return;
    }
    const moved = Math.hypot(nx - w.x, nz - w.z);
    w.x = nx;
    w.z = nz;
    const y = this.groundY(nx, nz);
    this.crowd.setPos(w.i, nx, nz, y);
    this.target.x += (nx - this.target.x) * 0.15;
    this.target.z += (nz - this.target.z) * 0.15;
    this.onSteer?.(moved);
    const now = performance.now();
    if (now - this.lastWalkPing > 500) {
      this.lastWalkPing = now;
      this.onWalk?.(nx, nz, false);
    }
    this.dirty = true;
  }

  /** where the walker's feet go: town ground (on a bridge: its deck, V10-D6), else the terrain */
  private bridges: Bridge[] = [];
  private groundY(x: number, z: number) {
    const city = this.walkCity!;
    if (Math.hypot(x, z) < 72) return TOWN_Y + bridgeLift(this.bridges, x, z);
    return Math.max(TOWN_Y, gridHeight(city.grid, x, z));
  }

  /** make placed resident `i` the player's own walker (home = where it lives) */
  enableWalker(city: Island, i: number) {
    const c = this.crowd;
    if (!c) return;
    this.walkCity = city;
    this.bridges = bridgesOf(city);
    if (!this.walkable) {
      this.walkable = new Walkable(city);
      this.walkable.setSolids(this.solids);
    }
    const p = c.at(i);
    this.walker = { i, home: { ...p.spot }, walk: null, x: p.spot.x, z: p.spot.z };
  }
  get walkerPos(): [number, number] | null {
    return this.walker ? [this.walker.x, this.walker.z] : null;
  }
  get walkerHome(): Spot | null {
    return this.walker?.home ?? null;
  }
  /** plan a walk to (x, z); returns its length in metres, or null when there is no way there */
  planWalk(x: number, z: number): number | null {
    if (!this.walker || !this.walkable) return null;
    return this.walkable.path(this.walker.x, this.walker.z, x, z)?.length ?? null;
  }
  walkTo(x: number, z: number): number | null {
    if (!this.walker || !this.walkable) return null;
    const path = this.walkable.path(this.walker.x, this.walker.z, x, z);
    if (!path) return null;
    this.walker.walk = new Walk(path);
    this.dirty = true;
    return path.length;
  }
  walkHome() {
    if (!this.walker) return;
    this.walkTo(this.walker.home.x, this.walker.home.z);
  }
  /** back home at once (the tab was hidden: nothing to watch) */
  snapHome() {
    const w = this.walker;
    if (!w || !this.crowd) return;
    w.walk = null;
    w.x = w.home.x;
    w.z = w.home.z;
    this.crowd.setPos(w.i, w.home.x, w.home.z, w.home.y);
    this.dirty = true;
  }
  private stepWalker(dt: number) {
    const w = this.walker;
    if (!w?.walk || !this.crowd || !this.walkCity) return;
    const [x, z] = w.walk.step(dt);
    w.x = x;
    w.z = z;
    const y = this.groundY(x, z);
    this.crowd.setPos(w.i, x, z, y);
    // the camera follows the walker
    this.target.x += (x - this.target.x) * 0.08;
    this.target.z += (z - this.target.z) * 0.08;
    const now = performance.now();
    const arrived = w.walk.done;
    if (arrived || now - this.lastWalkPing > 500) {
      this.lastWalkPing = now;
      this.onWalk?.(x, z, arrived);
    }
    if (arrived) w.walk = null;
    this.dirty = true;
  }

  // ---- staging (v6 §5, V6-D7) ---------------------------------------------------------------------

  private staging = new THREE.Group();
  /** pillar materials with their full opacity: they fade as the camera comes close */
  private beams: [THREE.MeshBasicMaterial, number][] = [];
  /**
   * Light pillars over the top ten (visible from the whole island), a thin one over each plaza-seat
   * player (v11), and a beacon over every mini plaza. `today` = the legend of the day's key: its pillar burns brighter (V6-D5).
   */
  stage(city: Island, placed: Placed[], today: string | null = null) {
    this.staging.clear();
    this.beams = [];
    const GLOW = { legendary: '#ffcf5a', mythic: '#b98cff', epic: '#6cb8ff', rare: '#72f29a' };
    const beam = (
      x: number,
      y: number,
      z: number,
      colour: string,
      r: number,
      h: number,
      o: number,
    ) => {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.35, r, h, 16, 1, true).translate(0, h / 2, 0),
        new THREE.MeshBasicMaterial({
          color: colour,
          transparent: true,
          opacity: o,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      m.position.set(x, y, z);
      m.renderOrder = 5;
      this.beams.push([m.material, o]);
      this.staging.add(m);
    };
    for (const p of placed) {
      const sp = p.g.special;
      // v11 (V11-D6): a player holding a plaza seat — the top 1 % — gets a thin pale pillar, so the
      // island's best players can be found from the overview (thinner and paler than a legend's)
      if ((!sp || sp.earned) && p.spot.kind === 'plaza' && !p.g.special?.sealed) {
        beam(p.spot.x, p.spot.y, p.spot.z, '#fff3dc', 0.5, 34, 0.13);
        continue;
      }
      if (!sp) continue;
      const isToday = today != null && sp.key === today;
      if (sp.rank <= 10 || isToday)
        beam(
          p.spot.x,
          sp.rank === 1 ? TOWN_Y : p.spot.y,
          p.spot.z,
          GLOW[sp.tier],
          sp.rank === 1 ? 1.7 : 1.1,
          sp.rank <= 3 ? 90 : 60,
          isToday ? 0.34 : 0.2,
        );
    }
    for (const m of city.miniPlazas) {
      const orb = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.3, 1),
        new THREE.MeshBasicMaterial({ color: '#fff4c8' }),
      );
      orb.position.set(m.x, m.y + 24, m.z);
      this.staging.add(orb);
      beam(m.x, m.y + 17, m.z, '#fff0b0', 1.1, 7, 0.22);
    }
    this.scene.add(this.staging);
    this.dirty = true;
  }

  // ---- sculpted pieces (v8 build 05) ---------------------------------------------------------------

  /** load the 3D models; each one replaces its code-built piece or sprite as it arrives */
  async addPieces(city: Island, placed: Placed[], homes: Map<number, Home> = new Map()) {
    const t0 = performance.now();
    // the model loader is its own chunk: it is not needed for the first view
    // v11 (V11-D8): after a deploy this chunk can be gone for a page opened earlier → reload once
    let mod: typeof import('./models');
    try {
      mod = await import('./models');
    } catch (e) {
      if (!recoverFromSkew(e)) report('error', `models chunk: ${String(e)}`);
      return;
    }
    const { loadPieces } = mod;
    const pcs = await loadPieces(city, placed, homes);
    if (!pcs) return;
    this.scene.add(pcs.group);
    if (pcs.monument && this.town) this.town.monument.visible = false;
    if (pcs.landmarks && this.town) for (const l of this.town.landmarks) l.visible = false;
    if (pcs.town && this.town) this.town.plots.visible = false;
    for (const i of pcs.replaced) this.crowd?.hide(i);
    this.bob = pcs.bob;
    // v11 (V11-D7): the solid pieces block walking once they stand there
    this.solids = pcs.solids;
    this.walkable?.setSolids(pcs.solids);
    this.stats.piecesMs = Math.round(performance.now() - t0);
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
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
    return 1 / Math.cos(this.pitch);
  }

  // ---- loop --------------------------------------------------------------------------------------------

  private loop = (now = 0) => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    // walkers only matter when they are big enough to see: animate at street and district zoom
    const animate = this.crowd && this.zoom > 0.45;
    if (!animate && !this.dirty && !this.anim && !this.walker?.walk && !this.steering) return;
    if (now - this.last < 32) return; // ~30 fps is plenty for a city and kind to phones
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (animate) this.clock += dt;
    for (const b of this.bob) b.obj.position.y = b.y + Math.sin(this.clock * 0.9) * 0.6;
    // water and air (v8 build 04): the air shows only close enough to be seen
    if (this.town)
      (this.town.water.material as THREE.ShaderMaterial).uniforms.uTime!.value = this.clock;
    if (this.air) {
      const px = this.host.clientHeight / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
      const fade = Math.min(1, Math.max(0, (this.zoom - 0.7) / 0.6));
      this.air.update(this.clock, this.target.x, this.target.z, px, fade);
    }
    this.stepWalker(dt);
    this.stepSteer(dt);
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
    // pillars are for finding legends from afar: close up they fade so the creatures read
    const fade = this.zoom < 0.7 ? 1 : Math.max(0.12, (0.7 / this.zoom) ** 1.4);
    for (const [mat, o] of this.beams) mat.opacity = o * fade;
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
    if (this.probeDue) this.probe();
    this.stats.frames++;
    this.stats.ms += performance.now() - t;
  };

  // ---- HUD (v8 §0 V8-D9) -----------------------------------------------------------------------------

  /** the camera's heading (radians): the compass turns with it */
  get heading() {
    return this.yaw;
  }
  get view(): { x: number; z: number; span: number } {
    return { x: this.target.x, z: this.target.z, span: this.span };
  }

  /** render counters for ?debug and the perf check (v3 build file 08) */
  readonly stats = { frames: 0, ms: 0, buildMs: 0, townMs: 0, layoutMs: 0, homes: 0, piecesMs: 0 };
  get info() {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles, ...this.stats };
  }
}
