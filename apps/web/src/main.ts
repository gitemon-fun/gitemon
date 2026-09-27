import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

// report what goes wrong on a player's device (a blank map on some GPUs): errors, rejected promises,
// three.js shader errors and the GPU name, sent once each to the Worker log — nothing personal
const sent = new Set<string>();
function report(kind: string, msg: string) {
  const key = kind + msg.slice(0, 200);
  if (sent.has(key) || sent.size > 20) return;
  sent.add(key);
  const body = JSON.stringify({
    kind,
    msg: msg.slice(0, 1500),
    url: location.pathname + location.search,
  });
  navigator.sendBeacon?.('/api/clientlog', body) ||
    fetch('/api/clientlog', { method: 'POST', body, keepalive: true }).catch(() => {});
}
addEventListener('error', (e) => report('error', `${e.message} @ ${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) =>
  report('rejection', String(e.reason?.stack ?? e.reason)),
);
const origError = console.error.bind(console);
console.error = (...a: unknown[]) => {
  report('console', a.map((x) => (x instanceof Error ? x.stack : String(x))).join(' '));
  origError(...a);
};
const origWarn = console.warn.bind(console);
console.warn = (...a: unknown[]) => {
  const m = a.map(String).join(' ');
  if (/THREE|WebGL|shader|context/i.test(m)) report('warn', m);
  origWarn(...a);
};
try {
  const g = document.createElement('canvas').getContext('webgl2');
  const ext = g?.getExtension('WEBGL_debug_renderer_info');
  report(
    'gpu',
    g
      ? String(ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'webgl2 (renderer hidden)')
      : 'NO WEBGL2',
  );
} catch (e) {
  report('gpu', 'probe failed ' + String(e));
}

mount(App, { target: document.getElementById('app')! });
