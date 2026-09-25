import { describe, expect, it } from 'vitest';
import { parseLocation } from '../src/geo.js';

// The lookup is generated (scripts/geo-build.ts) and not committed; without it every answer is null.
const built = (await parseLocation('Berlin, Germany')) !== null;

describe.skipIf(!built)('hometown from a GitHub location', () => {
  it.each([
    ['San Francisco, CA', 'US', 'San Francisco'],
    ['Berlin Germany', 'DE', 'Berlin'],
    ['Cambridge, UK', 'GB', 'Cambridge'],
    ['Bangalore', 'IN', 'Bengaluru'],
    ['🇩🇪', 'DE', null],
    ['Silicon Valley', 'US', null],
  ])('%s', async (loc, cc, city) => {
    expect(await parseLocation(loc)).toEqual({ cc, city });
  });

  it('gives no hometown for jokes and placeholders', async () => {
    for (const loc of ['Earth', 'localhost', 'The Internet', 'Remote', '', null])
      expect(await parseLocation(loc)).toBeNull();
  });
});
