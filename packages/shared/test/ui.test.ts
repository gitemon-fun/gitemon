import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast, readable, INK, TYPE_INFO, TYPES } from '../src/index.js';

// v15 (V15-D10): every label on a coloured fill reads (4.5 : 1), and the kit's own pairs are the measured ones
describe('readable colours', () => {
  it('gives every type chip a text colour that reads', () => {
    for (const t of TYPES) {
      const { bg, fg } = readable(TYPE_INFO[t].colors[0]);
      expect(contrast(bg, fg), t).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('keeps the kit tokens at their measured contrast', () => {
    const css = readFileSync('apps/web/public/island.css', 'utf8');
    const token = (n: string) => new RegExp(`--${n}:\\s*(#[0-9a-f]{6})`).exec(css)![1]!;
    expect(token('ink')).toBe(INK);
    const pairs: [string, string, number][] = [
      [token('ink'), token('paper'), 4.5],
      [token('ink2'), token('paper'), 4.5],
      [token('muted'), token('paper'), 4.5],
      [token('muted'), token('note'), 4.5],
      [token('gold-text'), token('paper'), 4.5],
      ['#ffffff', token('leaf'), 4.5],
      ['#ffffff', token('wood'), 4.5],
      [token('ink'), token('sky'), 4.5],
      [token('ink'), token('gold'), 4.5],
      [token('board-text'), token('board'), 4.5],
      [token('ink'), token('stone'), 4.5],
      [token('tablet-text'), token('tablet'), 4.5],
      [token('ink'), token('awning'), 4.5],
      [token('ink'), token('inn'), 4.5],
      [token('ink'), token('plaque'), 4.5],
      [token('danger'), token('paper'), 4.5],
      [token('link'), token('paper'), 4.5],
      [token('link'), token('paper2'), 4.5],
      [token('link'), token('note'), 4.5],
    ];
    for (const [fg, bg, min] of pairs)
      expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
  });
});
