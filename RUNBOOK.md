# Runbook

## Deploy

```bash
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… GITEMON_D1_ID=… ./scripts/deploy.sh
```

Builds the web app, applies D1 migrations, deploys the Worker. Uses the private art set when it is
checked out at `../gitemon-art`; otherwise the placeholder set.

## Roll back

`cd apps/api && npx wrangler rollback -c wrangler.deploy.toml` (then fix forward). D1 migrations are
additive; never edit an applied migration.

## Secrets (Worker)

`WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `SESSION_SECRET`, `TOKEN_KEY` (32 bytes, base64),
`INTERNAL_KEY`, `ADMIN_EMAILS`, `ADMIN_LOGINS`, optional `GITHUB_TOKEN` (a token with **no scopes**)
and optional `DAILY_CATCH_LIMIT`, `REAL_MIN_AGE_DAYS`. Rotating `TOKEN_KEY` makes stored player
tokens unreadable; players simply sign in again.

## Trusted fetcher

`scripts/drain.ts` hatches requested developers and refreshes stale ones. Run it every 2 minutes
with `GITHUB_TOKEN` and `GITEMON_INTERNAL_KEY`. `/health` reports `pending` and `pendingOldestMin`;
the `watchdog` workflow alerts when the site is down or the oldest request waits over 30 minutes.

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
