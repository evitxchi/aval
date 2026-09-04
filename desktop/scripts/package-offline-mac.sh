#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
DESKTOP_DIR="${SCRIPT_DIR:h}"
PROJECT_DIR="${DESKTOP_DIR:h}"
SOURCE_APP="${AVAL_ELECTRON_SOURCE_APP:-/Applications/Granola.app}"
OUTPUT_DIR="${DESKTOP_DIR}/dist"
APP_OUTPUT="${OUTPUT_DIR}/Aval.app"
APP_VERSION="$(/usr/bin/plutil -extract version raw "${DESKTOP_DIR}/package.json")"
DMG_OUTPUT="${OUTPUT_DIR}/Aval-${APP_VERSION}-arm64.dmg"
WORK_DIR="$(/usr/bin/mktemp -d /private/tmp/aval-offline-package.XXXXXX)"
STAGED_APP="${WORK_DIR}/Aval.app"

cleanup() {
  /bin/rm -rf -- "${WORK_DIR}"
}
trap cleanup EXIT

if [[ ! -d "${SOURCE_APP}/Contents/Frameworks/Electron Framework.framework" ]]; then
  print -u2 "No reusable Electron runtime found at ${SOURCE_APP}."
  print -u2 "Set AVAL_ELECTRON_SOURCE_APP to an installed Electron 44 application."
  exit 1
fi

RUNTIME_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "${SOURCE_APP}/Contents/Frameworks/Electron Framework.framework/Resources/Info.plist")"
if [[ "${RUNTIME_VERSION}" != 44.* ]]; then
  print -u2 "Aval requires an Electron 44 runtime for this offline build; found ${RUNTIME_VERSION}."
  exit 1
fi

/bin/mkdir -p "${STAGED_APP}/Contents/MacOS" "${STAGED_APP}/Contents/Resources/app"
/usr/bin/ditto "${SOURCE_APP}/Contents/Frameworks" "${STAGED_APP}/Contents/Frameworks"
/bin/cp "${SOURCE_APP}/Contents/MacOS/Granola" "${STAGED_APP}/Contents/MacOS/Aval"
/bin/cp "${SOURCE_APP}/Contents/Info.plist" "${STAGED_APP}/Contents/Info.plist"
/bin/cp "${SOURCE_APP}/Contents/PkgInfo" "${STAGED_APP}/Contents/PkgInfo"

