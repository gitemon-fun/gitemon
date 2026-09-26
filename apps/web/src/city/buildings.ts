import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TypeId } from '@gitemon/shared';
import type { PropId, RoofId } from './kit';

/**
 * District skins (GRANDPLAN v3 §6, V3-D4): one city skeleton, 18 skins. A skin changes three
 * things only: the roof silhouette (a shared set + one signature roof), the palette, and one
 * signature prop along its streets. Look target: the v3 concept art (GRANDPLAN §3.1).
 */

export interface Skin {
  /** wall tones; each building picks one and varies its lightness a little */
  walls: string[];
  roofs: string[];
  trim: string;
  /** awnings, doors */
  accent: string;
  ground: string;
  /** court paving, lighter than the district ground */
  court: string;
  /** lit windows (unlit material) — omitted = dark glass */
  glow?: string;
  /** shared roof set, most common first */
  roofSet: RoofId[];
  /** the district's signature roof and how often it appears */
  sig: RoofId;
  sigP: number;
  odds: { chimney: number; awning: number; balcony: number; flowers: number; dormer: number };
  lamp: 'lampHead' | 'crystal' | 'lantern';
  lampColor: string;
  tree: [string, string];
  /** signature street prop, placed in courts and along streets */
  prop: PropId;
  propColor: string;
}

const O = (chimney: number, awning: number, balcony: number, flowers: number, dormer: number) => ({
  chimney,
  awning,
  balcony,
  flowers,
  dormer,
});

