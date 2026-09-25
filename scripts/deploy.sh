#!/usr/bin/env bash
# Deploy gitemon.fun. Needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and GITEMON_D1_ID in the
# environment. Uses the private art set if it is checked out at ../gitemon-art (sibling of this repo).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CLOUDFLARE_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}" "${GITEMON_D1_ID:?}"

ART_SRC="../gitemon-art/index.ts"
ART_ALIAS="../../packages/creature-gen/src/art-entry.ts"
if [[ -f $ART_SRC ]]; then
  mkdir -p packages/creature-gen/art-real
  cp ../gitemon-art/*.ts packages/creature-gen/art-real/
  ART_ALIAS="../../packages/creature-gen/art-real/index.ts"
  echo "art: real set"
else
  echo "art: placeholder set"
fi

pnpm tsx --tsconfig scripts/tsconfig.json scripts/icons.ts
pnpm --filter @gitemon/web build

sed -e "s|__D1_ID__|$GITEMON_D1_ID|" \
    -e "s|\"../../packages/creature-gen/src/art-entry.ts\"|\"$ART_ALIAS\"|" \
    -e '/^WORKOS_CLIENT_ID = /d' \
    apps/api/wrangler.toml > apps/api/wrangler.deploy.toml

cd apps/api
npx wrangler d1 migrations apply gitemon --remote -c wrangler.deploy.toml
npx wrangler deploy -c wrangler.deploy.toml
