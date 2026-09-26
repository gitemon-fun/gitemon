import * as THREE from 'three';
import {
  COAST,
  TOWN_R,
  WATER_Y,
  gridHeight,
  gridRegion,
  hash32,
  type ClimateId,
  type Island,
} from '@gitemon/shared';
import { Batch, flatGrey, mg, shade } from './kit';

/**
 * The land (GRANDPLAN v4 §5, §6): one flat-shaded terrain mesh coloured by climate, height and
 * slope; the water plane (sea, rivers, lakes and the canal are wherever the land dips below it);
 * dirt roads draped on the land; and props that follow the land — never scattered uniformly.
 */

const u = (a: number, b: number, s: number) => (hash32(`${a | 0}:${b | 0}:${s}`) % 10000) / 10000;

interface Palette {
  low: string;
  high: string;
  rock: string;
  shore: string;
}
const LAND: Record<ClimateId, Palette> = {
  frost: { low: '#e9eff5', high: '#ffffff', rock: '#9aa6b4', shore: '#dfe7ee' },
  marsh: { low: '#7f8c68', high: '#8e9a74', rock: '#6f6a70', shore: '#8a8a70' },
  bloom: { low: '#9fc872', high: '#b4d484', rock: '#b8a890', shore: '#b8a890' },
  tide: { low: '#b4d088', high: '#c4d898', rock: '#b8ac94', shore: '#eedfb2' },
  jungle: { low: '#4f9440', high: '#3f7f36', rock: '#6f7a58', shore: '#e6d8a8' },
  volcano: { low: '#5a5054', high: '#46404a', rock: '#3a3538', shore: '#3f3a3e' },
  canyon: { low: '#dc8c5e', high: '#c4683f', rock: '#b85a3a', shore: '#e8b080' },
  crystal: { low: '#e4dcf2', high: '#d6ccec', rock: '#b8aed4', shore: '#eee8f4' },
  savanna: { low: '#d8c27a', high: '#c8b468', rock: '#a8906a', shore: '#e8d8a8' },
};
const TOWN_GROUND = '#e6dece';
const SEA_FLOOR = '#7fb8c4';

// ---- terrain -----------------------------------------------------------------------------------

export function terrain(isl: Island): THREE.Mesh {
  // the layout already sampled the land: reuse its grid (no height-field calls here)
  const { E, N, cell, h: H, region: C } = isl.grid;
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const tri = (ks: number[], xs: number[], zs: number[]) => {
    const ys = ks.map((k) => H[k]!);
    // flat colour per triangle: climate of its first corner, height, slope of the face
    const e1 = new THREE.Vector3(xs[1]! - xs[0]!, ys[1]! - ys[0]!, zs[1]! - zs[0]!);
    const e2 = new THREE.Vector3(xs[2]! - xs[0]!, ys[2]! - ys[0]!, zs[2]! - zs[0]!);
    const n = e1.cross(e2).normalize();
    const steep = 1 - Math.abs(n.y);
    const y = (ys[0]! + ys[1]! + ys[2]!) / 3;
    const cx = (xs[0]! + xs[1]! + xs[2]!) / 3;
    const cz = (zs[0]! + zs[1]! + zs[2]!) / 3;
    const reg = C[ks[0]!]!;
    if (y < WATER_Y - 0.05) c.set(SEA_FLOOR);
    else if (reg === -1) c.set(Math.hypot(cx, cz) > TOWN_R - 5 ? '#a8c880' : TOWN_GROUND);
    else if (reg === -2) c.set(LAND.tide.shore);
    else {
      const climate = isl.regions[reg]!.climate;
      const p = LAND[climate];
      const r = Math.hypot(cx, cz);
      if (steep > 0.45) c.set(p.rock);
      else if (y < 1.1 && r > COAST - 40) c.set(p.shore);
      else {
        c.set(p.low).lerp(new THREE.Color(p.high), Math.min(1, y / 18));
        // climate details: heather in the marsh, frozen lakes, striped canyon walls, dry patches
        if (climate === 'marsh' && u(cx / 9, cz / 9, 3) < 0.35) c.set('#9486b0');
        if (climate === 'frost' && y < 0.6) c.set('#c4e2f2');
        if (climate === 'canyon' && steep > 0.25)
          c.set(Math.floor(y / 2.2) % 2 ? '#c8683f' : '#e49a68');
        if (climate === 'savanna' && u(cx / 7, cz / 7, 5) < 0.3) c.set('#c2b060');
        if (climate === 'crystal' && u(cx / 6, cz / 6, 7) < 0.3) c.set('#cfe6f4');
      }
      if (steep > 0.2 && steep <= 0.45) c.lerp(new THREE.Color(p.rock), (steep - 0.2) * 2);
    }
    // a little lightness jitter per face keeps large areas from looking flat-filled
    c.offsetHSL(0, 0, (u(cx, cz, 9) - 0.5) * 0.04);
    for (let q = 0; q < 3; q++) {
      pos.push(xs[q]!, ys[q]!, zs[q]!);
      col.push(c.r, c.g, c.b);
    }
  };
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x0 = -E + i * cell;
      const z0 = -E + j * cell;
      const k00 = j * (N + 1) + i;
      const k10 = k00 + 1;
      const k01 = k00 + N + 1;
      const k11 = k01 + 1;
      if (Math.hypot(x0, z0) > E + 10) continue;
      tri([k00, k01, k10], [x0, x0, x0 + cell], [z0, z0 + cell, z0]);
      tri([k10, k01, k11], [x0 + cell, x0, x0 + cell], [z0, z0 + cell, z0 + cell]);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.receiveShadow = true;
  m.castShadow = true;
  return m;
}

