import { describe, expect, it } from 'vitest';
import { isChunkFailure, shouldReload } from '../src/index.js';

describe('deploy skew (V11-D8, G4)', () => {
  it('knows a missing chunk in every browser wording', () => {
    expect(isChunkFailure('TypeError: Importing a module script failed.')).toBe(true);
    expect(
      isChunkFailure('TypeError: Failed to fetch dynamically imported module: /assets/models-x.js'),
    ).toBe(true);
    expect(isChunkFailure('TypeError: error loading dynamically imported module')).toBe(true);
    expect(isChunkFailure('TypeError: x is undefined')).toBe(false);
  });

  it('reloads once, never in a loop', () => {
    const msg = 'Importing a module script failed.';
    expect(shouldReload(msg, null, 1_000_000)).toBe(true);
    expect(shouldReload(msg, 1_000_000 - 5_000, 1_000_000)).toBe(false);
    expect(shouldReload(msg, 1_000_000 - 120_000, 1_000_000)).toBe(true);
    expect(shouldReload('some other error', null, 1_000_000)).toBe(false);
  });
});
