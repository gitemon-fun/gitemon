import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Piece, PieceColour, PieceKind } from '@gitemon/shared';

/**
 * v19 build 03 (V19-D3): the small pieces a 3D Gitemon grows at form 2 and form 3 — horns, a crest, crystals,
 * spikes, a fin, leaves, a flower, a flame, antennae, wing nubs, shoulder plates. Built from simple shapes at load
 * (a few hundred triangles each) and merged into the creature's own geometry, with the part weight of what they
 * sit on (`aPart`): a horn on the head turns and grows with the head, a flame on the tail wags with the tail.
 * Which pieces a type wears is art (the private look table); only the shapes are here.
 */

/** where pieces sit, found on the model at load (model space, height 1, front +Z) */
export interface Anchors {
  crown: THREE.Vector3;
  brow: THREE.Vector3;
  back: THREE.Vector3;
  /** the right shoulder; the left one is its mirror */
  shoulder: THREE.Vector3;
  tail: THREE.Vector3;
  /** the way the tail points at its tip */
  tailDir: THREE.Vector3;
}

/** colour class in `aAcc`: 0 the body (its texture), then the piece colours; 5 = gem, glowing (flame) */
const COLOUR: Record<PieceColour, number> = { gem: 1, deep: 2, body: 3, ivory: 4 };

type Part = { geo: THREE.BufferGeometry; glow?: boolean; colour?: PieceColour };

