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
