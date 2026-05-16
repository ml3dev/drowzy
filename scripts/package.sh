#!/usr/bin/env bash
# Build drowzy-<version>.zip from the current source tree.
# Deterministic: includes only the extension files that ship to the Chrome
# Web Store. Run from the repo root.
#
# Usage:
#   scripts/package.sh           # builds drowzy-<manifest version>.zip
#   scripts/package.sh 1.4.0     # override the output filename's version
#
# The CI workflow (.github/workflows/release.yml) calls this on tag push.

set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-$(grep -E '"version"' manifest.json | head -1 | sed -E 's/.*"version"\s*:\s*"([^"]+)".*/\1/')}"
OUT="drowzy-${VERSION}.zip"
rm -f "$OUT"

zip -qr "$OUT" \
  manifest.json background.js formcheck.js icons.js \
  popup.html popup.css popup.js \
  sidepanel.html \
  onboarding.html onboarding.js \
  changelog.html changelog.js \
  privacy-policy.html privacy-policy.js \
  LICENSE \
  _locales icons

SHA=$(sha256sum "$OUT" | awk '{print $1}')
SIZE=$(wc -c < "$OUT")
echo "wrote $OUT"
echo "  size:   $SIZE bytes"
echo "  sha256: $SHA"
