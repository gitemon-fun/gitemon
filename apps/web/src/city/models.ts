import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  PROP_H,
  SERVICES,
  STREET_OUT,
  TOWN_R,
  TOWN_Y,
  WATER_Y,
  gridHeight,
  hash32,
  townProps,
  type Island,
} from '@gitemon/shared';
import type { Placed } from './crowd';
import type { Home } from './load';
import { plotHeight } from './town';

/**
 * The 3D pieces (GRANDPLAN v8 §0 V8-D1, D3, D8; build file 05). Sculpted models from the private
 * art set, served as /models/<key>.glb (scripts/models.sh). They load after the first view, and the
 * code-built pieces stay until they arrive — or for good, when the art set is absent.
 *
 *   the top 10 legends (a sealed one is a stone statue, a woken one is alive) · the monument ·
 *   one landmark per mini plaza · a giant wonder per region + a floating shrine near the town ·
 *   a gate at every town gate · two set pieces per region, away from the groups and the roads ·
 *   v9: the guild halls, Merit Houses and Town Services · v14.1: the KayKit street props (CC0)
 */

type Key = string;

/** world height (m) each piece is scaled to; the models arrive about 1.9 units tall */
const HEIGHT: Record<string, number> = {
  origin: 8,
  guardian: 5.6,
  legend: 4.2,
  monument: 24,
  gate: 7,
  landmark: 13,
  set: 7,
  'wonder-frost': 40,
  'wonder-marsh': 32,
  'wonder-bloom': 30,
  'wonder-tide': 24,
  'wonder-jungle': 42,
  'wonder-volcano': 20,
  'wonder-canyon': 22,
  'wonder-crystal': 20,
  'wonder-savanna': 30,
  'wonder-town': 16,
};

const STONE = new THREE.MeshStandardMaterial({ color: '#a8a39a', roughness: 0.95, metalness: 0 });
// v14.1: sealed stone keeps its grey — the sky's environment light would turn it to pale marble
STONE.userData.noEnv = true;

export interface Pieces {
  group: THREE.Group;
  /** legends whose sprite the model replaces (crowd index) */
  replaced: number[];
  /** the Origin floats: bobbed every frame */
  bob: { obj: THREE.Object3D; y: number }[];
  landmarks: boolean;
  monument: boolean;
  /** v9: the town's buildings arrived (the placeholder boxes can go) */
  town: boolean;
  /** v11 (V11-D7): ground footprints of the solid pieces (wonders, set pieces, legend statues) */
  /** r = the inner base that blocks walking; top = its height (v13.2: the walk view's camera stops at it) */
  solids: { x: number; z: number; r: number; top: number }[];
  /** v14.1 (V14-D15): the street props — small, so the renderer hides them at far zoom */
  props: THREE.Object3D | null;
}

const cache = new Map<Key, Promise<THREE.Group | null>>();
function load(loader: GLTFLoader, key: Key): Promise<THREE.Group | null> {
  let p = cache.get(key);
  if (!p) {
    p = loader
      .loadAsync(`/models/${key}.glb`)
      .then((g) => {
        g.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.castShadow = m.receiveShadow = true;
        });
        return g.scene;
      })
      .catch(() => null);
    cache.set(key, p);
  }
  return p;
}

/**
 * a copy of a model, standing on its base, scaled to `h` metres (and no wider than `maxW` across its
 * footprint, so a wide manor cannot spill onto its neighbour), facing `yaw` (front = +Z)
 */
function place(
  src: THREE.Group,
  h: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  maxW = Infinity,
) {
  const o = src.clone(true);
  const box = new THREE.Box3().setFromObject(o);
  const size = box.getSize(new THREE.Vector3());
  const s = Math.min(h / Math.max(0.001, size.y), maxW / Math.max(0.001, size.x, size.z));
  o.scale.setScalar(s);
  o.position.set(x, y - box.min.y * s, z);
  o.rotation.y = yaw;
  return o;
}

