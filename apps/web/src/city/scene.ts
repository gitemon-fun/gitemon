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
  type MapGitemon,
  type Spot,
  type TypeId,
} from '@gitemon/shared';
import { creatureGeometry, creatureMaterial } from './creatures';

/**
 * Gitemon City renderer (GRANDPLAN v2 §3, §7): Transit-style low-poly blocks under a fixed
 * isometric camera with 4 snap rotations. Buildings and creatures are instanced; the scene only
 * re-renders when something changes.
 */

interface Style {
  ground: string;
  walls: string[];
  roof: string;
  tree: [string, string];
}

const STYLE: Partial<Record<TypeId, Style>> = {
  forge: {
    ground: '#5a4a44',
    walls: ['#3b302c', '#4a3c37', '#2f2724'],
    roof: '#ff7a2e',
    tree: ['#2a2220', '#ff9a4a'],
  },
};
function style(t: TypeId): Style {
  const s = STYLE[t];
  if (s) return s;
  const c = TYPE_INFO[t].colors;
  const tone = (hex: string, l: number) => {
    const col = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    col.getHSL(hsl);
    col.setHSL(hsl.h, hsl.s * 0.45, l);
    return '#' + col.getHexString();
  };
  return {
    ground: tone(c[0], 0.62),
    walls: [tone(c[1], 0.86), tone(c[0], 0.8), '#efe9df'],
    roof: tone(c[0], 0.5),
    tree: ['#6b4a2e', tone(c[0], 0.42)],
  };
}

