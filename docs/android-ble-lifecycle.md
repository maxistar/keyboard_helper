# Android BLE Lifecycle

## Purpose and boundary

The Android companion owns a foreground-only BLE session through a platform-neutral JavaScript
lifecycle coordinator. Android `BluetoothGatt` details remain inside the project-owned Kotlin
plugin. A future Swift/CoreBluetooth adapter can drive the same events and effects without
changing lifecycle policy.

The lifecycle stores no device, payload, key, combo, layer, or connection state across JavaScript
processes. A cold process starts with no selected device and no connection intent, then observes
permission and Bluetooth availability. The implementation has no background scan, background
reconnect loop, foreground service, network transmission, or remote characteristic-value write.

## State and effect model

`src-mobile/ble_lifecycle.js` exposes an immutable, serializable snapshot with orthogonal facts:

- phase: `idle`, `permission-required`, `scanning`, `connecting`, `discovering`, `ready`,
  `reconnecting`, `suspended`, `disconnected`, `bluetooth-unavailable`, `unsupported`,
  `capacity-unavailable`, or `failed`;
- foreground/background visibility, desired connection, normalized permission and Bluetooth
  availability, and a process-local selected-device summary;
- monotonically increasing lifecycle and transport generations;
- `unknown`, `stock`, or `enhanced` capability mode;
- bounded retry progress and a structured reason.

Events enter one serialized queue. A pure reducer validates each transition and emits explicit,
generation-tagged effects. A generation change clears the diagnostic notification evidence and
invalidates late operation completions, disconnect callbacks, and notification callbacks.

```text
user select + connect
        │
        ▼
   connecting ──success──▶ discovering ──success──▶ ready
        │                       │                    stock/enhanced
        └──── failure ──────────┴──────────────────▶ failed/actionable

ready ──unexpected loss──▶ reconnecting ──bounded attempts──▶ ready
                                      └──exhausted──────────▶ disconnected

active ──confirmed background──▶ suspended ──foreground + intent──▶ reconnecting
```

## Fixed policy constants

- Unexpected foreground loss gets at most three fresh reconnect attempts: 500 ms, 1500 ms, then
  3000 ms. Successful discovery resets the budget. Exhaustion enters `disconnected` with reason
  `reconnect-exhausted` and leaves no timer.
- Ordinary background visibility is confirmed after 500 ms. Confirmed background stops scanning
  and retry timers, invalidates the generation, clears transient evidence, unsubscribes, releases
  GATT, and enters `suspended`.
- Permission and encrypted-subscription flows hold a system-interaction lease. Temporary Android
  permission or pairing UI does not tear down the initiating operation. The lease expires after
  30 seconds; if the app remains hidden, foreground cleanup runs immediately.
- Permission failure, Bluetooth unavailable, unsupported transport, and capacity unavailable
  cancel retry work. Bluetooth recovery may resume an existing foreground process-local intent,
  but never opens a permission prompt or starts a scan by itself.
- Explicit disconnect clears desired connection before cleanup, so a late native callback cannot
  restart the session.

## Android availability integration

The native adapter exposes only `unknown`, `available`, and `unavailable`, plus a separate
`supported` fact. Before Android grants the required runtime permission, adapter state is
`unknown`; this avoids using permission-protected Bluetooth state APIs prematurely.

The Kotlin plugin registers `BluetoothAdapter.ACTION_STATE_CHANGED` only while the JavaScript
observer is active, suppresses duplicate snapshots, and unregisters the receiver on observer stop
or plugin destruction. Unexpected connection-loss events include the active native attempt,
Android status, a normalized category, and `explicit: false`. Explicit disconnect removes the
callback channel before releasing GATT.

## Diagnostics and troubleshooting

The companion surface shows phase, visibility, intent, permission, Bluetooth availability,
generations, capability mode, retry progress, and structured reason. `ready/stock` is a valid
keyboard session; lack of the Keyboard Helper extension is not `unsupported`.

- `permission-required` / `permission-denied`: use the explicit Grant Bluetooth action; open app
  settings if Android no longer offers the prompt.
