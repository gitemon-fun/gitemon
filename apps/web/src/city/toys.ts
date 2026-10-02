import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { art } from '@gitemon/art';
import {
  MARKS,
  STRIDE_TOY,
  TOY,
  TYPE_INFO,
  gaitPose,
  lookOf,
  lookPivots,
  piecesFor,
  type Life,
  type Look,
  type MapGitemon,
  type TypeId,
} from '@gitemon/shared';
import { buildPieces, type Anchors } from './pieces';
import { modelUrl, prefetched } from './assets';

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
  rig: Rig;
}
/** build 08: where the parts turn, per form (model space, height 1, front +Z) */
interface Rig {
  neck: THREE.Vector3;
  tailRoot: THREE.Vector3;
  earL: THREE.Vector3;
  earR: THREE.Vector3;
  /** z of the back feet, the middle of the body, the front feet */
  zs: THREE.Vector3;
  /** v19: the hip line, and where pieces sit */
  hip: number;
  anchors: Anchors;
  /** v19: the way the face looks, as a yaw off +Z (Meshy's heads look a little to the side of the body) */
  faceYaw: number;
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
/** a 3D body's height as a share of its sprite's height (the drawing has empty space round it) */
export const TOY_H = 0.8;
/**
 * the swing forward and back (share of height): build 08 ties it to the stride, so a foot on the ground moves
 * back as fast as the body moves forward and the feet seem to grip — over one step the swing covers 2 × SWING,
 * the body STRIDE_TOY / TOY_H
 */
const SWING = STRIDE_TOY / (2 * TOY_H);
/** the lift of the foot that moves forward (share of height) */
const LIFT = 0.05;
/**
 * v18 build 08 (V18-D13): the neck line per form, as a share of the height — above it, and in front of it,
 * is the head. The ears are the top points either side of the head's middle; a centre horn stays still.
 */
const NECK: Record<Form, number> = { 1: 0.46, 2: 0.5, 3: 0.55 };
/** how far the chest moves out along its normals when breathing (share of height) */
const BREATH = 0.012;
/** how far the rear sinks when sitting and the front when bowing (share of its height above the ground) */
const SIT = 0.42;
const BOW = 0.26;

/**
 * The recolour, in the fragment shader: grey and white texels are multiplied by the body colour, the
 * saturated magenta gems take the gem colour with their own light and shade, and the dark eyes stay dark.
 */
function recolour(
  mat: THREE.MeshLambertMaterial,
  body: THREE.Color,
  gem: THREE.Color,
  deep: THREE.Color,
  markC: THREE.Color,
  rig: Rig,
  look: Look,
) {
  // v19 (01): where the turning points end up once the look reshapes the body
  const v = (a: THREE.Vector3) => [a.x, a.y, a.z] as [number, number, number];
  const lp = lookPivots(look, {
    neck: v(rig.neck),
    tailRoot: v(rig.tailRoot),
    earL: v(rig.earL),
    earR: v(rig.earR),
    zs: v(rig.zs),
    hip: rig.hip,
  });
  const V3 = (a: [number, number, number]) => new THREE.Vector3(...a);
  const walk: Walk = {
    uSteps: { value: 0 },
    uMoving: { value: 0 },
    uHead: { value: new THREE.Vector2() },
    uTail: { value: 0 },
    uEar: { value: new THREE.Vector2() },
    uBreath: { value: 0 },
    uBlink: { value: 0 },
    uSit: { value: 0 },
    uBow: { value: 0 },
  };
  mat.userData.walk = walk;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBody = { value: body };
    sh.uniforms.uGem = { value: gem };
    sh.uniforms.uDeep = { value: deep };
    sh.uniforms.uMarkC = { value: markC };
    Object.assign(sh.uniforms, walk, {
      // the life turns use the reshaped points; the reshape itself uses the model's own
      uNeck: { value: V3(lp.neck) },
      uTailRoot: { value: V3(lp.tailRoot) },
      uEarL: { value: V3(lp.earL) },
      uEarR: { value: V3(lp.earR) },
      uZs: { value: V3(lp.zs) },
      uZs0: { value: rig.zs },
      uHip: { value: rig.hip },
      uNeckY: { value: rig.neck.y },
      uLift: { value: lp.lift },
      uNeckShift: { value: lp.neckShift },
      uLookA: { value: new THREE.Vector4(look.head, look.ear, look.tail, look.leg) },
      uLookB: {
        value: new THREE.Vector4(look.width, look.length, MARKS.indexOf(look.mark), look.markScale),
      },
    });
    // the same turns for the normals (beginnormal) and the positions (begin_vertex)
    const turns = (v: string, pivot: boolean) => {
      const at = (p: string, f: string) => (pivot ? `${p} + ${f}( ${v} - ${p}` : `${f}( ${v}`);
      return `
        ${v} = ${at('uTailRoot', 'tRotY')}, uTail * aPart.y );
        float earSide = sign( aPart.z );
        float earA = -earSide * ( earSide > 0.0 ? uEar.y : uEar.x ) * abs( aPart.z );
        vec3 earP = earSide > 0.0 ? uEarR : uEarL;
        ${v} = ${at('earP', 'tRotZ')}, earA );
        ${v} = ${at('uNeck', 'tRotY')}, uHead.x * aPart.x );
        ${v} = ${pivot ? `uNeck + tRotX( ${v} - uNeck` : `tRotX( ${v}`}, uHead.y * aPart.x );`;
    };
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 aLeg;
        attribute vec4 aPart;
        attribute float aAcc;
        uniform float uSteps, uMoving, uTail, uBreath, uSit, uBow, uHip, uLift, uNeckShift;
        uniform vec2 uHead, uEar;
        uniform vec3 uNeck, uTailRoot, uEarL, uEarR, uZs, uZs0;
        uniform vec4 uLookA, uLookB;
        varying vec3 vRest;
        varying float vHeadW;
        varying float vAcc;
        vec3 tRotX( vec3 v, float a ) { float c = cos( a ), s = sin( a ); return vec3( v.x, c * v.y - s * v.z, s * v.y + c * v.z ); }
        vec3 tRotY( vec3 v, float a ) { float c = cos( a ), s = sin( a ); return vec3( c * v.x + s * v.z, v.y, -s * v.x + c * v.z ); }
        vec3 tRotZ( vec3 v, float a ) { float c = cos( a ), s = sin( a ); return vec3( c * v.x - s * v.y, s * v.x + c * v.y, v.z ); }`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        {${turns('objectNormal', false)}
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRest = position;
        vHeadW = aPart.x;
        vAcc = aAcc;
        // v19 (01): the type's look reshapes the rest pose before any motion. Body length about the body's
        // middle (the head moves with the neck instead of stretching) and width; legs stretch below the hip
        // line and everything above it shifts; then the head grows about the neck, the ears about their
        // base, the tail about its root — the life turns below use the moved points (lookPivots).
        {
          float hW = aPart.x;
          float zL = uZs0.y + ( transformed.z - uZs0.y ) * uLookB.y;
          transformed.z = mix( zL, transformed.z + uNeckShift, hW );
          transformed.x *= mix( uLookB.x, 1.0, hW );
          transformed.y = transformed.y < uHip ? transformed.y * uLookA.w : transformed.y + uLift;
          transformed = uNeck + ( transformed - uNeck ) * mix( 1.0, uLookA.x, hW );
          vec3 eb = aPart.z > 0.0 ? uEarR : uEarL;
          transformed = eb + ( transformed - eb ) * mix( 1.0, uLookA.y, abs( aPart.z ) );
          transformed = uTailRoot + ( transformed - uTailRoot ) * mix( 1.0, uLookA.z, aPart.y );
        }
        // legs: one step = one pair forward; the pair that moves forward lifts its feet
        float legPh = 3.14159265 * uSteps;
        transformed.z += uMoving * ${SWING.toFixed(4)} * sin( legPh ) * aLeg.x * aLeg.y;
        transformed.y += uMoving * ${LIFT.toFixed(3)} * max( 0.0, cos( legPh ) * aLeg.x ) * aLeg.y;
        // chest breathing along its normals
        transformed += normal * ${BREATH.toFixed(4)} * uBreath * aPart.w;
        {${turns('transformed', true)}
        }
        // sit: the rear sinks toward the ground; bow: the front does
        // (smoothstep needs its edges in order: 1 − smoothstep gives the reversed ramp)
        float rear = 1.0 - smoothstep( uZs.x - 0.05, uZs.y, transformed.z );
        float front = smoothstep( uZs.y, uZs.z + 0.05, transformed.z );
        // the legs compress, and everything above the shoulder line moves down as one piece (the head keeps
        // its shape)
        transformed.y -= ( ${SIT.toFixed(2)} * uSit * rear + ${BOW.toFixed(2)} * uBow * front ) * min( transformed.y, 0.45 );`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uBody, uGem, uDeep, uMarkC;
        uniform float uBlink, uHip, uNeckY;
        uniform vec3 uZs0;
        uniform vec4 uLookB;
        varying vec3 vRest;
        varying float vHeadW;
        varying float vAcc;
        float tHash( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
        // v19 (01): the type's markings, from the rest position (so they stay on the body as it moves)
        float tMark( vec3 p ) {
          float kind = uLookB.z;
          float sc = uLookB.w;
          float body = ( 1.0 - vHeadW ) * smoothstep( uHip - 0.02, uHip + 0.06, p.y )
            * ( 1.0 - smoothstep( uNeckY - 0.04, uNeckY + 0.02, p.y ) );
          if ( kind < 0.5 ) return 0.0;
          if ( kind < 1.5 ) return body * step( 0.58, fract( p.z * 7.0 * sc ) );
          if ( kind < 2.5 ) {
            vec3 q = p * 9.0 * sc;
            vec3 c = floor( q );
            vec3 o = vec3( tHash( c ), tHash( c + 3.1 ), tHash( c + 7.7 ) ) * 0.5 + 0.25;
            float d = length( fract( q ) - o );
            return body * step( 0.45, tHash( c + 1.3 ) ) * ( 1.0 - smoothstep( 0.2, 0.27, d ) );
          }
          if ( kind < 3.5 )
            return body * smoothstep( uHip + 0.1, uHip + 0.17, p.y )
              * smoothstep( uZs0.x - 0.08, uZs0.x, p.z ) * ( 1.0 - smoothstep( uZs0.z, uZs0.z + 0.08, p.z ) );
          if ( kind < 4.5 ) return 1.0 - smoothstep( uHip * 0.45, uHip * 0.6, p.y );
          if ( kind < 5.5 ) return -vHeadW * smoothstep( uZs0.z, uZs0.z + 0.12, p.z );
          return -( 1.0 - vHeadW ) * ( 1.0 - smoothstep( uHip + 0.04, uHip + 0.12, p.y ) )
            * step( uHip * 0.8, p.y );
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec3 c = texture2D( map, vMapUv ).rgb;
          float hi = max( c.r, max( c.g, c.b ) );
          // build 08: a blink — the dark eye texels take the pale body for a moment
          c = mix( c, vec3( 0.88 ), uBlink * ( 1.0 - smoothstep( 0.2, 0.32, hi ) ) );
          hi = max( c.r, max( c.g, c.b ) );
          float lo = min( c.r, min( c.g, c.b ) );
          float sat = hi > 0.001 ? ( hi - lo ) / hi : 0.0;
          // magenta: green is the lowest channel, the texel is clearly coloured, and red is strong —
          // the dark navy eyes have low red, so they stay dark
          float gem = smoothstep( 0.35, 0.6, sat ) * step( c.g, min( c.r, c.b ) + 0.02 )
            * smoothstep( 0.12, 0.25, c.r );
          float lum = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
          vec3 bodyC = c * uBody;
          // markings: a deeper shade (positive) or a pale one (negative: mask, belly) on body texels only
          float mk = tMark( vRest ) * ( 1.0 - gem ) * smoothstep( 0.3, 0.45, hi );
          bodyC = mk > 0.0 ? mix( bodyC, c * uMarkC, mk * 0.9 ) : mix( bodyC, c * mix( uBody, vec3( 1.0 ), 0.75 ), -mk );
          vec3 gemC = uGem * clamp( lum * 2.6, 0.25, 1.4 );
          vec3 col = mix( bodyC, gemC, gem );
          // v19 (03): the pieces are flat colours, not the texture
          if ( vAcc > 0.5 )
            col = vAcc < 1.5 ? uGem : vAcc < 2.5 ? uDeep : vAcc < 3.5 ? uBody : vAcc < 4.5 ? vec3( 0.93, 0.88, 0.78 ) : uGem * 1.7;
          diffuseColor.rgb *= col;
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'toy-recolour-v19';
}

/** the motion's inputs, set every frame by the body that uses the material (applyLife) */
export interface Walk {
  uSteps: { value: number };
  uMoving: { value: number };
  /** head yaw, pitch */
  uHead: { value: THREE.Vector2 };
  uTail: { value: number };
  /** left, right ear flick */
  uEar: { value: THREE.Vector2 };
  uBreath: { value: number };
  uBlink: { value: number };
  uSit: { value: number };
  uBow: { value: number };
}

/**
 * build 08: stand a 3D body for one frame — the toy walk's pose plus what its life decided (lifeStep has
 * run). `size` = its sprite height in world units, `steps` the toy step phase. The game (blocky.ts) and the
 * clip recorder use this one function, so the clips show exactly what players see.
 */
export function applyLife(
  mesh: THREE.Mesh,
  L: Life,
  steps: number,
  size: number,
  at: { x: number; y: number; z: number },
  upScale = 1,
  time = 0,
) {
  const pose = gaitPose(TOY, steps, L.mov, size, time, L.phase);
  // sitting leans the body back a little, bowing forward
  const pitch = pose.lean + L.lean + 0.14 * L.bow - 0.24 * L.sit;
  mesh.rotation.set(pitch, L.face, pose.roll + L.roll, 'YXZ');
  const h = size * TOY_H;
  mesh.scale.set(pose.sx * h, pose.sy * (1 + L.squash) * h * upScale, pose.sx * h);
  mesh.position.set(at.x, at.y + pose.lift + L.lift * h, at.z);
  const w = (mesh.material as THREE.Material).userData.walk as Walk | undefined;
  if (!w) return;
  w.uSteps.value = steps;
  w.uMoving.value = L.mov;
  w.uHead.value.set(L.headYaw, L.headPitch);
  w.uTail.value = L.tail;
  w.uEar.value.set(L.earL, L.earR);
  w.uBreath.value = L.breath * (1 - 0.5 * L.mov);
  w.uBlink.value = Math.min(1, L.blink * 1.6);
  w.uSit.value = L.sit;
  w.uBow.value = L.bow;
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
        // v19 build 11: the bytes may already be on their way since the page started
        const early = prefetched(`toy-${f}`);
        const gltf = await (
          early
            ? early.then((b) => (b ? loader.parseAsync(b, '') : null))
            : loader.loadAsync(modelUrl(`toy-${f}`))
        ).catch(() => null);
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

  /** v19 (03): the model of a form with a type's pieces merged in, built once per form and type */
  private geos = new Map<string, THREE.BufferGeometry>();
  private geoFor(f: Form, t: TypeId, look: Look, s: Src): THREE.BufferGeometry {
    const key = `${f}:${t}`;
    const have = this.geos.get(key);
    if (have) return have;
    const pieces = buildPieces(piecesFor(look, f), s.rig.anchors, s.rig.faceYaw);
    let geo = s.geo;
    if (pieces) {
      pieces.setIndex([...Array(pieces.getAttribute('position').count).keys()]);
      const merged = mergeGeometries([s.geo, pieces]);
      if (!merged) console.warn(`toys: pieces for ${key} did not merge`);
      geo = merged ?? s.geo;
      geo.computeBoundingSphere();
    }
    this.geos.set(key, geo);
    return geo;
  }

  /** a body of form `f` in this creature's colours and its type's look, standing on its base, 1 unit tall, facing +Z */
  make(f: Form, g: MapGitemon, shade: [number, number, number]): THREE.Mesh | null {
    const s = this.src.get(f);
    if (!s) return null;
    const t1 = TYPE_INFO[g.t1];
    const look = lookOf(art.looks, g.t1);
    const body = new THREE.Color(t1.colors[1]).multiply(new THREE.Color(...shade));
    const gem = new THREE.Color(g.t2 && g.t2 !== g.t1 ? TYPE_INFO[g.t2].colors[0] : t1.colors[0]);
    const deep = new THREE.Color(t1.colors[0]);
    // markings: between the type's main and dark colours, so they read on the light body
    const markC = new THREE.Color(t1.colors[0]).lerp(new THREE.Color(t1.colors[2]), 0.5);
    const mat = new THREE.MeshLambertMaterial({ map: s.map });
    recolour(mat, body, gem, deep, markC, s.rig, look);
    const mesh = new THREE.Mesh(this.geoFor(f, g.t1, look, s), mat);
    // like the v16 blocks: the crowd's blob shadow stays under it, so no shadow-map pass (budget, G4)
    mesh.receiveShadow = true;
    return mesh;
  }

  dispose() {
    for (const [k, geo] of this.geos)
      if (geo !== this.src.get(Number(k[0]) as Form)?.geo) geo.dispose();
    this.geos.clear();
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
  // (v19: the uv too, so the pieces — plain floats — can be merged into the same geometry)
  for (const name of ['position', 'normal', 'uv']) {
    const a = geo.getAttribute(name);
    if (!a || (a.array instanceof Float32Array && !a.normalized)) continue;
    const n = a.itemSize;
    const f = new Float32Array(a.count * n);
    for (let k = 0; k < a.count; k++)
      f.set(n === 2 ? [a.getX(k), a.getY(k)] : [a.getX(k), a.getY(k), a.getZ(k)], k * n);
    geo.setAttribute(name, new THREE.BufferAttribute(f, n));
  }
  // only what the shader reads: extra attributes would stop the pieces merging
  for (const name of Object.keys(geo.attributes))
    if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
  geo.applyMatrix4(m.matrixWorld);
  const fit = () => {
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    const h = Math.max(1e-3, b.max.y - b.min.y);
    geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    geo.scale(1 / h, 1 / h, 1 / h);
  };
  fit();
  const feet = rigLegs(geo, form, fit);
  const rig = rigParts(geo, form, feet);
  // v19 (03): the body's own vertices carry no piece colour
  geo.setAttribute(
    'aAcc',
    new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count), 1),
  );
  geo.computeBoundingSphere();
  const mat = (
    Array.isArray(m.material) ? m.material[0] : m.material
  ) as THREE.MeshStandardMaterial;
  return { geo, map: mat?.map ?? null, rig };
}

/**
 * Find the four feet, turn the body onto +Z and write `aLeg` (see HIP). A model whose ground does not split
 * into four feet keeps its direction and gets no leg swing (aLeg all zero): it still walks the toy walk.
 */
function rigLegs(
  geo: THREE.BufferGeometry,
  form: Form,
  fit: () => void,
): { zb: number; zf: number; turn: number } | null {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const none = () => {
    geo.setAttribute('aLeg', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    return null;
  };
  const ground: [number, number][] = [];
  for (let k = 0; k < n; k++) if (pos.getY(k) < 0.035) ground.push([pos.getX(k), pos.getZ(k)]);
  const feet = clusters(ground, 4);
  if (!feet) return none();
  // front = the two feet nearest +Z (the face's side); the body runs from the back pair to the front pair
  feet.sort((a, b) => a[1] - b[1]);
  const mid = (a: number[], b: number[]) => [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2];
  const back = mid(feet[0]!, feet[1]!);
  const front = mid(feet[2]!, feet[3]!);
  const turn = Math.atan2(front[0]! - back[0]!, front[1]! - back[1]!);
  geo.rotateY(-turn);
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
  return { zb: (bl[1] + br[1]) / 2, zf: (fl[1] + fr[1]) / 2, turn };
}

/**
 * build 08: the parts that move on their own, as weights in `aPart` (head, tail, ear with its side as the
 * sign, chest) and the points they turn round. Found by position in the body-aligned model: the head is
 * above the neck line and in front of the neck; the ears are the top points either side of the head's
 * middle; the tail is behind the back feet and above the hip line; the chest lies between the feet, between
 * hip and neck. A model with no feet found gets fixed guesses from its box.
 */
function rigParts(
  geo: THREE.BufferGeometry,
  form: Form,
  feet: { zb: number; zf: number; turn: number } | null,
): Rig {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const zb = feet?.zb ?? -0.2;
  const zf = feet?.zf ?? 0.2;
  const hip = HIP[form];
  const neckY = NECK[form];
  const ss = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  // the head's top (ears, horn): the highest 5 % of the points
  const ys = Array.from({ length: n }, (_, k) => pos.getY(k)).sort((a, b) => b - a);
  const topY = ys[Math.floor(n * 0.05)] ?? 0.9;
  let tx = 0;
  let tz = 0;
  let tn = 0;
  for (let k = 0; k < n; k++)
    if (pos.getY(k) >= topY) {
      tx += pos.getX(k);
      tz += pos.getZ(k);
      tn++;
    }
  tx /= Math.max(1, tn);
  tz /= Math.max(1, tn);
  const neck = new THREE.Vector3(tx * 0.6, neckY, tz - 0.1);
  // ear bases: the top points left and right of the head's middle
  const ear = (side: number) => {
    let x = 0;
    let z = 0;
    let c = 0;
    for (let k = 0; k < n; k++)
      if (pos.getY(k) > 0.86 && (pos.getX(k) - tx) * side > 0.05) {
        x += pos.getX(k);
        z += pos.getZ(k);
        c++;
      }
    return c ? new THREE.Vector3(x / c, 0.8, z / c) : new THREE.Vector3(tx + side * 0.15, 0.8, tz);
  };
  const tailRoot = new THREE.Vector3(0, hip + 0.1, zb - 0.1);
  const out = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) {
    const x = pos.getX(k);
    const y = pos.getY(k);
    const z = pos.getZ(k);
    // a narrow blend at the neck, so the head turns as one piece and keeps its shape
    const head = ss(neckY - 0.03, neckY + 0.05, y) * ss(neck.z - 0.1, neck.z, z);
    // the tails reach further back than the crystal wings: start well behind the back feet
    const tail = ss(zb - 0.1, zb - 0.3, z) * ss(hip * 0.7, hip + 0.06, y);
    const earW = ss(0.8, 0.92, y) * ss(0.04, 0.08, Math.abs(x - tx));
    const chest =
      ss(hip, hip + 0.08, y) *
      (1 - ss(neckY - 0.02, neckY + 0.08, y)) *
      ss(zb, zb + 0.08, z) *
      (1 - ss(zf, zf + 0.1, z));
    out.set([head, tail, Math.sign(x - tx) * earW, chest], k * 4);
  }
  geo.setAttribute('aPart', new THREE.BufferAttribute(out, 4));

  // v19 (03): where pieces sit. The face looks where Meshy's front was before the body was turned onto +Z.
  const faceYaw = -(feet?.turn ?? 0);
  const face = new THREE.Vector3(Math.sin(faceYaw), 0, Math.cos(faceYaw));
  let crownY = neckY;
  let brow = new THREE.Vector3(tx, neckY + 0.2, tz + 0.1);
  let browD = -Infinity;
  for (let k = 0; k < n; k++) {
    if (out[k * 4]! < 0.9) continue;
    const x = pos.getX(k);
    const y = pos.getY(k);
    if (Math.abs(x - tx) < 0.05 && Math.abs(out[k * 4 + 2]!) < 0.05) crownY = Math.max(crownY, y);
  }
  const headMid = new THREE.Vector3(tx, (neckY + crownY) / 2, tz);
  const p = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    if (out[k * 4]! < 0.9) continue;
    p.set(pos.getX(k), pos.getY(k), pos.getZ(k));
    if (p.y < headMid.y + 0.04 || p.y > crownY - 0.06) continue;
    const d = p.clone().sub(headMid).dot(face);
    if (d > browD) [browD, brow] = [d, p.clone()];
  }
  // the shoulders: the body's half-width just behind the front legs, at the top of the body
  let half = 0.12;
  for (let k = 0; k < n; k++) {
    const y = pos.getY(k);
    if (out[k * 4]! > 0.1 || y < hip || y > neckY || Math.abs(pos.getZ(k) - zf) > 0.08) continue;
    half = Math.max(half, Math.abs(pos.getX(k)));
  }
  // the tail's tip: the tail point farthest from its root
  let tip = new THREE.Vector3(0, hip + 0.15, zb - 0.3);
  let tipD = -1;
  for (let k = 0; k < n; k++) {
    if (out[k * 4 + 1]! < 0.6) continue;
    p.set(pos.getX(k), pos.getY(k), pos.getZ(k));
    const d = p.distanceTo(tailRoot);
    if (d > tipD) [tipD, tip] = [d, p.clone()];
  }
  // the back: over the hips, behind the mascot's own crystals — the top of the body there (crystal tips that
  // rise above the neck line are not the body)
  let backY = hip + 0.1;
  for (let k = 0; k < n; k++) {
    const y = pos.getY(k);
    if (Math.abs(pos.getX(k)) > 0.05 || Math.abs(pos.getZ(k) - zb) > 0.05) continue;
    if (out[k * 4]! > 0.05 || out[k * 4 + 1]! > 0.3 || y > neckY + 0.02) continue;
    backY = Math.max(backY, y);
  }

  const anchors: Anchors = {
    crown: new THREE.Vector3(tx, crownY - 0.03, tz),
    brow: brow.addScaledVector(face, -0.01),
    back: new THREE.Vector3(0, backY - 0.02, zb),
    shoulder: new THREE.Vector3(half * 0.85, neckY - 0.06, zf - 0.02),
    tail: tip,
    tailDir: tip.clone().sub(tailRoot).normalize(),
  };
  return {
    neck,
    tailRoot,
    earL: ear(-1),
    earR: ear(1),
    zs: new THREE.Vector3(zb, (zb + zf) / 2, zf),
    hip,
    anchors,
    faceYaw,
  };
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
