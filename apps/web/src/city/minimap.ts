import { TOWN_R, WATER_Y, gridHeight, type ClimateId, type Island } from '@gitemon/shared';

/**
 * The minimap picture (GRANDPLAN v8 §0 V8-D9): the island drawn once from its height grid — sea,
 * shore, the nine regions, the town ring — as a small canvas. The HUD draws the live dots on top.
 */

const COLOUR: Record<ClimateId, string> = {
  frost: '#eef3f8',
  marsh: '#8f93a8',
  bloom: '#a9cf7c',
  tide: '#c9dc98',
  jungle: '#4d9442',
  volcano: '#5a5054',
  canyon: '#d98a5c',
  crystal: '#e6def2',
  savanna: '#d9c47c',
};

export function islandPicture(isl: Island, size = 176): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const R = isl.radius + 20;
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const pal = isl.regions.map((g) => rgb(COLOUR[g.climate]));
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size) * 2 * R - R;
      const z = ((j + 0.5) / size) * 2 * R - R;
      const h = gridHeight(isl.grid, x, z);
      const r = Math.hypot(x, z);
      let col: number[];
      if (h < WATER_Y) col = h > WATER_Y - 0.6 ? [127, 205, 204] : [70, 146, 186];
      else if (r < TOWN_R) col = r > TOWN_R - 8 ? [150, 140, 128] : [226, 214, 190];
      else {
        const gi = Math.max(0, Math.min(isl.grid.N, Math.round((x + isl.grid.E) / isl.grid.cell)));
        const gj = Math.max(0, Math.min(isl.grid.N, Math.round((z + isl.grid.E) / isl.grid.cell)));
        const reg = isl.grid.region[gj * (isl.grid.N + 1) + gi]!;
        col = reg >= 0 ? pal[reg]! : [232, 216, 170];
        // hills read as lighter, valleys darker
        const k = 1 + Math.min(0.25, Math.max(-0.15, (h - 4) / 60));
        col = col.map((v) => Math.min(255, v * k));
      }
      const o = (j * size + i) * 4;
      img.data[o] = col[0]!;
      img.data[o + 1] = col[1]!;
      img.data[o + 2] = col[2]!;
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** world (x, z) → minimap pixel, and back */
export const toMap = (isl: Island, size: number, x: number, z: number) => {
  const R = isl.radius + 20;
  return [((x + R) / (2 * R)) * size, ((z + R) / (2 * R)) * size] as const;
};
export const fromMap = (isl: Island, size: number, px: number, py: number) => {
  const R = isl.radius + 20;
  return [(px / size) * 2 * R - R, (py / size) * 2 * R - R] as const;
};
