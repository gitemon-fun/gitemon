import * as THREE from 'three';
import { compose, toRgba } from '@gitemon/creature-gen';
import { art } from '@gitemon/art';
import { WALK, hash32, type MapGitemon, type Spot } from '@gitemon/shared';

/**
 * The crowd (build order 2026-09-25): every Gitemon is its pixel sprite, standing upright in the
 * low-poly city like a paper standee. One atlas texture, one instanced draw for the sprites and one
 * for their blob shadows. Street residents walk their stretch of sidewalk; the motion is computed
 * in the vertex shader, so thousands of walkers cost the CPU nothing per frame.
 */

export interface Placed {
  g: MapGitemon;
  spot: Spot;
}

const CELL = 80;
const COLS = 25;
/** world width of one atlas cell at form 2 */
const CELL_W = 2.5;
const FORM_SCALE = { 1: 0.82, 2: 1, 3: 1.3 } as const;
/** walking speed (radians of the patrol cycle per second) */
const SPEED = 0.32;

const spriteKey = (g: MapGitemon) => `${g.t1}:${g.f}:${g.sh}:${g.s}`;

function buildAtlas(list: Placed[]) {
  const keys = new Map<string, number>();
  for (const p of list) {
    const k = spriteKey(p.g);
    if (!keys.has(k)) keys.set(k, keys.size);
  }
  const rows = Math.max(1, Math.ceil(keys.size / COLS));
  const canvas = document.createElement('canvas');
  canvas.width = COLS * CELL;
  canvas.height = rows * CELL;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const tmp = document.createElement('canvas');
  for (const [k, i] of keys) {
    const [t1, f, sh, s] = k.split(':');
    // a fixed representative id: the per-creature hue jitter is applied as an instance tint
    const sp = compose(art, {
      id: 7,
      t1: t1 as MapGitemon['t1'],
      t2: null,
      sh: sh as MapGitemon['sh'],
      f: Number(f) as 1 | 2 | 3,
      s: Number(s) as 0 | 1,
    });
    tmp.width = sp.size;
    tmp.height = sp.size;
    tmp.getContext('2d')!.putImageData(new ImageData(toRgba(sp), sp.size, sp.size), 0, 0);
    // crop to the drawn pixels and scale every species to one standing height, so a small drawing
    // does not read as a small creature (size is the form's job, not the source image's)
    let x0 = sp.size,
      y0 = sp.size,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < sp.size; y++)
      for (let x = 0; x < sp.size; x++)
        if (sp.px[y * sp.size + x]) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
    if (x1 < 0) continue;
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const fit = Math.min((CELL - 2) / bw, (CELL * 0.8) / bh);
    const w = Math.round(bw * fit);
    const h = Math.round(bh * fit);
    ctx.drawImage(
      tmp,
      x0,
      y0,
      bw,
      bh,
      (i % COLS) * CELL + (CELL - w) / 2,
      Math.floor(i / COLS) * CELL + CELL - h,
      w,
      h,
    );
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  return { tex, keys, rows };
}

const VERT_COMMON = /* glsl */ `
  attribute vec3 iPos;   // x, z, phase
  attribute float iY;    // ground height at the spot (v4: the island has terrain)
  attribute vec3 iWalk;  // tx, tz, amplitude (0 = standing)
  uniform float uTime;
  uniform float uGrow;
  uniform vec3 uRight;
  vec3 walkPos(out float moving, out float dirSign) {
    float t = uTime * ${SPEED.toFixed(3)} + iPos.z;
    float s = clamp(sin(t) * 1.45, -1.0, 1.0);
    float v = cos(t);
    moving = iWalk.z > 0.0 ? step(abs(sin(t) * 1.45), 1.0) : 0.0;
    vec2 d = iWalk.xy * iWalk.z * s;
    dirSign = sign(dot(vec3(iWalk.x * v, 0.0, iWalk.y * v), uRight) + 1e-4);
    return vec3(iPos.x + d.x, iY, iPos.y + d.y);
  }
`;

export class Crowd {
  readonly sprites: THREE.Mesh;
  readonly shadows: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private walk: THREE.InstancedBufferAttribute;
  private list: Placed[] = [];
  private uniforms = {
    uTime: { value: 0 },
    uGrow: { value: 1 },
    uRight: { value: new THREE.Vector3(1, 0, 0) },
    uUpScale: { value: 1.8 },
    uAtlas: { value: null as THREE.Texture | null },
  };

