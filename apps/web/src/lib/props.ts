import type { TypeId } from '@gitemon/shared';

/**
 * Terrain look per biome, and small pixel props drawn by code (trees, rocks, crystals, houses…).
 * Everything here is deterministic and cached; nothing is downloaded.
 */

export interface Terrain {
  top: [string, string, string];
  side: string;
  under: string;
  plaza: [string, string];
  props: PropKind[];
  /** props per tile in the wild outskirts, 0..1 */
  density: number;
  waterfall?: string;
  glow?: string;
}

export type PropKind =
  | 'tree'
  | 'pine'
  | 'snowpine'
  | 'palm'
  | 'blossom'
  | 'rock'
  | 'darkrock'
  | 'crystal'
  | 'redcrystal'
  | 'purplecrystal'
  | 'mushroom'
  | 'glowshroom'
  | 'flowers'
  | 'gear'
  | 'books'
  | 'coral'
  | 'vent'
  | 'spike'
  | 'scrap'
  | 'reeds'
  | 'bush';

export const TERRAIN: Record<TypeId, Terrain> = {
  forge: {
    top: ['#4d3b36', '#57443e', '#453430'],
    side: '#33241f',
    under: '#231815',
    plaza: ['#7a6c64', '#6e6159'],
    props: ['darkrock', 'vent', 'spike'],
    density: 0.16,
    glow: '#ff7a2e',
  },
  iron: {
    top: ['#5b636c', '#656d76', '#535a62'],
    side: '#3a4047',
    under: '#262b30',
    plaza: ['#8d949b', '#81888f'],
    props: ['gear', 'rock', 'scrap'],
    density: 0.12,
  },
  serpent: {
    top: ['#3f8a3c', '#4a9645', '#387d35'],
    side: '#6b4a2e',
    under: '#4a3220',
    plaza: ['#a39a88', '#978e7c'],
    props: ['palm', 'tree', 'bush', 'reeds'],
    density: 0.3,
    waterfall: '#6fc3ff',
  },
  spark: {
    top: ['#a39a3c', '#aea545', '#968d35'],
    side: '#6e5f2a',
    under: '#4a3f1c',
    plaza: ['#a8a08e', '#9c9482'],
    props: ['bush', 'rock', 'flowers'],
    density: 0.12,
    glow: '#ffe25c',
  },
  prism: {
    top: ['#3f5d8a', '#476794', '#39557e'],
    side: '#2b3a55',
    under: '#1d2638',
    plaza: ['#9aa3b5', '#8e97a8'],
    props: ['crystal', 'crystal', 'rock'],
    density: 0.14,
    glow: '#8fd3ff',
  },
  tide: {
    top: ['#d9c58a', '#e2cf95', '#cdb97e'],
    side: '#8a7a50',
    under: '#5c5236',
    plaza: ['#b8b2a2', '#aca696'],
    props: ['palm', 'coral', 'rock'],
    density: 0.12,
    waterfall: '#5fd0e0',
  },
  frost: {
    top: ['#e8f1f7', '#f2f8fb', '#dde8f0'],
    side: '#9fb4c4',
    under: '#6d8394',
    plaza: ['#b9c4cc', '#adb8c0'],
    props: ['snowpine', 'snowpine', 'crystal'],
    density: 0.22,
    waterfall: '#bfe8ff',
  },
  garnet: {
    top: ['#8a4a3c', '#955446', '#7e4234'],
    side: '#5c2e24',
    under: '#3d1f18',
    plaza: ['#a6908a', '#9a847e'],
    props: ['redcrystal', 'rock', 'redcrystal'],
    density: 0.14,
    glow: '#ff5a7a',
  },
  moss: {
    top: ['#4a5a3e', '#55503f', '#44543a'],
    side: '#33382a',
    under: '#22251c',
    plaza: ['#8f8f80', '#838374'],
    props: ['glowshroom', 'mushroom', 'reeds', 'darkrock'],
    density: 0.28,
    glow: '#a8ff6a',
  },
  wing: {
    top: ['#c98a52', '#d4955c', '#bd7f48'],
    side: '#8a5a32',
    under: '#5c3c22',
    plaza: ['#b8a894', '#ac9c88'],
    props: ['rock', 'bush', 'spike'],
    density: 0.1,
  },
  rune: {
    top: ['#5a4a7a', '#645484', '#50416e'],
    side: '#3a2f52',
    under: '#271f38',
    plaza: ['#a39cb3', '#9790a7'],
    props: ['purplecrystal', 'mushroom', 'rock'],
    density: 0.16,
    glow: '#c38bff',
  },
  shade: {
    top: ['#3a3d44', '#43464e', '#33363c'],
    side: '#24262b',
    under: '#17181c',
    plaza: ['#6e7178', '#63666d'],
    props: ['glowshroom', 'darkrock', 'spike'],
    density: 0.18,
    glow: '#5cff9a',
  },
  bloom: {
    top: ['#6fae5c', '#7aba66', '#65a253'],
    side: '#6b4a2e',
    under: '#4a3220',
    plaza: ['#c9b8b0', '#bdaca4'],
    props: ['blossom', 'flowers', 'blossom', 'bush'],
    density: 0.26,
    waterfall: '#8fd8ff',
  },
  coral: {
    top: ['#3f9a8a', '#48a594', '#388d7e'],
    side: '#2a6358',
    under: '#1c4239',
    plaza: ['#a8b5ae', '#9ca9a2'],
    props: ['coral', 'coral', 'rock'],
    density: 0.16,
    waterfall: '#5fd0e0',
  },
  quill: {
    top: ['#d8c9a3', '#e1d2ac', '#cdbe98'],
    side: '#8f7f5c',
    under: '#5e533c',
    plaza: ['#b4ab98', '#a89f8c'],
    props: ['books', 'tree', 'flowers'],
    density: 0.12,
  },
  stone: {
    top: ['#7c6a58', '#867462', '#72604f'],
    side: '#54473a',
    under: '#382f27',
    plaza: ['#a39888', '#978c7c'],
    props: ['rock', 'rock', 'pine'],
    density: 0.16,
  },
  wild: {
    top: ['#6aa84f', '#74b358', '#619c47'],
    side: '#6b4a2e',
    under: '#4a3220',
    plaza: ['#b5ab98', '#a99f8c'],
    props: ['tree', 'flowers', 'bush', 'tree'],
    density: 0.24,
    waterfall: '#8fd8ff',
  },
  machine: {
    top: ['#44484f', '#4c5159', '#3d4148'],
    side: '#2c2f34',
    under: '#1c1e22',
    plaza: ['#7c8087', '#70747b'],
    props: ['scrap', 'gear', 'darkrock'],
    density: 0.14,
    glow: '#b8f24b',
  },
};

