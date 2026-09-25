import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TypeId } from '@gitemon/shared';

/**
 * Cosy low-rise architecture per district (Dedi: skyscrapers are the wrong asset). Each style is
 * one archetype geometry on a 1×1 footprint, merged with vertex colours, instanced per lot.
 * Height is in "storeys" (1 ≈ 3 units); the renderer scales footprint and height per lot.
 */

type Arch =
  | 'hut'
  | 'workshop'
  | 'stilt'
  | 'cottage'
  | 'dome'
  | 'beach'
  | 'igloo'
  | 'adobe'
  | 'mushroom'
  | 'tower'
  | 'wizard'
  | 'cave'
  | 'library'
  | 'shell'
  | 'barn'
  | 'factory';

export interface DistrictStyle {
  arch: Arch;
  wall: string;
  roof: string;
  trim: string;
  ground: string;
  tree: [string, string];
  /** extra light: glowing windows/chimneys */
  glow?: string;
}

export const DISTRICT_STYLE: Record<TypeId, DistrictStyle> = {
  forge: {
    arch: 'hut',
    wall: '#4a3b36',
    roof: '#2f2624',
    trim: '#ff7a2e',
    ground: '#6b5850',
    tree: ['#2a2220', '#8a3a24'],
    glow: '#ffb35c',
  },
  iron: {
    arch: 'workshop',
    wall: '#8d949b',
    roof: '#5b636c',
    trim: '#c8ced4',
    ground: '#9aa0a6',
    tree: ['#5a4a3a', '#6f8f6a'],
  },
  serpent: {
    arch: 'stilt',
    wall: '#b8905a',
    roof: '#6d8f3a',
    trim: '#4a3220',
    ground: '#6fa05a',
    tree: ['#5a3f24', '#3f8a3a'],
  },
  spark: {
    arch: 'cottage',
    wall: '#f3ead2',
    roof: '#e8b830',
    trim: '#8a6d10',
    ground: '#c9c07a',
    tree: ['#6b4a2e', '#8fb85a'],
  },
  prism: {
    arch: 'dome',
    wall: '#dbe8f7',
    roof: '#6fa3e0',
    trim: '#3b7de0',
    ground: '#aebfd6',
    tree: ['#6b5a4a', '#7fb0d8'],
    glow: '#bfe3ff',
  },
  tide: {
    arch: 'beach',
    wall: '#f5ecd8',
    roof: '#2fb3c9',
    trim: '#d9c58a',
    ground: '#e6d6a8',
    tree: ['#8a5a2e', '#4fa06a'],
  },
  frost: {
    arch: 'igloo',
    wall: '#f4f8fb',
    roof: '#d8e8f2',
    trim: '#8fb7cf',
    ground: '#e9f1f6',
    tree: ['#6b5a4a', '#e8f2f8'],
  },
  garnet: {
    arch: 'adobe',
    wall: '#d98b6a',
    roof: '#a8463a',
    trim: '#6e1a2f',
    ground: '#c58a74',
    tree: ['#6b4a2e', '#a85a4a'],
  },
  moss: {
    arch: 'mushroom',
    wall: '#e6dcc8',
    roof: '#7a4f9a',
    trim: '#a8ff6a',
    ground: '#5d6b4c',
    tree: ['#3a3a2a', '#6a5a8a'],
    glow: '#b8ff7a',
  },
  wing: {
    arch: 'tower',
    wall: '#f0e0c8',
    roof: '#e0782a',
    trim: '#8a4412',
    ground: '#d8b58a',
    tree: ['#6b4a2e', '#c9913f'],
  },
  rune: {
    arch: 'wizard',
    wall: '#b8a8d8',
    roof: '#5a3a8a',
    trim: '#d6b8ff',
    ground: '#8a7aa8',
    tree: ['#4a3a5a', '#7a5aa8'],
    glow: '#e0c8ff',
  },
  shade: {
    arch: 'cave',
    wall: '#4a4d55',
    roof: '#33363c',
    trim: '#5cff9a',
    ground: '#55585f',
    tree: ['#2a2c30', '#3a5a4a'],
    glow: '#5cff9a',
  },
  bloom: {
    arch: 'cottage',
    wall: '#fff3f7',
    roof: '#e55ea8',
    trim: '#7a2358',
    ground: '#8ec77a',
    tree: ['#6b4a2e', '#f5a8c8'],
  },
  coral: {
    arch: 'shell',
    wall: '#ffd8cc',
    roof: '#ff7a8a',
    trim: '#16705a',
    ground: '#9fd6c4',
    tree: ['#8a5a2e', '#3fc9a0'],
  },
  quill: {
    arch: 'library',
    wall: '#f1e6c8',
    roof: '#3a5a8a',
    trim: '#7a6530',
    ground: '#d8c9a3',
    tree: ['#6b4a2e', '#8aa05a'],
  },
  stone: {
    arch: 'hut',
    wall: '#a39888',
    roof: '#6e6255',
    trim: '#5a3f24',
    ground: '#a8987e',
    tree: ['#5a4a3a', '#6f8a4a'],
  },
  wild: {
    arch: 'barn',
    wall: '#f3ead8',
    roof: '#b83a2e',
    trim: '#46662a',
    ground: '#8fbf5a',
    tree: ['#6b4a2e', '#5fa84a'],
  },
  machine: {
    arch: 'factory',
    wall: '#6e7680',
    roof: '#44484f',
    trim: '#b8f24b',
    ground: '#5c6168',
    tree: ['#3a3d42', '#6e7680'],
    glow: '#d8ff7a',
  },
};

