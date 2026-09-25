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

/** A drawn sprite: palette indices (base64, one byte per pixel, 0 = transparent), row-major. */
export interface PixelSprite {
  w: number;
  h: number;
  palette: string[];
  px: string;
}

export interface ArtSet {
  id: string;
  /** Licence note shown in the footer / README. */
  licence: string;
  /** Procedural half-body templates (placeholder art and fallback). */
  shapes: Record<Shape, string[]>;
  /** Designed species, keyed `${type}-${form}` (DECISIONS D25). When present, they win. */
  species?: Record<string, PixelSprite>;
  /** Big per-biome landmark sprites for the map, keyed by type. */
  landmarks?: Record<string, PixelSprite>;
}

export function decodePx(s: PixelSprite): Uint8Array {
  const bin = atob(s.px);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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
