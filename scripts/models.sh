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
# v19 build 11: the far, giant pieces (wonders, set pieces, landmarks, legends 4-10) ship with 512 px
# textures — they read the same from where they are seen, at about a third less to download. Made once per
# source file and kept in the art repo's models/lo/ (not tracked), so a deploy does not redo them.
LO=$SRC/lo
mkdir -p "$LO"
small() { [[ $1 =~ ^(wonder-|set-|lm-|legend-([4-9]|10)$) ]]; }
while IFS='|' read -r key file; do
  if small "$key"; then
    lo="$LO/${file%.glb}.512.glb"
    if [[ ! -f $lo || $lo -ot $SRC/$file ]]; then
      npx -y @gltf-transform/cli@4 optimize "$SRC/$file" "$lo" --texture-compress webp --texture-size 512 \
        --compress meshopt --simplify false >/dev/null 2>&1 || cp "$SRC/$file" "$lo"
    fi
    cp "$lo" "$OUT/$key.glb"
  else
    cp "$SRC/$file" "$OUT/$key.glb"
  fi
  n=$((n + 1))
done < <(sed -n "s/^ *'\{0,1\}\([a-z0-9-]*\)'\{0,1\}: '\([^']*\.glb\)'.*/\1|\2/p" "$SRC/models.ts")
# v19 build 11: one content version for every model, so their addresses can be cached for a year
( cd "$OUT" && sha1sum *.glb | sha1sum | cut -c1-10 ) > "$OUT/version.txt"
echo "models: $n copied ($(du -sh "$OUT" | cut -f1)), version $(cat "$OUT/version.txt")"
# v19 build 10: the 3D portraits (cards, Me, Dex, profile pages), versioned like the models
if [[ -d ../gitemon-art/portraits ]]; then
  rm -rf apps/web/public/portraits && mkdir -p apps/web/public/portraits
  cp ../gitemon-art/portraits/*.webp apps/web/public/portraits/
  [[ -d ../gitemon-art/portraits/og ]] && cp -r ../gitemon-art/portraits/og apps/web/public/portraits/
  ( cd apps/web/public/portraits && sha1sum *.webp | sha1sum | cut -c1-10 ) > apps/web/public/portraits/version.txt
  echo "portraits: $(ls apps/web/public/portraits/*.webp | wc -l), version $(cat apps/web/public/portraits/version.txt)"
fi
if [[ -d ../gitemon-art/ui ]]; then
  rm -rf apps/web/public/ui && mkdir -p apps/web/public/ui
  cp ../gitemon-art/ui/*.png apps/web/public/ui/
  echo "ui: $(ls apps/web/public/ui | wc -l) icons"
fi