// ---- pixel prop drawing --------------------------------------------------------------------------

type Px = (x: number, y: number, c: string) => void;

function outline(c: HTMLCanvasElement, col = '#1b1720') {
  const g = c.getContext('2d')!;
  const d = g.getImageData(0, 0, c.width, c.height);
  const a = d.data;
  const w = c.width;
  const h = c.height;
  const edge: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (a[(y * w + x) * 4 + 3]) continue;
      const on = (xx: number, yy: number) =>
        xx >= 0 && yy >= 0 && xx < w && yy < h && a[(yy * w + xx) * 4 + 3] > 0;
      if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) edge.push(x, y);
    }
  g.fillStyle = col;
  for (let i = 0; i < edge.length; i += 2) g.fillRect(edge[i], edge[i + 1], 1, 1);
}

function canvas(w: number, h: number, draw: (px: Px, g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const px: Px = (x, y, col) => {
    g.fillStyle = col;
    g.fillRect(x, y, 1, 1);
  };
  draw(px, g);
  outline(c);
  return c;
}

function blob(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  col: string,
) {
  g.fillStyle = col;
  for (let y = -ry; y <= ry; y++)
    for (let x = -rx; x <= rx; x++)
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) g.fillRect(cx + x, cy + y, 1, 1);
}

function makeProp(kind: PropKind): HTMLCanvasElement {
  switch (kind) {
    case 'tree':
    case 'blossom': {
      const [a, b] = kind === 'tree' ? ['#3f8f3a', '#5fb152'] : ['#e58fb8', '#ffc4de'];
      return canvas(18, 24, (px, g) => {
        g.fillStyle = '#6b4526';
        g.fillRect(8, 14, 3, 9);
        blob(g, 9, 9, 7, 7, a);
        blob(g, 7, 7, 4, 4, b);
        if (kind === 'blossom')
          for (let i = 0; i < 6; i++) px(4 + ((i * 5) % 11), 4 + ((i * 7) % 9), '#ffffff');
      });
    }
    case 'pine':
    case 'snowpine':
      return canvas(16, 26, (_px, g) => {
        g.fillStyle = '#6b4526';
        g.fillRect(7, 20, 2, 5);
        const green = kind === 'pine' ? '#2f6f3a' : '#3d6f5a';
        for (let k = 0; k < 3; k++) {
          const top = 2 + k * 6;
          for (let y = 0; y < 9; y++) {
            const half = Math.floor(y * 0.75) + 1;
            g.fillStyle = kind === 'snowpine' && y < 2 ? '#ffffff' : green;
            g.fillRect(8 - half, top + y, half * 2, 1);
          }
        }
      });
    case 'palm':
      return canvas(20, 26, (px, g) => {
        for (let y = 10; y < 25; y++)
          px(9 + Math.floor((25 - y) / 6), y, y % 3 ? '#8a5a2e' : '#a8743e');
        g.fillStyle = '#3f9a3a';
        for (const [dx, dy] of [
          [-8, 2],
          [8, 2],
          [-6, -3],
          [6, -3],
          [0, -5],
        ]) {
          for (let t = 0; t <= 8; t++) {
            const x = 10 + Math.round((dx * t) / 8);
            const y = 9 + Math.round((dy * t) / 8 + (t * t) / 20);
            g.fillRect(x, y, 2, 2);
          }
        }
      });
    case 'bush':
      return canvas(14, 10, (_px, g) => {
        blob(g, 7, 6, 6, 3, '#3f8a3a');
        blob(g, 5, 5, 3, 2, '#5fae52');
      });
    case 'flowers':
      return canvas(14, 8, (px) => {
        const cols = ['#ff6f8f', '#ffd24c', '#8fb8ff', '#ffffff'];
        for (let i = 0; i < 7; i++) {
          const x = 1 + ((i * 5) % 12);
          const y = 2 + ((i * 3) % 5);
          px(x, y + 1, '#3f8a3a');
          px(x, y, cols[i % 4]);
        }
      });
    case 'rock':
    case 'darkrock':
      return canvas(16, 11, (_px, g) => {
        const [a, b] = kind === 'rock' ? ['#7b746c', '#a39b92'] : ['#3a3230', '#5c504b'];
        blob(g, 8, 6, 7, 4, a);
        blob(g, 6, 5, 3, 2, b);
      });
    case 'crystal':
    case 'redcrystal':
    case 'purplecrystal': {
      const [a, b] =
        kind === 'crystal'
          ? ['#5fb8ff', '#d6f0ff']
          : kind === 'redcrystal'
            ? ['#e0405a', '#ffc2cc']
            : ['#9b5de5', '#e2cbff'];
      return canvas(14, 20, (px, g) => {
        for (const [x0, h] of [
          [3, 12],
          [6, 18],
          [10, 10],
        ]) {
          for (let y = 0; y < h; y++) {
            const w = y < 3 ? y : 3;
            g.fillStyle = a;
            g.fillRect(x0 - Math.floor(w / 2), 19 - h + y, Math.max(1, w), 1);
          }
          px(x0, 19 - h + 2, b);
          px(x0, 19 - h + 3, b);
        }
      });
    }
    case 'mushroom':
    case 'glowshroom':
      return canvas(12, 12, (px, g) => {
        g.fillStyle = '#e8dcc8';
        g.fillRect(5, 6, 2, 5);
        blob(g, 6, 5, 5, 3, kind === 'mushroom' ? '#c8463a' : '#3fdc8a');
        px(4, 4, '#ffffff');
        px(8, 5, '#ffffff');
      });
    case 'gear':
      return canvas(14, 14, (_px, g) => {
        blob(g, 7, 7, 6, 6, '#8d949b');
        blob(g, 7, 7, 2, 2, 'rgba(0,0,0,0)');
        g.clearRect(6, 6, 3, 3);
      });
    case 'books':
      return canvas(12, 14, (_px, g) => {
        const cols = ['#b83a3a', '#3a6fb8', '#3a9a5a', '#d8a83a'];
        for (let i = 0; i < 4; i++) {
          g.fillStyle = cols[i];
          g.fillRect(1 + (i % 2), 11 - i * 3, 10 - (i % 2) * 2, 3);
        }
      });
    case 'coral':
      return canvas(14, 14, (px) => {
        const c = '#ff7a8a';
        for (let y = 13; y > 2; y--) px(7, y, c);
        for (let y = 9; y > 4; y--) px(4 + Math.floor((9 - y) / 2), y, c);
        for (let y = 10; y > 3; y--) px(10 - Math.floor((10 - y) / 3), y, c);
        px(7, 2, '#ffc2cc');
      });
    case 'vent':
      return canvas(16, 12, (px, g) => {
        blob(g, 8, 7, 7, 4, '#3a3230');
        blob(g, 8, 6, 3, 2, '#ff7a2e');
        px(8, 5, '#ffd166');
      });
    case 'spike':
      return canvas(10, 20, (_px, g) => {
        for (let y = 0; y < 18; y++) {
          const w = Math.max(1, Math.floor(y / 3));
          g.fillStyle = y % 5 === 0 ? '#5c504b' : '#2e2826';
          g.fillRect(5 - Math.floor(w / 2), 1 + y, w, 1);
        }
      });
    case 'scrap':
      return canvas(16, 12, (px, g) => {
        g.fillStyle = '#6e7680';
        g.fillRect(2, 6, 12, 5);
        g.fillStyle = '#8d949b';
        g.fillRect(4, 3, 6, 4);
        px(11, 4, '#b8f24b');
      });
    case 'reeds':
      return canvas(12, 16, (px) => {
        for (const x of [2, 5, 8, 10])
          for (let y = 4 + (x % 3); y < 15; y++) px(x, y, y < 7 ? '#8a6a3a' : '#5a8a3a');
      });
  }
}