export interface Placed {
  g: MapGitemon;
  spot: Spot;
}

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
  private creatures: { mesh: THREE.InstancedMesh; list: Placed[] }[] = [];
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
    this.faceCreatures();
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
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((px - r.left) / r.width) * 2 - 1,
      -((py - r.top) / r.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(
      this.creatures.map((c) => c.mesh),
      false,
    );
    const hit = hits[0];
    if (hit && hit.instanceId != null) {
      const set = this.creatures.find((c) => c.mesh === hit.object)!;
      const p = set.list[hit.instanceId];
      this.select(p);
      this.onPick(p);
      return;
    }
    // tapping the ground zooms toward it
    const g = this.groundAt(px, py);
    if (g) this.flyTo(g.x, g.z, Math.min(4, this.zoom * 2.2));
  }

  select(p: Placed | null) {
    this.ring.visible = !!p;
    if (p) this.ring.position.set(p.spot.x, 0.06, p.spot.z);
    this.dirty = true;
  }

  // ---- building the city ---------------------------------------------------------------------------

  build(city: City) {
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
      const st = style(d.t);
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
    this.buildBuildings(city, g);
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

  private buildBuildings(city: City, g: THREE.Group) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const towers = city.lots.filter((l) => !l.house);
    const houses = city.lots.filter((l) => l.house);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const body = new THREE.InstancedMesh(
      box,
      new THREE.MeshLambertMaterial({ flatShading: true }),
      towers.length + houses.length,
    );
    const roofTop = new THREE.InstancedMesh(
      box,
      new THREE.MeshLambertMaterial({ flatShading: true }),
      towers.length,
    );
    const pyramid = new THREE.ConeGeometry(0.72, 1, 4);
    pyramid.rotateY(Math.PI / 4);
    pyramid.translate(0, 0.5, 0);
    const roofs = new THREE.InstancedMesh(
      pyramid,
      new THREE.MeshLambertMaterial({ flatShading: true }),
      houses.length,
    );
    let i = 0;
    towers.forEach((l, k) => {
      const st = style(city.districts[l.d].t);
      q.setFromAxisAngle(up, l.rot + Math.PI / 2);
      m.compose(new THREE.Vector3(l.x, 0, l.z), q, new THREE.Vector3(l.w, l.h, l.depth));
      body.setMatrixAt(i, m);
      body.setColorAt(i++, col.set(st.walls[hash32(`w${k}`) % st.walls.length]));
      m.compose(
        new THREE.Vector3(l.x, l.h, l.z),
        q,
        new THREE.Vector3(l.w * 0.92, 0.6, l.depth * 0.92),
      );
      roofTop.setMatrixAt(k, m);
      roofTop.setColorAt(k, col.set(st.roof));
    });
    houses.forEach((l, k) => {
      const st = style(city.districts[l.d].t);
      q.setFromAxisAngle(up, l.rot + Math.PI / 2);
      m.compose(
        new THREE.Vector3(l.x, 0, l.z),
        q,
        new THREE.Vector3(l.w * 0.8, l.h, l.depth * 0.8),
      );
      body.setMatrixAt(i, m);
      body.setColorAt(i++, col.set('#f1e7d3'));
      m.compose(
        new THREE.Vector3(l.x, l.h, l.z),
        q,
        new THREE.Vector3(l.w * 1.05, 3.4, l.depth * 1.05),
      );
      roofs.setMatrixAt(k, m);
      roofs.setColorAt(k, col.set(st.roof));
    });
    g.add(body, roofTop, roofs);
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
      const st = s.t ? style(s.t) : null;
      tr.setColorAt(k, col.set(st ? st.tree[0] : '#6b4a2e'));
      cr.setColorAt(k, col.set(st ? st.tree[1] : '#5fa84a'));
    });
    g.add(tr, cr);
    // district landmarks: an obelisk with a glowing cap in the district's colour
    for (const d of city.districts) {
      const st = style(d.t);
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
    for (const c of this.creatures) {
      this.scene.remove(c.mesh);
      c.mesh.dispose();
    }
    this.creatures = [];
    const groups = new Map<string, Placed[]>();
    for (const p of placed) {
      const k = `${p.g.t1}:${p.g.t2 ?? ''}:${p.g.f}:${p.g.sh}:${p.g.s}`;
      let arr = groups.get(k);
      if (!arr) groups.set(k, (arr = []));
      arr.push(p);
    }
    for (const list of groups.values()) {
      const rep = { ...list[0].g, id: 1 };
      const mesh = new THREE.InstancedMesh(creatureGeometry(rep), creatureMaterial, list.length);
      // individual variation: a small per-creature tint (the shared geometry has one colourway)
      const tint = new THREE.Color();
      list.forEach((p, k) => {
        const h = hash32(`tint:${p.g.id}`);
        const l = 0.86 + (h % 29) / 100;
        tint.setRGB(l * (0.97 + ((h >>> 5) % 7) / 100), l, l * (0.97 + ((h >>> 9) % 7) / 100));
        mesh.setColorAt(k, tint);
      });
      mesh.userData.list = list;
      this.creatures.push({ mesh, list });
      this.scene.add(mesh);
    }
    // blob shadows, one instanced mesh for all
    const blob = new THREE.CircleGeometry(0.8, 12);
    blob.rotateX(-Math.PI / 2);
    const shadows = new THREE.InstancedMesh(
      blob,
      new THREE.MeshBasicMaterial({
        color: '#000000',
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
      placed.length,
    );
    const m = new THREE.Matrix4();
    placed.forEach((p, k) => {
      const s = p.g.f === 3 ? 1.35 : p.g.f === 2 ? 1.05 : 0.85;
      m.makeScale(s, 1, s).setPosition(p.spot.x, 0.07, p.spot.z);
      shadows.setMatrixAt(k, m);
    });
    shadows.userData.shadow = true;
    this.creatures.push({ mesh: shadows, list: [] });
    this.scene.add(shadows);
    this.faceCreatures();
  }

  private faceCreatures() {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const c of this.creatures) {
      if (!c.list.length) continue;
      c.list.forEach((p, k) => {
        // face the camera, with a small individual turn
        const jitter = ((p.g.id % 17) - 8) * 0.04;
        q.setFromAxisAngle(up, -this.yaw + Math.PI / 2 + jitter);
        m.compose(new THREE.Vector3(p.spot.x, 0, p.spot.z), q, new THREE.Vector3(1.6, 1.6, 1.6));
        c.mesh.setMatrixAt(k, m);
      });
      c.mesh.instanceMatrix.needsUpdate = true;
      c.mesh.computeBoundingSphere();
    }
    this.dirty = true;
  }

  // ---- loop --------------------------------------------------------------------------------------------

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.anim) {
      const k = Math.min(1, (performance.now() - this.anim.t0) / 700);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.target.lerpVectors(this.anim.from, this.anim.to, e);
      this.zoom = Math.exp(
        Math.log(this.anim.z0) + (Math.log(this.anim.z1) - Math.log(this.anim.z0)) * e,
      );
      if (k >= 1) this.anim = null;
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  };
}
