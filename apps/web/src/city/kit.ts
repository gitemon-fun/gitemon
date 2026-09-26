import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The building kit (GRANDPLAN v3 §4). Every part is one small geometry on a unit footprint (or in
 * metres, for add-ons), drawn as ONE instanced mesh for the whole city; the district palette arrives
 * as a per-instance colour that multiplies a baked grey (contact band + eave shade). So the number
 * of draw calls is the number of parts, not the number of districts or buildings.
 */

/** merge parts that may differ in indexing and attributes: position only, then re-derived */
function mg(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k);
    return n;
  });
  return mergeGeometries(clean)!;
}

/** grey vertex colours from a function of the vertex position (ambient occlusion, baked) */
function shade(geo: THREE.BufferGeometry, f: (x: number, y: number, z: number) => number) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.getAttribute('position');
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const v = f(p.getX(i), p.getY(i), p.getZ(i));
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}
const flatGrey = (geo: THREE.BufferGeometry, v = 1) => shade(geo, () => v);

/** a closed prism: `profile` is a polygon in the (z, y) plane, extruded along x from -0.5 to 0.5 */
function prismX(profile: [number, number][]): THREE.BufferGeometry {
  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    const [z0, y0] = profile[i]!;
    const [z1, y1] = profile[(i + 1) % n]!;
    tri([-0.5, y0, z0], [0.5, y1, z1], [0.5, y0, z0]);
    tri([-0.5, y0, z0], [-0.5, y1, z1], [0.5, y1, z1]);
  }
  // end caps (fan; profiles here are convex or star-shaped from their first vertex)
  for (let i = 1; i < n - 1; i++) {
    const [za, ya] = profile[0]!;
    const [zb, yb] = profile[i]!;
    const [zc, yc] = profile[i + 1]!;
    tri([0.5, ya, za], [0.5, yb, zb], [0.5, yc, zc]);
    tri([-0.5, ya, za], [-0.5, yc, zc], [-0.5, yb, zb]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

const eave = (x: number, y: number, z: number) => 0.78 + 0.22 * Math.min(1, y * 1.6) + 0 * x * z;

// ---- bodies + facade --------------------------------------------------------------------------------

/** unit body, base at y = 0: darker at the ground (contact band), full at the top */
const body = shade(new THREE.BoxGeometry(1, 1, 1, 1, 4, 1).translate(0, 0.5, 0), (_x, y) =>
  y < 0.001 ? 0.6 : Math.min(1, 0.86 + y * 0.6),
);

/** one storey of windows (n per face) on the front (+z) and back faces of a unit body */
function windowRow(n: number) {
  const parts: THREE.BufferGeometry[] = [];
  const pw = 0.56 / n;
  for (let i = 0; i < n; i++) {
    const x = -0.5 + (i + 0.5) / n;
    for (const z of [0.5, -0.5])
      parts.push(new THREE.BoxGeometry(pw, 0.42, 0.03).translate(x, 0.55, z));
  }
  return flatGrey(mg(parts));
}

// ---- roofs (unit footprint, base y = 0, height 1) -----------------------------------------------------

const gable = shade(
  prismX([
    [-0.5, 0],
    [0.5, 0],
    [0, 1],
  ]),
  eave,
);
const hip = shade(
  (() => {
    const v = (x: number, y: number, z: number) => [x, y, z];
    const A = v(-0.5, 0, 0.5),
      B = v(0.5, 0, 0.5),
      C = v(0.5, 0, -0.5),
      D = v(-0.5, 0, -0.5),
      E = v(-0.22, 1, 0),
      F = v(0.22, 1, 0);
    const t = [A, B, F, A, F, E, C, D, E, C, E, F, B, C, F, D, A, E, A, D, C, A, C, B].flat();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(t, 3));
    return g;
  })(),
  eave,
);
const flat = shade(
  mg([
    new THREE.BoxGeometry(1, 0.12, 1).translate(0, 0.06, 0),
    new THREE.BoxGeometry(1, 0.34, 0.06).translate(0, 0.17, 0.47),
    new THREE.BoxGeometry(1, 0.34, 0.06).translate(0, 0.17, -0.47),
    new THREE.BoxGeometry(0.06, 0.34, 1).translate(0.47, 0.17, 0),
    new THREE.BoxGeometry(0.06, 0.34, 1).translate(-0.47, 0.17, 0),
  ])!,
  (_x, y) => (y < 0.13 ? 0.85 : 1),
);
const lean = shade(
  prismX([
    [0.5, 0],
    [-0.5, 0],
    [-0.5, 1],
    [0.5, 0.35],
  ]),
  eave,
);
const mansard = shade(
  new THREE.CylinderGeometry(0.42, 0.707, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0),
  eave,
);
const tent = shade(
  new THREE.ConeGeometry(0.707, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0),
  eave,
);
const spire = shade(new THREE.ConeGeometry(0.5, 1, 8).translate(0, 0.5, 0), eave);
const dome = shade(
  mg([
    new THREE.CylinderGeometry(0.46, 0.5, 0.18, 12).translate(0, 0.09, 0),
    new THREE.SphereGeometry(0.46, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)
      .scale(1, 1.7, 1)
      .translate(0, 0.18, 0),
  ])!,
  eave,
);
const cap = shade(
  new THREE.SphereGeometry(0.62, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.5, 1),
  (_x, y) => 0.8 + 0.2 * Math.min(1, y * 2),
);
const vault = shade(
  new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, false, 0, Math.PI)
    .rotateZ(Math.PI / 2)
    .rotateX(Math.PI / 2)
    .scale(1, 2, 1),
  eave,
);
const saw = shade(
  prismX([
    [0.5, 0],
    [-0.5, 0],
    [-0.5, 1],
    [-0.17, 0.2],
    [-0.17, 1],
    [0.17, 0.2],
    [0.17, 1],
    [0.5, 0.2],
  ]),
  eave,
);

