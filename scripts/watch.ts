/**
 * v11 (V11-D10): the fetcher watches the site. Every pass it checks /health and the fetch backlog;
 * on a problem it runs GITEMON_ALERT_CMD with the message (once, then at most every 6 h while it
 * lasts), and once more when things recover. The machine itself going down is someone else's job:
 * an off-box watchdog notices that the fetcher's own heartbeat stops.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { decide, problemOf, type WatchState } from '@gitemon/shared';

const ORIGIN = process.env.GITEMON_ORIGIN ?? 'https://gitemon.fun';
const DIR = process.env.GITEMON_STATE_DIR ?? join(homedir(), '.local', 'state');
const FILE = join(DIR, 'gitemon-watch.json');

function send(msg: string) {
  const cmd = process.env.GITEMON_ALERT_CMD;
  if (!cmd) return console.error(`watch: ${msg} (no GITEMON_ALERT_CMD set)`);
  return new Promise<void>((done) =>
    execFile(
      '/bin/sh',
      ['-c', `${cmd} "$GITEMON_ALERT_MSG"`],
      { env: { ...process.env, GITEMON_ALERT_MSG: msg }, timeout: 60_000 },
      (err) => {
        if (err) console.error('watch: alert failed', err.message);
        done();
      },
    ),
  );
}

export async function watch() {
  let health: { ok?: boolean; pendingOldestMin?: number } | null = null;
  try {
    const r = await fetch(`${ORIGIN}/health`, { signal: AbortSignal.timeout(20_000) });
    health = r.ok ? ((await r.json()) as typeof health) : null;
  } catch {
    health = null;
  }
  let prev: WatchState = { problem: null, lastAlert: 0 };
  try {
    prev = JSON.parse(readFileSync(FILE, 'utf8')) as WatchState;
  } catch {
    /* first run */
  }
  const problem = problemOf(health);
  const now = Date.now();
  const msg = decide(prev, problem, now);
  if (msg) await send(msg);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(
    FILE,
    JSON.stringify({ problem, lastAlert: msg && problem ? now : problem ? prev.lastAlert : 0 }),
  );
  return problem;
}
