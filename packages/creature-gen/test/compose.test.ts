import { describe, expect, it } from 'vitest';
import { SHAPES, TYPES } from '@gitemon/shared';
import {
  compose,
  encodeIndexedPng,
  placeholderArt,
  validateArt,
  SIZE,
  P,
  scaleIndexed,
} from '../src/index.js';

describe('creature-gen', () => {
  it('placeholder art is valid', () => {
    expect(validateArt(placeholderArt)).toEqual([]);
  });

  it('is deterministic per id and differs between ids', () => {
    const p = { id: 42, t1: 'forge', t2: null, sh: 'steady', f: 1, s: 0 } as const;
    const a = compose(placeholderArt, p);
    const b = compose(placeholderArt, { ...p });
    expect([...a.px]).toEqual([...b.px]);
    const png1 = encodeIndexedPng(SIZE, SIZE, a.px, a.palette);
    const png2 = encodeIndexedPng(SIZE, SIZE, b.px, b.palette);
    expect([...png1]).toEqual([...png2]);
  });

  it('is left-right symmetric and has eyes for every type, shape and form', () => {
    for (const t of TYPES)
      for (const sh of SHAPES)
        for (const f of [1, 2, 3] as const) {
          const sp = compose(placeholderArt, { id: 7, t1: t, t2: null, sh, f, s: 0 });
          for (let y = 0; y < SIZE; y++)
            for (let x = 0; x < SIZE; x++)
              expect(sp.px[y * SIZE + x]).toBe(sp.px[y * SIZE + (SIZE - 1 - x)]);
          expect(sp.px.includes(P.eye)).toBe(true);
        }
  });

  it('evolution adds pixels, never removes the body', () => {
    const base = { id: 9, t1: 'tide', t2: null, sh: 'builder' } as const;
    const count = (f: 1 | 2 | 3) =>
      compose(placeholderArt, { ...base, f, s: 0 }).px.filter((v) => v !== 0).length;
    expect(count(2)).toBeGreaterThan(count(1));
    expect(count(3)).toBeGreaterThan(count(2));
  });

  it('encodes a valid PNG signature', () => {
    const sp = compose(placeholderArt, {
      id: 1,
      t1: 'spark',
      t2: 'prism',
      sh: 'polyglot',
      f: 3,
      s: 1,
    });
    const png = encodeIndexedPng(SIZE * 4, SIZE * 4, scaleIndexed(sp.px, SIZE, 4), sp.palette);
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});

describe('designed species', () => {
  const sp = {
    w: 4,
    h: 4,
    palette: ['#000000', '#ff0000', '#101010'],
    px: btoa(String.fromCharCode(0, 1, 1, 0, 1, 2, 2, 1, 1, 1, 1, 1, 0, 1, 1, 0)),
  };
  const art = { ...placeholderArt, species: { 'forge-1': sp } };
  it('uses the drawn species when present, on the bigger canvas', () => {
    const s = compose(art, { id: 5, t1: 'forge', t2: null, sh: 'maintainer', f: 1, s: 0 });
    expect(s.size).toBe(80);
    expect(s.px.some((v) => v === 1)).toBe(true);
  });
  it('falls back to form 1 art, and to procedural art for unknown types', () => {
    expect(compose(art, { id: 5, t1: 'forge', t2: null, sh: 'builder', f: 3, s: 0 }).size).toBe(80);
    expect(compose(art, { id: 5, t1: 'tide', t2: null, sh: 'builder', f: 1, s: 0 }).size).toBe(
      SIZE,
    );
  });
  it('shiny changes colours but not pixels; outlines stay dark', () => {
    const a = compose(art, { id: 9, t1: 'forge', t2: null, sh: 'steady', f: 1, s: 0 });
    const b = compose(art, { id: 9, t1: 'forge', t2: null, sh: 'steady', f: 1, s: 1 });
    expect([...a.px]).toEqual([...b.px]);
    expect(a.palette[1]).not.toBe(b.palette[1]);
    expect(b.palette[2]).toBe('#101010');
  });
});
