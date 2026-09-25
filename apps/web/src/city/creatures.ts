import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TYPE_INFO, hash32, type MapGitemon, type Shape, type TypeId } from '@gitemon/shared';

/**
 * Low-poly "toy" Gitemon (DECISIONS D31). Each type is a small recipe of primitives; form 1/2/3
 * grow and gain features; the work-shape is a little accessory; shiny swaps the colourway.
 * Every creature is merged into ONE geometry with vertex colours, so a street of hundreds is cheap.
 */

type Col =
  'main' | 'accent' | 'dark' | 'belly' | 'eye' | 'white' | 'gold' | 'metal' | 'wood' | 'pink';
type Kind = 'sphere' | 'cone' | 'box' | 'cyl' | 'torus' | 'ico';
/** kind, colour, position, scale, rotation (radians), mirror on x */
type Part = [
  Kind,
  Col,
  [number, number, number],
  [number, number, number],
  [number, number, number]?,
  boolean?,
];

interface Recipe {
  parts: (f: 1 | 2 | 3) => Part[];
  /** head centre, for accessories */
  head: [number, number, number];
  headR: number;
}

const eyes = (y: number, z: number, x: number, r = 0.075): Part[] => [
  ['sphere', 'white', [x, y, z], [r * 1.25, r * 1.35, r * 0.7], undefined, true],
  ['sphere', 'eye', [x, y - 0.005, z + r * 0.45], [r * 0.75, r * 0.85, r * 0.5], undefined, true],
];
const legs4 = (y: number, spreadX: number, spreadZ: number, h: number, r = 0.08): Part[] => [
  ['cyl', 'dark', [spreadX, y, spreadZ], [r, h, r], undefined, true],
  ['cyl', 'dark', [spreadX, y, -spreadZ], [r, h, r], undefined, true],
];
const crown = (y: number, r: number): Part[] => {
  const out: Part[] = [['cyl', 'gold', [0, y, 0], [r, 0.05, r]]];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    out.push([
      'cone',
      'gold',
      [Math.cos(a) * r * 0.85, y + 0.08, Math.sin(a) * r * 0.85],
      [0.045, 0.14, 0.045],
    ]);
  }
  return out;
};