export const SKINS: Record<TypeId, Skin> = {
  forge: {
    walls: ['#5a4640', '#6e4a3c', '#4a3d3a'],
    roofs: ['#3a3134', '#4a3a36'],
    trim: '#8a5a40',
    accent: '#e8a060',
    ground: '#8a7468',
    court: '#a8958a',
    glow: '#ffb25c',
    roofSet: ['gable', 'gableX', 'hip'],
    sig: 'gableX',
    sigP: 0.3,
    odds: O(0.9, 0.45, 0.15, 0.25, 0.1),
    lamp: 'lantern',
    lampColor: '#ffb25c',
    tree: ['#5a4030', '#9aa860'],
    prop: 'boulder',
    propColor: '#5a4a44',
  },
  iron: {
    walls: ['#9aa1a8', '#b3b8bd', '#8a9198'],
    roofs: ['#5b636c', '#6d757e'],
    trim: '#c8ced4',
    accent: '#6f8fb0',
    ground: '#a8adb2',
    court: '#c2c6ca',
    roofSet: ['flat', 'lean', 'gable'],
    sig: 'saw',
    sigP: 0.2,
    odds: O(0.3, 0.3, 0.2, 0.1, 0),
    lamp: 'lampHead',
    lampColor: '#fff3d0',
    tree: ['#5a4a3a', '#7f9f78'],
    prop: 'tank',
    propColor: '#8a9198',
  },
  serpent: {
    walls: ['#c8a46a', '#b8905a', '#d4b27c'],
    roofs: ['#6d8f3a', '#5a7a30'],
    trim: '#5a3a22',
    accent: '#c0703a',
    ground: '#7fae66',
    court: '#a8c890',
    roofSet: ['hip', 'tent', 'gable'],
    sig: 'tent',
    sigP: 0.35,
    odds: O(0.05, 0.2, 0.35, 0.3, 0),
    lamp: 'lantern',
    lampColor: '#ffd070',
    tree: ['#5a3f24', '#3f8a3a'],
    prop: 'bush',
    propColor: '#4f9a44',
  },
  spark: {
    walls: ['#f6eed6', '#f0e2b8', '#faf3e0'],
    roofs: ['#e8b830', '#d9a020'],
    trim: '#8a6d10',
    accent: '#f0c040',
    ground: '#d8cf8a',
    court: '#ece4b0',
    roofSet: ['gable', 'gableX', 'hip'],
    sig: 'tent',
    sigP: 0.15,
    odds: O(0.4, 0.4, 0.3, 0.3, 0.3),
    lamp: 'lampHead',
    lampColor: '#fff080',
    tree: ['#6b4a2e', '#9ac060'],
    prop: 'bush',
    propColor: '#9ac060',
  },
  prism: {
    walls: ['#eef2fa', '#e2eaf6', '#f6f8fc'],
    roofs: ['#8fb4e8', '#a8c4ee'],
    trim: '#c8d6ec',
    accent: '#7fa6e0',
    ground: '#c0cde0',
    court: '#dde5f0',
    roofSet: ['gable', 'gableX', 'hip'],
    sig: 'dome',
    sigP: 0.3,
    odds: O(0.35, 0.3, 0.45, 0.35, 0.1),
    lamp: 'crystal',
    lampColor: '#9fb4ff',
    tree: ['#6b5a4a', '#6f9f6a'],
    prop: 'bush',
    propColor: '#7aa874',
  },
  tide: {
    walls: ['#f3e6cc', '#efdcc0', '#f7eedc'],
    roofs: ['#d98a6a', '#6f93b8', '#e0b07a', '#8fb8b0'],
    trim: '#5e9aa0',
    accent: '#6fb0b8',
    ground: '#e0d4b8',
    court: '#efe6d2',
    roofSet: ['gable', 'gableX', 'hip'],
    sig: 'vaultX',
    sigP: 0.15,
    odds: O(0.5, 0.45, 0.2, 0.35, 0.2),
    lamp: 'lampHead',
    lampColor: '#fff3d0',
    tree: ['#6b5a44', '#8fb070'],
    prop: 'buoy',
    propColor: '#5fb0b8',
  },
  frost: {
    walls: ['#dde6f0', '#e8edf4', '#cfdbe8'],
    roofs: ['#ffffff', '#f4f8fc'],
    trim: '#b8c8da',
    accent: '#a8bcd4',
    ground: '#e6edf4',
    court: '#f4f7fb',
    glow: '#ffd89a',
    roofSet: ['vault', 'gable', 'hip'],
    sig: 'vault',
    sigP: 0.35,
    odds: O(0.7, 0.2, 0.4, 0.2, 0.15),
    lamp: 'lampHead',
    lampColor: '#fff0c0',
    tree: ['#6b5a4a', '#e8f0f4'],
    prop: 'pine',
    propColor: '#dfe9ee',
  },
  garnet: {
    walls: ['#d98b6a', '#e0a07a', '#c87a5a'],
    roofs: ['#9a4a3a', '#b05a44'],
    trim: '#f0d0b0',
    accent: '#c8503a',
    ground: '#d8a888',
    court: '#ecc8a8',
    roofSet: ['flat', 'hip', 'lean'],
    sig: 'mansard',
    sigP: 0.2,
    odds: O(0.2, 0.45, 0.35, 0.45, 0),
    lamp: 'lantern',
    lampColor: '#ffc080',
    tree: ['#6b4a30', '#8aa860'],
    prop: 'bush',
    propColor: '#7a9a50',
  },
  moss: {
    walls: ['#ece4cc', '#dfe4c8', '#e8dcc0'],
    roofs: ['#7f9f5a', '#6f8f4a', '#8aa864'],
    trim: '#6b5a3a',
    accent: '#a8845a',
    ground: '#9ab87a',
    court: '#bcd29e',
    roofSet: ['gable', 'gableX', 'hip'],
    sig: 'cap',
    sigP: 0.18,
    odds: O(0.45, 0.35, 0.3, 0.45, 0.15),
    lamp: 'lantern',
    lampColor: '#ffe0a0',
    tree: ['#6b4a2e', '#5f9a4a'],
    prop: 'bush',
    propColor: '#5f9a4a',
  },
  wing: {
    walls: ['#f4e8d4', '#eee0c8', '#faf2e4'],
    roofs: ['#7fa8d8', '#9ab8e0'],
    trim: '#d8c8a8',
    accent: '#8ab0e0',
    ground: '#dcd6c2',
    court: '#eeeadc',
    roofSet: ['gableX', 'gable', 'tent'],
    sig: 'tent',
    sigP: 0.35,
    odds: O(0.3, 0.3, 0.4, 0.3, 0.2),
    lamp: 'lampHead',
    lampColor: '#fff3d0',
    tree: ['#6b5a44', '#9ac080'],
    prop: 'bush',
    propColor: '#9ac080',
  },
  rune: {
    walls: ['#c8b6e6', '#b8a4dc', '#d6c8ee'],
    roofs: ['#4a4470', '#5a5080'],
    trim: '#e8dcf6',
    accent: '#8a70d0',
    ground: '#b8aed0',
    court: '#d4cce4',
    roofSet: ['gableX', 'gable', 'hip'],
    sig: 'spire',
    sigP: 0.28,
    odds: O(0.6, 0.35, 0.25, 0.4, 0.2),
    lamp: 'lantern',
    lampColor: '#ffd890',
    tree: ['#6b5a4a', '#b0a060'],
    prop: 'bush',
    propColor: '#8a9a60',
  },
  shade: {
    walls: ['#55585f', '#4a4d55', '#62656c'],
    roofs: ['#2e2a3a', '#3a3448'],
    trim: '#8a8494',
    accent: '#7a5aa0',
    ground: '#6a6d74',
    court: '#83868c',
    glow: '#c890ff',
    roofSet: ['gableX', 'gable', 'mansard'],
    sig: 'spire',
    sigP: 0.2,
    odds: O(0.5, 0.15, 0.2, 0.1, 0.25),
    lamp: 'lantern',
    lampColor: '#c890ff',
    tree: ['#3a3440', '#5a5068'],
    prop: 'boulder',
    propColor: '#4a4d55',
  },
  bloom: {
    walls: ['#fff0f4', '#fbe2ea', '#fff8f0'],
    roofs: ['#e87a9a', '#f098b0'],
    trim: '#f4c8d4',
    accent: '#e87a9a',
    ground: '#e8d2d8',
    court: '#f6e6ea',
    roofSet: ['hip', 'gable', 'gableX'],
    sig: 'mansard',
    sigP: 0.15,
    odds: O(0.3, 0.45, 0.4, 0.8, 0.2),
    lamp: 'lampHead',
    lampColor: '#fff0f6',
    tree: ['#6b4a3a', '#f0a0c0'],
    prop: 'bush',
    propColor: '#e888a8',
  },
  coral: {
    walls: ['#ffe0d2', '#ffd0c0', '#fff0e6'],
    roofs: ['#f08a6a', '#e87858'],
    trim: '#fff4ea',
    accent: '#f0a080',
    ground: '#f0d0c0',
    court: '#faeade',
    roofSet: ['hip', 'gable', 'flat'],
    sig: 'dome',
    sigP: 0.15,
    odds: O(0.2, 0.45, 0.35, 0.4, 0),
    lamp: 'lampHead',
    lampColor: '#fff3e0',
    tree: ['#8a6a4a', '#8ac0a0'],
    prop: 'buoy',
    propColor: '#f08a6a',
  },
  quill: {
    walls: ['#f1e6c8', '#e8dab4', '#f6eed8'],
    roofs: ['#8a3a34', '#a04a40'],
    trim: '#5a3a2a',
    accent: '#8a3a34',
    ground: '#d8ceb0',
    court: '#ece4cc',
    glow: '#ffd890',
    roofSet: ['gableX', 'gable', 'mansard'],
    sig: 'mansard',
    sigP: 0.2,
    odds: O(0.55, 0.3, 0.2, 0.3, 0.35),
    lamp: 'lantern',
    lampColor: '#ffd890',
    tree: ['#6b4a2e', '#8aa860'],
    prop: 'bench',
    propColor: '#7a5230',
  },
  stone: {
    walls: ['#a8a090', '#b8b0a0', '#9a9282'],
    roofs: ['#5a5a60', '#6a6a70'],
    trim: '#d0c8b8',
    accent: '#8a7a60',
    ground: '#b0a898',
    court: '#c8c0b0',
    roofSet: ['hip', 'gable', 'gableX'],
    sig: 'hip',
    sigP: 0.2,
    odds: O(0.6, 0.2, 0.15, 0.2, 0.15),
    lamp: 'lantern',
    lampColor: '#ffe0a0',
    tree: ['#5a4a3a', '#7a9a60'],
    prop: 'boulder',
    propColor: '#8a8478',
  },
  wild: {
    walls: ['#f3ead8', '#ece0c4', '#f8f0e0'],
    roofs: ['#5a8a44', '#6a9a50'],
    trim: '#7a5a3a',
    accent: '#c08a4a',
    ground: '#9ac07a',
    court: '#bcd89e',
    roofSet: ['gable', 'hip', 'tent'],
    sig: 'hip',
    sigP: 0.25,
    odds: O(0.35, 0.3, 0.3, 0.35, 0.15),
    lamp: 'lantern',
    lampColor: '#ffe0a0',
    tree: ['#6b4a2e', '#4f8a3a'],
    prop: 'pine',
    propColor: '#4f8a3a',
  },
  machine: {
    walls: ['#8a929c', '#e6c8a4', '#c8b8a4', '#9aa4ae'],
    roofs: ['#4f6a8a', '#5f7a9a'],
    trim: '#c8a040',
    accent: '#d8a050',
    ground: '#9aa0a8',
    court: '#b8bcc2',
    roofSet: ['gable', 'saw', 'flat'],
    sig: 'saw',
    sigP: 0.35,
    odds: O(0.5, 0.2, 0.2, 0.15, 0),
    lamp: 'lampHead',
    lampColor: '#fff3d0',
    tree: ['#5a4a3a', '#7f9a78'],
    prop: 'tank',
    propColor: '#8a929c',
  },
};

