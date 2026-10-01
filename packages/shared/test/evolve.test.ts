import { describe, expect, it } from 'vitest';
import { evolvedFrom, meritForm, nextForm } from '../src/index.js';

// v19 build 02 (V19-D3): the way to the next form, and when the evolution moment plays
describe('evolve (v19)', () => {
  it('shows the nearer of the two paths', () => {
    const n = nextForm(1, 30, 30)!;
    expect(n.to).toBe(2);
    expect(n.share).toBeCloseTo(0.75); // merit 30 of 40 beats level 30 of 61
    expect(nextForm(2, 10, 80)!.share).toBeCloseTo(80 / 85);
    expect(nextForm(3, 99, 99)).toBeNull();
  });
  it('plays the moment once, only when the form went up since last seen', () => {
    expect(evolvedFrom(2, 1)).toBe(1);
    expect(evolvedFrom(3, 1)).toBe(1);
    expect(evolvedFrom(3, 2)).toBe(2);
    expect(evolvedFrom(2, 2)).toBeNull();
    expect(evolvedFrom(2, null)).toBeNull();
  });
  it('the merit lines still give Form 2 at 40 and Form 3 at 70', () => {
    expect([meritForm(39), meritForm(40), meritForm(69), meritForm(70)]).toEqual([1, 2, 2, 3]);
  });
});
