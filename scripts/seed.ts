/**
 * Seed the world so the map is not empty on day one: the most-followed developers per language,
 * plus official towns for big projects. Resumable (skips logins already done in .cache).
 *   GITHUB_TOKEN=... GITEMON_INTERNAL_KEY=... pnpm tsx --tsconfig scripts/tsconfig.json scripts/seed.ts [perLang]
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { GH, internal, pump, sleep } from './lib.ts';

const perLang = Number(process.argv[2] ?? 600);
const LANGS = [
  'rust',
  'c++',
  'c',
  'python',
  'javascript',
  'typescript',
  'go',
  'java',
  'kotlin',
  'ruby',
  'elixir',
  'php',
  'swift',
  'dart',
  'haskell',
  'ocaml',
  'shell',
  'nix',
  'html',
  'css',
  'vue',
  'c#',
  'r',
  'julia',
  'scala',
  'lua',
  'zig',
  'tex',
];
mkdirSync('scripts/.cache', { recursive: true });
const DONE = 'scripts/.cache/seed-done.json';
const done = new Set<string>(existsSync(DONE) ? JSON.parse(readFileSync(DONE, 'utf8')) : []);

const TOWNS: [string, string, string][] = [
  ['Rust Lang', 'rust-lang', 'forge'],
  ['Tokio', 'tokio-rs', 'forge'],
  ['Bevy', 'bevyengine', 'forge'],
  ['Zig', 'ziglang', 'forge'],
  ['LLVM', 'llvm', 'iron'],
  ['curl', 'curl', 'iron'],
  ['Godot', 'godotengine', 'iron'],
  ['Python', 'python', 'serpent'],
  ['Django', 'django', 'serpent'],
  ['Pallets', 'pallets', 'serpent'],
  ['PyTorch', 'pytorch', 'serpent'],
  ['Hugging Face', 'huggingface', 'serpent'],
  ['Node.js', 'nodejs', 'spark'],
  ['React', 'facebook', 'spark'],
  ['webpack', 'webpack', 'spark'],
  ['TypeScript', 'microsoft', 'prism'],
  ['Deno', 'denoland', 'prism'],
  ['Angular', 'angular', 'prism'],
  ['Astro', 'withastro', 'prism'],
  ['Go', 'golang', 'tide'],
  ['Kubernetes', 'kubernetes', 'tide'],
  ['Prometheus', 'prometheus', 'tide'],
  ['Grafana', 'grafana', 'tide'],
  ['HashiCorp', 'hashicorp', 'tide'],
  ['Apache', 'apache', 'frost'],
  ['Spring', 'spring-projects', 'frost'],
  ['JetBrains', 'JetBrains', 'frost'],
  ['Rails', 'rails', 'garnet'],
  ['Elixir', 'elixir-lang', 'garnet'],
  ['Phoenix', 'phoenixframework', 'garnet'],
  ['Laravel', 'laravel', 'moss'],
  ['Symfony', 'symfony', 'moss'],
  ['WordPress', 'WordPress', 'moss'],
  ['Swift', 'apple', 'wing'],
  ['Flutter', 'flutter', 'wing'],
  ['Dart', 'dart-lang', 'wing'],
  ['Haskell', 'haskell', 'rune'],
  ['OCaml', 'ocaml', 'rune'],
  ['NixOS', 'NixOS', 'shade'],
  ['Homebrew', 'Homebrew', 'shade'],
  ['Neovim', 'neovim', 'shade'],
  ['Oh My Zsh', 'ohmyzsh', 'shade'],
  ['Svelte', 'sveltejs', 'bloom'],
  ['Vue', 'vuejs', 'bloom'],
  ['Tailwind', 'tailwindlabs', 'bloom'],
  ['.NET', 'dotnet', 'coral'],
  ['MDN', 'mdn', 'quill'],
  ['Tidyverse', 'tidyverse', 'stone'],
  ['Julia', 'JuliaLang', 'stone'],
];

async function searchUsers(q: string, page: number): Promise<string[]> {
  for (;;) {
    const r = await fetch(
      `https://api.github.com/search/users?q=${encodeURIComponent(q)}&sort=followers&order=desc&per_page=100&page=${page}`,
      {
        headers: { authorization: `bearer ${GH}`, 'user-agent': 'gitemon-seed' },
      },
    );
    if (r.status === 403 || r.status === 429) {
      await sleep(30_000);
      continue;
    }
    const d = (await r.json()) as { items?: { login: string; type: string }[] };
    await sleep(2200); // search API: 30 requests/minute
    return (d.items ?? []).filter((i) => i.type === 'User').map((i) => i.login);
  }
}

async function main() {
  for (const [name, owner, biome] of TOWNS)
    await internal('/internal/official-town', { name, owner, biome });
  console.error(`towns: ${TOWNS.length}`);
  const logins = new Set<string>();
  for (const lang of LANGS)
    for (let page = 1; page <= Math.ceil(perLang / 100); page++)
      for (const u of await searchUsers(`language:${lang} followers:>50`, page)) logins.add(u);
  const todo = [...logins].filter((l) => !done.has(l.toLowerCase()));
  console.error(`candidates ${logins.size}, todo ${todo.length}`);
  for (let i = 0; i < todo.length; i += 50) {
    const part = todo.slice(i, i + 50);
    await pump(part);
    for (const l of part) done.add(l.toLowerCase());
    writeFileSync(DONE, JSON.stringify([...done]));
    console.error(` ${Math.min(i + 50, todo.length)}/${todo.length}`);
  }
}
main();
