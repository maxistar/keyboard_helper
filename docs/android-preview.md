# Keyboard Helper Companion for Android

Keyboard Helper Companion is an `arm64-v8a` preview for Android 12 / API 31 and newer. It is
distributed as a signed APK through the Keyboard Helper GitHub release page, not Google Play. The
application works in the foreground; selected keyboard, connection, and Live state are process-local.

## Download, verify, and install

1. Open the [Keyboard Helper releases](https://github.com/maxistar/keyboard_helper/releases) page
   on the phone and choose a release that includes
   `Keyboard-Helper-Companion_<version>_android-arm64_preview.apk` and its `.sha256` file.
2. Use a checksum-capable file manager or another trusted SHA-256 utility on the phone to compare
   the APK digest with the sidecar. Do not install when the names or values differ.
3. Open the APK. Android may ask the browser or file manager for permission to install unknown
   apps. Approve only that source for this installation; do not disable Android security globally.
4. Launch **Keyboard Helper Companion** and grant **Nearby devices** when the application asks.
   Location permission is not required on supported Android versions.

If a locally built debug APK with the same package is already installed, Android will reject the
preview because its signer differs. Uninstall the debug application once, then install the preview.
Application permission state may be reset. Bluetooth keyboard pairing is owned by Android and is
normally retained separately.

## Pair and connect

Pair the keyboard first in Android **Settings > Connected devices > Pair new device**. Return to the
companion, choose **Connect**, select the bonded keyboard, and wait for **Connection: connected**.
If Android asks to pair during connection, accept the system prompt.

**Browse** always lets you inspect the bundled keyboard layouts. A stock ZMK keyboard adds
connection status and whatever standard Battery Service or Device Information Service evidence it
actually exposes; these standard values are optional. **Live** is available only with compatible
Keyboard Helper enhanced firmware and presents read-only layer, key, combo, and bounded diagnostic
telemetry. The Android companion follows keyboard state and never writes a remote layer change.

## Limitations

- Supported preview baseline: Android 12 / API 31+, `arm64-v8a`; package minSdk is 24 but older
  devices are not part of the supported physical acceptance baseline.
- Foreground use only. Background BLE monitoring is not promised.
- Keyboard selection and Live state are not restored after the process is killed.
- Battery and device-information values may be absent on otherwise compatible stock firmware.
- Live telemetry requires the optional Keyboard Helper ZMK extension and a matching local layout.
- No Google Play listing, automatic updater, mobile layout editing, or remote layer control.

## Troubleshooting

- **Nearby devices denied:** enable it in Android app permissions, then reconnect.
- **Bluetooth unavailable:** enable Bluetooth and return to the app.
- **Empty scan/list:** wake the keyboard, confirm it is paired to the current Bluetooth profile, and
  retry. Clear stale Android pairing and pair again if Android reports an incorrect PIN.
- **Pairing/security failure:** remove the keyboard from Android, clear that ZMK Bluetooth profile,
  restart both sides, pair in Android Settings, then reconnect in the app.
- **Connection lost:** wake the keyboard and allow bounded automatic recovery. Use **Reconnect**
  after retries are exhausted.
- **Connection capacity exhausted:** disconnect another central/device or switch the keyboard to a
  free Bluetooth profile, then retry.
- **Unsupported protocol:** Browse and standard evidence remain valid; install compatible enhanced
  firmware only if Live telemetry is wanted.
- **Waiting for Live:** press a key or switch a layer after connecting. If it persists, reconnect and
  confirm the enhanced service is visible to a BLE scanner.
- **Sequence gap:** the companion detected missed telemetry and resubscribes; reconnect if the state
  does not recover.
- **Layout mismatch / layer unavailable:** choose the JSON layout that matches the keyboard
  firmware. The companion will not invent a missing layer.

