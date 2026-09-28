import { shouldReload } from '@gitemon/shared';

// report what goes wrong on a player's device (a blank map on some GPUs): errors, rejected promises,
// three.js shader errors, the GPU name and one frame check — sent once each, nothing personal
const sent = new Set<string>();
export function report(kind: string, msg: string) {
  const key = kind + msg.slice(0, 200);
  if (sent.has(key) || sent.size > 20) return;
  sent.add(key);
  const body = JSON.stringify({
    kind,
    msg: msg.slice(0, 1500),
    url: location.pathname + location.search,
  });
  if (!navigator.sendBeacon?.('/api/clientlog', body))
    fetch('/api/clientlog', { method: 'POST', body, keepalive: true }).catch(() => {});
}

/** v11 (V11-D8): a chunk missing after a deploy → reload once (a session flag stops any loop) */
export function recoverFromSkew(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  let last: number | null = null;
  try {
    last = Number(sessionStorage.getItem('gitemon.reloadAt')) || null;
  } catch {
    /* storage blocked: still reload once per page */
  }
  if (!shouldReload(msg, last, Date.now())) return false;
  try {
    sessionStorage.setItem('gitemon.reloadAt', String(Date.now()));
  } catch {
    /* fine */
  }
  report('reload', msg);
  location.reload();
  return true;
}
