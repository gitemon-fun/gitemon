import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Production builds use the private art set when it is checked out next to the code
// (see RUNBOOK); a fresh clone builds with the CC0 placeholder art.
const real = fileURLToPath(
  new URL('../../packages/creature-gen/art-real/index.ts', import.meta.url),
);
const placeholder = fileURLToPath(
  new URL('../../packages/creature-gen/src/art-entry.ts', import.meta.url),
);

// v19 build 11: the models' content version (scripts/models.sh), so their addresses can be cached for a year
const modelsV = fileURLToPath(new URL('./public/models/version.txt', import.meta.url));
const MODELS_V = existsSync(modelsV) ? readFileSync(modelsV, 'utf8').trim() : '';

export default defineConfig({
  plugins: [svelte()],
  define: { __MODELS_V__: JSON.stringify(MODELS_V) },
  resolve: { alias: { '@gitemon/art': existsSync(real) ? real : placeholder } },
  build: { rollupOptions: { input: ['app.html'] }, target: 'es2022' },
  // local development talks to the live API
  server: { proxy: { '/api': { target: 'https://gitemon.fun', changeOrigin: true } } },
});
