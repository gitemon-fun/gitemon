import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  AVENUE,
  CANAL_IN,
  CANAL_OUT,
  PLAZA_R,
  RING0,
  TYPE_INFO,
  hash32,
  type City,
  type TypeId,
} from '@gitemon/shared';
import { Crowd, type Placed } from './crowd';
import { DISTRICT_STYLE, archetype, homeParts } from './buildings';

/**
 * Gitemon City renderer (GRANDPLAN v2 §3, §7): Transit-style low-poly blocks under a fixed
 * isometric camera with 4 snap rotations. Buildings are instanced per district style; the crowd is
 * one instanced draw of pixel sprites (crowd.ts). Frames are capped at 30 fps, and the loop idles
 * when nothing moves on screen or the tab is hidden.
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
    this.scene.fog = new THREE.Fog('#bfdcf0', 900, 1800);
    this.scene.add(new THREE.HemisphereLight('#fff6e8', '#6f7f96', 1.9));
    const sun = new THREE.DirectionalLight('#fff1d6', 1.6);
    sun.position.set(-200, 400, 120);
    this.scene.add(sun);
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
        top.copy(v).setY(h);
        v.setY(h * 0.45).project(this.camera);
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
    if (p) this.ring.position.set(p.spot.x, 0.06, p.spot.z);
    this.dirty = true;
  }

  // ---- building the city ---------------------------------------------------------------------------

  /** homes: lot index → the owner's roof colour (claimed players, V2-D5) */
  build(city: City, homes = new Map<number, string>()) {
    const g = new THREE.Group();
    this.scene.add(g);
    const flat = (geo: THREE.BufferGeometry, color: string, y = 0) => {
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      g.add(m);
      return m;
    };
    // island-less ground: a big soft disc, then each district's wedge
    flat(new THREE.CircleGeometry(city.radius + 60, 96), '#d9d2c3', -0.2);
    for (const d of city.districts) {
      const st = DISTRICT_STYLE[d.t];
      // RingGeometry's theta runs counter-clockwise in its own plane; after rotating flat, angle -> -angle
      flat(
        new THREE.RingGeometry(CANAL_OUT, RING0 + d.bands * 26 + 4, 12, 1, -d.a1, d.a1 - d.a0),
        st.ground,
        -0.1,
      );
    }
    // plaza + canal
    flat(new THREE.CircleGeometry(PLAZA_R + 2, 64), '#e8e0d0', 0);
    flat(new THREE.RingGeometry(PLAZA_R - 6, PLAZA_R - 5.4, 64), '#cfc4b0', 0.02);
    flat(new THREE.RingGeometry(14, 14.6, 48), '#cfc4b0', 0.02);
    flat(new THREE.RingGeometry(CANAL_IN, CANAL_OUT, 96), '#5fb2d8', 0.01);
    flat(new THREE.RingGeometry(CANAL_IN - 1.2, CANAL_IN, 96), '#9d9384', 0.03);
    flat(new THREE.RingGeometry(CANAL_OUT, CANAL_OUT + 1.2, 96), '#9d9384', 0.03);
    this.buildRoads(city, g);
    this.buildBuildings(city, g, homes);
    this.buildDecor(city, g);
    this.dirty = true;
  }

  private buildRoads(city: City, g: THREE.Group) {
    const pave: THREE.BufferGeometry[] = [];
    const road: THREE.BufferGeometry[] = [];
    const strip = (pts: [number, number][], w: number, y: number, out: THREE.BufferGeometry[]) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, z0] = pts[i];
        const [x1, z1] = pts[i + 1];
        const len = Math.hypot(x1 - x0, z1 - z0);
        const geo = new THREE.PlaneGeometry(len + w * 0.3, w);
        geo.rotateX(-Math.PI / 2);
        geo.rotateY(-Math.atan2(z1 - z0, x1 - x0));
        geo.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
        out.push(geo);
      }
    };
    for (const r of city.roads) {
      strip(r.pts, r.w + 6, 0.02, pave);
      strip(r.pts, r.w, 0.05, road);
    }
    g.add(
      new THREE.Mesh(mergeGeometries(pave)!, new THREE.MeshLambertMaterial({ color: '#c9c0ae' })),
    );
    g.add(
      new THREE.Mesh(mergeGeometries(road)!, new THREE.MeshLambertMaterial({ color: '#5d5a60' })),
    );
    // bridges over the canal on every avenue
    const planks: THREE.BufferGeometry[] = [];
    for (const d of city.districts) {
      const geo = new THREE.BoxGeometry(CANAL_OUT - CANAL_IN + 3, 0.5, AVENUE);
      geo.rotateY(-d.a0);
      const r = (CANAL_IN + CANAL_OUT) / 2;
      geo.translate(Math.cos(d.a0) * r, 0.25, Math.sin(d.a0) * r);
      planks.push(geo);
    }
    g.add(
      new THREE.Mesh(mergeGeometries(planks)!, new THREE.MeshLambertMaterial({ color: '#b08a5a' })),
    );
  }

  private buildBuildings(city: City, g: THREE.Group, homes: Map<number, string>) {
    // one instanced archetype per district style (buildings.ts): cosy low-rise, facing its road
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const place = (l: City['lots'][number]) => {
      const a = Math.atan2(l.z, l.x);
      // the front (+z of the archetype) looks at the road it faces
      q.setFromAxisAngle(up, Math.atan2(-Math.cos(a) * l.face, -Math.sin(a) * l.face));
    };
    if (homes.size) {
      const { walls, roof } = homeParts();
      const wm = new THREE.InstancedMesh(walls, mat, homes.size);
      const rm = new THREE.InstancedMesh(roof, mat, homes.size);
      let k = 0;
      for (const [i, colour] of homes) {
        const l = city.lots[i]!;
        place(l);
        m.compose(
          new THREE.Vector3(l.x, 0, l.z),
          q,
          new THREE.Vector3(l.w * 0.8, 6.4, l.depth * 0.8),
        );
        wm.setMatrixAt(k, m);
        rm.setMatrixAt(k, m);
        wm.setColorAt(k, col.set('#ffffff'));
        rm.setColorAt(k++, col.set(colour));
      }
      g.add(wm, rm);
    }
    city.districts.forEach((d, di) => {
      const lots = city.lots.filter((l, i) => l.d === di && !homes.has(i));
      if (!lots.length) return;
      const mesh = new THREE.InstancedMesh(archetype(DISTRICT_STYLE[d.t]), mat, lots.length);
      lots.forEach((l, k) => {
        place(l);
        const h = hash32(`b${di}:${k}`);
        const sw = l.w * (0.78 + (h % 12) / 100);
        const sd = l.depth * (0.8 + ((h >>> 4) % 10) / 100);
        // storeys: houses stay small, downtown (taller lots) gets a little more height
        const sy = l.house ? 6 : 6.4 + (l.h - 5) * 0.3 + ((h >>> 8) % 10) / 8;
        m.compose(new THREE.Vector3(l.x, 0, l.z), q, new THREE.Vector3(sw, sy, sd));
        mesh.setMatrixAt(k, m);
        const t = 0.9 + ((h >>> 12) % 16) / 100;
        mesh.setColorAt(k, col.setRGB(t, t, t));
      });
      g.add(mesh);
    });
  }

  private buildDecor(city: City, g: THREE.Group) {
    // trees between plaza and canal, and around each district square
    const trunk = new THREE.CylinderGeometry(0.25, 0.35, 1.6, 5);
    trunk.translate(0, 0.8, 0);
    const crown = new THREE.IcosahedronGeometry(1.4, 0);
    crown.translate(0, 2.6, 0);
    const spots: { x: number; z: number; t: TypeId | null }[] = [];
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      spots.push({ x: Math.cos(a) * (PLAZA_R + 1.5), z: Math.sin(a) * (PLAZA_R + 1.5), t: null });
    }
    for (const d of city.districts) {
      const { x, z, r } = d.square;
      for (const [sx, sz] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ])
        spots.push({ x: x + sx * (r + 1.2), z: z + sz * (r + 1.2), t: d.t });
    }
    // yard trees behind some lots, so blocks read as gardens, not a parking lot of boxes
    city.lots.forEach((l, k) => {
      const h = hash32(`yard${k}`);
      if (h % 5 > 1) return;
      const a = Math.atan2(l.z, l.x);
      const back = (l.depth / 2 + 0.4) * l.face;
      const side = ((h >>> 3) % 2 ? 1 : -1) * l.w * 0.42;
      spots.push({
        x: l.x + Math.cos(a) * back - Math.sin(a) * side,
        z: l.z + Math.sin(a) * back + Math.cos(a) * side,
        t: city.districts[l.d]!.t,
      });
    });
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const tr = new THREE.InstancedMesh(
      trunk,
      new THREE.MeshLambertMaterial({ flatShading: true }),
      spots.length,
    );
    const cr = new THREE.InstancedMesh(
      crown,
      new THREE.MeshLambertMaterial({ flatShading: true }),
      spots.length,
    );
    spots.forEach((s, k) => {
      const sc = 0.8 + (hash32(`tree${k}`) % 40) / 100;
      m.makeScale(sc, sc, sc).setPosition(s.x, 0, s.z);
      tr.setMatrixAt(k, m);
      cr.setMatrixAt(k, m);
      const st = s.t ? DISTRICT_STYLE[s.t] : null;
      tr.setColorAt(k, col.set(st ? st.tree[0] : '#6b4a2e'));
      cr.setColorAt(k, col.set(st ? st.tree[1] : '#5fa84a'));
    });
    g.add(tr, cr);
    // district landmarks: an obelisk with a glowing cap in the district's colour
    for (const d of city.districts) {
      const st = { walls: [DISTRICT_STYLE[d.t].wall] };
      const ob = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 1.6, 12, 4),
        new THREE.MeshLambertMaterial({ color: st.walls[0], flatShading: true }),
      );
      ob.position.set(d.square.x, 6, d.square.z);
      const cap = new THREE.Mesh(
        new THREE.OctahedronGeometry(1.6, 0),
        new THREE.MeshBasicMaterial({ color: TYPE_INFO[d.t].colors[0] }),
      );
      cap.position.set(d.square.x, 13.4, d.square.z);
      g.add(ob, cap);
    }
    // the plaza monument
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(5.5, 6.5, 2, 8),
      new THREE.MeshLambertMaterial({ color: '#bdb3a2', flatShading: true }),
    );
    base.position.y = 1;
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 2, 16, 8),
      new THREE.MeshLambertMaterial({ color: '#e7dfd0', flatShading: true }),
    );
    column.position.y = 10;
    const orb = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.6, 1),
      new THREE.MeshLambertMaterial({ color: '#f2c94c', emissive: '#6a4a00', flatShading: true }),
    );
    orb.position.y = 20.5;
    g.add(base, column, orb);
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
    return Math.max(1, Math.min(3.2, 1.1 / this.zoom));
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
    if (this.crowd) {
      const right = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.crowd.update(this.clock, right, this.grow, this.upScale);
    }
    this.renderer.render(this.scene, this.camera);
  };
}