export function water(isl: Island): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(isl.radius + 900, 96).rotateX(-Math.PI / 2).translate(0, WATER_Y, 0),
    new THREE.MeshLambertMaterial({ color: '#5cb6d8', transparent: true, opacity: 0.86 }),
  );
  m.receiveShadow = true;
  return m;
}

/** dirt roads draped on the land, one from each town gate */
export function roads(isl: Island): THREE.Mesh {
  const pos: number[] = [];
  const W = 1.7;
  for (const pts of isl.roads)
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i]!;
      const [x1, z1] = pts[i + 1]!;
      const dx = x1 - x0;
      const dz = z1 - z0;
      const l = Math.hypot(dx, dz);
      const nx = (-dz / l) * W;
      const nz = (dx / l) * W;
      const y = (x: number, z: number) =>
        Math.max(WATER_Y + 0.25, gridHeight(isl.grid, x, z)) + 0.12;
      const a = [x0 + nx, y(x0 + nx, z0 + nz), z0 + nz];
      const b = [x0 - nx, y(x0 - nx, z0 - nz), z0 - nz];
      const c = [x1 + nx, y(x1 + nx, z1 + nz), z1 + nz];
      const d = [x1 - nx, y(x1 - nx, z1 - nz), z1 - nz];
      pos.push(...a, ...c, ...b, ...b, ...c, ...d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(
    g,
    new THREE.MeshLambertMaterial({ color: '#cdb28a', side: THREE.DoubleSide }),
  );
  m.receiveShadow = true;
  return m;
}

// ---- props (v4 §6) ------------------------------------------------------------------------------

const cone = (r: number, h: number, seg: number, y = 0) =>
  new THREE.ConeGeometry(r, h, seg).translate(0, y + h / 2, 0);
const cyl = (r0: number, r1: number, h: number, seg: number, y = 0) =>
  new THREE.CylinderGeometry(r0, r1, h, seg).translate(0, y + h / 2, 0);
const blob = (r: number, x: number, y: number, z: number, d = 0) =>
  new THREE.IcosahedronGeometry(r, d).translate(x, y, z);

