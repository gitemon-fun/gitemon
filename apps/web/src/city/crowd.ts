import * as THREE from 'three';
import { compose, toRgba } from '@gitemon/creature-gen';
import { art } from '@gitemon/art';
import {
  GAITS,
  PATROL_K,
  STRIDE,
  TYPE_INFO,
  WALK,
  hash32,
  standingStep,
  type Gait,
  type MapGitemon,
  type Spot,
} from '@gitemon/shared';

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

const spriteKey = (g: MapGitemon) => `${g.t1}:${g.f}:${g.sh}:${g.s}:${g.special?.species ?? ''}`;

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
    const [t1, f, sh, s, one] = k.split(':');
    // a fixed representative id: the per-creature hue jitter is applied as an instance tint
    const sp = compose(art, {
      id: 7,
      t1: t1 as MapGitemon['t1'],
      t2: null,
      sh: sh as MapGitemon['sh'],
      f: Number(f) as 1 | 2 | 3,
      s: Number(s) as 0 | 1,
      sp: one || null,
    });
    tmp.width = sp.size;
    tmp.height = sp.size;
    // v10: marking pixels carry alpha 191 so the shader can recolour them per player (V10-D5)
    tmp.getContext('2d')!.putImageData(new ImageData(toRgba(sp, 1, 191), sp.size, sp.size), 0, 0);
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

/** v5 specials: bigger by tier (The Origin biggest), and the glow colour of a sealed one */
// v6 staging (V6-D7): the top tiers read from afar; the lower ones stay near player size
const SPECIAL_SCALE = { legendary: 1.8, mythic: 1.4, epic: 1.2, rare: 1.1 } as const;
const GLOW: Record<string, [number, number, number]> = {
  legendary: [1.0, 0.8, 0.3],
  mythic: [0.72, 0.5, 1.0],
  epic: [0.35, 0.7, 1.0],
  rare: [0.4, 0.95, 0.55],
};
/** [size multiplier, sealed flag, glow r, g, b] for one resident */
function specialAttr(g: MapGitemon): [number, number, number, number, number] {
  const sp = g.special;
  if (!sp && g.at) {
    // v6 blessing: not a silhouette (sealed = 1) but a glow halo (2), bigger with the streak
    const [tier, level] = g.at.split(':');
    const [r, gg, b] = GLOW[tier ?? ''] ?? GLOW.legendary!;
    return [1 + Number(level ?? 0) * 0.08, 2 + Number(level ?? 0), r, gg, b];
  }
  if (!sp) return [1, 0, 0, 0, 0];
  const scale = sp.rank === 1 ? 3 : sp.rank <= 3 ? 2.3 : SPECIAL_SCALE[sp.tier];
  const [r, gg, b] = GLOW[sp.tier]!;
  // sealed = a glowing silhouette (1); a named legend — woken, or earned on merit (V7) — shows its own
  // colours with the tier's glow at its feet (2)
  return [scale, sp.sealed ? 1 : 2, r, gg, b];
}

/** v10 (V10-D3): the gait of a resident's species; placeholder art and unknown species hop */
function gaitOf(g: MapGitemon): Gait {
  const k = g.special?.species ?? `${g.t1}-${g.f}`;
  return art.gaits?.[k] ?? art.gaits?.[`${g.t1}-${g.f}`] ?? 'hop';
}
/** v10 (V10-D5): the marking colour of a player with a second type, as [hue 0..1, sat, on] */
function accentAttr(g: MapGitemon): [number, number, number] {
  if (g.special || !g.t2 || g.t2 === g.t1) return [0, 0, 0];
  const n = parseInt(TYPE_INFO[g.t2].colors[0].slice(1), 16);
  const [r, gg, b] = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const max = Math.max(r, gg, b);
  const min = Math.min(r, gg, b);
  const d = max - min;
  const l = (max + min) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h =
    d === 0
      ? 0
      : max === r
        ? ((gg - b) / d + 6) % 6
        : max === gg
          ? (b - r) / d + 2
          : (r - gg) / d + 4;
  return [h / 6, Math.max(0.35, sat), 1];
}
/** a resident's standing height before zoom growth (size is the form's and the standing's job) */
const baseScale = (g: MapGitemon) => FORM_SCALE[g.f] * (g.special ? 1 : standingStep(g.m ?? 0));

const STRIDE_BY_ID = GAITS.map((k) => STRIDE[k].toFixed(3));

