import { compose, toRgba, SIZE } from '@gitemon/creature-gen';
import { art } from '@gitemon/art';
import type { MapGitemon } from '@gitemon/shared';

/** Sprites are composed in the browser from the same deterministic code the server uses. */
const cache = new Map<string, HTMLCanvasElement>();

export function spriteKey(g: Pick<MapGitemon, 'id' | 't1' | 't2' | 'sh' | 'f' | 's'>) {
  return `${g.id}:${g.t1}:${g.t2 ?? ''}:${g.sh}:${g.f}:${g.s}`;
}

export function sprite(
  g: Pick<MapGitemon, 'id' | 't1' | 't2' | 'sh' | 'f' | 's'>,
): HTMLCanvasElement {
  const k = spriteKey(g);
  let c = cache.get(k);
  if (c) return c;
  const sp = compose(art, { id: g.id, t1: g.t1, t2: g.t2, sh: g.sh, f: g.f, s: g.s });
  c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(toRgba(sp), SIZE, SIZE), 0, 0);
  if (cache.size > 4000) cache.delete(cache.keys().next().value!);
  cache.set(k, c);
  return c;
}

export { SIZE };
