/**
 * Tuning sample (build file 03): fetch ~200 real developers, score them, print distributions.
 * Local only. Token comes from the GITHUB_TOKEN environment variable, never a file.
 *   GITHUB_TOKEN=... pnpm tsx scripts/sample.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fetchSnapshot } from '@gitemon/ingest';
import { score } from '@gitemon/scorer';
import type { Snapshot } from '@gitemon/shared';

const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error('GITHUB_TOKEN missing');
const CACHE = 'scripts/.cache/sample.json';

async function searchUsers(q: string, n: number): Promise<string[]> {
  const r = await fetch(
    `https://api.github.com/search/users?q=${encodeURIComponent(q)}&per_page=${n}`,
    {
      headers: { authorization: `bearer ${token}`, 'user-agent': 'gitemon.fun' },
    },
  );
  const d = (await r.json()) as { items?: { login: string; type: string }[] };
  return (d.items ?? []).filter((i) => i.type === 'User').map((i) => i.login);
}

async function main() {
  const snaps: Snapshot[] = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : [];
  if (!snaps.length) {
    const langs = [
      'rust',
      'python',
      'javascript',
      'typescript',
      'go',
      'java',
      'ruby',
      'php',
      'c++',
      'swift',
      'haskell',
      'shell',
    ];
    const logins = new Set<string>();
    for (const l of langs) {
      for (const u of await searchUsers(`language:${l} followers:>2000`, 5)) logins.add(u);
      for (const u of await searchUsers(`language:${l} followers:20..200 repos:>5`, 6))
        logins.add(u);
      for (const u of await searchUsers(`language:${l} followers:1..10 repos:2..10`, 5))
        logins.add(u);
    }
    for (const u of ['dependabot[bot]', 'github-actions[bot]']) logins.add(u);
    for (const login of logins) {
      try {
        const s = await fetchSnapshot(login, token!);
        if (!('notFound' in s)) snaps.push(s);
        process.stderr.write('.');
      } catch (e) {
        process.stderr.write(`x(${login}:${(e as Error).message})`);
      }
    }
    writeFileSync(CACHE, JSON.stringify(snaps));
  }
  const scored = snaps.map((s) => ({ s, r: score(s) }));
  const hist = (f: (x: (typeof scored)[number]) => string | number) => {
    const m = new Map<string | number, number>();
    for (const x of scored) m.set(f(x), (m.get(f(x)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => (a[0] > b[0] ? 1 : -1));
  };
  const n = scored.length;
  console.log(`n=${n}`);
  console.log(
    'level deciles',
    hist((x) => Math.floor(x.r.level / 10) * 10),
  );
  console.log(
    'form',
    hist((x) => x.r.form),
  );
  console.log(
    'shape',
    hist((x) => x.r.shape),
  );
  console.log(
    'type1',
    hist((x) => x.r.type1),
  );
  console.log('dual', scored.filter((x) => x.r.type2).length);
  for (const k of ['might', 'insight', 'renown', 'grit', 'range'] as const)
    console.log(
      k,
      'deciles',
      hist((x) => Math.floor(x.r.stats[k] / 10) * 10),
    );
  const top = [...scored].sort((a, b) => b.r.level - a.r.level).slice(0, 12);
  for (const x of top)
    console.log(
      x.r.level,
      x.s.login,
      x.r.type1,
      x.r.shape,
      'f' + x.r.form,
      JSON.stringify(x.r.stats),
    );
}
main();
