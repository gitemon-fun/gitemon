import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// v14.1: every third-party file the site ships has a line on /credits (apps/api/src/credits.ts)
describe('credits', () => {
  it('lists every file in the shipped env/, audio/ and fonts/ folders', () => {
    const credits = readFileSync('apps/api/src/credits.ts', 'utf8');
    const shipped = ['env', 'audio', 'fonts'].flatMap((d) =>
      readdirSync(`apps/web/public/${d}`).map((f) => `${d}/${f}`),
    );
    expect(shipped.length).toBeGreaterThan(0);
    for (const f of shipped) expect(credits, f).toContain(`file: '${f}'`);
  });
});
