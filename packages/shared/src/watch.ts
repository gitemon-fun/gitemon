/**
 * v11 (V11-D10): the rules of the fetcher's site watch (scripts/watch.ts runs them). Pure.
 */
const REPEAT_MS = 6 * 3_600_000;

export interface WatchState {
  problem: string | null;
  lastAlert: number;
}

/** what is wrong, if anything (pure: the /health reply or null when it did not answer) */
export function problemOf(
  health: { ok?: boolean; pendingOldestMin?: number } | null,
): string | null {
  if (!health) return 'gitemon.fun /health is not answering';
  if (health.ok === false) return 'gitemon.fun /health says not ok';
  const age = health.pendingOldestMin ?? 0;
  if (age > 30) return `fetch backlog: the oldest request has waited ${age} min`;
  return null;
}

/** whether to send now (pure) */
export function decide(prev: WatchState, problem: string | null, now: number): string | null {
  if (problem && (!prev.problem || now - prev.lastAlert > REPEAT_MS)) return `Gitemon: ${problem}`;
  if (!problem && prev.problem)
    return 'Gitemon: recovered — the site answers and the backlog is clear';
  return null;
}
