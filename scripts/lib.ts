/** Shared helpers for the trusted fetcher scripts (seed, drain). Run on a machine that holds a GitHub token. */
import { fetchSnapshot, GitHubError } from '@gitemon/ingest';
import type { Snapshot } from '@gitemon/shared';

export const ORIGIN = process.env.GITEMON_ORIGIN ?? 'https://gitemon.fun';
export const GH = process.env.GITHUB_TOKEN ?? '';
export const KEY = process.env.GITEMON_INTERNAL_KEY ?? '';
if (!GH || !KEY) throw new Error('GITHUB_TOKEN and GITEMON_INTERNAL_KEY are required');

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function internal<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(ORIGIN + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
      'user-agent': 'gitemon-fetcher',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

/** Fetch snapshots for logins and push them in batches. Returns logins that do not exist. */
export async function pump(logins: string[], log = (s: string) => process.stderr.write(s)) {
  const missing: string[] = [];
  let batch: Snapshot[] = [];
  const flush = async () => {
    if (!batch.length) return;
    await internal('/internal/ingest', { snapshots: batch });
    batch = [];
  };
  for (const login of logins) {
    try {
      const s = await fetchSnapshot(login, GH);
      if ('notFound' in s) missing.push(login);
      else batch.push(s);
      log('.');
    } catch (e) {
      if (e instanceof GitHubError && e.rateLimited) {
        log('R');
        await flush();
        await sleep(60_000);
        continue;
      }
      log('x');
    }
    if (batch.length >= 10) await flush();
  }
  await flush();
  if (missing.length) await internal('/internal/missing', { logins: missing });
  return missing;
}