for ROLE in "" " (GPU)" " (Plugin)" " (Renderer)"; do
  OLD_APP="${STAGED_APP}/Contents/Frameworks/Granola Helper${ROLE}.app"
  NEW_APP="${STAGED_APP}/Contents/Frameworks/Aval Helper${ROLE}.app"
  /bin/mv "${OLD_APP}" "${NEW_APP}"
  /bin/mv "${NEW_APP}/Contents/MacOS/Granola Helper${ROLE}" "${NEW_APP}/Contents/MacOS/Aval Helper${ROLE}"
  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Aval Helper${ROLE}" "${NEW_APP}/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleExecutable Aval Helper${ROLE}" "${NEW_APP}/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.evalxnder.aval.helper${ROLE//[ ()]/}" "${NEW_APP}/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${APP_VERSION}" "${NEW_APP}/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Delete :ElectronAsarIntegrity" "${NEW_APP}/Contents/Info.plist" 2>/dev/null || true
done

PLIST="${STAGED_APP}/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName Aval' "${PLIST}"
/usr/libexec/PlistBuddy -c 'Set :CFBundleExecutable Aval' "${PLIST}"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier com.evalxnder.aval' "${PLIST}"
/usr/libexec/PlistBuddy -c 'Set :CFBundleName Aval' "${PLIST}"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${APP_VERSION}" "${PLIST}"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${APP_VERSION}" "${PLIST}"
/usr/libexec/PlistBuddy -c 'Set :LSApplicationCategoryType public.app-category.business' "${PLIST}"
/usr/libexec/PlistBuddy -c 'Set :NSHumanReadableCopyright Copyright © 2026 Aval' "${PLIST}"
for KEY in CFBundleIconName CFBundleURLTypes ElectronAsarIntegrity GranolaManagedUpdateHandshakeVersion NSAppTransportSecurity NSAudioCaptureUsageDescription NSBluetoothAlwaysUsageDescription NSBluetoothPeripheralUsageDescription NSCalendarsUsageDescription NSCameraUsageDescription NSContactsUsageDescription NSDockTilePlugIn NSMicrophoneUsageDescription NSScreenCaptureUsageDescription NSSystemExtensionUsageDescription; do
  /usr/libexec/PlistBuddy -c "Delete :${KEY}" "${PLIST}" 2>/dev/null || true
done

/bin/cp "${DESKTOP_DIR}/main.cjs" "${DESKTOP_DIR}/preload.cjs" "${DESKTOP_DIR}/codex-app-server.cjs" "${DESKTOP_DIR}/package.json" "${STAGED_APP}/Contents/Resources/app/"
/bin/cp "${DESKTOP_DIR}/ELECTRON-LICENSE.txt" "${STAGED_APP}/Contents/Resources/"
if [[ -f /Applications/Cursor.app/Contents/Resources/LICENSES.chromium.html ]]; then
  /bin/cp /Applications/Cursor.app/Contents/Resources/LICENSES.chromium.html "${STAGED_APP}/Contents/Resources/"
fi

/usr/bin/sips -s format icns "${PROJECT_DIR}/public/icon-512.png" --out "${STAGED_APP}/Contents/Resources/icon.icns" >/dev/null

# Keep this development artifact compact and native to the current Apple
# silicon Mac. The normal electron-builder path remains the release route.
find "${STAGED_APP}" -type f -print0 | while IFS= read -r -d '' FILE_PATH; do
  if /usr/bin/file "${FILE_PATH}" | /usr/bin/grep -q 'universal binary'; then
    MODE="$(/usr/bin/stat -f '%Lp' "${FILE_PATH}")"
    /usr/bin/lipo "${FILE_PATH}" -thin arm64 -output "${FILE_PATH}.arm64"
    /bin/chmod "${MODE}" "${FILE_PATH}.arm64"
    /bin/mv "${FILE_PATH}.arm64" "${FILE_PATH}"
  fi
done
/bin/rm -f "${STAGED_APP}/Contents/Frameworks/Electron Framework.framework/Resources/v8_context_snapshot.x86_64.bin"

find "${STAGED_APP}" -name _CodeSignature -type d -prune -exec /bin/rm -rf -- {} +
/usr/bin/xattr -cr "${STAGED_APP}"
/usr/bin/codesign --force --deep --sign - --timestamp=none "${STAGED_APP}"
/usr/bin/codesign --verify --deep --strict --verbose=2 "${STAGED_APP}"

/bin/mkdir -p "${OUTPUT_DIR}"
if [[ -e "${APP_OUTPUT}" ]]; then /bin/rm -rf -- "${APP_OUTPUT}"; fi
if [[ -e "${DMG_OUTPUT}" ]]; then /bin/rm -f -- "${DMG_OUTPUT}"; fi
/usr/bin/ditto "${STAGED_APP}" "${APP_OUTPUT}"

DMG_ROOT="${WORK_DIR}/dmg"
/bin/mkdir -p "${DMG_ROOT}"
/usr/bin/ditto "${STAGED_APP}" "${DMG_ROOT}/Aval.app"
/bin/ln -s /Applications "${DMG_ROOT}/Applications"
if ! /usr/bin/hdiutil create -volname Aval -srcfolder "${DMG_ROOT}" -format UDZO -ov "${DMG_OUTPUT}"; then
  # Managed shells can forbid hdiutil from attaching the temporary device it
  # uses for UDZO creation. makehybrid writes UDF without that device step;
  # convert can then wrap and compress the raw image as a checksummed UDIF.
  /bin/rm -f -- "${DMG_OUTPUT}"
  # DiscRecording's HFS hybrid generator attaches com.apple.FinderInfo to
  # every copied file. That invalidates an already-signed app bundle when it
  # is copied out of the DMG. UDF preserves the bundle without those xattrs.
  RAW_IMAGE="${WORK_DIR}/Aval-udf.iso"
  /usr/bin/hdiutil makehybrid -udf -udf-version 1.50 -udf-volume-name Aval -o "${RAW_IMAGE}" "${DMG_ROOT}"
  /usr/bin/hdiutil convert "${RAW_IMAGE}" -format UDZO -o "${DMG_OUTPUT}"
fi

/usr/bin/hdiutil verify "${DMG_OUTPUT}"

print "Created ${DMG_OUTPUT}"
print "Electron runtime ${RUNTIME_VERSION}; Apple silicon; ad-hoc signed development build."