const R: Record<TypeId, Recipe> = {
  // Magma: salamander → armoured drake → volcano dragon
  forge: {
    head: [0, 0.62, 0.42],
    headR: 0.3,
    parts: (f) => [
      ['sphere', 'main', [0, 0.36, -0.02], [0.42, 0.32, 0.55]],
      ['sphere', 'belly', [0, 0.3, 0.12], [0.3, 0.22, 0.38]],
      ['sphere', 'main', [0, 0.62, 0.42], [0.3, 0.27, 0.3]],
      ...eyes(0.68, 0.64, 0.13),
      ['cone', 'main', [0, 0.32, -0.62], [0.16, 0.5, 0.16], [-Math.PI / 2 - 0.3, 0, 0]],
      ['sphere', 'accent', [0.2, 0.52, -0.05], [0.07, 0.07, 0.07], undefined, true],
      ['sphere', 'accent', [0.12, 0.55, -0.28], [0.06, 0.06, 0.06], undefined, true],
      ...legs4(0.1, 0.24, 0.24, 0.2, 0.09),
      ...(f >= 2
        ? ([0, 1, 2, 3].map((k) => [
            'cone',
            'dark',
            [0, 0.66 - k * 0.03, 0.12 - k * 0.2],
            [0.07, 0.16, 0.07],
            [-0.3, 0, 0],
          ]) as Part[])
        : []),
      ...(f >= 3
        ? ([
            ['box', 'dark', [0.42, 0.66, -0.1], [0.5, 0.03, 0.34], [0, 0, 0.5], true],
            ['cone', 'accent', [0.14, 0.9, 0.36], [0.06, 0.22, 0.06], [0.3, 0, -0.3], true],
          ] as Part[])
        : []),
    ],
  },
  // Iron: tin beetle → rhino beetle → mech beetle
  iron: {
    head: [0, 0.42, 0.42],
    headR: 0.22,
    parts: (f) => [
      ['sphere', 'metal', [0, 0.38, -0.05], [0.44, 0.3, 0.5]],
      ['sphere', 'main', [0, 0.46, -0.08], [0.4, 0.26, 0.44]],
      ['box', 'dark', [0, 0.5, -0.08], [0.02, 0.2, 0.8]],
      ['sphere', 'dark', [0, 0.36, 0.4], [0.22, 0.18, 0.2]],
      ...eyes(0.42, 0.56, 0.1, 0.06),
      ['cone', 'dark', [0, 0.58, 0.52], [0.06, f >= 2 ? 0.34 : 0.16, 0.06], [0.5, 0, 0]],
      ...([0.18, -0.02, -0.22].flatMap((z) => [
        ['cyl', 'dark', [0.36, 0.14, z], [0.04, 0.24, 0.04], [0, 0, 0.5], true],
      ]) as Part[]),
      ...(f >= 3
        ? ([
            ['sphere', 'accent', [0, 0.46, -0.52], [0.14, 0.14, 0.08]],
            ['cyl', 'metal', [0.32, 0.62, -0.2], [0.06, 0.2, 0.06], undefined, true],
          ] as Part[])
        : []),
    ],
  },
  // Python: snakelet → vine serpent → jungle serpent
  serpent: {
    head: [0, 0.78, 0.2],
    headR: 0.26,
    parts: (f) => [
      ['torus', 'main', [0, 0.14, 0], [0.34, 0.34, 0.5], [Math.PI / 2, 0, 0]],
      ['torus', 'main', [0, 0.32, -0.02], [0.24, 0.24, 0.42], [Math.PI / 2, 0, 0]],
      ['cyl', 'main', [0, 0.52, 0.12], [0.13, 0.36, 0.13], [0.3, 0, 0]],
      ['sphere', 'main', [0, 0.78, 0.2], [0.26, 0.22, 0.28]],
      ['sphere', 'belly', [0, 0.46, 0.2], [0.09, 0.2, 0.06]],
      ...eyes(0.84, 0.4, 0.11),
      ['cone', 'accent', [0.18, 0.66, 0.05], [0.12, 0.08, 0.2], [0, 0, -1.2], true],
      ...(f >= 2 ? ([['cone', 'pink', [0, 1.0, 0.12], [0.1, 0.16, 0.1]]] as Part[]) : []),
      ...(f >= 3
        ? ([['box', 'accent', [0.36, 0.8, 0], [0.4, 0.03, 0.22], [0, 0.2, 0.6], true]] as Part[])
        : []),
    ],
  },
  // JavaScript: firefly moth → storm moth → thunder moth
  spark: {
    head: [0, 0.72, 0.18],
    headR: 0.24,
    parts: (f) => [
      ['sphere', 'white', [0, 0.46, 0], [0.3, 0.38, 0.3]],
      ['sphere', 'main', [0, 0.3, -0.05], [0.26, 0.24, 0.26]],
      ['sphere', 'white', [0, 0.74, 0.14], [0.24, 0.22, 0.22]],
      ...eyes(0.78, 0.33, 0.1),
      [
        'box',
        'main',
        [0.36, 0.6, -0.08],
        [0.46, 0.03, f >= 3 ? 0.6 : 0.4],
        [0.2, -0.3, 0.45],
        true,
      ],
      ['box', 'accent', [0.3, 0.42, -0.08], [0.32, 0.025, 0.3], [0.2, -0.3, 0.2], true],
      ['cyl', 'dark', [0.08, 0.98, 0.2], [0.015, 0.2, 0.015], [0.3, 0, -0.3], true],
      ['sphere', 'accent', [0.12, 1.08, 0.24], [0.04, 0.04, 0.04], undefined, true],
      ...(f >= 2
        ? ([
            ['box', 'dark', [0.46, 0.66, -0.08], [0.04, 0.035, 0.46], [0.2, -0.3, 0.45], true],
          ] as Part[])
        : []),
    ],
  },
  // TypeScript: crystal fox kit → prism fox → crystal kitsune
  prism: {
    head: [0, 0.74, 0.3],
    headR: 0.26,
    parts: (f) => [
      ['sphere', 'main', [0, 0.4, 0], [0.28, 0.3, 0.4]],
      ['sphere', 'belly', [0, 0.38, 0.14], [0.18, 0.2, 0.2]],
      ['sphere', 'main', [0, 0.74, 0.3], [0.26, 0.24, 0.24]],
      ['cone', 'white', [0, 0.68, 0.52], [0.09, 0.14, 0.09], [Math.PI / 2, 0, 0]],
      ...eyes(0.8, 0.5, 0.1),
      ['cone', 'main', [0.14, 1.0, 0.28], [0.08, 0.22, 0.06], [0, 0, -0.25], true],
      ...legs4(0.1, 0.14, 0.18, 0.2),
      ...(Array.from({ length: f === 3 ? 3 : 1 }, (_, k) => [
        'ico',
        'accent',
        [(k - (f === 3 ? 1 : 0)) * 0.24, 0.6, -0.5],
        [0.14, 0.34, 0.14],
        [-0.8, 0, (k - 1) * 0.4],
      ]) as Part[]),
    ],
  },
  // Go: seal pup → shell seal → walrus king
  tide: {
    head: [0, 0.66, 0.2],
    headR: 0.3,
    parts: (f) => [
      ['sphere', 'main', [0, 0.36, 0], [0.4, 0.36, 0.46]],
      ['sphere', 'belly', [0, 0.34, 0.2], [0.28, 0.26, 0.24]],
      ['sphere', 'main', [0, 0.68, 0.2], [0.3, 0.27, 0.28]],
      ...eyes(0.74, 0.44, 0.13),
      ['sphere', 'dark', [0, 0.64, 0.46], [0.05, 0.04, 0.04]],
      ['box', 'main', [0.4, 0.2, 0.08], [0.22, 0.04, 0.12], [0, 0.4, -0.3], true],
      ['box', 'main', [0, 0.1, -0.44], [0.3, 0.04, 0.14]],
      ...(f >= 2
        ? ([
            ['cone', 'white', [0.07, 0.52, 0.44], [0.03, 0.18, 0.03], [Math.PI, 0, 0], true],
          ] as Part[])
        : []),
    ],
  },
  // Java/Kotlin: snow owlet → frost owl → glacier owl
  frost: {
    head: [0, 0.76, 0.12],
    headR: 0.3,
    parts: (f) => [
      ['sphere', 'white', [0, 0.46, 0], [0.36, 0.44, 0.34]],
      ['sphere', 'main', [0, 0.78, 0.06], [0.32, 0.28, 0.3]],
      ['sphere', 'white', [0.12, 0.78, 0.26], [0.12, 0.12, 0.06], undefined, true],
      ['sphere', 'eye', [0.12, 0.78, 0.31], [0.06, 0.07, 0.03], undefined, true],
      ['cone', 'gold', [0, 0.7, 0.34], [0.04, 0.07, 0.04], [Math.PI, 0, 0]],
      ['cone', 'main', [0.2, 1.04, 0.02], [0.06, 0.14, 0.06], [0, 0, -0.3], true],
      ['sphere', 'main', [0.34, 0.46, -0.02], [0.08, f >= 3 ? 0.46 : 0.3, 0.22], [0, 0, 0.2], true],
      ['cone', 'gold', [0.08, 0.04, 0.12], [0.04, 0.08, 0.04], undefined, true],
      ...(f >= 2
        ? ([
            ['ico', 'accent', [0.36, 0.72, -0.08], [0.06, 0.18, 0.06], [0, 0, -0.4], true],
          ] as Part[])
        : []),
    ],
  },
  // Ruby/Elixir: gem hedgehog → crystal hedgehog → garnet porcupine
  garnet: {
    head: [0, 0.4, 0.4],
    headR: 0.2,
    parts: (f) => [
      ['sphere', 'belly', [0, 0.36, 0.1], [0.36, 0.34, 0.4]],
      ['sphere', 'main', [0, 0.44, -0.06], [0.4, 0.38, 0.4]],
      ['sphere', 'belly', [0, 0.4, 0.38], [0.2, 0.18, 0.16]],
      ...eyes(0.46, 0.5, 0.09, 0.06),
      ['sphere', 'eye', [0, 0.38, 0.56], [0.04, 0.035, 0.035]],
      ...(Array.from({ length: f === 1 ? 6 : f === 2 ? 9 : 13 }, (_, k) => {
        const a = (k / (f === 1 ? 6 : f === 2 ? 9 : 13)) * Math.PI * 1.6 - 0.8;
        return [
          'ico',
          'accent',
          [Math.sin(a) * 0.34, 0.62 + Math.cos(a) * 0.1, -0.12 - Math.cos(a) * 0.2],
          [0.07, f === 3 ? 0.3 : 0.2, 0.07],
          [-0.6, 0, -a * 0.6],
        ] as Part;
      }) as Part[]),
    ],
  },
  // PHP: moss elephant → mossy mammoth → ancient mammoth
  moss: {
    head: [0, 0.66, 0.36],
    headR: 0.3,
    parts: (f) => [
      ['sphere', 'main', [0, 0.46, -0.06], [0.42, 0.36, 0.5]],
      ['sphere', 'main', [0, 0.66, 0.34], [0.3, 0.28, 0.26]],
      ['sphere', 'main', [0.3, 0.68, 0.26], [0.04, 0.22, 0.18], undefined, true],
      ['cyl', 'main', [0, 0.46, 0.58], [0.07, 0.3, 0.07], [0.35, 0, 0]],
      ...eyes(0.72, 0.56, 0.12, 0.055),
      ...legs4(0.14, 0.24, 0.24, 0.28, 0.1),
      ['sphere', 'accent', [0.1, 0.78, -0.1], [0.24, 0.1, 0.3]],
      ...(f >= 2
        ? ([['cone', 'white', [0.14, 0.44, 0.5], [0.03, 0.2, 0.03], [1.9, 0, 0], true]] as Part[])
        : []),
      ...(f >= 3
        ? ([
            ['box', 'wood', [0, 0.92, -0.14], [0.26, 0.2, 0.26]],
            ['cone', 'pink', [0, 1.1, -0.14], [0.22, 0.16, 0.22]],
          ] as Part[])
        : []),
    ],
  },
  // Swift/Dart: swift chick → swallow → sky falcon
  wing: {
    head: [0, 0.72, 0.16],
    headR: 0.26,
    parts: (f) => [
      ['sphere', 'main', [0, 0.42, 0], [0.3, 0.34, 0.34]],
      ['sphere', 'belly', [0, 0.38, 0.14], [0.2, 0.24, 0.2]],
      ['sphere', 'main', [0, 0.72, 0.14], [0.26, 0.24, 0.24]],
      ...eyes(0.78, 0.36, 0.11),
      ['cone', 'gold', [0, 0.68, 0.4], [0.05, 0.12, 0.05], [Math.PI / 2, 0, 0]],
      [
        'box',
        'main',
        [0.34, 0.5, -0.06],
        [f >= 3 ? 0.6 : 0.3, 0.04, 0.24],
        [0, 0, f >= 2 ? 0.5 : -0.6],
        true,
      ],
      ['cone', 'dark', [0, 0.36, -0.42], [0.1, 0.26, 0.04], [-1.9, 0, 0]],
      ...(f >= 3
        ? ([['cone', 'gold', [0, 0.98, 0.08], [0.05, 0.2, 0.05], [-0.4, 0, 0]]] as Part[])
        : []),
    ],
  },
  // Functional: axolotl → axolotl sage → cosmic axolotl
  rune: {
    head: [0, 0.62, 0.26],
    headR: 0.3,
    parts: (f) => [
      ['sphere', 'main', [0, 0.34, -0.06], [0.3, 0.26, 0.44]],
      ['sphere', 'main', [0, 0.62, 0.26], [0.32, 0.26, 0.26]],
      ...eyes(0.68, 0.48, 0.14),
      ...([0.12, 0, -0.12].map((dy) => [
        'cone',
        'pink',
        [0.34, 0.66 + dy, 0.2],
        [0.035, 0.16, 0.035],
        [0, 0, -1.2 - dy * 3],
        true,
      ]) as Part[]),
      ['cone', 'main', [0, 0.3, -0.58], [0.12, 0.34, 0.05], [-Math.PI / 2, 0, 0]],
      ...legs4(0.12, 0.2, 0.2, 0.18, 0.06),
      ...(f >= 3
        ? ([['torus', 'gold', [0, 1.02, 0.2], [0.18, 0.18, 0.18], [Math.PI / 2, 0, 0]]] as Part[])
        : []),
    ],
  },
  // Shell/Nix: shadow bat → cave bat → bat lord
  shade: {
    head: [0, 0.62, 0.1],
    headR: 0.28,
    parts: (f) => [
      ['sphere', 'main', [0, 0.46, 0], [0.3, 0.36, 0.28]],
      ['sphere', 'main', [0, 0.74, 0.08], [0.26, 0.24, 0.24]],
      ['cone', 'main', [0.14, 1.0, 0.06], [0.07, 0.2, 0.05], [0, 0, -0.2], true],
      ['sphere', 'accent', [0.1, 0.78, 0.3], [0.06, 0.05, 0.03], undefined, true],
      ['box', 'dark', [0.42, 0.56, -0.04], [f >= 3 ? 0.62 : 0.4, 0.03, 0.3], [0, 0, 0.35], true],
      ...(f >= 3
        ? ([['cone', 'dark', [0, 0.4, -0.2], [0.34, 0.6, 0.2], [0.1, 0, 0]]] as Part[])
        : []),
    ],
  },
  // HTML/CSS: flower bunny → blossom hare → sakura spirit
  bloom: {
    head: [0, 0.72, 0.2],
    headR: 0.26,
    parts: (f) => [
      ['sphere', 'white', [0, 0.38, 0], [0.3, 0.3, 0.34]],
      ['sphere', 'white', [0, 0.72, 0.18], [0.26, 0.24, 0.24]],
      ['sphere', 'main', [0.1, 1.04, 0.12], [0.06, 0.24, 0.05], [0, 0, -0.15], true],
      ...eyes(0.78, 0.4, 0.1),
      ['sphere', 'pink', [0, 0.72, 0.42], [0.04, 0.03, 0.03]],
      ['sphere', 'white', [0, 0.38, -0.34], [0.1, 0.1, 0.1]],
      ...([0, 1, 2].map((k) => [
        'sphere',
        'main',
        [Math.cos(k * 2.1) * 0.2, 0.92, 0.1 + Math.sin(k * 2.1) * 0.12],
        [0.06, 0.04, 0.06],
      ]) as Part[]),
      ...(f >= 2
        ? ([['torus', 'main', [0, 0.54, 0.1], [0.2, 0.2, 0.2], [Math.PI / 2, 0, 0]]] as Part[])
        : []),
    ],
  },
  // C#: coral crab → reef crab → titan crab
  coral: {
    head: [0, 0.4, 0.2],
    headR: 0.2,
    parts: (f) => [
      ['sphere', 'main', [0, 0.32, 0], [0.42, 0.22, 0.34]],
      ['cyl', 'main', [0.12, 0.54, 0.22], [0.03, 0.16, 0.03], undefined, true],
      ['sphere', 'white', [0.12, 0.64, 0.22], [0.06, 0.06, 0.06], undefined, true],
      ['sphere', 'eye', [0.12, 0.64, 0.27], [0.035, 0.035, 0.03], undefined, true],
      ['sphere', 'accent', [0.5, 0.34, 0.24], [0.14, 0.1, 0.12], undefined, true],
      ...([0.14, -0.04, -0.2].map((z) => [
        'cyl',
        'main',
        [0.4, 0.12, z],
        [0.035, 0.2, 0.035],
        [0, 0, 0.8],
        true,
      ]) as Part[]),
      ...(f >= 2 ? ([['ico', 'pink', [0, 0.54, -0.1], [0.14, 0.22, 0.14]]] as Part[]) : []),
      ...(f >= 3
        ? ([
            ['box', 'white', [0, 0.72, -0.1], [0.3, 0.26, 0.26]],
            ['cone', 'accent', [0, 0.96, -0.1], [0.2, 0.2, 0.2]],
          ] as Part[])
        : []),
    ],
  },
  // Docs: ink squid → scholar squid → ink kraken
  quill: {
    head: [0, 0.7, 0],
    headR: 0.3,
    parts: (f) => [
      ['sphere', 'main', [0, 0.66, 0], [0.3, 0.38, 0.3]],
      ['cone', 'main', [0, 1.06, 0], [0.24, 0.2, 0.24]],
      ...eyes(0.66, 0.26, 0.11),
      ...Array.from({ length: f === 3 ? 8 : 6 }, (_, k) => {
        const a = (k / (f === 3 ? 8 : 6)) * Math.PI * 2;
        return [
          'cone',
          'main',
          [Math.cos(a) * 0.18, 0.2, Math.sin(a) * 0.18],
          [0.06, 0.36, 0.06],
          [Math.PI + Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3],
        ] as Part;
      }),
      ...(f >= 2
        ? ([
            ['cyl', 'white', [0.3, 0.6, 0.1], [0.02, 0.3, 0.02], [0, 0, 0.4]],
            ['cone', 'dark', [0.36, 0.75, 0.1], [0.04, 0.1, 0.02], [0, 0, 0.4]],
          ] as Part[])
        : []),
    ],
  },
  // SQL/R: pebble golem → boulder golem → mountain golem
  stone: {
    head: [0, 0.82, 0.08],
    headR: 0.24,
    parts: (f) => [
      ['ico', 'main', [0, 0.46, 0], [0.38, 0.36, 0.3]],
      ['ico', 'main', [0, 0.84, 0.06], [0.24, 0.2, 0.22]],
      ['sphere', 'accent', [0.09, 0.86, 0.26], [0.04, 0.04, 0.03], undefined, true],
      ['ico', 'dark', [0.44, 0.5, 0], [0.14, 0.24, 0.14], undefined, true],
      ['ico', 'dark', [0.16, 0.12, 0], [0.13, 0.13, 0.13], undefined, true],
      ['sphere', 'accent', [0.1, 0.66, 0.2], [0.18, 0.06, 0.16]],
      ...(f >= 2 ? ([['ico', 'pink', [0.2, 1.0, -0.08], [0.06, 0.14, 0.06]]] as Part[]) : []),
    ],
  },
  // Everything else: sprout sheep → meadow ram → flower ram
  wild: {
    head: [0, 0.6, 0.38],
    headR: 0.24,
    parts: (f) => [
      ...([
        [0, 0.42, 0],
        [0.2, 0.46, 0.1],
        [-0.2, 0.46, 0.1],
        [0.18, 0.44, -0.16],
        [-0.18, 0.44, -0.16],
        [0, 0.6, -0.04],
      ].map((p) => [
        'sphere',
        'white',
        p as [number, number, number],
        [0.24, 0.22, 0.24],
      ]) as Part[]),
      ['sphere', 'dark', [0, 0.56, 0.38], [0.18, 0.18, 0.18]],
      ...eyes(0.6, 0.5, 0.08, 0.055),
      ...legs4(0.12, 0.16, 0.16, 0.22, 0.05),
      ['sphere', 'main', [0, 0.78, 0.2], [0.06, 0.12, 0.06]],
      ...(f >= 2
        ? ([['torus', 'main', [0.18, 0.64, 0.34], [0.09, 0.09, 0.09], [0, 1.4, 0], true]] as Part[])
        : []),
      ...(f >= 3
        ? ([
            ['sphere', 'pink', [0.12, 0.72, 0], [0.05, 0.05, 0.05], undefined, true],
            ['sphere', 'gold', [0, 0.72, -0.14], [0.05, 0.05, 0.05]],
          ] as Part[])
        : []),
    ],
  },
  // Agents: drone → rover → guardian mech
  machine: {
    head: [0, 0.8, 0.06],
    headR: 0.24,
    parts: (f) => [
      ['box', 'metal', [0, 0.46, 0], [0.5, 0.42, 0.4]],
      ['box', 'main', [0, 0.82, 0.04], [0.36, 0.26, 0.32]],
      ['box', 'accent', [0, 0.84, 0.21], [0.26, 0.06, 0.02]],
      ['cyl', 'dark', [0.14, 1.02, 0], [0.015, 0.16, 0.015], undefined, true],
      ['sphere', 'accent', [0.14, 1.12, 0], [0.035, 0.035, 0.035], undefined, true],
      ['cyl', 'dark', [0.18, 0.12, 0], [0.12, 0.08, 0.12], [0, 0, Math.PI / 2], true],
      ...(f >= 2
        ? ([['box', 'metal', [0.34, 0.5, 0], [0.12, 0.3, 0.12], undefined, true]] as Part[])
        : []),
    ],
  },
};

