#!/bin/bash

# Create blendr-admin-extension.zip for Chrome Web Store upload.
# This script refuses to package unless manifest.json is higher than the
# currently published Chrome Web Store version.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXTENSION_DIR="$ROOT_DIR/apps/admin-extension"
OUT="$ROOT_DIR/blendr-admin-extension.zip"
EXTENSION_ID="dhijdnhjdpoiegbagdcjgaokoljgdbno"

current_version() {
  node -e "const fs=require('fs'); console.log(JSON.parse(fs.readFileSync('$EXTENSION_DIR/manifest.json','utf8')).version)"
}

compare_versions() {
  node -e "
    const [a,b]=process.argv.slice(1);
    const pa=a.split('.').map(Number), pb=b.split('.').map(Number);
    for (let i=0; i<Math.max(pa.length,pb.length); i++) {
      const da=pa[i]||0, db=pb[i]||0;
      if (da>db) process.exit(0);
      if (da<db) process.exit(1);
    }
    process.exit(1);
  " "$1" "$2"
}

MANIFEST_VERSION="$(current_version)"
PUBLISHED_XML="$(curl -fsSL "https://clients2.google.com/service/update2/crx?response=updatecheck&prodversion=130.0.0.0&acceptformat=crx2,crx3&x=id%3D${EXTENSION_ID}%26uc")"
PUBLISHED_VERSION="$(printf '%s' "$PUBLISHED_XML" | sed -n 's/.* version="\([^"]*\)".*/\1/p')"

if [ -z "$PUBLISHED_VERSION" ]; then
  echo "Could not determine published Chrome Web Store version."
  exit 1
fi

if ! compare_versions "$MANIFEST_VERSION" "$PUBLISHED_VERSION"; then
  echo "manifest.json version $MANIFEST_VERSION must be higher than published version $PUBLISHED_VERSION."
  exit 1
fi

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

mkdir -p "$STAGING/icons"
cp "$EXTENSION_DIR/manifest.json" "$STAGING/"
cp "$EXTENSION_DIR/background.js" "$STAGING/"
cp "$EXTENSION_DIR/config.js" "$STAGING/"
cp "$EXTENSION_DIR/content-script.js" "$STAGING/"
cp "$EXTENSION_DIR/popup.html" "$STAGING/"
cp "$EXTENSION_DIR/popup.js" "$STAGING/"
cp "$EXTENSION_DIR/icons/icon-16.png" "$STAGING/icons/"
cp "$EXTENSION_DIR/icons/icon-32.png" "$STAGING/icons/"
cp "$EXTENSION_DIR/icons/icon-48.png" "$STAGING/icons/"
cp "$EXTENSION_DIR/icons/icon-128.png" "$STAGING/icons/"

rm -f "$OUT"
(cd "$STAGING" && zip -qr "$OUT" .)

echo "Created $OUT"
unzip -l "$OUT"
