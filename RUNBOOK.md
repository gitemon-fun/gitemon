# Runbook

## Deploy

```bash
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… GITEMON_D1_ID=… ./scripts/deploy.sh
```

Builds the web app, applies D1 migrations, deploys the Worker. Uses the private art set when it is
checked out at `../gitemon-art` (sprites, plus `scripts/models.sh` copies the picked 3D models and
the icons into `apps/web/public/`); otherwise the placeholder set and no models.

**After any change to the island layout** (`packages/shared/src/island.ts`), re-freeze today's
layout right after the deploy, or the stored legend spots stop matching the map:

```bash
GITHUB_TOKEN=… GITEMON_INTERNAL_KEY=… pnpm tsx --tsconfig scripts/tsconfig.json scripts/daily.ts --force
```

## Roll back

`cd apps/api && npx wrangler rollback -c wrangler.deploy.toml` (then fix forward). D1 migrations are
additive; never edit an applied migration.

## Secrets (Worker)

`WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `SESSION_SECRET`, `TOKEN_KEY` (32 bytes, base64),
`INTERNAL_KEY`, `ADMIN_EMAILS`, `ADMIN_LOGINS`, optional `GITHUB_TOKEN` (a token with **no scopes**)
and optional `DAILY_CATCH_LIMIT`, `REAL_MIN_AGE_DAYS`. Rotating `TOKEN_KEY` makes stored player
tokens unreadable; players simply sign in again.

## Trusted fetcher

`scripts/drain.ts` hatches requested developers and refreshes stale ones, and once a UTC day runs
`scripts/daily.ts`: it freezes the island layout, every legend's spot and the day's Merit House
holders (top 3 by merit per region, kept while top 5, only at merit ≥ 50). Run it every 2 minutes
with `GITHUB_TOKEN` and `GITEMON_INTERNAL_KEY`. `/health` reports `pending` and `pendingOldestMin`;
every fetcher pass also watches the site (`scripts/watch.ts`): when `/health` stops answering or the oldest request waits over 30 minutes it runs `GITEMON_ALERT_CMD` with the message (set in the fetcher's service unit), repeats at most every 6 hours, and says when it recovers. If the fetcher's machine itself goes down, an off-box watchdog on that machine's heartbeat raises the alarm.

## Seed

`scripts/seed.ts [perLanguage]` adds the most-followed developers per language and the official
towns. Resumable.

## Re-score after a scorer change

Bump `SCORER_VERSION`, deploy, then let the fetcher refresh everyone (or run `seed.ts` again —
`/internal/ingest` re-scores existing rows).

## Takedown / abuse

An admin (signed in, listed in `ADMIN_EMAILS`/`ADMIN_LOGINS`) can hide a Gitemon
(`POST /api/admin/hide/:id`) or delete a town (`POST /api/admin/town/:id/delete`); every action is
in `GET /api/admin/log`. A developer can always hide their own Gitemon with **Release**.

## Client errors

The map reports errors, shader problems, the GPU name and one frame check per visit (did the island
draw anything: pixels, draw calls, camera, fog) to `POST /api/clientlog`. Reports go to the Worker log
(`cd apps/api && npx wrangler tail gitemon --search CLIENTLOG`) and to the D1 table `clientlog`, which
keeps the newest 500: `npx wrangler d1 execute gitemon --remote -c wrangler.deploy.toml --command
"SELECT * FROM clientlog ORDER BY id DESC LIMIT 20"`.

## Landing (v14)

`/` is the island itself with a welcome card, served by the Worker from `app.html` (`landingShell` in
`apps/api/src/pages.ts`); a visitor with a session cookie gets the plain app and lands at their Gitemon.
Before the 3D island is ready, the page shows still pictures of the opening view: a tiny blurred copy
inside the page, then `poster-wide.webp` / `poster-tall.webp`, which fade into the live island. The
pictures and the share picture (`og-default.png`) are captures of the live island kept in the private
art repo; `scripts/icons.ts` copies them in at deploy. **When the island's look or opening view
changes, capture them again** (the capture script lives in the gitignored `.claude/tools/`), commit
them to the art repo and deploy — otherwise the fade shows the old island for a moment.

## Camera (v13)

The camera's pure maths (springs, tilt limits, the walk camera's three-quarter angle) lives in
`packages/shared/src/camera.ts` with its tests; the input and the zoom-to-cursor solver are in
`apps/web/src/city/scene.ts`. `/map?debug` exposes the scene as `window.city` for measuring: the
ground point under the pointer (`city.terrainAt(x, y)`) should stay under the pointer through a wheel
zoom. It does to under 1 px, except where a hill between the camera and the pointer lifts the camera
(the pivot must stay in view); there the zoom stops at the nearest view the hill allows.

## Creature art (v10)

The 54 creatures (18 evolution lines × 3 forms) are made with free Meta AI images, one conversation per
line so each line stays one creature, then turned into pixel sprites by the private art repo's
`tools/build_v10.py` (it finds the source's own pixel grid, removes the background, keeps outlines,
and marks the marking colour as `accent`). Its output is the art repo's `species.ts` + `gaits.ts`;
`scripts/deploy.sh` copies them in. Changing the art set's `id` refreshes cached profile and share images.