const ACCESSORY: Record<Shape, (r: Recipe) => Part[]> = {
  builder: () => [
    ['cyl', 'wood', [0.46, 0.4, 0.1], [0.025, 0.26, 0.025], [0, 0, -0.3]],
    ['box', 'metal', [0.52, 0.54, 0.1], [0.14, 0.08, 0.08], [0, 0, -0.3]],
  ],
  reviewer: (r) => [
    [
      'torus',
      'dark',
      [r.head[0] + 0.11, r.head[1] + 0.03, r.head[2] + r.headR * 0.9],
      [0.075, 0.075, 0.075],
      undefined,
      true,
    ],
  ],
  maintainer: (r) => [
    [
      'box',
      'accent',
      [0, r.head[1] - r.headR * 1.1, r.head[2] - 0.05],
      [r.headR * 1.4, 0.05, r.headR * 1.2],
    ],
  ],
  steady: (r) => [
    [
      'torus',
      'pink',
      [0, r.head[1] - r.headR * 0.9, r.head[2] - 0.05],
      [r.headR * 0.95, r.headR * 0.95, r.headR * 1.3],
      [Math.PI / 2, 0, 0],
    ],
  ],
  polyglot: (r) =>
    [0, 1, 2].map(
      (k) =>
        [
          'ico',
          k === 0 ? 'accent' : k === 1 ? 'pink' : 'gold',
          [Math.cos(k * 2.1) * 0.42, r.head[1] + 0.3, Math.sin(k * 2.1) * 0.3],
          [0.05, 0.05, 0.05],
        ] as Part,
    ),
};

