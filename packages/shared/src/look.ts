import type { TypeId } from './types.js';

/**
 * v19 (V19-D2): how a type's 3D Gitemon differs from the base model — its proportions, its markings and the
 * small pieces it grows at form 2 and form 3. The table itself is art and lives in the private art set
 * (`ArtSet.looks`, like the gaits); this file holds the shape of an entry, the limits and the pure maths the
 * client and the tests share. An absent entry = the base model (`BASE_LOOK`).
 */

export const MARKS = ['none', 'stripes', 'spots', 'saddle', 'socks', 'mask', 'belly'] as const;
export type Mark = (typeof MARKS)[number];

/** where a piece sits: on top of the head, on the forehead, along the back, at the shoulders, on the tail tip */
export const ANCHORS = ['crown', 'brow', 'back', 'shoulders', 'tail'] as const;
export type Anchor = (typeof ANCHORS)[number];

export const PIECES = [
  'horn', // one horn on the brow
  'horns', // a pair, swept back
  'crest', // a fan of small blades
  'crystals', // a cluster of crystal prisms
  'spikes', // a cluster of cones
  'fin', // one flat fin
  'leaf', // a pair of leaves
  'flower', // a ring of petals
  'flame', // a cluster of flame tongues
  'antennae', // two stalks with a bead
  'wings', // a pair of small wing nubs
  'plates', // a pair of shoulder plates
] as const;
export type PieceKind = (typeof PIECES)[number];

/** a piece's colour: the gem colour (second type), the type's deep colour, the body, ivory */
export const PIECE_COLOURS = ['gem', 'deep', 'body', 'ivory'] as const;
export type PieceColour = (typeof PIECE_COLOURS)[number];

export interface Piece {
  kind: PieceKind;
  at: Anchor;
  colour: PieceColour;
  /** size as a share of the creature's height */
  size: number;
}

export interface Look {
  /** scale of each part about its pivot, and of the body's width and length (1 = the base model) */
  head: number;
  ear: number;
  tail: number;
  leg: number;
  width: number;
  length: number;
  mark: Mark;
  /** how many marks fit across the body (stripes, spots) */
  markScale: number;
  /** pieces grown at form 2, and at form 3 (form 3 lists all it wears) */
  f2: Piece[];
  f3: Piece[];
}

export const BASE_LOOK: Look = {
  head: 1,
  ear: 1,
  tail: 1,
  leg: 1,
  width: 1,
  length: 1,
  mark: 'none',
  markScale: 1,
  f2: [],
  f3: [],
};

/** the limits a look must keep, so the motion code (pivots, feet, sit / bow) still fits the body */
export const LOOK_RANGE = { min: 0.5, max: 1.7 } as const;
/** a piece's size limits (share of the creature's height) */
export const PIECE_RANGE = { min: 0.05, max: 0.45 } as const;
/** at most this many pieces at one form (triangle budget, G6) */
export const MAX_PIECES = 3;

/** problems with one look, empty when it is fine */
export function lookProblems(l: Look): string[] {
  const out: string[] = [];
  for (const k of ['head', 'ear', 'tail', 'leg', 'width', 'length'] as const)
    if (!(l[k] >= LOOK_RANGE.min && l[k] <= LOOK_RANGE.max)) out.push(`${k} ${l[k]} out of range`);
  if (!MARKS.includes(l.mark)) out.push(`mark ${l.mark}`);
  if (!(l.markScale > 0)) out.push('markScale');
  for (const [form, list] of [
    [2, l.f2],
    [3, l.f3],
  ] as const) {
    if (list.length > MAX_PIECES) out.push(`form ${form}: ${list.length} pieces`);
    for (const p of list) {
      if (!PIECES.includes(p.kind)) out.push(`form ${form}: kind ${p.kind}`);
      if (!ANCHORS.includes(p.at)) out.push(`form ${form}: anchor ${p.at}`);
      if (!PIECE_COLOURS.includes(p.colour)) out.push(`form ${form}: colour ${p.colour}`);
      if (!(p.size >= PIECE_RANGE.min && p.size <= PIECE_RANGE.max))
        out.push(`form ${form}: size ${p.size}`);
    }
  }
  return out;
}

/** the look of a type in an art set's table; the base model when the table has none */
export const lookOf = (looks: Partial<Record<TypeId, Look>> | undefined, t: TypeId): Look =>
  looks?.[t] ?? BASE_LOOK;

/** V19-D3: the pieces a creature wears follow its stored form (merit OR level), never merit alone */
export const piecesFor = (l: Look, form: 1 | 2 | 3): Piece[] =>
  form === 3 ? l.f3 : form === 2 ? l.f2 : [];

export type Vec3 = [number, number, number];

/**
 * Where the turning points end up once a look reshapes the base model (model space, height 1, front +Z).
 * The vertex shader reshapes in this order: body length (about the body's middle; the head moves with the
 * neck) and width, legs (below the hip line stretch, above it shift), head about the neck, ears about their
 * base, tail about its root. The life turns (head, ears, tail) then use these moved points.
 */
export function lookPivots(
  l: Look,
  rig: { neck: Vec3; tailRoot: Vec3; earL: Vec3; earR: Vec3; zs: Vec3; hip: number },
) {
  const zmid = rig.zs[1];
  const lift = (l.leg - 1) * rig.hip;
  const z = (v: number) => zmid + (v - zmid) * l.length;
  const neck: Vec3 = [rig.neck[0], rig.neck[1] + lift, z(rig.neck[2])];
  // the head (and the ears on it) moves with the neck, then grows about it
  const dz = neck[2] - rig.neck[2];
  const ear = (e: Vec3): Vec3 => {
    const moved: Vec3 = [e[0], e[1] + lift, e[2] + dz];
    return [
      neck[0] + (moved[0] - neck[0]) * l.head,
      neck[1] + (moved[1] - neck[1]) * l.head,
      neck[2] + (moved[2] - neck[2]) * l.head,
    ];
  };
  return {
    neck,
    neckShift: dz,
    lift,
    earL: ear(rig.earL),
    earR: ear(rig.earR),
    tailRoot: [rig.tailRoot[0] * l.width, rig.tailRoot[1] + lift, z(rig.tailRoot[2])] as Vec3,
    zs: [z(rig.zs[0]), zmid, z(rig.zs[2])] as Vec3,
  };
}
