#!/bin/bash
# Build a local-only DMG without mounting a temporary disk image. The release
# workflow still uses electron-builder with Developer ID and notarization.
set -euo pipefail
cd "$(dirname "$0")/.."
version="$(node -p 'require("./package.json").version')"
app="dist/mac-arm64/Aval.app"
test -d "$app" || { echo "Build the macOS application before creating the DMG." >&2; exit 1; }
codesign --verify --deep --strict "$app"
staging="$(mktemp -d "${TMPDIR:-/tmp}/aval-dmg.XXXXXX")"
trap 'rm -rf "$staging"' EXIT
mkdir "$staging/content"
ditto "$app" "$staging/content/Aval.app"
ln -s /Applications "$staging/content/Applications"
hdiutil makehybrid -hfs -hfs-volume-name Aval -o "$staging/Aval-hfs" "$staging/content"
hdiutil convert "$staging/Aval-hfs.dmg" -format UDZO -o "$staging/Aval.dmg"
hdiutil verify "$staging/Aval.dmg"
mv "$staging/Aval.dmg" "dist/Aval-${version}-arm64.dmg"
echo "Local DMG: desktop/dist/Aval-${version}-arm64.dmg (not notarized)"