export type RoofId =
  | 'gable'
  | 'gableX'
  | 'hip'
  | 'flat'
  | 'lean'
  | 'mansard'
  | 'tent'
  | 'spire'
  | 'dome'
  | 'cap'
  | 'vault'
  | 'vaultX'
  | 'saw';

export const ROOFS: Record<RoofId, THREE.BufferGeometry> = {
  gable,
  gableX: gable.clone().rotateY(Math.PI / 2),
  hip,
  flat,
  lean,
  mansard,
  tent,
  spire,
  dome,
  cap,
  vault,
  vaultX: vault.clone().rotateY(Math.PI / 2),
  saw,
};
/** roofs that are round: they take a square footprint (min of width and depth) */
export const ROUND: ReadonlySet<RoofId> = new Set(['spire', 'dome', 'cap']);
/** roof height as a share of the building's width (flat roofs are a fixed 1 m) */
export const PITCH: Record<RoofId, number> = {
  gable: 0.55,
  gableX: 0.55,
  hip: 0.5,
  flat: 0,
  lean: 0.45,
  mansard: 0.45,
  tent: 0.7,
  spire: 1.5,
  dome: 0.7,
  cap: 0.55,
  vault: 0.5,
  vaultX: 0.5,
  saw: 0.35,
};

// ---- add-ons (metres) -------------------------------------------------------------------------------

export const PARTS = {
  body,
  win1: windowRow(1),
  win2: windowRow(2),
  win3: windowRow(3),
  door: flatGrey(new THREE.BoxGeometry(0.2, 0.7, 0.04).translate(0, 0.35, 0.5), 0.9),
  chimney: shade(new THREE.BoxGeometry(0.6, 1.8, 0.6).translate(0, 0.9, 0), (_x, y) =>
    y > 1.7 ? 0.7 : 1,
  ),
  awning: flatGrey(new THREE.BoxGeometry(1, 0.12, 1.1).rotateX(0.38).translate(0, 0, 0.5)),
  balcony: shade(
    mg([
      new THREE.BoxGeometry(1, 0.16, 0.9).translate(0, 0, 0.45),
      new THREE.BoxGeometry(1, 0.55, 0.06).translate(0, 0.35, 0.88),
      new THREE.BoxGeometry(0.06, 0.55, 0.9).translate(0.47, 0.35, 0.45),
      new THREE.BoxGeometry(0.06, 0.55, 0.9).translate(-0.47, 0.35, 0.45),
    ])!,
    (_x, y) => (y < 0.1 ? 0.75 : 1),
  ),
  flowers: shade(
    mg([
      new THREE.BoxGeometry(1, 0.26, 0.34).translate(0, 0.13, 0.17),
      new THREE.BoxGeometry(0.9, 0.2, 0.26).translate(0, 0.34, 0.17),
    ])!,
    (_x, y) => (y < 0.25 ? 0.55 : 1.05),
  ),
  dormer: shade(
    mg([
      new THREE.BoxGeometry(1.3, 1.1, 1.2).translate(0, 0.55, 0),
      prismX([
        [-0.6, 0],
        [0.6, 0],
        [0, 0.7],
      ])
        .rotateY(Math.PI / 2)
        .scale(1.2, 1, 1.5)
        .translate(0, 1.1, 0),
    ])!,
    eave,
  ),
  pole: flatGrey(new THREE.CylinderGeometry(0.12, 0.12, 5.5, 5).translate(0, 2.75, 0), 0.8),
  flag: flatGrey(new THREE.BoxGeometry(2.6, 1.5, 0.08).translate(1.35, 4.7, 0)),
} as const;
export type PartId = keyof typeof PARTS;

