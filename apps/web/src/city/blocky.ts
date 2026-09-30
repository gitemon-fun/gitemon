import * as THREE from 'three';
import { voxelize } from '@gitemon/creature-gen';
import { PAPER_MAX, gaitPose, hash32, paperTurn, type Gait } from '@gitemon/shared';
import { CELL, gaitOf, specialAttr, speciesPixels, spriteKey, type Crowd } from './crowd';

/**
 * v16 Pixel-block Gitemon (GRANDPLAN v16). Near the camera a creature's sprite gives way to its own
 * drawing in pixel blocks — each pixel a column of cubes, rounder toward the middle (voxel.ts) — so it
 * has real sides and a back. It stands, walks and hops exactly where and as its sprite would (the crowd
 * shader's maths on the CPU), keeps its drawn side toward the camera and turns toward the way it walks
 * (V16-D3), so it never shows a thin edge. Far away the crowd stays sprites (V16-D2).
 */

/** each way from the middle, as a share of the drawing's larger side (V16-Q1) */
const DEPTH = 0.18;
/** a standing creature turns this far off the camera, so its thickness shows */
const IDLE_TURN = 0.4;
/** how often the near set is chosen again (ms) */
const PICK_MS = 300;

interface Shape {
  geo: THREE.BufferGeometry;
  fit: number;
}
interface Body {
  mesh: THREE.Mesh;
  mat: THREE.MeshLambertMaterial;
  gait: Gait;
  phase: number;
  fit: number;
  used: number;
}

