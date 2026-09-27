#!/usr/bin/env bash
# Copy the picked 3D models from the private art repo into the web app's public folder as
# models/<key>.glb (v8 build 05). Public URLs carry rank/landmark keys only, never a person.
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
