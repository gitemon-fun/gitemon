import { describe, expect, it } from 'vitest';
import { TYPE_INFO, standingStep } from '@gitemon/shared';
import { compose, placeholderArt, recolour, toRgba, type ArtSet } from '../src/index.js';

// a 2×2 designed species: index 2 = body, index 3 = the marking colour (accent)
const art: ArtSet = {
  ...placeholderArt,
  species: {
    'bloom-1': {
      w: 2,
      h: 2,
      palette: ['#000000', '#e55ea8', '#7fe8b8'],
      px: btoa('\x01\x02\x01\x01'),
      accent: [2],
    },
  },
};
const base = { id: 3, t1: 'bloom', sh: 'steady', f: 1, s: 0 } as const;
const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  return d === 0
    ? 0
    : max === r
      ? ((g - b) / d + 6) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
};

describe('no two players identical (V10-D5, G4)', () => {
  it('markings take the second type colour; the body keeps the species colour', () => {
    const plain = compose(art, { ...base, t2: null });
    const forge = compose(art, { ...base, t2: 'forge' });
    expect(forge.palette[1]).toBe(plain.palette[1]);
    expect(forge.palette[2]).not.toBe(plain.palette[2]);
    expect(Math.abs(hue(forge.palette[2]!) - hue(TYPE_INFO.forge.colors[0]))).toBeLessThan(0.2);
  });

  it('one-of-one legends are never recoloured', () => {
    const a = compose(art, { ...base, t2: 'forge', sp: 'bloom-1' });
    const b = compose(art, { ...base, t2: null, sp: 'bloom-1' });
    expect(a.palette).toEqual(b.palette);
  });

  it('the map atlas marks only the marking pixels', () => {
    const sp = compose(art, { ...base, t2: null });
    const rgba = toRgba(sp, 1, 191);
    const alphas = new Set<number>();
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) alphas.add(rgba[i]!);
    expect([...alphas].sort()).toEqual([191, 255]);
    expect(recolour('#7fe8b8', '#e0612f')).not.toBe('#7fe8b8');
  });

  it('standing adds a small size step, never size from volume', () => {
    expect(standingStep(0)).toBe(1);
    expect(standingStep(35)).toBeGreaterThan(1);
    expect(standingStep(60)).toBeGreaterThan(standingStep(35));
    expect(standingStep(100)).toBe(standingStep(60));
  });
});
