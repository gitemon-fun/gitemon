/** Shared helpers for the trusted fetcher scripts (seed, drain). Run on a machine that holds a GitHub token. */
import { fetchSnapshot, GitHubError } from '@gitemon/ingest';
import type { Snapshot } from '@gitemon/shared';

export const ORIGIN = process.env.GITEMON_ORIGIN ?? 'https://gitemon.fun';
export const GH = process.env.GITHUB_TOKEN ?? '';
export const KEY = process.env.GITEMON_INTERNAL_KEY ?? '';
if (!GH || !KEY) throw new Error('GITHUB_TOKEN and GITEMON_INTERNAL_KEY are required');

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function internal<T>(path: string, body?: unknown): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await internalOnce<T>(path, body);
    } catch (e) {
      if (attempt >= 4) throw e;
      await sleep(5_000 * attempt);
    }
  }
}

async function internalOnce<T>(path: string, body?: unknown): Promise<T> {
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

const CONCURRENCY = Number(process.env.GITEMON_CONCURRENCY ?? 3);

/** Fetch snapshots (a few in parallel) and push them in small batches. Returns logins that do not exist. */
export async function pump(logins: string[], log = (s: string) => process.stderr.write(s)) {
  const missing: string[] = [];
  const batch: Snapshot[] = [];
  let paused: Promise<void> | null = null;
  const flush = async () => {
    while (batch.length) await internal('/internal/ingest', { snapshots: batch.splice(0, 3) });
  };
  const queue = [...logins];
  const worker = async () => {
    for (let login = queue.shift(); login; login = queue.shift()) {
      if (paused) await paused;
      try {
        const s = await fetchSnapshot(login, GH);
        if ('notFound' in s) missing.push(login);
        else batch.push(s);
        log('.');
      } catch (e) {
        if (e instanceof GitHubError && e.rateLimited) {
          log('R');
          queue.unshift(login);
          paused ??= sleep(60_000).then(() => void (paused = null));
          continue;
        }
        log('x');
      }
      if (batch.length >= 6) await flush();
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await flush();
  if (missing.length) await internal('/internal/missing', { logins: missing });
  return missing;
}
