#!/usr/bin/env bash
# Copy the picked 3D models (models/<key>.glb, v8 build 05) and the game icons (ui/<name>.png,
# v8 build 06) from the private art repo into the web app's public folder. Public URLs carry
# rank/landmark/icon keys only, never a person.
# Used by deploy.sh and for local development. Without the art repo the map keeps its code-built pieces.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=../gitemon-art/models
OUT=apps/web/public/models
[[ -f $SRC/models.ts ]] || { echo "models: none (no art repo)"; exit 0; }
rm -rf "$OUT" && mkdir -p "$OUT"
n=0
while IFS='|' read -r key file; do
  cp "$SRC/$file" "$OUT/$key.glb"; n=$((n + 1))
done < <(sed -n "s/^ *'\{0,1\}\([a-z0-9-]*\)'\{0,1\}: '\([^']*\.glb\)'.*/\1|\2/p" "$SRC/models.ts")
echo "models: $n copied ($(du -sh "$OUT" | cut -f1))"
if [[ -d ../gitemon-art/ui ]]; then
  rm -rf apps/web/public/ui && mkdir -p apps/web/public/ui
  cp ../gitemon-art/ui/*.png apps/web/public/ui/
  echo "ui: $(ls apps/web/public/ui | wc -l) icons"
fi