type Col = 'wall' | 'roof' | 'trim' | 'glow' | 'dark' | 'wood';

function part(geo: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([color.r, color.g, color.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  return g;
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) =>
  new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const cyl = (r0: number, r1: number, h: number, seg: number, x = 0, y = 0, z = 0) =>
  new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y + h / 2, z);
const pyramid = (w: number, h: number, y: number) =>
  new THREE.ConeGeometry(w * 0.72, h, 4).rotateY(Math.PI / 4).translate(0, y + h / 2, 0);
/** a gable roof: a triangular prism along x */
const gable = (w: number, d: number, h: number, y: number) =>
  new THREE.CylinderGeometry(d * 0.62, d * 0.62, w, 3)
    .rotateZ(Math.PI / 2)
    .rotateX(Math.PI / 2)
    .scale(1, h / (d * 0.62 * 1.5), 1)
    .translate(0, y + h * 0.33, 0);
const dome = (r: number, y = 0, squash = 1) =>
  new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)
    .scale(1, squash, 1)
    .translate(0, y, 0);
const windowRow = (w: number, y: number, z: number, n: number) => {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) out.push(box(0.1, 0.14, 0.02, -w / 2 + ((i + 0.5) / n) * w, y, z));
  return out;
};

/** Archetype geometry on a 1×1 footprint, ~1 storey (≈1 unit before scaling) per `h`. */
export function archetype(s: DistrictStyle): THREE.BufferGeometry {
  const C = (k: Col) =>
    new THREE.Color(
      k === 'wall'
        ? s.wall
        : k === 'roof'
          ? s.roof
          : k === 'trim'
            ? s.trim
            : k === 'glow'
              ? (s.glow ?? '#ffe08a')
              : k === 'wood'
                ? '#7a5230'
                : '#2a2530',
    );
  const P: [THREE.BufferGeometry, Col][] = [];
  const win = (w: number, y: number, z: number, n: number) =>
    windowRow(w, y, z, n).forEach((g) => P.push([g, 'glow']));
  switch (s.arch) {
    case 'hut':
      P.push(
        [box(0.8, 0.55, 0.7), 'wall'],
        [pyramid(1.05, 0.5, 0.55), 'roof'],
        [cyl(0.08, 0.1, 0.5, 5, 0.25, 0.7, -0.1), 'dark'],
        [box(0.12, 0.08, 0.12, 0.25, 1.2, -0.1), 'trim'],
      );
      win(0.5, 0.25, 0.351, 2);
      break;
    case 'workshop':
      P.push(
        [box(0.9, 0.6, 0.7), 'wall'],
        [box(0.95, 0.08, 0.75, 0, 0.6), 'roof'],
        [cyl(0.07, 0.07, 0.5, 6, -0.3, 0.6, 0.15), 'roof'],
        [box(0.3, 0.35, 0.02, 0.2, 0, 0.351), 'dark'],
      );
      win(0.4, 0.35, 0.351, 2);
      break;
    case 'stilt':
      for (const [x, z] of [
        [-0.3, -0.25],
        [0.3, -0.25],
        [-0.3, 0.25],
        [0.3, 0.25],
      ])
        P.push([cyl(0.04, 0.04, 0.4, 5, x, 0, z), 'wood']);
      P.push(
        [box(0.8, 0.45, 0.65, 0, 0.4), 'wall'],
        [pyramid(1.1, 0.5, 0.85), 'roof'],
        [box(0.3, 0.04, 0.3, 0, 0.35, 0.45), 'wood'],
      );
      break;
    case 'cottage':
    case 'library':
      P.push(
        [box(0.85, 0.55, 0.65), 'wall'],
        [gable(0.95, 0.8, 0.45, 0.55), 'roof'],
        [box(0.18, 0.3, 0.02, 0, 0, 0.326), 'trim'],
      );
      win(0.6, 0.28, 0.326, 2);
      if (s.arch === 'library')
        P.push(
          [cyl(0.14, 0.14, 0.9, 8, 0.38, 0, -0.2), 'wall'],
          [new THREE.ConeGeometry(0.18, 0.3, 8).translate(0.38, 1.05, -0.2), 'roof'],
        );
      break;
    case 'dome':
      P.push(
        [cyl(0.45, 0.45, 0.18, 10), 'wall'],
        [dome(0.45, 0.18, 1.1), 'roof'],
        [box(0.18, 0.28, 0.1, 0, 0, 0.42), 'trim'],
        [new THREE.OctahedronGeometry(0.1).translate(0, 0.75, 0), 'glow'],
      );
      break;
    case 'beach':
      P.push(
        [box(0.7, 0.45, 0.6, 0, 0.12), 'wall'],
        [gable(0.8, 0.75, 0.35, 0.57), 'roof'],
        [box(0.9, 0.05, 0.8, 0, 0.07), 'wood'],
      );
      for (const [x, z] of [
        [-0.4, -0.35],
        [0.4, -0.35],
        [-0.4, 0.35],
        [0.4, 0.35],
      ])
        P.push([cyl(0.03, 0.03, 0.12, 5, x, 0, z), 'wood']);
      break;
    case 'igloo':
      P.push(
        [dome(0.45, 0, 0.9), 'wall'],
        [box(0.22, 0.22, 0.3, 0, 0, 0.42), 'roof'],
        [box(0.12, 0.14, 0.02, 0, 0, 0.571), 'dark'],
      );
      break;
    case 'adobe':
      P.push(
        [box(0.8, 0.5, 0.7), 'wall'],
        [box(0.5, 0.35, 0.45, -0.1, 0.5, -0.1), 'wall'],
        [box(0.82, 0.04, 0.72, 0, 0.5), 'roof'],
        [box(0.16, 0.26, 0.02, 0.15, 0, 0.351), 'trim'],
      );
      break;
    case 'mushroom':
      P.push(
        [cyl(0.2, 0.26, 0.55, 8), 'wall'],
        [dome(0.5, 0.5, 0.7), 'roof'],
        [box(0.14, 0.24, 0.02, 0, 0, 0.25), 'dark'],
      );
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        P.push([
          new THREE.SphereGeometry(0.06, 5, 4).translate(
            Math.cos(a) * 0.3,
            0.72,
            Math.sin(a) * 0.3,
          ),
          'trim',
        ]);
      }
      break;
    case 'tower':
      P.push(
        [cyl(0.28, 0.32, 1.1, 8), 'wall'],
        [new THREE.ConeGeometry(0.38, 0.4, 8).translate(0, 1.3, 0), 'roof'],
        [box(0.5, 0.05, 0.5, 0, 0.7), 'trim'],
      );
      win(0.2, 0.8, 0.29, 1);
      break;
    case 'wizard':
      P.push(
        [cyl(0.3, 0.34, 0.9, 8), 'wall'],
        [new THREE.ConeGeometry(0.4, 0.7, 8).translate(0, 1.25, 0), 'roof'],
        [new THREE.OctahedronGeometry(0.08).translate(0, 1.7, 0), 'glow'],
      );
      win(0.2, 0.55, 0.31, 1);
      break;
    case 'cave':
      P.push(
        [new THREE.IcosahedronGeometry(0.5, 0).scale(1, 0.7, 0.9).translate(0, 0.3, 0), 'wall'],
        [box(0.26, 0.3, 0.1, 0, 0, 0.42), 'glow'],
      );
      break;
    case 'shell':
      P.push(
        [dome(0.45, 0, 1), 'wall'],
        [new THREE.ConeGeometry(0.2, 0.5, 8).translate(0.1, 0.55, -0.1), 'roof'],
        [box(0.14, 0.24, 0.02, 0, 0, 0.44), 'trim'],
      );
      break;
    case 'barn':
      P.push(
        [box(0.9, 0.6, 0.7), 'wall'],
        [gable(1, 0.8, 0.5, 0.6), 'roof'],
        [box(0.3, 0.4, 0.02, 0, 0, 0.351), 'roof'],
        [cyl(0.16, 0.16, 0.9, 8, 0.55, 0, -0.1), 'trim'],
      );
      break;
    case 'factory':
      P.push(
        [box(0.95, 0.55, 0.75), 'wall'],
        [box(0.95, 0.12, 0.25, 0, 0.55, -0.2), 'roof'],
        [box(0.95, 0.12, 0.25, 0, 0.55, 0.15), 'roof'],
        [cyl(0.08, 0.1, 0.7, 6, 0.3, 0.55, -0.2), 'dark'],
      );
      win(0.7, 0.3, 0.376, 3);
      break;
  }
  return mergeGeometries(P.map(([g, c]) => part(g, C(c))))!;
}
