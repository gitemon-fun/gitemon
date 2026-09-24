# Gitemon

Every GitHub developer, hatched into a pixel creature on one shared map — **[gitemon.fun](https://gitemon.fun)**.

- **Hatch.** Every developer already exists as a wild Gitemon, built from public GitHub data.
- **Catch.** Sign in with GitHub and catch the developers you admire. Worked together for real? It's a *bonded* catch.
- **Claim.** When someone you caught signs in, you both get a friendship buff.
- **Belong.** Your home is your language's biome. Found a town, and be seen from the far zoom.

## The rules, in one paragraph

Power is not size. A Gitemon never grows because of raw volume. Only work other people confirmed
counts — pull requests merged into *their* repos, reviews you gave, stars others gave you — and
every stat is log-scaled with a ceiling. Commits to your own repos count for nothing on their own,
so AI-generated volume changes nothing either. The whole scorer is a pure function in
[`packages/scorer`](packages/scorer/src/index.ts); read it, and send a PR if you think it's unfair.

**Privacy:** Gitemon never requests access to private repositories and never contacts anyone. Your
private work counts only through the anonymous number GitHub itself shows on your profile, and only
if you turned that setting on.

## Layout

| Path | What |
|---|---|
| `packages/shared` | types, the world grid, deterministic hashing |
| `packages/ingest` | fetches a public GitHub snapshot (GraphQL) |
| `packages/scorer` | snapshot → stats, level, type, species, form (pure, tested) |
| `packages/creature-gen` | deterministic pixel sprites + a tiny PNG encoder; CC0 placeholder art |
| `apps/api` | Cloudflare Worker (Hono): pages, API, auth, images — D1 + R2 |
| `apps/web` | the map (Svelte + canvas) |
| `scripts` | trusted-fetcher jobs: seed, drain |

## Run it

```bash
pnpm install
pnpm check          # format, lint, typecheck, test
pnpm --filter @gitemon/web build
cd apps/api && npx wrangler dev   # needs a D1 database; see wrangler.toml
```

A fresh clone builds with the placeholder art. See [TRADEMARK.md](TRADEMARK.md) before you deploy
a copy.

## Licence

Code: [AGPL-3.0](LICENSE). Name, logo and creature art: not licensed — see [TRADEMARK.md](TRADEMARK.md).
