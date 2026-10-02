import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASE_LOOK, TYPES, lookPivots, lookProblems, piecesFor, type Look } from '../src/index.js';

// v19 (V19-D2, D3): per-type 3D looks
describe('look (v19)', () => {
  it('the base look is valid and changes nothing', () => {
    expect(lookProblems(BASE_LOOK)).toEqual([]);
    const rig = {
      neck: [0, 0.5, 0.1],
      tailRoot: [0, 0.4, -0.3],
      earL: [-0.1, 0.8, 0.2],
      earR: [0.1, 0.8, 0.2],
      zs: [-0.2, 0, 0.2],
      hip: 0.3,
    } as const;
    const p = lookPivots(BASE_LOOK, rig as never);
    expect(p.neck).toEqual([0, 0.5, 0.1]);
    expect(p.earR).toEqual([0.1, 0.8, 0.2]);
    expect(p.lift).toBe(0);
  });
  it('longer legs lift the neck and the tail root by the same amount', () => {
    const l: Look = { ...BASE_LOOK, leg: 1.2 };
    const rig = {
      neck: [0, 0.5, 0.1],
      tailRoot: [0, 0.4, -0.3],
      earL: [-0.1, 0.8, 0.2],
      earR: [0.1, 0.8, 0.2],
      zs: [-0.2, 0, 0.2],
      hip: 0.3,
    } as const;
    const p = lookPivots(l, rig as never);
    expect(p.neck[1]).toBeCloseTo(0.56);
    expect(p.tailRoot[1]).toBeCloseTo(0.46);
  });
  it('rejects a look outside the limits', () => {
    expect(lookProblems({ ...BASE_LOOK, ear: 3 })).toHaveLength(1);
    expect(
      lookProblems({ ...BASE_LOOK, f2: [{ kind: 'horn', at: 'brow', colour: 'gem', size: 0.9 }] }),
    ).toHaveLength(1);
  });
  it('pieces follow the stored form (V19-D3)', () => {
    const l: Look = { ...BASE_LOOK, f2: [{ kind: 'horn', at: 'brow', colour: 'gem', size: 0.2 }] };
    expect(piecesFor(l, 1)).toEqual([]);
    expect(piecesFor(l, 2)).toHaveLength(1);
  });
  // the real table lives in the private art set; checked when it is present
  const real = new URL('../../creature-gen/art-real/looks.ts', import.meta.url);
  it.skipIf(!existsSync(real))(
    'the real art set gives every type a valid, distinct look',
    async () => {
      const { looks } = (await import(real.href)) as { looks: Record<string, Look> };
      const seen = new Set<string>();
      for (const t of TYPES) {
        const l = looks[t];
        expect(l, t).toBeDefined();
        expect(lookProblems(l!), t).toEqual([]);
        const key = JSON.stringify([
          l!.head,
          l!.ear,
          l!.tail,
          l!.leg,
          l!.width,
          l!.length,
          l!.mark,
          l!.f2,
        ]);
        expect(seen.has(key), t).toBe(false);
        seen.add(key);
      }
    },
  );
});

// v19 build 10: the 3D portrait of a Gitemon
import { portraitPath } from '../src/index.js';
describe('portrait (v19 build 10)', () => {
  it('a player by type, form and gem; a sealed legend keeps its secret', () => {
    expect(portraitPath({ t1: 'prism', t2: 'tide', f: 2 }, 'v1')).toBe(
      '/portraits/prism-2-tide.webp?v=v1',
    );
    expect(portraitPath({ t1: 'prism', t2: 'prism', f: 3 }, 'v1')).toBe(
      '/portraits/prism-3-none.webp?v=v1',
    );
    const sp = { key: 'k', rank: 2, tier: 'legendary', title: null, species: null } as const;
    expect(
      portraitPath({ t1: 'prism', t2: null, f: 3, special: { ...sp, sealed: true } }, 'v1'),
    ).toBeNull();
    expect(
      portraitPath({ t1: 'prism', t2: null, f: 3, special: { ...sp, sealed: false } }, 'v1'),
    ).toBe('/portraits/legend-2.webp?v=v1');
    expect(portraitPath({ t1: 'prism', t2: null, f: 1 }, '')).toBeNull();
  });
});