// ---- landmarks (one per district square, v3 §6; built in code, V3-D7) ----------------------------------

type P = [THREE.BufferGeometry, string];
/** merge parts into one geometry with baked vertex colours (colour × a soft height shade) */
function bake(parts: P[]): THREE.BufferGeometry {
  const out = parts.map(([g, col]) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute('uv');
    const c = new THREE.Color(col);
    const pos = n.getAttribute('position');
    const arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const k = pos.getY(i) < 0.05 ? 0.7 : 1;
      arr[i * 3] = c.r * k;
      arr[i * 3 + 1] = c.g * k;
      arr[i * 3 + 2] = c.b * k;
    }
    n.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (n.getAttribute('normal')) n.deleteAttribute('normal');
    return n;
  });
  const m = mergeGeometries(out)!;
  m.computeVertexNormals();
  return m;
}
const cyl = (r0: number, r1: number, h: number, seg: number, y = 0, x = 0, z = 0) =>
  new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y + h / 2, z);
const box = (w: number, h: number, d: number, y = 0, x = 0, z = 0) =>
  new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const cone = (r: number, h: number, seg: number, y = 0, x = 0, z = 0) =>
  new THREE.ConeGeometry(r, h, seg).translate(x, y + h / 2, z);
const ball = (r: number, y: number, x = 0, z = 0, d = 1) =>
  new THREE.IcosahedronGeometry(r, d).translate(x, y, z);

