import type { Shape } from '@gitemon/shared';

/**
 * An art set is one half-body template per shape (the left half; it is mirrored). Each template
 * is SIZE rows of SIZE/2 characters. The rightmost column is the centre line.
 *
 *   .  empty            #  body            ?  body or empty (seeded per creature)
 *   a  accent (always)  e  eye white       p  pupil            m  mouth
 *
 * Features that grow with evolution (horns, wings, crest) are added by code so they always attach
 * to the body; see compose.ts.
 */
export const SIZE = 24;
export const HALF = SIZE / 2;

export interface ArtSet {
  id: string;
  /** Licence note shown in the footer / README. */
  licence: string;
  shapes: Record<Shape, string[]>;
}

export function validateArt(a: ArtSet): string[] {
  const errs: string[] = [];
  for (const [shape, rows] of Object.entries(a.shapes)) {
    if (rows.length !== SIZE) errs.push(`${shape}: ${rows.length} rows, want ${SIZE}`);
    rows.forEach((r, i) => {
      if (r.length !== HALF) errs.push(`${shape} row ${i}: ${r.length} cols, want ${HALF}`);
      if (/[^.#?aepm]/.test(r)) errs.push(`${shape} row ${i}: bad char`);
    });
    if (!rows.some((r) => r.includes('e'))) errs.push(`${shape}: no eyes`);
  }
  return errs;
}