const propCache = new Map<PropKind, HTMLCanvasElement>();
export function prop(kind: PropKind) {
  let c = propCache.get(kind);
  if (!c) propCache.set(kind, (c = makeProp(kind)));
  return c;
}

const houseCache = new Map<string, HTMLCanvasElement>();
export function house(roof: string, big = false): HTMLCanvasElement {
  const k = roof + big;
  let c = houseCache.get(k);
  if (c) return c;
  const W = big ? 30 : 22;
  const H = big ? 30 : 22;
  c = canvas(W, H, (px, g) => {
    const wallTop = Math.floor(H * 0.45);
    g.fillStyle = '#efe2c6';
    g.fillRect(3, wallTop, W - 6, H - wallTop - 1);
    g.fillStyle = '#cdbd9c';
    g.fillRect(3, H - 4, W - 6, 3);
    g.fillStyle = roof;
    for (let y = 0; y < wallTop; y++) {
      const half = Math.floor(((y + 1) / wallTop) * (W / 2));
      g.fillRect(W / 2 - half, y + 1, half * 2, 1);
    }
    g.fillStyle = '#5a3a28';
    g.fillRect(W / 2 - 2, H - 9, 4, 8);
    px(6, wallTop + 3, '#ffe08a');
    px(7, wallTop + 3, '#ffe08a');
    px(W - 8, wallTop + 3, '#ffe08a');
    px(W - 7, wallTop + 3, '#ffe08a');
  });
  houseCache.set(k, c);
  return c;
}

/** Fallback landmark when the art set has none: a banner tower in the biome's colours. */
const towerCache = new Map<string, HTMLCanvasElement>();
export function tower(color: string, glow = '#ffe08a'): HTMLCanvasElement {
  let c = towerCache.get(color);
  if (c) return c;
  c = canvas(36, 64, (px, g) => {
    g.fillStyle = '#8d857c';
    g.fillRect(8, 20, 20, 43);
    g.fillStyle = '#a39b92';
    g.fillRect(10, 20, 6, 43);
    g.fillStyle = color;
    for (let y = 0; y < 18; y++) {
      const half = Math.floor(((y + 1) / 18) * 13);
      g.fillRect(18 - half, y + 2, half * 2, 1);
    }
    for (let y = 26; y < 58; y += 10) {
      px(17, y, glow);
      px(18, y, glow);
      px(17, y + 1, glow);
      px(18, y + 1, glow);
    }
    g.fillStyle = '#5a3a28';
    g.fillRect(15, 54, 6, 9);
    g.fillStyle = color;
    g.fillRect(19, 0, 1, 4);
    g.fillRect(20, 0, 6, 3);
  });
  towerCache.set(color, c);
  return c;
}
