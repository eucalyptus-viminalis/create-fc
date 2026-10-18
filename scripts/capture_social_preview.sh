#!/usr/bin/env bash
# Render assets/social-preview.html to the 1200x630 PNG GitHub uses as the
# repo's social preview. Upload it at Settings -> General -> Social preview.
set -euo pipefail

INPUT_HTML="${1:-assets/social-preview.html}"
OUTPUT_PNG="${2:-assets/social-preview.png}"
VIEWPORT="${3:-1200,630}"

[[ -f "$INPUT_HTML" ]] || { echo "Input HTML not found: $INPUT_HTML" >&2; exit 1; }
mkdir -p "$(dirname "$OUTPUT_PNG")"

pnpm dlx playwright@1.63.0 screenshot \
  --browser=chromium \
  --channel=chrome \
  --wait-for-timeout=1500 \
  --viewport-size="$VIEWPORT" \
  "file://$(pwd)/$INPUT_HTML" \
  "$OUTPUT_PNG"

echo "Wrote $OUTPUT_PNG"