const cone = (r: number, h: number, seg = 7) => {
  const g = new THREE.ConeGeometry(r, h, seg, 1);
  g.translate(0, h / 2, 0);
  return g;
};
const prism = (r: number, h: number) => {
  // a crystal: a hexagonal column with a pointed tip
  const body = new THREE.CylinderGeometry(r, r, h * 0.72, 6, 1);
  body.translate(0, h * 0.36, 0);
  const tip = new THREE.ConeGeometry(r, h * 0.28, 6, 1);
  tip.translate(0, h * 0.86, 0);
  return mergeGeometries([body.toNonIndexed(), tip.toNonIndexed()])!;
};
const blob = (sx: number, sy: number, sz: number, seg = 8) => {
  const g = new THREE.SphereGeometry(1, seg, Math.max(4, seg >> 1));
  g.scale(sx, sy, sz);
  return g;
};
/** a little fixed-seed random, so a type's pieces always look the same */
const rnd = (k: number) => {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** the shapes of one piece, at the origin, pointing up (+Y), front +Z, `s` = its size */
function shapes(kind: PieceKind, s: number): Part[] {
  const out: Part[] = [];
  if (kind === 'horn') {
    const g = cone(0.16 * s, s);
    g.rotateX(0.35);
    out.push({ geo: g });
  } else if (kind === 'horns') {
    for (const side of [-1, 1]) {
      const g = cone(0.14 * s, s);
      g.rotateZ(-side * 0.45);
      g.rotateX(-0.55);
      g.translate(side * 0.1, 0, 0);
      out.push({ geo: g });
    }
  } else if (kind === 'crest') {
    for (let k = 0; k < 5; k++) {
      const a = (k - 2) * 0.32;
      const h = s * (1 - Math.abs(k - 2) * 0.18);
      const g = cone(0.09 * s, h, 5);
      g.scale(0.45, 1, 1);
      g.rotateX(-0.5);
      g.rotateZ(a);
      out.push({ geo: g });
    }
  } else if (kind === 'crystals') {
    for (let k = 0; k < 5; k++) {
      const h = s * (0.55 + 0.45 * rnd(k + 1));
      const g = prism(0.11 * s, h);
      g.rotateZ((rnd(k + 9) - 0.5) * 0.9);
      g.rotateX((rnd(k + 17) - 0.5) * 0.9);
      g.translate((rnd(k + 3) - 0.5) * 0.5 * s, 0, (rnd(k + 5) - 0.5) * 0.5 * s);
      out.push({ geo: g });
    }
  } else if (kind === 'spikes') {
    for (let k = 0; k < 7; k++) {
      const g = cone(0.12 * s, s * (0.6 + 0.4 * rnd(k + 2)), 5);
      g.rotateX(-0.7);
      g.rotateZ((rnd(k + 4) - 0.5) * 0.8);
      g.translate((rnd(k + 6) - 0.5) * 0.7 * s, 0, (rnd(k + 8) - 0.5) * 0.9 * s);
      out.push({ geo: g });
    }
  } else if (kind === 'fin') {
    const g = cone(0.32 * s, s, 4);
    g.scale(0.18, 1, 1);
    g.rotateX(-0.55);
    out.push({ geo: g });
  } else if (kind === 'leaf') {
    for (const side of [-1, 1]) {
      const g = blob(0.16 * s, 0.035 * s, 0.5 * s);
      g.translate(0, 0, 0.45 * s);
      g.rotateX(-0.9);
      g.rotateY(side * 0.55);
      out.push({ geo: g });
    }
  } else if (kind === 'flower') {
    for (let k = 0; k < 5; k++) {
      const g = blob(0.16 * s, 0.05 * s, 0.32 * s, 7);
      g.translate(0, 0.05 * s, 0.26 * s);
      g.rotateY((k / 5) * Math.PI * 2);
      out.push({ geo: g });
    }
    out.push({ geo: blob(0.13 * s, 0.1 * s, 0.13 * s, 7), colour: 'ivory' });
  } else if (kind === 'flame') {
    for (let k = 0; k < 3; k++) {
      const g = cone(0.2 * s, s * (1 - k * 0.22), 6);
      g.rotateZ((k - 1) * 0.35);
      out.push({ geo: g, glow: true });
    }
  } else if (kind === 'antennae') {
    for (const side of [-1, 1]) {
      const stalk = new THREE.CylinderGeometry(0.025 * s, 0.03 * s, s, 4, 1);
      stalk.translate(0, s / 2, 0);
      stalk.rotateZ(-side * 0.35);
      stalk.translate(side * 0.08, 0, 0);
      out.push({ geo: stalk, colour: 'deep' });
      const bead = blob(0.09 * s, 0.09 * s, 0.09 * s, 6);
      bead.translate(side * (0.08 + Math.sin(0.35) * s), Math.cos(0.35) * s, 0);
      out.push({ geo: bead });
    }
  } else if (kind === 'wings') {
    // one wing (the right one); the shoulders anchor mirrors it to the left
    const g = blob(0.12 * s, 0.5 * s, 0.32 * s, 8);
    g.translate(0, 0.45 * s, 0);
    g.rotateZ(-0.75);
    g.rotateX(-0.35);
    out.push({ geo: g });
  } else if (kind === 'plates') {
    const g = new THREE.BoxGeometry(0.5 * s, 0.14 * s, 0.6 * s);
    g.rotateZ(-0.35);
    out.push({ geo: g });
  }
  return out;
}

/**
 * The pieces as one geometry with the same attributes as the creature's (position, normal, uv, aLeg, aPart,
 * aAcc), ready to merge. `aPart` takes the part weight of the anchor: head (crown, brow) or tail.
 */
export function buildPieces(
  list: Piece[],
  at: Anchors,
  /** head pieces turn to where the face looks */
  faceYaw = 0,
): THREE.BufferGeometry | null {
  const geos: THREE.BufferGeometry[] = [];
  const add = (src: THREE.BufferGeometry, cls: number, head: number, tail: number) => {
    const g = (src.index ? src.toNonIndexed() : src).clone();
    g.deleteAttribute('uv');
    const n = g.getAttribute('position').count;
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    g.setAttribute('aLeg', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const part = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) part.set([head, tail, 0, 0], k * 4);
    g.setAttribute('aPart', new THREE.BufferAttribute(part, 4));
    g.setAttribute('aAcc', new THREE.BufferAttribute(new Float32Array(n).fill(cls), 1));
    geos.push(g);
  };
  for (const p of list) {
    for (const s of shapes(p.kind, p.size)) {
      const cls = s.glow ? 5 : COLOUR[s.colour ?? p.colour];
      if (p.at === 'shoulders') {
        // the right side as built, the left one mirrored (and its faces turned back the right way round)
        for (const side of [1, -1]) {
          const g = s.geo.clone();
          if (side < 0) {
            g.scale(-1, 1, 1);
            const ni = g.index ? g.toNonIndexed() : g;
            flipWinding(ni);
            ni.translate(-at.shoulder.x, at.shoulder.y, at.shoulder.z);
            add(ni, cls, 0, 0);
          } else {
            g.translate(at.shoulder.x, at.shoulder.y, at.shoulder.z);
            add(g, cls, 0, 0);
          }
        }
        continue;
      }
      const g = s.geo.clone();
      if (p.at === 'tail') {
        // point the piece along the tail's tip
        g.applyQuaternion(
          new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), at.tailDir),
        );
        g.translate(at.tail.x, at.tail.y, at.tail.z);
        add(g, cls, 0, 1);
      } else {
        const a = p.at === 'crown' ? at.crown : p.at === 'brow' ? at.brow : at.back;
        if (p.at !== 'back') g.rotateY(faceYaw);
        g.translate(a.x, a.y, a.z);
        add(g, cls, p.at === 'back' ? 0 : 1, 0);
      }
    }
  }
  if (!geos.length) return null;
  const merged = mergeGeometries(geos)!;
  merged.computeVertexNormals();
  return merged;
}

/** reverse each triangle (a mirrored copy would otherwise face inward) */
function flipWinding(g: THREE.BufferGeometry) {
  for (const name of ['position', 'normal']) {
    const a = g.getAttribute(name);
    if (!a) continue;
    for (let t = 0; t < a.count; t += 3) {
      const x = a.getX(t + 1),
        y = a.getY(t + 1),
        z = a.getZ(t + 1);
      a.setXYZ(t + 1, a.getX(t + 2), a.getY(t + 2), a.getZ(t + 2));
      a.setXYZ(t + 2, x, y, z);
    }
  }
}
