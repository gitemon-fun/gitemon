import type { ArtSet } from './art.js';
import { HALF, SIZE } from './art.js';

/**
 * Placeholder art: plain geometric bodies. CC0 — free for any fork. The real creature art is
 * not part of this repository (see TRADEMARK.md).
 */
function geo(inside: (x: number, y: number) => boolean, eyeRow: number, eyeCol: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < SIZE; y++) {
    let r = '';
    for (let x = 0; x < HALF; x++) {
      // x measured from the centre line (HALF-1 is the centre column)
      const dx = HALF - 1 - x + 0.5;
      const dy = y - SIZE / 2 + 0.5;
      if (y === eyeRow && x === eyeCol) r += 'e';
      else if (y === eyeRow + 1 && x === eyeCol) r += 'p';
      else r += inside(dx, dy) ? '#' : '.';
    }
    rows.push(r);
  }
  return rows;
}

export const placeholderArt: ArtSet = {
  id: 'placeholder',
  licence: 'CC0-1.0 placeholder shapes',
  shapes: {
    steady: geo((x, y) => x * x + y * y < 64, 10, 8),
    builder: geo((x, y) => Math.abs(x) < 7.5 && Math.abs(y) < 8, 9, 8),
    reviewer: geo((x, y) => y > -8 && y < 8 && Math.abs(x) < (y + 9) * 0.5, 10, 9),
    maintainer: geo((x, y) => Math.abs(x) + Math.abs(y) < 10, 10, 8),
    polyglot: geo(
      (x, y) => Math.abs(x) < 8 && Math.abs(y) < 8 && Math.abs(x) + Math.abs(y) < 12,
      10,
      8,
    ),
  },
};
