# Android preview maintainer guide

Keyboard Helper publishes one signed `arm64-v8a` Android preview APK from the existing release
workflow. The signing identity belongs only to application ID
`me.maxistar.keyboardhelper.companion`; never reuse a keystore from another application.

## Signing identity and secrets

Create the dedicated production keystore offline with a long random store password, a distinct key
password, and a project-specific alias. Keep two encrypted backups under separate maintainer control
and test recovery before enabling publication. GitHub Actions requires these repository secrets:

- `ANDROID_KEYSTORE_BASE64`: base64 of the complete binary keystore, without line breaks.
- `ANDROID_KEYSTORE_PASSWORD`: password protecting the keystore.
- `ANDROID_KEY_ALIAS`: alias of the Keyboard Helper preview key.
- `ANDROID_KEY_PASSWORD`: password protecting that key entry.

Do not paste secret values into workflow logs, issues, release notes, or committed files. The job
decodes the keystore under `RUNNER_TEMP`, writes the ignored
`src-tauri/gen/android/keystore.properties`, and uploads only verified files under `dist/android`.

Extract the public certificate identity locally, normalize it to 64 uppercase hexadecimal
characters, and save that single public value in `android/preview-certificate.sha256`:

```sh
keytool -list -v -keystore /secure/path/keyboard-helper-preview.jks -alias YOUR_ALIAS
```

Independently compare the recorded SHA-256 fingerprint with the backed-up keystore before adding the
four secrets. Changing this file or the production key changes Android update identity and requires
an explicit incident/migration decision.

## Trusted branch inspection

The `master` release workflow builds Android only in its trusted push context. It uploads
`tauri-release-android-arm64-preview` as a workflow artifact and does not create a GitHub release.
Download both staged files, verify the checksum, then independently inspect the APK:

```sh
shasum -a 256 -c Keyboard-Helper-Companion_*.apk.sha256
node scripts/verify-android-preview.mjs Keyboard-Helper-Companion_*.apk \
  --version X.Y.Z \
  --fingerprint-file android/preview-certificate.sha256
```

The verifier requires the release signature, recorded signer, package/display identity, shared
semantic version and derived version code, minSdk 24, and `arm64-v8a`-only native contents. Also
review the job log and artifact file list: neither may contain the keystore, properties file, secret
values, or an unsigned/debug APK.

## Release authorization and recovery

A version tag is never implicit. After automated gates, trusted branch inspection, clean-install,
stock/enhanced smoke, and upgrade acceptance are recorded, obtain explicit maintainer approval for
the exact version. Only then align package/Tauri/Cargo versions and create `vX.Y.Z`. The single
publish job must contain every desktop asset plus the Android APK and checksum.

If the keystore is lost or suspected compromised, stop Android publication. Do not silently replace
the signer: document the incident, withdraw invalid assets, and require users to uninstall before a
separately approved replacement signing channel.