export function landmark(t: TypeId): THREE.BufferGeometry {
  const s = SKINS[t];
  const [w0, w1] = s.walls;
  const [r0] = s.roofs;
  const P: P[] = [[cyl(4.3, 4.6, 0.5, 16), '#d8d0c0']];
  switch (t) {
    case 'rune':
      P.push(
        [cyl(2.2, 2.6, 13, 10, 0.5), w0!],
        [cyl(3, 3, 0.5, 10, 6), s.trim],
        [cyl(2.8, 2.8, 0.5, 10, 10.5), s.trim],
        [cone(3.1, 9, 10, 13.5), r0!],
        [ball(0.7, 23.4, 0, 0, 0), s.lampColor],
      );
      break;
    case 'forge':
      P.push(
        [box(7, 6, 5.5, 0.5), w0!],
        [box(7.4, 1, 5.9, 6.5), r0!],
        [cyl(1.1, 1.4, 16, 8, 0.5, -2, -1.2), '#3a3336'],
        [cyl(1.3, 1.3, 0.6, 8, 16.5, -2, -1.2), '#5a4a44'],
        [box(2.2, 3, 0.2, 0.5, 1, 2.8), s.glow!],
      );
      break;
    case 'frost':
      P.push(
        [box(4, 13, 4, 0.5), w0!],
        [box(4.6, 1.2, 4.6, 13.5), '#ffffff'],
        [
          new THREE.CylinderGeometry(1.1, 1.1, 0.2, 12).rotateX(Math.PI / 2).translate(0, 10, 2.05),
          '#f4f8fc',
        ],
        [cone(2.6, 5, 4, 14.7).rotateY(Math.PI / 4), '#ffffff'],
        [cone(0.4, 2.4, 6, 19.6), s.trim],
      );
      break;
    case 'prism':
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const h = 7 + (k % 3) * 3;
        P.push([
          new THREE.OctahedronGeometry(1, 0)
            .scale(1.1, h / 2, 1.1)
            .translate(Math.cos(a) * 1.8, h / 2 + 0.5, Math.sin(a) * 1.8),
          k % 2 ? '#b8c8ff' : '#d8e0ff',
        ]);
      }
      P.push([
        new THREE.OctahedronGeometry(1, 0).scale(1.6, 11, 1.6).translate(0, 11.5, 0),
        '#c8d4ff',
      ]);
      break;
    case 'moss':
      P.push(
        [cyl(1.6, 2.6, 8, 8, 0.5), '#7a5a3a'],
        [ball(4.6, 11, 0, 0, 0), '#5f9a4a'],
        [ball(3.2, 13, -2.6, 1.2, 0), '#6fa854'],
        [ball(3, 12, 2.4, -1.5, 0), '#548a40'],
      );
      break;
    case 'tide':
      P.push(
        [cyl(1.8, 2.4, 4, 10, 0.5), '#f4f0e6'],
        [cyl(1.6, 1.8, 4, 10, 4.5), '#d8584a'],
        [cyl(1.4, 1.6, 4, 10, 8.5), '#f4f0e6'],
        [cyl(1.9, 1.9, 0.4, 10, 12.5), s.trim],
        [cyl(1, 1, 1.6, 8, 12.9), '#fff4c0'],
        [cone(1.6, 1.6, 10, 14.5), s.trim],
      );
      break;
    case 'machine':
      P.push(
        [box(3.8, 14, 3.8, 0.5), w0!],
        [box(4.4, 0.6, 4.4, 14.5), s.trim],
        [cone(2.6, 3, 4, 15.1).rotateY(Math.PI / 4), r0!],
        [
          cyl(1.5, 1.5, 0.3, 10)
            .rotateX(Math.PI / 2)
            .translate(0, 11, 1.95),
          s.trim,
        ],
        [
          cyl(1.1, 1.1, 0.3, 8)
            .rotateZ(Math.PI / 2)
            .translate(1.95, 7, 0),
          s.trim,
        ],
      );
      break;
    case 'iron':
      P.push(
        [box(4.4, 11, 4.4, 0.5), w0!],
        [box(6, 1.2, 3, 11.5), '#5b636c'],
        [box(2.4, 2, 2.4, 12.7), w1!],
      );
      break;
    case 'serpent':
      P.push(
        [box(8, 1.6, 8, 0.5), w0!],
        [box(6.2, 1.6, 6.2, 2.1), w1!],
        [box(4.4, 1.6, 4.4, 3.7), w0!],
        [box(2.8, 2.4, 2.8, 5.3), w1!],
        [cone(2.4, 2.6, 4, 7.7).rotateY(Math.PI / 4), r0!],
      );
      break;
    case 'spark':
      P.push(
        [cyl(0.5, 1.4, 16, 4, 0.5), '#8a8a90'],
        [ball(1.3, 17.6, 0, 0, 0), '#fff080'],
        [box(3.4, 3, 3.4, 0.5), w0!],
        [cone(2.6, 2, 4, 3.5).rotateY(Math.PI / 4), r0!],
      );
      break;
    case 'garnet':
      for (let k = 0; k < 4; k++)
        P.push(
          [box(5 - k, 2.6, 5 - k, 0.5 + k * 3.2), w0!],
          [cone((5 - k) * 0.9, 1.2, 4, 3.1 + k * 3.2).rotateY(Math.PI / 4), r0!],
        );
      break;
    case 'wing':
      P.push(
        [cyl(1.6, 2.4, 11, 8, 0.5), w0!],
        [cone(2, 2.6, 8, 11.5), r0!],
        [box(0.5, 13, 0.5).translate(0, -6.5, 0).rotateZ(0.5).translate(0, 10, 2.2), '#8a6a4a'],
        [
          box(0.5, 13, 0.5)
            .translate(0, -6.5, 0)
            .rotateZ(0.5 + Math.PI / 2)
            .translate(0, 10, 2.2),
          '#8a6a4a',
        ],
      );
      break;
    case 'shade':
      P.push(
        [cyl(1.8, 2.4, 12, 7, 0.5).rotateZ(0.08), w0!],
        [cone(2.6, 8, 7, 12.3).rotateZ(-0.12).translate(0.6, 0, 0), r0!],
        [ball(0.8, 20.5, 1.4, 0, 0), s.glow!],
      );
      break;
    case 'bloom':
      P.push(
        [cyl(3.4, 3.6, 0.9, 14, 0.5), s.trim],
        [cyl(0.5, 0.7, 4, 8, 1.4), s.trim],
        [cyl(2, 1.2, 0.6, 12, 5.4), s.trim],
        [ball(2.4, 8.6, 0, 0, 1), '#f098b8'],
        [ball(1.4, 10, 1.6, 0.6, 0), '#f8c0d4'],
      );
      break;
    case 'coral':
      P.push(
        [cyl(3.2, 3.4, 3, 14, 0.5), w0!],
        [
          new THREE.SphereGeometry(3.3, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2)
            .scale(1, 1.3, 1)
            .translate(0, 3.5, 0),
          r0!,
        ],
        [cone(0.9, 4, 10, 7.6), s.trim],
      );
      break;
    case 'quill':
      P.push(
        [box(5, 12, 5, 0.5), w0!],
        [box(5.4, 0.6, 5.4, 12.5), s.trim],
        [cone(3.9, 6, 4, 13.1).rotateY(Math.PI / 4), r0!],
        [box(2, 3, 0.2, 0.5, 0, 2.55), s.glow!],
      );
      break;
    case 'stone':
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        P.push([
          box(1.2, 4 + (k % 3), 0.8, 0.5, Math.cos(a) * 3.2, Math.sin(a) * 3.2).rotateY(-a),
          w0!,
        ]);
      }
      P.push([box(2, 7, 1.4, 0.5), w1!]);
      break;
    case 'wild':
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        P.push([
          cone(1.8, 6 + (k % 2) * 3, 6, 0.5, Math.cos(a) * 2.4, Math.sin(a) * 2.4),
          '#4f8a3a',
        ]);
      }
      P.push([cone(2.2, 12, 6, 0.5), '#3f7a30']);
      break;
  }
  return bake(P);
}

/** the plaza monument (v3 concept 08): a stacked golden spire on a stepped stone base */
export function monument(): THREE.BufferGeometry {
  const gold = '#f2c24c';
  const P: P[] = [
    [cyl(6.4, 7, 1, 8), '#d8d0c0'],
    [cyl(5, 5.6, 1, 8, 1), '#e4dccc'],
    [cyl(2.6, 3.4, 4, 8, 2), gold],
    [cyl(3.2, 3.2, 0.6, 8, 6), '#e0b040'],
    [cyl(1.8, 2.4, 5, 8, 6.6), gold],
    [cyl(2.4, 2.4, 0.5, 8, 11.6), '#e0b040'],
    [cyl(1, 1.6, 5, 8, 12.1), gold],
    [cone(1.2, 6, 8, 17.1), gold],
    [ball(0.8, 23.6, 0, 0, 1), '#fff0b0'],
  ];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    P.push([cyl(0.5, 0.7, 2.6, 6, 2, Math.cos(a) * 3.9, Math.sin(a) * 3.9), gold]);
    P.push([ball(0.55, 5.2, Math.cos(a) * 3.9, Math.sin(a) * 3.9, 0), gold]);
  }
  return bake(P);
}
