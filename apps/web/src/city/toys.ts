import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { TYPE_INFO, type MapGitemon } from '@gitemon/shared';

/**
 * v18 3D creature line (GRANDPLAN v18). One Meshy model per form — the mascot as a kitten, a winged fox
 * and a horned three-tail fox — served as /models/toy-<form>.glb from the private art set. Every player
 * near the camera stands as the model of its form (V18-D1), coloured in code (V18-D2): the white body
 * takes the first type's light colour, the gems take the second type's colour. Without the art set the
 * v16 pixel blocks stay.
 */

export type Form = 1 | 2 | 3;
interface Src {
  geo: THREE.BufferGeometry;
  map: THREE.Texture | null;
}

/**
 * v18 build 06 (option 1, Dedi 2026-10-01): the legs swing in a trot with no skeleton. At load the four feet
 * are found (the vertices on the ground fall into four clusters), the model is turned so its body runs from
 * the back feet to the front feet along +Z — Meshy built the bodies 27–42° off the face's direction — and
 * every vertex in a leg's column below the hip gets that leg's pair (+1 / -1) and a weight (1 at the foot,
 * 0 at the hip) in `aLeg`. The vertex shader swings the two diagonal pairs against each other.
 */
/** the hip line per form, as a share of the height (side views: short kitten legs, long adult legs) */
const HIP: Record<Form, number> = { 1: 0.22, 2: 0.3, 3: 0.38 };
/** how far from a foot's centre (across the ground, share of height) a vertex still belongs to that leg */
const FOOT_R = 0.1;
/** the swing forward and back, and the lift of the foot that moves forward (share of height) */
const SWING = 0.11;
const LIFT = 0.05;

/**
 * The recolour, in the fragment shader: grey and white texels are multiplied by the body colour, the
 * saturated magenta gems take the gem colour with their own light and shade, and the dark eyes stay dark.
 */
function recolour(mat: THREE.MeshLambertMaterial, body: THREE.Color, gem: THREE.Color) {
  const walk: Walk = { uSteps: { value: 0 }, uMoving: { value: 0 } };
  mat.userData.walk = walk;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBody = { value: body };
    sh.uniforms.uGem = { value: gem };
    Object.assign(sh.uniforms, walk);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 aLeg;\nuniform float uSteps;\nuniform float uMoving;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // one step = one pair forward; the pair that moves forward lifts its feet
        float legPh = 3.14159265 * uSteps;
        transformed.z += uMoving * ${SWING.toFixed(3)} * sin( legPh ) * aLeg.x * aLeg.y;
        transformed.y += uMoving * ${LIFT.toFixed(3)} * max( 0.0, cos( legPh ) * aLeg.x ) * aLeg.y;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uBody;\nuniform vec3 uGem;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec3 c = texture2D( map, vMapUv ).rgb;
          float hi = max( c.r, max( c.g, c.b ) );
          float lo = min( c.r, min( c.g, c.b ) );
          float sat = hi > 0.001 ? ( hi - lo ) / hi : 0.0;
          // magenta: green is the lowest channel, the texel is clearly coloured, and red is strong —
          // the dark navy eyes have low red, so they stay dark
          float gem = smoothstep( 0.35, 0.6, sat ) * step( c.g, min( c.r, c.b ) + 0.02 )
            * smoothstep( 0.12, 0.25, c.r );
          float lum = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
          vec3 bodyC = c * uBody;
          vec3 gemC = uGem * clamp( lum * 2.6, 0.25, 1.4 );
          diffuseColor.rgb *= mix( bodyC, gemC, gem );
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'toy-recolour';
}

/** the leg swing's inputs, set every frame by the body that uses the material */
export interface Walk {
  uSteps: { value: number };
  uMoving: { value: number };
}

export class Toys {
  private src = new Map<Form, Src>();
  private loading: Promise<void> | null = null;
  /** true once at least one form arrived */
  ready = false;

  /** start the three downloads once; a missing art set leaves `ready` false (blocks stay) */
  load(): Promise<void> {
    if (this.loading) return this.loading;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    this.loading = Promise.all(
      ([1, 2, 3] as Form[]).map(async (f) => {
        const gltf = await loader.loadAsync(`/models/toy-${f}.glb`).catch(() => null);
        if (!gltf) return;
        const src = normalise(gltf.scene, f);
        if (!src) return;
        this.src.set(f, src);
        this.ready = true;
      }),
    ).then(() => undefined);
    return this.loading;
  }

  has(f: Form) {
    return this.src.has(f);
  }

  /** a body of form `f` in this creature's colours, standing on its base, 1 unit tall, facing +Z */
  make(f: Form, g: MapGitemon, shade: [number, number, number]): THREE.Mesh | null {
    const s = this.src.get(f);
    if (!s) return null;
    const t1 = TYPE_INFO[g.t1];
    const body = new THREE.Color(t1.colors[1]).multiply(new THREE.Color(...shade));
    const gem = new THREE.Color(g.t2 && g.t2 !== g.t1 ? TYPE_INFO[g.t2].colors[0] : t1.colors[0]);
    const mat = new THREE.MeshLambertMaterial({ map: s.map });
    recolour(mat, body, gem);
    const mesh = new THREE.Mesh(s.geo, mat);
    // like the v16 blocks: the crowd's blob shadow stays under it, so no shadow-map pass (budget, G4)
    mesh.receiveShadow = true;
    return mesh;
  }