export class Blocky {
  readonly group = new THREE.Group();
  /** block shape per species drawing (V16-D5: the shape depends only on the drawing) */
  private shapes = new Map<string, Shape | null>();
  /** built bodies by crowd index; the active ones stand in the world, the rest wait to be reused */
  private bodies = new Map<number, Body>();
  private active = new Set<number>();
  private lastPick = -Infinity;
  /** false = every creature a sprite again (the before/after check, ?debug) */
  enabled = true;
  /**
   * v17 (V17-D4): your Gitemon's silhouette where something stands in front of it — the same shape in a
   * flat light colour, drawn after the world and before your Gitemon, only where the world is nearer
   * (so its own legs never show through its body). Opaque, so it sorts with the world by renderOrder.
   */
  private ghost = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: '#ffe9a8',
      depthWrite: false,
      depthFunc: THREE.GreaterDepth,
      // a ground bump at its feet is not "in front": the world must be clearly nearer
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      fog: false,
    }),
  );
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    private crowd: Crowd,
    /** at most this many bodies at once (phone 16, desktop 32) */
    private cap: number,
  ) {
    this.ghost.renderOrder = 10;
    this.ghost.frustumCulled = false;
  }

  private shape(key: string): Shape | null {
    if (this.shapes.has(key)) return this.shapes.get(key)!;
    const sp = speciesPixels(key);
    if (!sp) {
      this.shapes.set(key, null);
      return null;
    }
    const mask = new Uint8Array(sp.w * sp.h);
    for (let i = 0; i < mask.length; i++) mask[i] = sp.rgba[i * 4 + 3]! > 0 ? 1 : 0;
    const v = voxelize(mask, sp.w, sp.h, {
      maxDepth: Math.max(1, Math.round(DEPTH * Math.max(sp.w, sp.h))),
      step: 2,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(v.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(v.normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(v.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(v.indices, 1));
    geo.computeBoundingSphere();
    const s = { geo, fit: sp.fit };
    this.shapes.set(key, s);
    return s;
  }

  /** the creature's own colours, baked: its markings in its second type's colour and its tint (V16-D5) */
  private texture(i: number, key: string): THREE.Texture | null {
    const sp = speciesPixels(key);
    if (!sp) return null;
    const { tint, accent } = this.crowd.colourOf(i);
    const px = new Uint8ClampedArray(sp.rgba);
    for (let k = 0; k < px.length; k += 4) {
      const a = px[k + 3]!;
      if (!a) continue;
      let r = px[k]! / 255;
      let g = px[k + 1]! / 255;
      let b = px[k + 2]! / 255;
      // the same recolour as the crowd shader: marking pixels (alpha ~0.75) take the accent hue,
      // keeping their light and shade
      if (a < 230 && accent[2] > 0.5)
        [r, g, b] = hsl(accent[0], accent[1], (Math.max(r, g, b) + Math.min(r, g, b)) / 2);
      px[k] = Math.round(Math.min(1, r * tint[0]) * 255);
      px[k + 1] = Math.round(Math.min(1, g * tint[1]) * 255);
      px[k + 2] = Math.round(Math.min(1, b * tint[2]) * 255);
      px[k + 3] = 255;
    }
    const c = document.createElement('canvas');
    c.width = sp.w;
    c.height = sp.h;
    c.getContext('2d')!.putImageData(new ImageData(px, sp.w, sp.h), 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private body(i: number): Body | null {
    const have = this.bodies.get(i);
    if (have) return have;
    const g = this.crowd.at(i).g;
    const key = spriteKey(g);
    const shape = this.shape(key);
    const map = shape ? this.texture(i, key) : null;
    if (!shape || !map) return null;
    const mat = new THREE.MeshLambertMaterial({ map });
    const mesh = new THREE.Mesh(shape.geo, mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = true;
    const b: Body = {
      mesh,
      mat,
      gait: gaitOf(g),
      phase: (hash32(`crowd:${g.id}`) % 6283) / 1000,
      fit: shape.fit,
      used: 0,
    };
    this.bodies.set(i, b);
    return b;
  }

  /**
   * Choose the near set: the creatures within `radius` of (fx, fz), nearest first, at most `cap`, the
   * player's own walker always (V16-D2). Sealed legends stay glowing silhouettes; statues stay statues.
   */
  private pick(time: number, fx: number, fz: number, radius: number, walker: number | null) {
    const c = this.crowd;
    const near: [number, number][] = [];
    const v = new THREE.Vector3();
    if (radius > 0)
      for (let i = 0; i < c.size; i++) {
        if (i === walker) continue;
        const g = c.at(i).g;
        if (specialAttr(g)[1] === 1 || c.modelled(i)) continue;
        c.positionOf(i, time, v);
        const d = Math.hypot(v.x - fx, v.z - fz);
        if (d < radius) near.push([d, i]);
      }
    near.sort((a, b) => a[0] - b[0]);
    const want = new Set<number>();
    if (!this.enabled) near.length = 0;
    else if (walker != null && !c.modelled(walker)) want.add(walker);
    for (const [, i] of near) {
      if (want.size >= this.cap) break;
      want.add(i);
    }
    for (const i of this.active)
      if (!want.has(i)) {
        const b = this.bodies.get(i);
        if (b) this.group.remove(b.mesh);
        c.setShown(i, true);
      }
    for (const i of want)
      if (!this.active.has(i)) {
        const b = this.body(i);
        if (!b) {
          want.delete(i);
          continue;
        }
        this.group.add(b.mesh);
        c.setShown(i, false);
      }
    this.active = want;
    // keep a few spare bodies for creatures that come back; drop the longest unused
    const now = performance.now();
    for (const i of want) this.bodies.get(i)!.used = now;
    if (this.bodies.size > this.cap * 2) {
      const idle = [...this.bodies]
        .filter(([i]) => !want.has(i))
        .sort((a, b) => a[1].used - b[1].used);
      for (const [i, b] of idle.slice(0, this.bodies.size - this.cap * 2)) {
        b.mat.map?.dispose();
        b.mat.dispose();
        this.bodies.delete(i);
      }
    }
  }

  /**
   * Every frame: choose the near set now and then, and stand every body where its sprite would be.
   * `focus` null = no blocks (the map is too far out); the walker keeps its body while walking.
   */
  update(
    time: number,
    right: THREE.Vector3,
    grow: number,
    upScale: number,
    focus: { x: number; z: number; radius: number } | null,
    walker: number | null,
    /** v17: draw this creature's silhouette through walls (your walker in the follow view) */
    seeThrough: number | null = null,
  ) {
    const now = performance.now();
    if (now - this.lastPick > PICK_MS) {
      this.lastPick = now;
      this.pick(time, focus?.x ?? 0, focus?.z ?? 0, focus?.radius ?? 0, walker);
    }
    for (const i of this.active) {
      const b = this.bodies.get(i);
      if (!b) continue;
      const m = this.crowd.motion(i, time, right);
      const size = this.crowd.heightOf(i, grow);
      const pose = gaitPose(b.gait, m.steps, m.moving, size, time, b.phase);
      const breath = (1 - m.moving) * (Math.sin(time * 1.8 + b.phase) * 0.5 + 0.5) * 0.03;
      // one drawing pixel in world units: the atlas cell (CELL px) spans `size` across
      const s = (b.fit * size) / CELL;
      const walks = m.dx !== 0 || m.dz !== 0;
      // sprites are drawn facing left; one that walks faces the way it goes (the shader's flip)
      const flip = walks ? -m.dir : 1;
      // its drawn side stays toward the camera, turned toward the way it walks (V16-D3)
      let [ax, az] = walks
        ? paperTurn(right.x, right.z, m.dx, m.dz, m.dir, PAPER_MAX, 1)
        : [right.x, right.z];
      if (!walks) {
        const t = IDLE_TURN * flip;
        [ax, az] = [ax * Math.cos(t) - az * Math.sin(t), ax * Math.sin(t) + az * Math.cos(t)];
      }
      const yaw = Math.atan2(-az, ax);
      // the shader shears by lean (per unit of height) toward the way it walks, then rolls
      const tilt = pose.roll - Math.atan(pose.lean * m.dir) + pose.sway * Math.sin(time * 6) * 0.5;
      this.tmpE.set(0, yaw, tilt, 'YXZ');
      b.mesh.quaternion.copy(this.tmpQ.setFromEuler(this.tmpE));
      b.mesh.scale.set(flip * pose.sx * s, pose.sy * (1 + breath) * s * upScale, s);
      b.mesh.position.set(m.x, m.y + pose.lift, m.z);
      b.mesh.renderOrder = i === seeThrough ? 11 : 0;
    }
    // v17 (V17-D4): the silhouette follows its body exactly
    const g =
      seeThrough != null && this.active.has(seeThrough) ? this.bodies.get(seeThrough) : null;
    if (g) {
      this.ghost.geometry = g.mesh.geometry;
      this.ghost.position.copy(g.mesh.position);
      this.ghost.quaternion.copy(g.mesh.quaternion);
      this.ghost.scale.copy(g.mesh.scale);
      if (!this.ghost.parent) this.group.add(this.ghost);
    } else if (this.ghost.parent) this.group.remove(this.ghost);
  }

  /** the crowd indices standing as blocks right now (tests, ?debug) */
  get standing(): number[] {
    return [...this.active];
  }

  dispose() {
    this.group.remove(this.ghost);
    (this.ghost.material as THREE.Material).dispose();
    for (const i of this.active) this.crowd.setShown(i, true);
    for (const b of this.bodies.values()) {
      b.mat.map?.dispose();
      b.mat.dispose();
    }
    for (const s of this.shapes.values()) s?.geo.dispose();
    this.bodies.clear();
    this.shapes.clear();
    this.active.clear();
  }
}

/** hue 0…1, saturation, lightness → rgb 0…1 (the crowd shader's hsl2rgb) */
function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = [0, 4, 2].map((o) => Math.max(0, Math.min(1, Math.abs(((h * 6 + o) % 6) - 3) - 1)));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  return k.map((v) => l + c * (v - 0.5)) as [number, number, number];
}