// ---- street furniture + district props (metres, base y = 0) ------------------------------------------

export const PROPS = {
  lampPost: flatGrey(new THREE.CylinderGeometry(0.09, 0.12, 3.4, 5).translate(0, 1.7, 0), 0.9),
  lampHead: flatGrey(new THREE.SphereGeometry(0.34, 6, 4).translate(0, 3.55, 0)),
  crystal: flatGrey(new THREE.OctahedronGeometry(0.42).scale(1, 1.8, 1).translate(0, 3.9, 0)),
  lantern: flatGrey(new THREE.BoxGeometry(0.42, 0.55, 0.42).translate(0, 3.45, 0)),
  trunk: flatGrey(new THREE.CylinderGeometry(0.22, 0.32, 1.6, 5).translate(0, 0.8, 0), 0.9),
  crown: shade(new THREE.IcosahedronGeometry(1.35, 0).translate(0, 2.7, 0), (_x, y) =>
    y < 2.4 ? 0.82 : 1,
  ),
  pine: shade(
    mg([
      new THREE.ConeGeometry(1.2, 2, 6).translate(0, 1.9, 0),
      new THREE.ConeGeometry(0.85, 1.6, 6).translate(0, 3, 0),
    ])!,
    (_x, y) => 0.8 + y * 0.06,
  ),
  bush: shade(
    new THREE.IcosahedronGeometry(0.75, 0).scale(1, 0.75, 1).translate(0, 0.5, 0),
    () => 0.95,
  ),
  tank: shade(
    mg([
      new THREE.CylinderGeometry(0.9, 0.9, 1.6, 10).translate(0, 0.8, 0),
      new THREE.SphereGeometry(0.9, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.6, 0),
    ])!,
    (_x, y) => (y < 0.1 ? 0.7 : 1),
  ),
  buoy: flatGrey(new THREE.SphereGeometry(0.45, 8, 5).translate(0, 0.45, 0)),
  boulder: shade(
    new THREE.DodecahedronGeometry(0.8, 0).scale(1, 0.7, 1).translate(0, 0.45, 0),
    () => 0.95,
  ),
  bench: flatGrey(
    mg([
      new THREE.BoxGeometry(1.6, 0.12, 0.5).translate(0, 0.45, 0),
      new THREE.BoxGeometry(1.6, 0.5, 0.1).translate(0, 0.75, -0.22),
    ])!,
    0.85,
  ),
  fountain: shade(
    mg([
      new THREE.CylinderGeometry(1.5, 1.6, 0.5, 12).translate(0, 0.25, 0),
      new THREE.CylinderGeometry(0.25, 0.3, 1.2, 6).translate(0, 0.9, 0),
      new THREE.CylinderGeometry(0.7, 0.4, 0.25, 10).translate(0, 1.5, 0),
    ])!,
    (_x, y) => (y < 0.05 ? 0.7 : 1),
  ),
  water: flatGrey(new THREE.CylinderGeometry(1.3, 1.3, 0.1, 12).translate(0, 0.46, 0)),
  stripe: flatGrey(new THREE.BoxGeometry(0.5, 0.04, 2.2).translate(0, 0.02, 0)),
} as const;
export type PropId = keyof typeof PROPS;

// ---- instance batching ---------------------------------------------------------------------------------

/** collects (geometry, matrix, colour) triples and emits one InstancedMesh per geometry */
export class Batch {
  private items = new Map<THREE.BufferGeometry, { m: THREE.Matrix4[]; c: THREE.Color[] }>();
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, colour: THREE.ColorRepresentation) {
    let e = this.items.get(geo);
    if (!e) this.items.set(geo, (e = { m: [], c: [] }));
    e.m.push(m.clone());
    e.c.push(new THREE.Color(colour));
  }
  meshes(material: THREE.Material, opts: { cast?: boolean; receive?: boolean } = {}) {
    const out: THREE.InstancedMesh[] = [];
    for (const [geo, e] of this.items) {
      const mesh = new THREE.InstancedMesh(geo, material, e.m.length);
      e.m.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, e.c[i]!);
      });
      mesh.castShadow = !!opts.cast;
      mesh.receiveShadow = !!opts.receive;
      mesh.computeBoundingSphere();
      out.push(mesh);
    }
    return out;
  }
}