// ---- colours --------------------------------------------------------------------------------------

function shiftHue(hex: string, turn: number, dl = 0): THREE.Color {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL((hsl.h + turn / 360 + 1) % 1, Math.min(1, hsl.s), Math.max(0, Math.min(1, hsl.l + dl)));
  return c;
}

function palette(g: MapGitemon): Record<Col, THREE.Color> {
  const a = TYPE_INFO[g.t1].colors;
  const b = g.t2 ? TYPE_INFO[g.t2].colors : a;
  const h = hash32(`hue:${g.id}`);
  const turn = g.s ? 150 + (h % 60) : ((h % 21) - 10) * 1.2;
  const dl = g.s ? 0.04 : (((h >>> 8) % 9) - 4) * 0.01;
  return {
    main: shiftHue(a[0], turn, dl),
    accent: shiftHue(g.t2 ? b[0] : a[1], turn, dl),
    dark: shiftHue(a[2], turn, dl),
    belly: shiftHue(a[1], turn, 0.08),
    eye: new THREE.Color('#15151b'),
    white: new THREE.Color('#fbf8f2'),
    gold: new THREE.Color('#f2c94c'),
    metal: new THREE.Color('#a9b3bd'),
    wood: new THREE.Color('#8a5a36'),
    pink: new THREE.Color('#ff8fb8'),
  };
}