  constructor(list: Placed[]) {
    this.list = list;
    const n = list.length;
    const { tex, keys, rows } = buildAtlas(list);
    this.uniforms.uAtlas.value = tex;
    const pos = new Float32Array(n * 3);
    const ys = new Float32Array(n);
    const walk = new Float32Array(n * 3);
    const uv = new Float32Array(n * 4);
    const tint = new Float32Array(n * 4);
    list.forEach((p, i) => {
      const h = hash32(`crowd:${p.g.id}`);
      pos.set([p.spot.x, p.spot.z, (h % 6283) / 1000], i * 3);
      ys[i] = p.spot.y;
      // about two thirds of the street residents are out walking at any time
      const walks =
        ((p.spot.kind === 'street' || p.spot.kind === 'wild') &&
          (p.spot.tx || p.spot.tz) &&
          (h >>> 12) % 3 !== 0) ||
        (p.spot.kind === 'plaza' && (h >>> 12) % 2 === 0);
      walk.set([p.spot.tx, p.spot.tz, walks ? WALK * (0.55 + ((h >>> 4) % 45) / 100) : 0], i * 3);
      const k = keys.get(spriteKey(p.g))!;
      uv.set([(k % COLS) / COLS, Math.floor(k / COLS) / rows, 1 / COLS, 1 / rows], i * 4);
      const hv = hash32(`hue:${p.g.id}`);
      const l = p.g.s ? 1 : 0.9 + (hv % 21) / 100;
      tint.set(
        [
          l * (0.96 + ((hv >>> 5) % 9) / 100),
          l,
          l * (0.96 + ((hv >>> 9) % 9) / 100),
          FORM_SCALE[p.g.f],
        ],
        i * 4,
      );
    });
    const iPos = new THREE.InstancedBufferAttribute(pos, 3);
    const iY = new THREE.InstancedBufferAttribute(ys, 1);
    this.walk = new THREE.InstancedBufferAttribute(walk, 3);
    const iUv = new THREE.InstancedBufferAttribute(uv, 4);
    const iTint = new THREE.InstancedBufferAttribute(tint, 4);

    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]),
        3,
      ),
    );
    quad.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2),
    );
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    quad.setAttribute('iPos', iPos);
    quad.setAttribute('iY', iY);
    quad.setAttribute('iWalk', this.walk);
    quad.setAttribute('iUv', iUv);
    quad.setAttribute('iTint', iTint);
    quad.instanceCount = n;

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      fog: true,
      alphaTest: 0.5,
      vertexShader: /* glsl */ `
        ${VERT_COMMON}
        attribute vec4 iUv;
        attribute vec4 iTint;
        uniform float uUpScale;
        varying vec2 vUv;
        varying vec3 vTint;
        #include <fog_pars_vertex>
        void main() {
          float moving; float dirSign;
          vec3 base = walkPos(moving, dirSign);
          float size = ${CELL_W.toFixed(2)} * iTint.w * uGrow;
          // a small hop per step while walking, a slow breath while standing
          float t = uTime * 7.0 + iPos.z * 3.0;
          float hop = moving * abs(sin(t)) * 0.16 * size / ${CELL_W.toFixed(2)};
          float breath = (1.0 - moving) * (sin(uTime * 1.8 + iPos.z) * 0.5 + 0.5) * 0.03;
          vec3 p = base
            + uRight * position.x * size
            + vec3(0.0, position.y * size * uUpScale * (1.0 + breath) + hop, 0.0);
          // face the way it walks (sprites are drawn facing left)
          float flip = moving > 0.5 ? -dirSign : 1.0;
          vec2 uv0 = vec2(flip > 0.0 ? uv.x : 1.0 - uv.x, uv.y);
          vUv = iUv.xy + uv0 * iUv.zw;
          vTint = iTint.rgb;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        varying vec2 vUv;
        varying vec3 vTint;
        #include <fog_pars_fragment>
        void main() {
          vec4 c = texture2D(uAtlas, vUv);
          if (c.a < 0.5) discard;
          gl_FragColor = vec4(c.rgb * vTint, 1.0);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    });
    Object.assign(this.material.uniforms, this.uniforms);
    this.sprites = new THREE.Mesh(quad, this.material);
    this.sprites.frustumCulled = false;

    const ground = new THREE.InstancedBufferGeometry();
    ground.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]), 3),
    );
    ground.setIndex([0, 2, 1, 0, 3, 2]);
    ground.setAttribute('iPos', iPos);
    ground.setAttribute('iY', iY);
    ground.setAttribute('iWalk', this.walk);
    ground.setAttribute('iTint', iTint);
    ground.instanceCount = n;
    const shadowMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        ${VERT_COMMON}
        attribute vec4 iTint;
        varying vec2 vP;
        void main() {
          float moving; float dirSign;
          vec3 base = walkPos(moving, dirSign);
          float r = 0.62 * iTint.w * uGrow;
          vP = position.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(base + vec3(position.x * r, 0.08, position.z * r * 0.8), 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vP;
        void main() {
          float d = dot(vP, vP);
          if (d > 1.0) discard;
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.24 * (1.0 - d));
        }
      `,
    });
    this.shadows = new THREE.Mesh(ground, shadowMat);
    this.shadows.frustumCulled = false;
  }

  /** Called every frame with the camera's ground-plane right vector. */
  update(time: number, right: THREE.Vector3, grow: number, upScale: number) {
    this.uniforms.uTime.value = time;
    this.uniforms.uRight.value.copy(right);
    this.uniforms.uGrow.value = grow;
    this.uniforms.uUpScale.value = upScale;
  }

  /** Where a resident stands right now (the same maths as the shader). */
  positionOf(i: number, time: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.list[i]!;
    const a = this.walk.getZ(i);
    const h = hash32(`crowd:${p.g.id}`);
    const t = time * SPEED + (h % 6283) / 1000;
    const s = Math.max(-1, Math.min(1, Math.sin(t) * 1.45));
    return out.set(
      p.spot.x + this.walk.getX(i) * a * s,
      p.spot.y,
      p.spot.z + this.walk.getY(i) * a * s,
    );
  }

  /** A tapped resident stops walking, so it stays where the ring is. */
  stop(i: number, time: number) {
    const v = this.positionOf(i, time, new THREE.Vector3());
    const p = this.list[i]!;
    p.spot = { ...p.spot, x: v.x, z: v.z };
    const pos = this.sprites.geometry.getAttribute('iPos') as THREE.InstancedBufferAttribute;
    pos.setXY(i, v.x, v.z);
    pos.needsUpdate = true;
    this.walk.setZ(i, 0);
    this.walk.needsUpdate = true;
  }

  get size() {
    return this.list.length;
  }
  at(i: number) {
    return this.list[i]!;
  }
  heightOf(i: number, grow: number) {
    return CELL_W * FORM_SCALE[this.list[i]!.g.f] * grow;
  }

  dispose() {
    this.sprites.geometry.dispose();
    this.shadows.geometry.dispose();
    this.material.dispose();
    this.uniforms.uAtlas.value?.dispose();
  }
}