const VERT_COMMON = /* glsl */ `
  attribute vec3 iPos;   // x, z, phase
  attribute float iY;    // ground height at the spot (v4: the island has terrain)
  attribute vec3 iWalk;  // tx, tz, amplitude (0 = standing)
  attribute vec4 iGait;  // v10: gait id, steps (-1 = patrol), moving, heading (the player's walker)
  uniform float uTime;
  uniform float uGrow;
  uniform vec3 uRight;
  const float PI = 3.14159265;
  // total variation of clamp(K sin t): how far a patrol has gone (packages/shared/src/gait.ts)
  float patrolDist(float t) {
    float k = floor(t / 6.2831853);
    float a = t - k * 6.2831853;
    float u = clamp(${PATROL_K.toFixed(3)} * sin(a), -1.0, 1.0);
    float e = ${Math.asin(1 / PATROL_K).toFixed(6)};
    float d = a < e ? u : a < PI - e ? 1.0 : a < PI + e ? 2.0 - u : a < 6.2831853 - e ? 3.0 : 4.0 + u;
    return 4.0 * k + d;
  }
  vec3 walkPos(out float moving, out float dirSign) {
    float t = uTime * ${SPEED.toFixed(3)} + iPos.z;
    float s = clamp(sin(t) * ${PATROL_K.toFixed(3)}, -1.0, 1.0);
    moving = iWalk.z > 0.0 ? step(abs(sin(t) * ${PATROL_K.toFixed(3)}), 1.0) : 0.0;
    vec2 d = iWalk.xy * iWalk.z * s;
    // the way it walks, and while it pauses the way it last walked (it keeps facing that way)
    float v = moving > 0.5 ? cos(t) : sin(t);
    dirSign = sign(dot(vec3(iWalk.x * v, 0.0, iWalk.y * v), uRight) + 1e-4);
    return vec3(iPos.x + d.x, iY, iPos.y + d.y);
  }
  // v10 gaits (GRANDPLAN v10 §4): the step cycle follows distance; a leg holds whole steps, so a
  // resident always lands as it stops. base = its height before zoom growth, size = as drawn.
  void gaitPose(float base, float size, inout float moving, inout float dirSign,
                out float lift, out float sx, out float sy, out float roll, out float lean, out float sway) {
    float g = iGait.x;
    float steps;
    if (iGait.y >= 0.0) {
      steps = iGait.y; moving = iGait.z; dirSign = iGait.w;
    } else {
      float stride = (g < 0.5 ? ${STRIDE_BY_ID[0]} : g < 1.5 ? ${STRIDE_BY_ID[1]} : g < 2.5 ? ${STRIDE_BY_ID[2]} : g < 3.5 ? ${STRIDE_BY_ID[3]} : ${STRIDE_BY_ID[4]}) * base;
      float amp = iWalk.z * length(iWalk.xy);
      float n = max(1.0, floor(2.0 * amp / stride + 0.5));
      steps = (patrolDist(uTime * ${SPEED.toFixed(3)} + iPos.z) - 1.0) * n * 0.5;
    }
    float f = fract(steps);
    float m = moving;
    lift = 0.0; sx = 1.0; sy = 1.0; roll = 0.0; lean = 0.0; sway = 0.0;
    if (g < 0.5) {            // hop: arcs, squash on landing, stretch in the air
      float air = sin(PI * f);
      float land = 1.0 - smoothstep(0.0, 0.2, min(f, 1.0 - f));
      lift = m * air * 0.22 * size;
      sy = 1.0 + m * (0.07 * air - 0.14 * land);
      sx = 1.0 + m * (0.12 * land - 0.04 * air);
      lean = 0.03 * m;
    } else if (g < 1.5) {     // waddle: roll from foot to foot
      roll = m * 0.15 * sin(PI * steps);
      lift = m * abs(sin(PI * steps)) * 0.04 * size;
    } else if (g < 2.5) {     // trot: quick bob, leaning in
      lift = m * abs(sin(2.0 * PI * steps)) * 0.05 * size;
      lean = 0.07 * m;
    } else if (g < 3.5) {     // slither: the body sways, a little length pulse
      sway = m * 0.07;
      sx = 1.0 + 0.05 * m * sin(2.0 * PI * steps);
    } else {                  // float: hovers and bobs even when still, leans into the way it goes
      lift = 0.25 * size + sin(uTime * 2.2 + iPos.z * 5.0) * 0.05 * size;
      lean = 0.1 * m;
    }
  }
`;