/** every prop is two parts at most — a stem and a crown — so each takes a trunk and a leaf colour */
const P = {
  pine: [
    cyl(0.2, 0.3, 1.2, 5),
    shade(mg([cone(1.3, 2.4, 6, 1), cone(0.9, 1.9, 6, 2.4)]), (_x, y) => 0.8 + y * 0.05),
  ],
  round: [cyl(0.22, 0.32, 1.6, 5), shade(blob(1.4, 0, 2.6, 0), (_x, y) => (y < 2.4 ? 0.82 : 1))],
  canopy: [
    cyl(0.35, 0.5, 3, 6),
    shade(
      mg([blob(2.1, 0, 3.8, 0), blob(1.5, 1.2, 3.4, 0.6), blob(1.4, -1.1, 3.5, -0.5)]),
      (_x, y) => (y < 3.2 ? 0.78 : 1),
    ),
  ],
  palm: [
    shade(
      new THREE.CylinderGeometry(0.14, 0.24, 4, 5).translate(0.25, 2, 0).rotateZ(-0.08),
      () => 0.9,
    ),
    shade(
      mg(
        [0, 1, 2, 3, 4].map((k) =>
          new THREE.BoxGeometry(2.2, 0.08, 0.55)
            .translate(1.1, 0, 0)
            .rotateZ(-0.35)
            .rotateY((k / 5) * Math.PI * 2)
            .translate(0.1, 4.1, 0),
        ),
      ),
      () => 1,
    ),
  ],
  acacia: [
    cyl(0.12, 0.2, 2.6, 5),
    shade(new THREE.CylinderGeometry(1.9, 1.5, 0.45, 8).translate(0, 2.8, 0), (_x, y) =>
      y < 2.7 ? 0.8 : 1,
    ),
  ],
  cactus: [
    shade(
      mg([
        cyl(0.3, 0.34, 2.4, 6),
        cyl(0.18, 0.2, 0.9, 5, 1).translate(0.45, 0, 0),
        cyl(0.16, 0.18, 0.7, 5, 1.3).translate(-0.42, 0, 0),
      ]),
      () => 1,
    ),
    null,
  ],
  bush: [null, shade(blob(0.8, 0, 0.55, 0).scale(1, 0.75, 1), () => 0.95)],
  rock: [
    null,
    shade(
      new THREE.DodecahedronGeometry(0.9, 0).scale(1, 0.65, 1).translate(0, 0.35, 0),
      () => 0.95,
    ),
  ],
  shard: [
    null,
    flatGrey(new THREE.OctahedronGeometry(0.6, 0).scale(0.8, 2.4, 0.8).translate(0, 1.2, 0)),
  ],
  crystal: [
    null,
    flatGrey(
      mg([
        new THREE.OctahedronGeometry(0.5, 0).scale(0.9, 3, 0.9).translate(0, 1.5, 0),
        new THREE.OctahedronGeometry(0.4, 0).scale(0.8, 2, 0.8).rotateZ(0.4).translate(0.5, 1, 0.2),
        new THREE.OctahedronGeometry(0.35, 0)
          .scale(0.8, 1.6, 0.8)
          .rotateZ(-0.5)
          .translate(-0.4, 0.8, -0.2),
      ]),
    ),
  ],
  rod: [cyl(0.06, 0.09, 4.2, 5), flatGrey(blob(0.35, 0, 4.4, 0))],
  reeds: [
    null,
    flatGrey(
      mg(
        [0, 1, 2, 3, 4, 5].map((k) =>
          cone(0.07, 1.4 + (k % 3) * 0.3, 4).translate(
            Math.cos(k * 1.3) * 0.4,
            0,
            Math.sin(k * 1.3) * 0.4,
          ),
        ),
      ),
    ),
  ],
  deadtree: [
    shade(
      mg([cyl(0.14, 0.25, 3, 5), cyl(0.06, 0.09, 1.3, 4).rotateZ(0.8).translate(0.4, 1.8, 0)]),
      () => 1,
    ),
    null,
  ],
  flowers: [
    null,
    flatGrey(
      mg(
        [0, 1, 2, 3, 4, 5, 6].map((k) =>
          blob(0.22, Math.cos(k * 2.4) * (0.3 + k * 0.1), 0.2, Math.sin(k * 2.4) * (0.3 + k * 0.1)),
        ),
      ),
    ),
  ],
  grass: [
    null,
    flatGrey(
      mg(
        [0, 1, 2, 3].map((k) =>
          cone(0.12, 0.9 + (k % 2) * 0.4, 4).translate(
            Math.cos(k * 1.7) * 0.3,
            0,
            Math.sin(k * 1.7) * 0.3,
          ),
        ),
      ),
    ),
  ],
  column: [
    flatGrey(mg([cyl(0.35, 0.4, 2.6, 8), new THREE.BoxGeometry(1, 0.3, 1).translate(0, 2.75, 0)])),
    null,
  ],
  lava: [
    null,
    flatGrey(new THREE.CircleGeometry(1.2, 7).rotateX(-Math.PI / 2).translate(0, 0.08, 0)),
  ],
} as const satisfies Record<
  string,
  readonly [THREE.BufferGeometry | null, THREE.BufferGeometry | null]
