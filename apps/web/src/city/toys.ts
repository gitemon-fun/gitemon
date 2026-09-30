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

/** turns the model so its face looks along +Z (Meshy's front, set on the screenshot sheet) */
const FRONT_YAW = 0;

/**
 * The recolour, in the fragment shader: grey and white texels are multiplied by the body colour, the
 * saturated magenta gems take the gem colour with their own light and shade, and the dark eyes stay dark.
 */
function recolour(mat: THREE.MeshLambertMaterial, body: THREE.Color, gem: THREE.Color) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBody = { value: body };
    sh.uniforms.uGem = { value: gem };
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
        const src = normalise(gltf.scene);
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
function normalise(root: THREE.Object3D): Src | null {
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
  geo.rotateY(FRONT_YAW);
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const h = Math.max(1e-3, b.max.y - b.min.y);
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  geo.scale(1 / h, 1 / h, 1 / h);
  geo.computeBoundingSphere();
  const mat = (
    Array.isArray(m.material) ? m.material[0] : m.material
  ) as THREE.MeshStandardMaterial;
  return { geo, map: mat?.map ?? null };
}