/**
 * v11 (V11-D9): many placements of one model as InstancedMeshes — one draw per part instead of one
 * per copy. Each placement is [height, x, y, z, yaw, maxW], sized exactly as place() sizes a copy.
 */
function instanced(src: THREE.Group, list: [number, number, number, number, number, number][]) {
  const out = new THREE.Group();
  src.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(src);
  const size = box.getSize(new THREE.Vector3());
  const at = list.map(([h, x, y, z, yaw, maxW]) => {
    const s = Math.min(h / Math.max(0.001, size.y), maxW / Math.max(0.001, size.x, size.z));
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x, y - box.min.y * s, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      new THREE.Vector3(s, s, s),
    );
  });
  const rootInv = new THREE.Matrix4().copy(src.matrixWorld).invert();
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const local = new THREE.Matrix4().multiplyMatrices(rootInv, m.matrixWorld);
    const inst = new THREE.InstancedMesh(m.geometry, m.material, at.length);
    at.forEach((mat, i) => inst.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(mat, local)));
    inst.castShadow = inst.receiveShadow = true;
    inst.computeBoundingSphere();
    out.add(inst);
  });
  return out;
}

const facing = (x: number, z: number) => Math.atan2(x, z); // outward from the centre
const rnd = (seed: string) => (hash32(seed) >>> 0) / 4294967296;

/** where the land meets the sea along an angle (walks out along the height grid) */
function coastAt(isl: Island, a: number) {
  for (let r = TOWN_R + 20; r < isl.radius + 30; r += 3)
    if (gridHeight(isl.grid, Math.cos(a) * r, Math.sin(a) * r) < WATER_Y) return r;
  return isl.radius;
}

/**
 * Open ground for a big piece: far from every wild group and every road, not in water, not on a
 * cliff. Deterministic (the island is), so every viewer sees the same world.
 */
function openSpot(
  isl: Island,
  region: number,
  rMin: number,
  rMax: number,
  taken: [number, number][],
  clear: number,
  salt: string,
) {
  const g = isl.regions[region]!;
  const hab = isl.habitats;
  const road = isl.roads[region] ?? [];
  let best: [number, number, number] | null = null;
  for (let k = 0; k < 90; k++) {
    const a = g.a0 + (g.a1 - g.a0) * (0.15 + 0.7 * rnd(`${salt}a${k}`));
    const r = rMin + (rMax - rMin) * rnd(`${salt}r${k}`);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = gridHeight(isl.grid, x, z);
    if (y < WATER_Y + 0.5) continue;
    const e = 3;
    const sl =
      Math.hypot(
        gridHeight(isl.grid, x + e, z) - gridHeight(isl.grid, x - e, z),
        gridHeight(isl.grid, x, z + e) - gridHeight(isl.grid, x, z - e),
      ) /
      (2 * e);
    if (sl > 0.7) continue;
    let d = Infinity;
    for (const h of hab) d = Math.min(d, Math.hypot(h.x - x, h.z - z) - 8);
    for (const [px, pz] of road) d = Math.min(d, Math.hypot(px - x, pz - z));
    for (const [tx, tz] of taken) d = Math.min(d, Math.hypot(tx - x, tz - z) - clear);
    if (!best || d > best[2]) best = [x, z, d];
  }
  return best && best[2] > 4 ? best : null;
}