export class Crowd {
  readonly sprites: THREE.Mesh;
  readonly shadows: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private walk: THREE.InstancedBufferAttribute;
  private gait: THREE.InstancedBufferAttribute;
  /** v10: the player's own walker — steps counted on the CPU from the distance it moved */
  private driven = new Map<
    number,
    {
      steps: number;
      stride: number;
      moving: number;
      dir: number;
      dx: number;
      dz: number;
      last: number;
    }
  >();
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
    const spec = new Float32Array(n * 4); // scale, sealed, glow r, glow g
    const glowB = new Float32Array(n);
    const gait = new Float32Array(n * 4);
    const accent = new Float32Array(n * 3);
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
          baseScale(p.g),
        ],
        i * 4,
      );
      const [sc, sealed, gr, gg, gb] = specialAttr(p.g);
      spec.set([sc, sealed, gr, gg], i * 4);
      glowB[i] = gb;
      gait.set([GAITS.indexOf(gaitOf(p.g)), -1, 0, 1], i * 4);
      accent.set(accentAttr(p.g), i * 3);
    });
    const iPos = new THREE.InstancedBufferAttribute(pos, 3);
    const iY = new THREE.InstancedBufferAttribute(ys, 1);
    this.walk = new THREE.InstancedBufferAttribute(walk, 3);
    const iUv = new THREE.InstancedBufferAttribute(uv, 4);
    const iTint = new THREE.InstancedBufferAttribute(tint, 4);
    const iSpec = new THREE.InstancedBufferAttribute(spec, 4);
    const iGlowB = new THREE.InstancedBufferAttribute(glowB, 1);
    this.gait = new THREE.InstancedBufferAttribute(gait, 4);
    const iAccent = new THREE.InstancedBufferAttribute(accent, 3);

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
    quad.setAttribute('iSpec', iSpec);
    quad.setAttribute('iGlowB', iGlowB);
    quad.setAttribute('iGait', this.gait);
    quad.setAttribute('iAccent', iAccent);
    quad.instanceCount = n;

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      fog: true,
      alphaTest: 0.5,
      vertexShader: /* glsl */ `
        ${VERT_COMMON}
        attribute vec4 iUv;
        attribute vec4 iTint;
        attribute vec4 iSpec;
        attribute float iGlowB;
        attribute vec3 iAccent;
        uniform float uUpScale;
        varying vec3 vAccent;
        varying vec2 vUv;
        varying vec3 vTint;
        varying float vSealed;
        varying vec3 vGlow;
        #include <fog_pars_vertex>
        void main() {
          float moving; float dirSign;
          vec3 base = walkPos(moving, dirSign);
          float size = ${CELL_W.toFixed(2)} * iTint.w * iSpec.x * uGrow;
          float lift; float sx; float sy; float roll; float lean; float sway;
          gaitPose(${CELL_W.toFixed(2)} * iTint.w * iSpec.x, size, moving, dirSign, lift, sx, sy, roll, lean, sway);
          // a slow breath while standing
          float breath = (1.0 - moving) * (sin(uTime * 1.8 + iPos.z) * 0.5 + 0.5) * 0.03;
          float x = position.x * size * sx;
          float y = position.y * size * uUpScale * (1.0 + breath) * sy;
          x += (lean * dirSign + sway * sin(uTime * 6.0 + position.y * 4.0)) * y;
          float xr = x * cos(roll) - y * sin(roll);
          float yr = x * sin(roll) + y * cos(roll);
          vec3 p = base + uRight * xr + vec3(0.0, yr + lift, 0.0);
          // face the way it walks, and keep facing it while it pauses (sprites are drawn facing left)
          float walker = iGait.y >= 0.0 || iWalk.z > 0.0 ? 1.0 : 0.0;
          float flip = walker > 0.5 ? -dirSign : 1.0;
          vec2 uv0 = vec2(flip > 0.0 ? uv.x : 1.0 - uv.x, uv.y);
          vUv = iUv.xy + uv0 * iUv.zw;
          vTint = iTint.rgb;
          vAccent = iAccent;
          vSealed = iSpec.y;
          vGlow = vec3(iSpec.z, iSpec.w, iGlowB);
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vTint;
        varying float vSealed;
        varying vec3 vGlow;
        varying vec3 vAccent;
        #include <fog_pars_fragment>
        vec3 hsl2rgb(float h, float s, float l) {
          vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
          return l + s * (k - 0.5) * (1.0 - abs(2.0 * l - 1.0));
        }
        void main() {
          vec4 c = texture2D(uAtlas, vUv);
          if (c.a < 0.5) discard;
          // v10 (V10-D5): marking pixels (alpha ~0.75) take the player's second type colour, keeping
          // their light and shade
          if (c.a < 0.9 && vAccent.z > 0.5) {
            float l = (max(c.r, max(c.g, c.b)) + min(c.r, min(c.g, c.b))) * 0.5;
            c.rgb = hsl2rgb(vAccent.x, vAccent.y, l);
          }
          vec3 col = c.rgb * vTint;
          if (vSealed > 0.5 && vSealed < 1.5) {
            // a sealed legend (v5 §4): its shape as a glowing silhouette with a slow shimmer; the
            // species reads, the details do not
            float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
            float shimmer = 0.5 + 0.5 * sin(uTime * 1.6 + vUv.y * 40.0 + vUv.x * 25.0);
            col = mix(vGlow * 0.55, vGlow * 1.25 + 0.15, l) + vGlow * shimmer * 0.18;
          }
          gl_FragColor = vec4(col, 1.0);
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
    ground.setAttribute('iSpec', iSpec);
    ground.setAttribute('iGlowB', iGlowB);
    ground.setAttribute('iGait', this.gait);
    ground.instanceCount = n;
    const shadowMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        ${VERT_COMMON}
        attribute vec4 iTint;
        attribute vec4 iSpec;
        attribute float iGlowB;
        varying vec2 vP;
        varying float vSealed;
        varying vec3 vGlow;
        void main() {
          float moving; float dirSign;
          vec3 base = walkPos(moving, dirSign);
          float size = ${CELL_W.toFixed(2)} * iTint.w * iSpec.x * uGrow;
          float lift; float sx; float sy; float roll; float lean; float sway;
          gaitPose(${CELL_W.toFixed(2)} * iTint.w * iSpec.x, size, moving, dirSign, lift, sx, sy, roll, lean, sway);
          vSealed = iSpec.y;
          vGlow = vec3(iSpec.z, iSpec.w, iGlowB);
          float r = 0.62 * iTint.w * iSpec.x * uGrow * (iSpec.y > 1.5 ? 2.0 + (iSpec.y - 2.0) * 0.5 : iSpec.y > 0.5 ? 2.2 : 1.0);
          r *= 1.0 - 0.45 * clamp(lift / (0.35 * size), 0.0, 1.0);
          vP = position.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(base + vec3(position.x * r, 0.08, position.z * r * 0.8), 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vP;
        varying float vSealed;
        varying vec3 vGlow;
        void main() {
          float d = dot(vP, vP);
          if (d > 1.0) discard;
          if (vSealed > 0.5) gl_FragColor = vec4(vGlow, 0.55 * (1.0 - d) * (1.0 - d));
          else gl_FragColor = vec4(0.0, 0.0, 0.0, 0.24 * (1.0 - d));
        }
      `,
    });
    this.shadows = new THREE.Mesh(ground, shadowMat);
    this.shadows.frustumCulled = false;
  }

  /** Called every frame with the camera's ground-plane right vector. */
  update(time: number, right: THREE.Vector3, grow: number, upScale: number) {
    const now = performance.now();
    for (const [i, d] of this.driven) {
      const along = d.dx * right.x + d.dz * right.z;
      if (Math.abs(along) > 1e-4) d.dir = Math.sign(along);
      if (now - d.last > 120 && d.moving) {
        // stopped: finish the step it is in (feet down), then stand
        const target = Math.ceil(d.steps - 1e-3);
        d.steps = Math.min(target, d.steps + ((now - d.last - 120) / 1000) * 0.2 + 0.08);
        if (d.steps >= target) d.moving = 0;
      }
      this.gait.setXYZW(i, this.gait.getX(i), d.steps, d.moving, d.dir);
      this.gait.addUpdateRange(i * 4, 4);
      this.gait.needsUpdate = true;
    }
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

  /** v6: move one resident by hand (the player's own walker): position, ground height, standing still */
  setPos(i: number, x: number, z: number, y: number) {
    const p = this.list[i]!;
    const ox = p.spot.x;
    const oz = p.spot.z;
    p.spot = { ...p.spot, x, z, y };
    const pos = this.sprites.geometry.getAttribute('iPos') as THREE.InstancedBufferAttribute;
    const iy = this.sprites.geometry.getAttribute('iY') as THREE.InstancedBufferAttribute;
    pos.setXY(i, x, z);
    iy.setX(i, y);
    pos.needsUpdate = true;
    iy.needsUpdate = true;
    this.walk.setZ(i, 0);
    this.walk.needsUpdate = true;
    // v10: it walks with its gait — steps follow the distance it just moved
    const moved = Math.hypot(x - ox, z - oz);
    let d = this.driven.get(i);
    if (!d) {
      const stride = STRIDE[GAITS[this.gait.getX(i)] ?? 'hop'] * this.heightOf(i, 1);
      d = { steps: 0, stride, moving: 0, dir: 1, dx: 0, dz: 0, last: 0 };
      this.driven.set(i, d);
    }
    if (moved > 1e-4 && moved < 5) {
      d.steps += moved / d.stride;
      d.moving = 1;
      d.dx = x - ox;
      d.dz = z - oz;
      d.last = performance.now();
    }
  }

  /** v8: hide a resident's sprite and blob (a sculpted model stands there); it can still be tapped */
  hide(i: number) {
    const spec = this.sprites.geometry.getAttribute('iSpec') as THREE.InstancedBufferAttribute;
    spec.setX(i, 0);
    spec.needsUpdate = true;
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
    return CELL_W * baseScale(this.list[i]!.g) * specialAttr(this.list[i]!.g)[0] * grow;
  }

  dispose() {
    this.sprites.geometry.dispose();
    this.shadows.geometry.dispose();
    this.material.dispose();
    this.uniforms.uAtlas.value?.dispose();
  }
}
