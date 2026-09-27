import * as THREE from 'three';
import { WATER_Y, type Island } from '@gitemon/shared';

/**
 * Water and air (GRANDPLAN v8 §0 V8-D7, build file 04). Both read the island's height grid from one
 * small float texture, so the GPU knows how deep the water is and which region a point of air is in.
 *
 *   water: shallow turquoise → deep blue by depth, a foam band on every shore, a slow ripple
 *   air:   one field of points that travels with the camera; each point takes the look of the
 *          region under it — snow, fireflies, petals, spray, pollen, embers, dust, sparkles, seeds
 */

/** the grid as a texture: R = height, G = region index (-1 town, -2 sea) */
export function gridTexture(isl: Island): THREE.DataTexture {
  const g = isl.grid;
  const n = g.N + 1;
  const data = new Float32Array(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    data[k * 4] = g.h[k]!;
    data[k * 4 + 1] = g.region[k]!;
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.FloatType);
  // heights are read with the GPU's bilinear filter where the device allows it; regions by nearest
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

const GRID_GLSL = /* glsl */ `
  uniform sampler2D uGrid;
  uniform float uE;
  vec2 gridUv(vec2 xz) { return (xz + uE) / (2.0 * uE); }
`;

export function waterMesh(isl: Island, grid: THREE.DataTexture): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    depthWrite: false,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uGrid: { value: null }, uE: { value: isl.grid.E }, uTime: { value: 0 } },
    ]),
    vertexShader: /* glsl */ `
      varying vec3 vW;
      #include <fog_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${GRID_GLSL}
      uniform float uTime;
      varying vec3 vW;
      #include <fog_pars_fragment>
      float n2(vec2 p) { return sin(p.x) * sin(p.y); }
      void main() {
        vec2 uv = gridUv(vW.xz);
        bool inGrid = uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0;
        float ground = inGrid ? texture2D(uGrid, uv).r : -3.0;
        float depth = clamp(${WATER_Y.toFixed(2)} - ground, 0.0, 4.0);
        vec3 shallow = vec3(0.49, 0.84, 0.80);
        vec3 deep = vec3(0.16, 0.45, 0.66);
        vec3 c = mix(shallow, deep, smoothstep(0.0, 2.6, depth));
        // a slow ripple: two crossing sine fields, just enough to catch the light
        float r = n2(vW.xz * 0.35 + uTime * vec2(0.6, 0.4)) + n2(vW.xz * 0.23 - uTime * vec2(0.3, 0.5));
        // (faded out with distance: far away the ripple would only shimmer)
        c += r * 0.025 * (1.0 - smoothstep(120.0, 420.0, distance(cameraPosition, vW)));
        // foam on every shore, breathing in and out
        float band = 0.18 + 0.08 * sin(uTime * 1.3 + vW.x * 0.2 + vW.z * 0.17);
        float foam = 1.0 - smoothstep(0.0, band, depth);
        c = mix(c, vec3(0.97, 0.98, 0.96), foam * 0.85);
        float a = mix(0.62, 0.94, smoothstep(0.0, 1.8, depth));
        gl_FragColor = vec4(c, max(a, foam));
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uGrid!.value = grid;
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(isl.radius + 2400, 128).rotateX(-Math.PI / 2).translate(0, WATER_Y, 0),
    mat,
  );
  m.renderOrder = 1;
  return m;
}

/** one field of air around the camera target; `update` moves it with the camera and the clock */
export function airField(isl: Island, grid: THREE.DataTexture) {
  const N = 2200;
  const BOX = 150;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  let s = 12345;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < N; i++) {
    pos.set([r() * BOX, r(), r() * BOX], i * 3);
    seed[i] = r();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uGrid: { value: null },
        uE: { value: isl.grid.E },
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector2() },
        uScale: { value: 400 },
        uFade: { value: 1 },
      },
    ]),
    vertexShader: /* glsl */ `
      ${GRID_GLSL}
      attribute float seed;
      uniform float uTime;
      uniform vec2 uCenter;
      uniform float uScale;
      varying vec4 vCol;
      #include <fog_pars_vertex>
      void main() {
        float t = uTime;
        // the box wraps round the camera target, so the air is always here and never runs out
        vec2 drift = vec2(0.0);
        float kind = -9.0;
        vec2 xz = uCenter + mod(position.xz - uCenter + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
        vec4 g = texture2D(uGrid, gridUv(xz));
        kind = floor(g.g + 0.5);
        float ground = max(g.r, ${WATER_Y.toFixed(2)});
        float y = 0.0;
        float size = 0.3;
        vCol = vec4(0.0);
        float ph = seed * 6.2831;
        if (kind < -0.5) {
          vCol = vec4(0.0);                                         // town, sea: clear air
        } else if (kind < 0.5) {                                    // frost: snow falling
          y = 18.0 - mod(t * 1.6 + seed * 18.0, 18.0);
          xz += vec2(sin(t * 0.7 + ph), cos(t * 0.5 + ph)) * 0.8;
          vCol = vec4(1.0, 1.0, 1.0, 0.9); size = 0.32;
        } else if (kind < 1.5) {                                    // marsh: fireflies
          y = 0.8 + 2.5 * position.y + sin(t * 0.8 + ph) * 0.6;
          xz += vec2(sin(t * 0.4 + ph * 3.0), cos(t * 0.35 + ph * 2.0)) * 2.0;
          vCol = vec4(0.85, 1.0, 0.45, 0.35 + 0.65 * step(0.4, sin(t * 2.0 + ph * 5.0))); size = 0.28;
        } else if (kind < 2.5) {                                    // bloom: petals drifting
          y = 10.0 - mod(t * 0.7 + seed * 10.0, 10.0);
          xz += vec2(mod(t * 1.2 + seed * 30.0, 30.0) - 15.0, sin(t + ph) * 1.5);
          vCol = vec4(1.0, 0.68, 0.8, 0.95); size = 0.36;
        } else if (kind < 3.5) {                                    // tide: glints of spray
          y = 0.4 + 1.5 * position.y;
          vCol = vec4(1.0, 1.0, 1.0, 0.8 * step(0.8, sin(t * 3.0 + ph * 7.0))); size = 0.22;
        } else if (kind < 4.5) {                                    // jungle: pollen
          y = 1.0 + 8.0 * position.y + sin(t * 0.5 + ph) * 0.8;
          xz += vec2(sin(t * 0.3 + ph), cos(t * 0.25 + ph)) * 1.2;
          vCol = vec4(0.9, 1.0, 0.6, 0.7); size = 0.2;
        } else if (kind < 5.5) {                                    // volcano: embers rising
          float k = mod(t * 1.8 + seed * 20.0, 20.0);
          y = k;
          xz += vec2(sin(t * 1.1 + ph), cos(t * 0.9 + ph)) * 0.7;
          vCol = vec4(1.0, 0.55, 0.15, 1.0 - k / 20.0); size = 0.3;
        } else if (kind < 6.5) {                                    // canyon: dust blown along
          y = 0.3 + 3.0 * position.y;
          xz += vec2(mod(t * 5.0 + seed * 40.0, 40.0) - 20.0, 0.0);
          vCol = vec4(0.9, 0.72, 0.5, 0.55); size = 0.26;
        } else if (kind < 7.5) {                                    // crystal: sparkles
          y = 0.5 + 6.0 * position.y;
          vCol = vec4(0.9, 0.82, 1.0, step(0.75, sin(t * 2.4 + ph * 9.0))); size = 0.3;
        } else {                                                    // savanna: seeds on the wind
          y = 1.0 + 5.0 * position.y + sin(t * 0.6 + ph) * 0.5;
          xz += vec2(mod(t * 2.0 + seed * 30.0, 30.0) - 15.0, cos(t * 0.4 + ph));
          vCol = vec4(1.0, 0.95, 0.7, 0.6); size = 0.22;
        }
        vec4 mvPosition = viewMatrix * vec4(xz.x, ground + y, xz.y, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = size * uScale / max(1.0, -mvPosition.z);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying vec4 vCol;
      #include <fog_pars_fragment>
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = vCol.a * uFade * (1.0 - smoothstep(0.25, 0.5, d));
        if (a < 0.02) discard;
        gl_FragColor = vec4(vCol.rgb, a);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uGrid!.value = grid;
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  return {
    points,
    /** follow the camera target; `px` = pixels per world unit at distance 1 (for point sizes) */
    update(t: number, cx: number, cz: number, px: number, fade: number) {
      mat.uniforms.uTime!.value = t;
      (mat.uniforms.uCenter!.value as THREE.Vector2).set(cx, cz);
      mat.uniforms.uScale!.value = px;
      mat.uniforms.uFade!.value = fade;
      points.visible = fade > 0.01;
    },
  };
}