export async function loadPieces(
  isl: Island,
  placed: Placed[],
  homes: Map<number, Home> = new Map(),
): Promise<Pieces | null> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  // no art set here (a fresh clone): keep the code-built world
  const probe = await fetch('/models/monument.glb', { method: 'HEAD' }).catch(() => null);
  if (!probe?.ok) return null;

  const group = new THREE.Group();
  const out: Pieces = {
    group,
    replaced: [],
    bob: [],
    landmarks: false,
    monument: false,
    town: false,
    solids: [],
    props: null,
  };
  const jobs: Promise<void>[] = [];
  const put = (
    key: Key,
    h: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    then?: (o: THREE.Object3D) => void,
    maxW = Infinity,
    solid = false,
  ) =>
    jobs.push(
      load(loader, key).then((src) => {
        if (!src) return;
        const o = place(src, h, x, y, z, yaw, maxW);
        group.add(o);
        then?.(o);
        // v11 (V11-D7): a solid piece blocks walking over the inner part of its base
        if (solid) {
          const b = new THREE.Box3().setFromObject(o);
          const r = 0.55 * Math.min(b.max.x - b.min.x, b.max.z - b.min.z) * 0.5;
          out.solids.push({
            x: (b.min.x + b.max.x) / 2,
            z: (b.min.z + b.max.z) / 2,
            r: Math.max(0.9, r),
            top: b.max.y,
          });
        }
      }),
    );

  // ---- the top 10 legends (V8-D1): the model belongs to the rank; sealed = stone (V8-D3) ----
  placed.forEach((p, i) => {
    const sp = p.g.special;
    if (!sp || sp.rank > 10) return;
    const key =
      sp.rank === 1
        ? 'origin'
        : sp.rank === 2
          ? 'guardian-a'
          : sp.rank === 3
            ? 'guardian-b'
            : `legend-${sp.rank}`;
    const h = sp.rank === 1 ? HEIGHT.origin! : sp.rank <= 3 ? HEIGHT.guardian! : HEIGHT.legend!;
    // the Origin faces the opening view; the others look out over the plaza
    const yaw = sp.rank === 1 ? Math.PI / 4 : facing(p.spot.x, p.spot.z);
    put(
      key,
      h,
      p.spot.x,
      p.spot.y,
      p.spot.z,
      yaw,
      (o) => {
        if (sp.sealed)
          o.traverse((m) => {
            if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).material = STONE;
          });
        else if (sp.rank === 1)
          o.traverse((m) => {
            const mat = (m as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
            if (mat?.isMeshStandardMaterial) {
              mat.emissive = new THREE.Color('#ffcf5a');
              mat.emissiveIntensity = 0.28;
            }
          });
        if (sp.rank === 1) out.bob.push({ obj: o, y: o.position.y });
        out.replaced.push(i);
      },
      Infinity,
      sp.rank > 3,
    );
  });

  // ---- the monument and the landmarks (replace the code-built ones once they arrive) ----
  put('monument', HEIGHT.monument!, 0, TOWN_Y, 0, Math.PI / 4, () => (out.monument = true));
  // v9 (V9-D6): each mini plaza's centrepiece is its region's set piece; the landmarks moved into
  // town as the guild halls
  for (const l of isl.landmarks) {
    const climate = isl.regions[l.region]!.climate;
    put(
      `set-${climate}`,
      9,
      l.x,
      l.y - 0.2,
      l.z,
      facing(-l.x, -l.z),
      () => (out.landmarks = true),
      9,
      true,
    );
  }

  // ---- v9 the town: guild halls, Merit Houses by their holder's band, the six services ----
  // v11 (V11-D9): the 27 Merit Houses share 3 models, so each model is drawn once, instanced
  const houses = new Map<Key, [number, number, number, number, number, number][]>();
  isl.town.forEach((p, k) => {
    const band = homes.get(k)?.band ?? 0;
    const key =
      p.kind === 'hall'
        ? `lm-${isl.regions[p.region]!.climate}`
        : p.kind === 'service'
          ? `svc-${SERVICES[p.slot]!}`
          : `house-${band + 1}`;
    const h = plotHeight(p.kind, band);
    if (p.kind === 'house') {
      const list = houses.get(key as Key) ?? [];
      list.push([h, p.x, p.y, p.z, Math.atan2(p.fx, p.fz), p.w + 0.6]);
      houses.set(key as Key, list);
      return;
    }
    put(
      key,
      h,
      p.x,
      p.y,
      p.z,
      Math.atan2(p.fx, p.fz),
      () => (out.town = true),
      p.w + (p.kind === 'hall' ? 1.5 : 0.6),
    );
  });
  for (const [key, list] of houses)
    jobs.push(
      load(loader, key).then((src) => {
        if (!src) return;
        group.add(instanced(src, list));
        out.town = true;
      }),
    );

  // ---- gates: one at every region's gate in the town wall, facing out ----
  for (const g of isl.regions) {
    const r = TOWN_R - 0.8;
    put(
      'gate',
      HEIGHT.gate!,
      Math.cos(g.mid) * r,
      TOWN_Y,
      Math.sin(g.mid) * r,
      facing(Math.cos(g.mid), Math.sin(g.mid)),
    );
  }

  // ---- the wonders (V8-D8): one giant per region, seen from the town ----
  const taken: [number, number][] = isl.landmarks.map((l) => [l.x, l.z]);
  isl.regions.forEach((g, i) => {
    const key = `wonder-${g.climate}`;
    const coast = coastAt(isl, g.mid);
    let spot: [number, number, number] | null;
    if (g.climate === 'volcano') {
      // at the foot of the cone, on the town side
      const d = Math.hypot(isl.volcano.x, isl.volcano.z);
      const k = (d - 58) / d;
      spot = [isl.volcano.x * k, isl.volcano.z * k, 0];
    } else if (g.climate === 'tide' || g.climate === 'bloom') {
      // on the shore: the arch stands in the shallows, the blossom tree on the cliff edge
      const r = coast - (g.climate === 'tide' ? 6 : 16);
      spot = [Math.cos(g.mid + 0.05) * r, Math.sin(g.mid + 0.05) * r, 0];
    } else {
      spot = openSpot(isl, i, TOWN_R + 70, coast - 30, taken, 40, key);
    }
    if (!spot) return;
    const [x, z] = spot;
    const y = Math.max(WATER_Y - 0.6, gridHeight(isl.grid, x, z)) - 0.4;
    taken.push([x, z]);
    // wonders face the town, so the side that reads (the geode's opening, the arch) is seen from it
    put(key, HEIGHT[key]!, x, y, z, facing(-x, -z), undefined, Infinity, true);
  });
  // the floating shrine: over the back of the town, off the plaza axis, so it never hides the Origin
  {
    const a = Math.PI / 4 + Math.PI + 0.5;
    const r = STREET_OUT - 6;
    put(
      'wonder-town',
      HEIGHT['wonder-town']!,
      Math.cos(a) * r,
      TOWN_Y + 36,
      Math.sin(a) * r,
      a,
      (o) => out.bob.push({ obj: o, y: o.position.y }),
    );
  }

  // ---- set pieces: two per region in open ground (the third is the mini plaza centrepiece) ----
  isl.regions.forEach((g, i) => {
    for (let k = 0; k < 2; k++) {
      const s = openSpot(isl, i, TOWN_R + 40, coastAt(isl, g.mid) - 18, taken, 22, `set${i}:${k}`);
      if (!s) continue;
      taken.push([s[0], s[1]]);
      put(
        `set-${g.climate}`,
        HEIGHT.set! * (0.85 + 0.3 * rnd(`sets${i}${k}`)),
        s[0],
        gridHeight(isl.grid, s[0], s[1]) - 0.2,
        s[1],
        rnd(`setyaw${i}${k}`) * Math.PI * 2,
        undefined,
        Infinity,
        true,
      );
    }
  });

  // ---- v14.1 (V14-D15): street props — one file, a scene per prop, each prop drawn instanced ----
  jobs.push(
    loader
      .loadAsync('/models/props.glb')
      .then((g) => {
        const byKey = new Map<string, [number, number, number, number, number, number][]>();
        for (const p of townProps(isl)) {
          const list = byKey.get(p.key) ?? [];
          list.push([PROP_H[p.key], p.x, p.y, p.z, p.yaw, Infinity]);
          byKey.set(p.key, list);
        }
        const props = new THREE.Group();
        for (const [key, list] of byKey) {
          const src = g.scenes.find((sc) => sc.name === key);
          if (src) props.add(instanced(src, list));
        }
        group.add(props);
        out.props = props;
      })
      .catch(() => undefined),
  );

  await Promise.all(jobs);
  return out;
}