>;
type PropKey = keyof typeof P;

interface Rule {
  p: PropKey;
  /** chance per candidate cell */
  q: number;
  stem?: string;
  leaf?: string | string[];
  s?: [number, number];
  /** only where… */
  when?: (c: {
    y: number;
    slope: number;
    wet: boolean;
    coast: boolean;
    x: number;
    z: number;
  }) => boolean;
}
const DRESS: Record<ClimateId, Rule[]> = {
  frost: [
    {
      p: 'pine',
      q: 0.5,
      stem: '#6b5a4a',
      leaf: ['#5f8a6e', '#6f9a7a', '#4f7a60'],
      when: (c) => c.y < 16 && c.slope < 0.5,
    },
    { p: 'shard', q: 0.06, leaf: '#bfe2f4', s: [0.8, 1.8] },
    { p: 'rock', q: 0.05, leaf: '#b0bac6', when: (c) => c.slope > 0.3 },
  ],
  marsh: [
    { p: 'reeds', q: 0.5, leaf: '#8a9a5a', when: (c) => c.wet },
    { p: 'deadtree', q: 0.05, stem: '#4a4048' },
    { p: 'bush', q: 0.14, leaf: ['#7a6a9a', '#8a7aaa', '#6a7a58'] },
  ],
  bloom: [
    { p: 'flowers', q: 0.55, leaf: ['#f4a0c0', '#fff0a0', '#ffffff', '#c8a8f0', '#ffb88a'] },
    { p: 'round', q: 0.1, stem: '#6b4a3a', leaf: '#8ec060' },
    { p: 'rock', q: 0.03, leaf: '#c0b4a0', when: (c) => c.slope > 0.3 },
  ],
  tide: [
    { p: 'palm', q: 0.12, stem: '#9a7a54', leaf: '#6fae5a', when: (c) => c.coast },
    { p: 'grass', q: 0.12, leaf: '#9ab870' },
    { p: 'rock', q: 0.04, leaf: '#c8bca4', when: (c) => c.coast },
  ],
  jungle: [
    {
      p: 'canopy',
      q: 0.6,
      stem: '#5a4030',
      leaf: ['#3f8a34', '#4f9a3c', '#357a2c'],
      s: [0.8, 1.3],
    },
    { p: 'palm', q: 0.08, stem: '#8a6a44', leaf: '#4f9a44' },
    { p: 'bush', q: 0.25, leaf: '#2f6f2a' },
  ],
  volcano: [
    { p: 'rock', q: 0.12, leaf: '#2e2a2e', s: [0.8, 1.8] },
    { p: 'deadtree', q: 0.03, stem: '#2a2628' },
  ],
  canyon: [
    { p: 'cactus', q: 0.07, stem: '#6f9a54' },
    { p: 'bush', q: 0.06, leaf: '#b8a060' },
    { p: 'rock', q: 0.05, leaf: '#b86a44' },
  ],
  crystal: [
    { p: 'crystal', q: 0.1, leaf: ['#b8d0ff', '#e0c8ff', '#c8f0ff'], s: [0.8, 1.6] },
    { p: 'rod', q: 0.018, stem: '#8a8a94', leaf: '#fff080' },
  ],
  savanna: [
    { p: 'acacia', q: 0.08, stem: '#6b4a2e', leaf: '#8aa050', s: [0.9, 1.3] },
    { p: 'grass', q: 0.3, leaf: ['#d8c060', '#c8b050'] },
    { p: 'rock', q: 0.02, leaf: '#b0987a' },
  ],
};

export interface Dressing {
  props: THREE.InstancedMesh[];
  glow: THREE.InstancedMesh[];
}

