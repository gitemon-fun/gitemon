/**
 * One-off hometown backfill (build file 06): reads the public `location` of every Gitemon in
 * batches of 100 per GraphQL call, parses it on this machine, and writes an SQL file of updates.
 *   GITHUB_TOKEN=… pnpm tsx --tsconfig scripts/tsconfig.json scripts/hometown.ts out.sql
 *   wrangler d1 execute gitemon --remote --file out.sql
 * New and refreshed Gitemon get their hometown from the fetcher (scripts/lib.ts); this only fills
 * the ones hatched before the field existed.
 */
import { writeFileSync } from 'node:fs';
import { parseLocation } from '../packages/ingest/src/geo.ts';

const GH = process.env.GITHUB_TOKEN ?? '';
const ORIGIN = process.env.GITEMON_ORIGIN ?? 'https://gitemon.fun';
const out = process.argv[2];
if (!GH || !out) throw new Error('usage: GITHUB_TOKEN=… hometown.ts <out.sql>');

const { g } = (await (await fetch(`${ORIGIN}/api/city`)).json()) as {
  g: [number, string][];
};
const q = (s: string | null) => (s == null ? 'NULL' : `'${s.replace(/'/g, "''")}'`);
const sql: string[] = [];
let found = 0;
for (let i = 0; i < g.length; i += 100) {
  const batch = g.slice(i, i + 100);
  const query = `query{${batch
    .map(([, login], k) => `u${k}:user(login:${JSON.stringify(login)}){databaseId location}`)
    .join(' ')}}`;
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${GH}`, 'user-agent': 'gitemon-fetcher' },
    body: JSON.stringify({ query }),
  });
  const body = (await r.json()) as {
    data?: Record<string, { databaseId: number; location: string | null } | null>;
  };
  for (const [k, u] of Object.entries(body.data ?? {})) {
    const id = batch[Number(k.slice(1))]![0];
    if (!u || u.databaseId !== id) continue;
    const home = await parseLocation(u.location);
    if (home) found++;
    sql.push(
      `UPDATE gitemon SET country = ${q(home?.cc ?? null)}, city = ${q(home?.city ?? null)} WHERE id = ${id};`,
    );
  }
  process.stderr.write(`${Math.min(i + 100, g.length)} `);
}
writeFileSync(out, sql.join('\n') + '\n');
console.log(`\n${sql.length} read, ${found} with a hometown → ${out}`);
