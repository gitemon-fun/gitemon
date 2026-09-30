/**
 * v15 (V15-D10): text on a coloured fill is measured, never guessed (WCAG 2 contrast). The map and the
 * Worker pages both colour chips and banners by type, so both ask here which text colour reads.
 */

/** the kit's reading ink (apps/web/public/island.css `--ink`) */
export const INK = '#3b2a1e';

function channel(c: number) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** relative luminance of a #rrggbb colour */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio of two #rrggbb colours (1 … 21) */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function darken(hex: string, k: number): string {
  const h = hex.replace('#', '');
  return (
    '#' +
    [0, 2, 4]
      .map((i) =>
        Math.round(parseInt(h.slice(i, i + 2), 16) * k)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/**
 * The fill and text colour for a label on `fill`: ink when it reads, else white; when neither reaches
 * `min`, the fill is darkened just enough for white (the hue stays).
 */
export function readable(fill: string, min = 4.5): { bg: string; fg: string } {
  if (contrast(INK, fill) >= min) return { bg: fill, fg: INK };
  if (contrast('#ffffff', fill) >= min) return { bg: fill, fg: '#ffffff' };
  for (let k = 0.99; k > 0.2; k -= 0.01) {
    const bg = darken(fill, k);
    if (contrast('#ffffff', bg) >= min) return { bg, fg: '#ffffff' };
  }
  return { bg: '#000000', fg: '#ffffff' };
}
