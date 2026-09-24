import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Production builds use the private art set when it is checked out next to the code
// (see RUNBOOK); a fresh clone builds with the CC0 placeholder art.
const real = fileURLToPath(
  new URL('../../packages/creature-gen/art-real/index.ts', import.meta.url),
);
const placeholder = fileURLToPath(
  new URL('../../packages/creature-gen/src/art-entry.ts', import.meta.url),
);

export default defineConfig({
  plugins: [svelte()],
  resolve: { alias: { '@gitemon/art': existsSync(real) ? real : placeholder } },
  build: { rollupOptions: { input: 'app.html' }, target: 'es2022' },
});