// ---- geometry -------------------------------------------------------------------------------------

const BASE: Record<Kind, () => THREE.BufferGeometry> = {
  sphere: () => new THREE.SphereGeometry(1, 9, 7),
  cone: () => new THREE.ConeGeometry(1, 1, 6),
  box: () => new THREE.BoxGeometry(1, 1, 1),
  cyl: () => new THREE.CylinderGeometry(1, 1, 1, 7),
  torus: () => new THREE.TorusGeometry(1, 0.22, 5, 10),
  ico: () => new THREE.IcosahedronGeometry(1, 0),
};

const FORM_SCALE = { 1: 0.78, 2: 1, 3: 1.32 } as const;
const cache = new Map<string, THREE.BufferGeometry>();

/** One merged, vertex-coloured geometry for a Gitemon, standing on y = 0 and facing +z. */
export function creatureGeometry(g: MapGitemon): THREE.BufferGeometry {
  const key = `${g.id}:${g.t1}:${g.t2}:${g.sh}:${g.f}:${g.s}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const recipe = R[g.t1];
  const pal = palette(g);
  const parts: Part[] = [...recipe.parts(g.f), ...ACCESSORY[g.sh](recipe)];
  if (g.f === 3) parts.push(...crown(recipe.head[1] + recipe.headR * 0.95, recipe.headR * 0.55));
  const geos: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const [kind, col, pos, scl, rot, mirror] of parts) {
    for (const side of mirror ? [1, -1] : [1]) {
      const geo = BASE[kind]().toNonIndexed();
      e.set(rot?.[0] ?? 0, (rot?.[1] ?? 0) * side, (rot?.[2] ?? 0) * side);
      q.setFromEuler(e);
      m.compose(
        new THREE.Vector3(pos[0] * side, pos[1], pos[2]),
        q,
        new THREE.Vector3(scl[0], scl[1], scl[2]),
      );
      geo.applyMatrix4(m);
      const c = pal[col];
      const n = geo.getAttribute('position').count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.deleteAttribute('uv');
      geos.push(geo);
    }
  }
  const merged = mergeGeometries(geos)!;
  const s = FORM_SCALE[g.f];
  merged.scale(s, s, s);
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  cache.set(key, merged);
  return merged;
}

export const creatureMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  flatShading: true,
});