- `bluetooth-unavailable`: enable Bluetooth. The app will not silently scan.
- `security-required`: keep the app in the foreground and complete Android pairing/encryption UI.
- `capacity-unavailable`: close other BLE sessions or reboot Bluetooth, then explicitly retry.
- `reconnect-exhausted`: bring the keyboard near the phone and use Reconnect.
- `discovery-failed` or generic connection failure: disconnect, power-cycle the keyboard if
  needed, and start a new explicit connection flow.
- On OEM builds that aggressively stop WebViews, use `adb logcat`, disable battery restrictions
  temporarily for diagnosis, and verify the cold-process state rather than expecting restoration.

## Physical acceptance matrix

Use an arm64 phone running Android API 31 or newer and the known enhanced keyboard. Record bounded
metadata only; do not retain inferred text, HID data, or an unbounded notification stream.

| Scenario | Expected result | Status |
|---|---|---|
| Foreground connect | connect → discover → `ready/enhanced`; read and notification succeed | pass, API 36 physical phone |
| Normal background/resume | after 500 ms: `suspended` and GATT released; foreground reconnects and a second notification cycle succeeds | pass, API 36 physical phone |
| Explicit disconnect | intent becomes `none`; no reconnect occurs | pass, remained disconnected beyond the full retry window |
| Permission/pairing UI | temporary visibility change does not tear down; 30-second expiry is safe | pass: API 36 permission prompt plus pending-native-operation expiry test |
| Bluetooth off/on while active | cleanup → `bluetooth-unavailable` → bounded recovery; no prompt or scan | pass, API 36 physical phone |
| Bluetooth off/on while idle | availability changes; no prompt, scan, or connection starts | pass, API 36 physical phone |
| Unexpected loss | delays are 500/1500/3000 ms; success resets or exhaustion is actionable | pass, API 36 physical phone; exhaustion exposed active Reconnect and explicit recovery returned to `ready/enhanced` with notifications |
| Process recreation | no selection, intent, retry, GATT claim, or notification bytes remain | pass, force-stop/cold-start on API 36 |
| Capacity unavailable | deterministic mapping is acceptable when safe hardware reproduction is unavailable | automated pass |

Acceptance decision recorded on 2026-09-08: **pass; proceed to stock companion UI after this
change is synchronized and archived**. The physical matrix ran on an arm64 Xiaomi `2511FPC34G`
with Android 16 / API 36. The unexpected-loss exercise exposed a disabled manual Reconnect action;
the lifecycle action predicate was corrected, covered by a regression test, rebuilt, installed, and
the exhaustion → explicit reconnect → `ready/enhanced` notification cycle passed on the same phone.
Connection-capacity exhaustion remains deterministic-test-only because safe hardware reproduction
was unavailable. All other `android-ble-lifecycle` and modified `android-ble-transport` scenarios
are covered by the physical matrix, deterministic tests, or both, with no stop condition reached.

Automated verification does not require BLE hardware: reducer tables, injected clocks, coordinator
ordering, generation filtering, adapter contract tests, the full frontend suite, Rust tests, and
the arm64 Android build cover the deterministic boundary.

## Automated verification record

Recorded on 2026-09-08:

- `npm run check:js`: pass, 228 tests including 15 lifecycle tests;
- `TAURI_CONFIG='{"app":{"macOSPrivateApi":false}}' cargo test --manifest-path
  src-tauri/Cargo.toml --locked`: pass, 35 Rust tests; existing vendored `rdev` warnings are
  unchanged;
- `npm run android:build`: pass for `aarch64-linux-android`; only the two retained pre-API-33
  `BluetoothGatt` value-access compatibility warnings and Gradle/JDK deprecation notices remain;
- `npm run tauri -- build --debug --no-bundle`: pass, confirming desktop dependency and startup
  isolation; a separate DMG packaging attempt reached a built `.app` before its sandboxed bundling
  script failed, so packaging is not used as lifecycle evidence;
- Rust formatting, `git diff --check`, and `openspec validate
  stabilize-android-ble-lifecycle --strict`: pass;
- the arm64 APK installed and cold-started on the API 35 arm64 emulator with no app-process crash;
  BLE lifecycle acceptance remains physical-device-only.