  dispose() {
    for (const s of this.src.values()) {
      s.geo.dispose();
      s.map?.dispose();
    }
    this.src.clear();
  }
}

/** one geometry in model space: base on y = 0, centred, 1 unit tall, face along +Z */
function normalise(root: THREE.Object3D, form: Form): Src | null {
  root.updateMatrixWorld(true);
  let mesh: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
  });
  if (!mesh) return null;
  const m = mesh as THREE.Mesh;
  // meshopt stores positions and normals as small normalised integers: turn them into floats first,
  // or the transform below is clamped to -1…1 and the body is pulled into streaks
  const geo = m.geometry.clone();
  for (const name of ['position', 'normal']) {
    const a = geo.getAttribute(name);
    if (!a || a.array instanceof Float32Array) continue;
    const f = new Float32Array(a.count * 3);
    for (let k = 0; k < a.count; k++) f.set([a.getX(k), a.getY(k), a.getZ(k)], k * 3);
    geo.setAttribute(name, new THREE.BufferAttribute(f, 3));
  }
  geo.applyMatrix4(m.matrixWorld);
  const fit = () => {
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    const h = Math.max(1e-3, b.max.y - b.min.y);
    geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    geo.scale(1 / h, 1 / h, 1 / h);
  };
  fit();
  rigLegs(geo, form, fit);
  geo.computeBoundingSphere();
  const mat = (
    Array.isArray(m.material) ? m.material[0] : m.material
  ) as THREE.MeshStandardMaterial;
  return { geo, map: mat?.map ?? null };
}

/**
 * Find the four feet, turn the body onto +Z and write `aLeg` (see HIP). A model whose ground does not split
 * into four feet keeps its direction and gets no leg swing (aLeg all zero): it still walks the toy walk.
 */
function rigLegs(geo: THREE.BufferGeometry, form: Form, fit: () => void) {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const none = () =>
    geo.setAttribute('aLeg', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const ground: [number, number][] = [];
  for (let k = 0; k < n; k++) if (pos.getY(k) < 0.035) ground.push([pos.getX(k), pos.getZ(k)]);
  const feet = clusters(ground, 4);
  if (!feet) return none();
  // front = the two feet nearest +Z (the face's side); the body runs from the back pair to the front pair
  feet.sort((a, b) => a[1] - b[1]);
  const mid = (a: number[], b: number[]) => [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2];
  const back = mid(feet[0]!, feet[1]!);
  const front = mid(feet[2]!, feet[3]!);
  geo.rotateY(-Math.atan2(front[0]! - back[0]!, front[1]! - back[1]!));
  fit();
  // the feet again, in the turned and centred model
  const g2: [number, number][] = [];
  for (let k = 0; k < n; k++) if (pos.getY(k) < 0.035) g2.push([pos.getX(k), pos.getZ(k)]);
  const f2 = clusters(g2, 4);
  if (!f2) return none();
  f2.sort((a, b) => a[1] - b[1]);
  // diagonal pairs: back-left with front-right (+1), back-right with front-left (-1)
  const [b0, b1, f0, f1] = f2 as [number, number][];
  const [bl, br] = b0[0] < b1[0] ? [b0, b1] : [b1, b0];
  const [fl, fr] = f0[0] < f1[0] ? [f0, f1] : [f1, f0];
  const legs: [number, number, number][] = [
    [bl[0], bl[1], 1],
    [fr[0], fr[1], 1],
    [br[0], br[1], -1],
    [fl[0], fl[1], -1],
  ];
  const hip = HIP[form];
  const out = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const y = pos.getY(k);
    if (y >= hip) continue;
    let best = Infinity;
    let pair = 0;
    for (const [x, z, p] of legs) {
      const d = Math.hypot(pos.getX(k) - x, pos.getZ(k) - z);
      if (d < best) [best, pair] = [d, p];
    }
    if (best >= FOOT_R) continue;
    const t = Math.min(1, Math.max(0, (best - 0.6 * FOOT_R) / (0.4 * FOOT_R)));
    out[k * 2] = pair;
    out[k * 2 + 1] = Math.pow(1 - y / hip, 0.8) * (1 - t * t * (3 - 2 * t));
  }
  geo.setAttribute('aLeg', new THREE.BufferAttribute(out, 2));
}

/** k clusters of ground points (farthest-point start, then a few k-means rounds); null when too few points */
function clusters(pts: [number, number][], k: number): [number, number][] | null {
  if (pts.length < k * 2) return null;
  const c: [number, number][] = [pts[0]!];
  while (c.length < k) {
    let far = pts[0]!;
    let fd = -1;
    for (const p of pts) {
      const d = Math.min(...c.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
      if (d > fd) [far, fd] = [p, d];
    }
    c.push(far);
  }
  for (let r = 0; r < 8; r++) {
    const sum = c.map(() => [0, 0, 0]);
    for (const p of pts) {
      let bi = 0;
      let bd = Infinity;
      c.forEach((q, i) => {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (d < bd) [bd, bi] = [d, i];
      });
      sum[bi]![0]! += p[0];
      sum[bi]![1]! += p[1];
      sum[bi]![2]! += 1;
    }
    for (let i = 0; i < k; i++)
      if (sum[i]![2]) c[i] = [sum[i]![0]! / sum[i]![2]!, sum[i]![1]! / sum[i]![2]!];
  }
  return c;
}
