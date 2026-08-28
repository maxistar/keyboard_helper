#!/usr/bin/env bash

set -euo pipefail

TARGET="${1:?usage: verify-macos-ad-hoc.sh <target> <expected-arch> <artifact-label>}"
EXPECTED_ARCH="${2:?usage: verify-macos-ad-hoc.sh <target> <expected-arch> <artifact-label>}"
ARTIFACT_LABEL="${3:?usage: verify-macos-ad-hoc.sh <target> <expected-arch> <artifact-label>}"

VERSION="$(jq -r '.version' package.json)"
BUNDLE_ROOT="src-tauri/target/${TARGET}/release/bundle"
APP_PATH="${BUNDLE_ROOT}/macos/Keyboard Helper.app"
PLIST_PATH="${APP_PATH}/Contents/Info.plist"
STAGE_DIR="dist/macos/${ARTIFACT_LABEL}"
ASSET_NAME="Keyboard-Helper_${VERSION}_${ARTIFACT_LABEL}_unnotarized.dmg"

fail() {
  echo "macOS preview verification failed: $*" >&2
  exit 1
}

[[ -d "${APP_PATH}" ]] || fail "application bundle not found at ${APP_PATH}"
[[ -f "${PLIST_PATH}" ]] || fail "Info.plist not found at ${PLIST_PATH}"

shopt -s nullglob
dmg_files=("${BUNDLE_ROOT}/dmg/"*.dmg)
[[ "${#dmg_files[@]}" -eq 1 ]] || fail "expected exactly one DMG under ${BUNDLE_ROOT}/dmg, found ${#dmg_files[@]}"

codesign --verify --deep --strict --verbose=2 "${APP_PATH}"

signature_info="$(codesign --display --verbose=4 "${APP_PATH}" 2>&1)"
grep -q '^Signature=adhoc$' <<<"${signature_info}" || fail "application is not ad-hoc signed"

bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${PLIST_PATH}")"
[[ "${bundle_id}" == "me.maxistar.keyri-app" ]] || fail "unexpected bundle identifier: ${bundle_id}"

bundle_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "${PLIST_PATH}")"
[[ "${bundle_version}" == "${VERSION}" ]] || fail "bundle version ${bundle_version} does not match package version ${VERSION}"

executable_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "${PLIST_PATH}")"
executable_path="${APP_PATH}/Contents/MacOS/${executable_name}"
[[ -x "${executable_path}" ]] || fail "bundle executable not found at ${executable_path}"

architectures="$(lipo -archs "${executable_path}")"
case " ${architectures} " in
  *" ${EXPECTED_ARCH} "*) ;;
  *) fail "expected architecture ${EXPECTED_ARCH}, found: ${architectures}" ;;
esac

mkdir -p "${STAGE_DIR}"
find "${STAGE_DIR}" -mindepth 1 -maxdepth 1 -type f -delete
cp "${dmg_files[0]}" "${STAGE_DIR}/${ASSET_NAME}"
(
  cd "${STAGE_DIR}"
  shasum -a 256 "${ASSET_NAME}" > "${ASSET_NAME}.sha256"
)

# Ad-hoc signing proves code integrity but does not establish Developer ID trust
# or notarization. Gatekeeper rejection is diagnostic only and is deliberately
# separate from the codesign verification result above.
if spctl --assess --type execute --verbose=2 "${APP_PATH}"; then
  echo "Warning: Gatekeeper accepted this local ad-hoc build; it is still not notarized." >&2
else
  echo "Gatekeeper did not classify the ad-hoc preview as an identified, notarized release (expected)."
fi

echo "Verified ${APP_PATH}"
echo "  signature: ad-hoc"
echo "  architecture: ${architectures}"
echo "  bundle id: ${bundle_id}"
echo "  version: ${bundle_version}"
echo "  staged asset: ${STAGE_DIR}/${ASSET_NAME}"
echo "  checksum: ${STAGE_DIR}/${ASSET_NAME}.sha256"