export function dress(isl: Island, lit: THREE.Material, unlit: THREE.Material): Dressing {
  const b = new Batch();
  const g = new Batch();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const put = (
    batch: Batch,
    geo: THREE.BufferGeometry | null,
    x: number,
    y: number,
    z: number,
    s: number,
    rot: number,
    colour: string,
  ) => {
    if (!geo) return;
    q.setFromAxisAngle(up, rot);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
    batch.add(geo, m, colour);
  };

  // keep habitats, roads and the town clear: a coarse occupancy grid
  const CELL = 3;
  const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const blocked = new Set<string>();
  const block = (x: number, z: number, r: number) => {
    for (let dx = -r; dx <= r; dx += CELL)
      for (let dz = -r; dz <= r; dz += CELL) blocked.add(key(x + dx, z + dz));
  };
  for (const h of isl.habitats) block(h.x, h.z, 6);
  for (const pts of isl.roads) for (const [x, z] of pts) block(x, z, 4);
  for (const l of isl.landmarks) block(l.x, l.z, 6);

  const STEP = 3.4;
  const E = isl.radius;
  for (let x = -E; x <= E; x += STEP)
    for (let z = -E; z <= E; z += STEP) {
      const jx = x + (u(x, z, 1) - 0.5) * STEP;
      const jz = z + (u(x, z, 2) - 0.5) * STEP;
      if (Math.hypot(jx, jz) < TOWN_R + 3 || blocked.has(key(jx, jz))) continue;
      const reg = gridRegion(isl.grid, jx, jz);
      if (reg < 0) continue;
      const hq = (x: number, z: number) => gridHeight(isl.grid, x, z);
      const y = hq(jx, jz);
      if (y < WATER_Y + 0.3) continue;
      const e = 1.4;
      const slope =
        Math.hypot(hq(jx + e, jz) - hq(jx - e, jz), hq(jx, jz + e) - hq(jx, jz - e)) / (2 * e);
      if (slope > 1.1) continue;
      const wet =
        hq(jx + 3, jz) < WATER_Y ||
        hq(jx - 3, jz) < WATER_Y ||
        hq(jx, jz + 3) < WATER_Y ||
        hq(jx, jz - 3) < WATER_Y;
      const coast = Math.hypot(jx, jz) > COAST - 38;
      const ctx = { y, slope, wet, coast, x: jx, z: jz };
      const climate = isl.regions[reg]!.climate;
      let roll = u(jx * 7, jz * 7, 3);
      for (const r of DRESS[climate]) {
        if (r.when && !r.when(ctx)) continue;
        if (roll < r.q) {
          const [stem, leaf] = P[r.p];
          const [s0, s1] = r.s ?? [0.85, 1.2];
          const s = s0 + (s1 - s0) * u(jx, jz, 4);
          const rot = u(jx, jz, 5) * Math.PI * 2;
          const leafCol = Array.isArray(r.leaf)
            ? r.leaf[Math.floor(u(jx, jz, 6) * r.leaf.length)]!
            : (r.leaf ?? '#ffffff');
          const glowLeaf = r.p === 'rod';
          put(b, stem, jx, y, jz, s, rot, r.stem ?? '#6b4a2e');
          put(glowLeaf ? g : b, leaf, jx, y, jz, s, rot, leafCol);
          break;
        }
        roll -= r.q;
      }
    }

  // the volcano: glowing lava pools on its flanks and in the crater
  const { x: vx, z: vz } = isl.volcano;
  for (let k = 0; k < 46; k++) {
    const a = u(k, 1, 11) * Math.PI * 2;
    const d = 9 + u(k, 2, 11) * 46;
    const x = vx + Math.cos(a) * d;
    const z = vz + Math.sin(a) * d;
    if (isl.at(x, z)?.region !== isl.regions.findIndex((r) => r.climate === 'volcano')) continue;
    put(
      g,
      P.lava[1],
      x,
      isl.height(x, z),
      z,
      0.7 + u(k, 3, 11) * 1.4,
      a,
      k % 3 ? '#ff7a2a' : '#ffb040',
    );
  }
  put(g, P.lava[1], vx, isl.height(vx, vz) + 0.2, vz, 5, 0, '#ff8a30');

  return {
    props: b.meshes(lit, { cast: true, receive: true }),
    glow: g.meshes(unlit),
  };
}
