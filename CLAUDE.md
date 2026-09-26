# CLAUDE.md — Gitemon

**Project:** `gitemon-fun/gitemon` — every GitHub developer as a collectible pixel creature on one shared island (Gitemon Island), for developers who want to be seen and to belong.

> **Read first:** `.claude/ai_context/` is the **source of truth for intent + design, kept in sync
> with the code** (drift is a bug, fixed in the same change).
> Entry: `.claude/ai_context/development/v5/implementation/00_INDEX.md` · Live cursor: `…/STATUS.md`
> · Blueprint: `…/v5/GRANDPLAN.md (v2–v4 = base, still binding)` · Locked decisions: `…/DECISIONS.md` · Raw intent:
> `.claude/ai_context/raw_materials/` · Methodology: `.claude/FRAMEWORK.md`.
> **When docs disagree, `DECISIONS.md` wins.**
> ⚠ This file is tracked in a **public** repo. It must stay safe-as-public: no internal paths beyond
> this repo, no account ids, no personal or gov context.

## Project facts

- **Slug:** `gitemon` · **Repo:** `gitemon-fun/gitemon` (public, AGPL-3.0) + `gitemon-fun/gitemon-art` (private)
- **URL:** https://gitemon.fun
- **Stack:** pnpm monorepo · Svelte 5 SPA + Three.js (Gitemon City) · one Hono Worker (pages, API, images, assets) · D1 + R2 · WorkOS (GitHub only)

## Hard rules

1. **Read `STATUS.md` first** on every pickup; resume where it points.
2. **Deploy:** Cloudflare only. Never Vercel, never Next.js.
3. **Auth:** WorkOS AuthKit, GitHub provider, basic-profile scope only. **Never request the `repo` scope. Never read private repos** (D9).
4. **Never notify a caught developer** — no email, mention, issue or tag, ever (D14).
5. **Power is not size** — no stat may grow with raw volume; changes to the scorer need tests proving it (D6).
6. **Repo policy:** `.claude/` is gitignored and never pushed. Commits as `irwndedi@gmail.com`. gitleaks before every push. Anti-abuse thresholds live in env config, never in the repo.
7. **Art + name are not open.** Real art lives only in the private art repo; the public repo ships placeholders (D8).
8. **Plan via the framework.** GRANDPLAN §0 Run mode decides where work stops. Every run ends with **Blocked on me → Changed → Found**.

## Security

- Live secrets: `wrangler secret` only — never in this repo. Players' GitHub tokens are stored encrypted and used only for their own refresh.

## How it works

- Ingest fetches a public GitHub snapshot (GraphQL) → D1.
- `packages/scorer` (pure) turns it into stats, type, species, form.
- `packages/creature-gen` composes a deterministic 24×24 sprite — in the browser for the map, in the Worker for profile images and share cards.
- `packages/shared` `layout()` derives the city (plaza, 18 districts, streets, lots, spots) from populations; `/api/city` serves every resident (edge-cached) and the client places them by rank: plaza, district squares, house doors, streets.
- Hometown: the fetcher parses the public GitHub `location` with a generated GeoNames lookup (`scripts/geo-build.ts`) and sends it in the snapshot; `/world` ranks countries and cities.
- A trusted fetcher (`scripts/drain.ts`, on a timer) hatches requested developers and refreshes stale ones through `/internal/*`.
- Signed-in players catch, claim, keep a Dex, join towns.

## Authoritative decisions (mirror — ledger is `…/DECISIONS.md`)

- D1 creatures on one map · D3 free catch + claim buff · D4 login = belonging · D6 power ≠ size · D8 AGPL, art/name closed · D9 no private repos · D14 no notifications

## Conventions

- `pnpm check` (format + lint + typecheck + test) green before push. The scorer's golden tests are the test boundary.

## Status

Lives in `…/implementation/STATUS.md` — trust that over this file.
