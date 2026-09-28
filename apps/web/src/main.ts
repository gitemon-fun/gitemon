import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { recoverFromSkew, report } from './lib/clientlog';

addEventListener('error', (e) => report('error', `${e.message} @ ${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => {
  report('rejection', String(e.reason?.stack ?? e.reason));
  recoverFromSkew(e.reason);
});
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
mount(App, { target: document.getElementById('app')! });
