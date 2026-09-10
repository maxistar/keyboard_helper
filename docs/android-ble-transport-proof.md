# Android BLE Transport Proof

## Purpose

This document is the fixed evaluation matrix and physical-device acceptance script for the
Keyboard Helper Android BLE adapter. Compilation alone is not acceptance: the retained adapter
must complete the full foreground GATT path against a compatible physical keyboard.

The application-facing contract is owned by Keyboard Helper in `src-mobile/ble_transport.js`.
Candidate-specific Kotlin, Rust, or Java objects must not cross that boundary.

## Candidate Matrix

Evaluate pinned versions. Record `pass`, `fail`, or `not demonstrated` for every row and link the
result to build output or a physical-run observation.

| Criterion | Direct `btleplug` | Tauri community plugin | Project-owned Kotlin plugin |
|---|---|---|---|
| Android API 24 build and API 31+ runtime | build only | fail: minSdk 26 | pass: minSdk 24, API 30 and 36 runtime |
| Durable integration outside `src-tauri/gen/` | not demonstrated | available, but rejected | pass |
| Just-in-time scan/connect permission flow | not demonstrated | not reached | pass |
| Permission denial is actionable | not demonstrated | not reached | pass by deterministic test |
| Bounded scan can be stopped | build only | not reached | pass |
| Stable normalized device identifier | build only | not reached | pass |
| One selected-device connection | not demonstrated | not reached | pass |
| Services and characteristics can be listed | not demonstrated | not reached | pass |
| Standard Battery Level can be read | not demonstrated | not reached | pass: 81% |
| Encrypted event CCC can be enabled | not demonstrated | not reached | pass |
| Event notification bytes reach the app | not demonstrated | not reached | pass |
| Disconnect releases subscription and GATT | not demonstrated | not reached | pass |
| Explicit reconnect works in the same process | not demonstrated | not reached | pass |
| Late callbacks can be tagged and discarded | not demonstrated | not reached | pass by deterministic test and physical disconnect observation |
| Errors retain permission/security/GATT category | not demonstrated | documented, not reached | pass by boundary/native mapping tests |
| Deterministic adapter tests are possible | pass for isolated API use | not evaluated | pass |
| Dependency is maintained and pinnable | pass: `0.12.0` | pass: `0.12.0` | pass: project-owned `0.1.0` |
| Future Swift/CoreBluetooth adapter can preserve the boundary | possible, with shared-library coupling | possible | pass: platform-native adapter behind shared contract |

## Initial Source Review

Review date: 2026-09-07.

- Direct `btleplug 0.12.0` documents Android central support for discovery, GATT services,
  characteristics, reads, and notifications. Its Android setup requires a hybrid Rust/Java build
  and explicit Java packaging, while the project currently gates `btleplug` out of mobile builds.
- `tauri-plugin-blec 0.12.0` is a Tauri 2 client plugin which wraps `btleplug` on desktop and uses a
  Tauri Android plugin on Android. Its public API covers permission checks, bounded scan/stop,
  connect/disconnect, service listing, read, subscribe, and unsubscribe. Open upstream reports
  include empty Android service lists and device-specific Android connection failures, so it must
  not be selected on documentation or compilation evidence alone.
- A project-owned Kotlin plugin using Android `BluetoothLeScanner` and `BluetoothGatt` can expose
  only the required operations, preserve callback generations, and later be mirrored by a native
  Swift/CoreBluetooth adapter behind the same application contract. It is the preferred candidate,
  but still requires the same physical proof.

## Candidate Build Evidence

### Direct `btleplug 0.12.0`

- **Android Rust target:** pass. A minimal crate using `Manager`, `Central`, scan start/stop,
  peripheral enumeration, and property reads completed `cargo check --target
  aarch64-linux-android` on 2026-09-07.
- **Durable Tauri packaging:** not demonstrated. The crate's Android implementation also requires
  its Java/JNI classes to be built and packaged into the Android application; a Rust target build
  alone does not prove that hybrid integration or runtime permission handling.
- **Selection status:** retained as technically viable but lower priority. Direct integration would
  duplicate mobile-plugin packaging work while providing less explicit control over the future
  Kotlin/Swift platform boundary.

### `tauri-plugin-blec 0.12.0`

- **Rust Android target:** pass. The plugin and application Rust library compiled for
  `aarch64-linux-android`.
- **API 24 APK:** fail. Android manifest merging rejected the plugin because its library declares
  `minSdk 26`, while Keyboard Helper retains `minSdk 24`.
- **Override assessment:** rejected. `tools:overrideLibrary` would assert compatibility without
  evidence and could expose API-26 calls on supported API-24/25 installations.
- **Runtime concerns:** not reached. Open upstream reports for empty service lists and
  device-specific Android connection failures would still require physical validation if the
  baseline mismatch were removed.
- **Selection status:** rejected for this change. Raising the application's minimum SDK is outside
  the approved Android shell contract.

### Project-owned Kotlin plugin `0.1.0`

- **Durable integration:** pass. The Rust/Tauri bridge and Kotlin source live under
  `plugins/tauri-plugin-keyboard-helper-ble/`, outside ignored generated Android state.
- **API 24 APK:** pass. The native plugin declares `minSdk 24`; the application produced an arm64
  universal debug APK with the plugin registered only on Android.
- **Native surface:** implemented for version-aware permissions, bounded scan, one connection,
  service discovery, characteristic read, encrypted CCC subscription, bounded notification bytes,
  disconnect, and connection-attempt rejection.
- **Desktop isolation:** pass by construction at the dependency and registration boundary; the
  plugin path dependency exists only for `target_os = "android"`.
- **Physical runtime proof:** pass on API 36, with a supplementary compatibility pass on API 30.
  The proof covered permission, bounded discovery, selected-device GATT connection, service and
  characteristic discovery, Battery and capabilities reads, encrypted event subscription, a real
  notification, disconnect cleanup, and explicit reconnect in the same process.
- **Selection status:** selected for this change.

Primary references:

- `https://github.com/deviceplug/btleplug` and its `0.12.0` changelog
- `https://github.com/MnlPhlp/tauri-plugin-blec` and published `0.12.0` APIs/issues
- Android `BluetoothLeScanner`, `BluetoothGatt`, and Bluetooth permission API documentation
- Tauri 2 mobile plugin documentation and generated plugin structure

## Selected Adapter Setup

- Keep the application-facing API in `src-mobile/ble_transport.js` and the Tauri invocation
  adapter in `src-mobile/native_ble_adapter.js`; neither exposes `BluetoothGatt` or Kotlin values.
- Keep native Android sources in `plugins/tauri-plugin-keyboard-helper-ble/`, outside generated
  `src-tauri/gen/` state. The path dependency and plugin registration are Android-only.
- Grant only `keyboard-helper-ble:default` to the Android `mobile` window. API 31+ requests
  `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT`; API 24–30 retains the location-based scan path.
- Recreate ignored Android state with `npm run android:init` when needed and build the arm64 debug
  proof APK with `npm run android:build`.

Troubleshooting keeps failure categories distinct:

- `permission-denied` / `permanently-denied`: retry from the explicit permission control or open
  Android app settings; do not prompt in a loop.
- `security-required`: complete Android pairing/bonding when the encrypted event CCC is enabled,
  then retry the subscription without treating discovery as failed.
- `connection-failed`, `discovery-failed`, `read-failed`, and `subscription-failed`: preserve the
  operation category and retry only from a valid connected state.
- `stale-operation`: discard the result because a newer connection generation owns the surface.
- Some OEM builds forbid ADB `pm clear` and permission revocation. For a permission-clean hardware
  run, uninstall/reinstall the proof app and confirm Nearby Devices state in system settings.

## Fixed Physical Proof Script

Use a phone running Android API 31 or newer and a known enhanced Corney/ZMK keyboard. Start with
the app absent or with Bluetooth permissions revoked. Keep the app in the foreground throughout.

1. Record date, phone model, Android/API version, application revision, adapter candidate and
   pinned version, and keyboard firmware/build identifier.
2. Cold-start the app. Confirm no Bluetooth or location prompt appears before user action.
3. Start discovery. Accept the nearby-device scan/connect request. If it is denied, confirm scan
   does not start and the UI gives an actionable retry/settings result.
4. Confirm the scan stops explicitly or at its finite timeout. Locate the known keyboard and
   connect it as the only selected device.
5. Record discovered services and characteristics. If Battery Service `0x180f` exists, read
   Battery Level `0x2a19`; otherwise record `unavailable` without failing extension discovery.
6. Discover Keyboard Helper service `b34a0001-e782-4706-8f9c-6c056c416507` and read capabilities
   `b34a0003-e782-4706-8f9c-6c056c416507`.
7. Enable notifications on `b34a0004-e782-4706-8f9c-6c056c416507`. Complete an Android pairing
   confirmation if the encrypted CCC triggers one, and record the observed flow.
8. Press or release one physical keyboard key. Record only the exact characteristic UUID, payload
   byte length, and bounded hexadecimal bytes shown by the diagnostic surface.
9. Disconnect. Confirm subscription and GATT state are released and late callbacks do not restore
   the old connection.
10. Explicitly reconnect without restarting the app and repeat service discovery, available
    Battery Level read, capabilities read, subscription, and one real notification.
11. Background the app only after the proof and confirm no background scan, foreground service, or
    automatic reconnect loop was started.

## Evidence Record

Do not record key labels, inferred characters, HID data, or an unbounded event stream. Store only
the metadata requested by the script and the minimum notification bytes needed to prove the
transport boundary.

| Field | Result |
|---|---|
| Date and revision | 2026-09-07, `4f9228e` plus the uncommitted transport proof implementation, app `0.4.0` (`versionCode 4000`) |
| Phone and Android/API | Xiaomi `2511FPC34G` (`klee_eea`), Android 16 / API 36, arm64-v8a |
| Keyboard firmware/build | Corney enhanced Keyboard Helper BLE protocol 1.0; capabilities and frames match the retained ZMK `v0.2.1` proof, but the exact flashed artifact identifier is not independently exposed over GATT |
| Selected adapter/version | Project-owned Kotlin plugin `0.1.0` |
| Permission result | Pass: clean Nearby Devices state followed by a user-initiated grant; package state confirms `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT` granted |
| Scan/connect result | Pass: bounded scan found `Corney`; one selected-device connection reached `connected` |
| Battery result | Pass: Battery Service `0000180f-0000-1000-8000-00805f9b34fb`, Battery Level 81% |
| Extension capabilities | Pass: service `b34a0001-e782-4706-8f9c-6c056c416507`; 8 bytes `01 00 77 00 14 01 00 00` |
| First notification UUID/length/bytes | Pass: `b34a0004-e782-4706-8f9c-6c056c416507`, 12 bytes, `01 03 00 04 0d 01 00 00 07 0d 01 ff` |
| Disconnect/reconnect result | Pass: explicit disconnect prevented old-subscription updates; explicit reconnect, discovery/read, subscription, and a new physical notification all succeeded in the same process |
| Final decision | Accept the project-owned Kotlin adapter for the Android foreground transport proof; retain the project-owned JavaScript boundary for a future Swift/CoreBluetooth implementation |

### Supplementary API 24–30 compatibility evidence

This run exercises the retained legacy permission path but does not replace the required API 31+
acceptance run above.

| Field | Result |
|---|---|
| Date and revision | 2026-09-07, `4f9228e` plus the uncommitted transport proof implementation |
| Phone and Android/API | Xiaomi Mi 9 Lite (`pyxis`), Android 11 / API 30, arm64-v8a |
| Selected adapter/version | Project-owned Kotlin plugin `0.1.0` |
| Permission precondition | Fine and coarse location permissions explicitly revoked before launch |
| Permission result | Pass: the user-initiated flow granted the legacy scan permission; no pre-emptive prompt was reported |
| Scan result | Pass: the known keyboard appeared in the bounded diagnostic device list |
| Connect result | Pass: selecting the keyboard produced `Connection: connected` |
| Discovery/read result | Pass: services `1801`, `1800`, `180f`, `b34a0001-e782-4706-8f9c-6c056c416507`, `180a`, and `1812` were listed; Battery Level read as 81%; capabilities read as 8 bytes `01 00 77 00 14 01 00 00` |
| Notification result | Pass: subscription delivered UUID `b34a0004-e782-4706-8f9c-6c056c416507`, length 12, bytes `01 03 00 04 a9 00 00 00 07 0d 01 ff` after a physical keyboard action |
| Disconnect/reconnect result | Pass: explicit disconnect reached `disconnected`; a keyboard action did not update the old notification; explicit reconnect reached `connected`; discovery/read and subscription were re-established and a subsequent physical action delivered a new notification without restarting the app |

## Automated Verification Record

Verification date: 2026-09-07.

- `npm run lint`: pass.
- `npm test`: pass, 212 tests. Mobile coverage includes permission denial, empty scan, connection
  failure, bounded scan/cancellation, operation guards, absent Battery/extension presentation,
  security failure, notification receipt, disconnect cleanup, reconnect generation, and stale
  callback rejection.
- `TAURI_CONFIG='{"app":{"macOSPrivateApi":false}}' cargo test`: pass, 35 Rust tests. The override
  lets direct Cargo testing use the base config; the normal Tauri macOS build supplies its platform
  config. Existing vendored `rdev` warnings remain unchanged.
- `cargo fmt --all -- --check`: pass.
- `npm run android:build`: pass for `aarch64-linux-android`; the Kotlin compiler reports only two
  compatibility deprecations for pre-API-33 `BluetoothGatt` value access.
- `openspec validate prove-android-ble-transport --strict`: pass.
- Scoped source inspection finds no characteristic value write, persistence, network transport,
  foreground service, background scan, or automatic reconnect path. The only native write is the
  CCC descriptor operation required to enable notifications.

## Acceptance Review

| Requirement group | Evidence and decision |
|---|---|
| Adapter selection | Pass: all three candidates have pinned build/runtime dispositions; Kotlin `0.1.0` is selected from physical evidence rather than compilation alone |
| Replaceable boundary | Pass: project-owned serialized JS/Rust boundary, Android-only registration, and stale-generation tests |
| Permissions | Pass: user-initiated Nearby Devices flow on API 36, legacy location flow on API 30, and deterministic denial/permanent-denial coverage |
| Bounded discovery and connection | Pass: `Corney` found and connected on API 30 and 36; timeout/cancel, empty result, invalid state, and failure paths are tested |
| Battery and extension discovery | Pass: Battery 81%, extension service, and capabilities bytes observed; absent-service presentation is tested and non-fatal |
| Encrypted notifications | Pass: exact bounded event UUID/length/bytes observed on physical hardware; security errors remain separate from discovery errors |
| Disconnect and reconnect | Pass: old notifications stopped and the complete GATT/subscription/notification path repeated in the same process |
| Regression isolation | Pass: 212 JS tests, 35 desktop Rust tests, Android arm64 build, and strict OpenSpec validation require no BLE hardware |
| Read-only foreground scope | Pass: source/capability inspection and the physical run confirm no remote value write, persistence, network transmission, background service/scan, or automatic reconnect |

Stage decision: **accepted**. The foreground Android BLE transport proof is complete. Lifecycle,
stock-keyboard product behavior, and product UI remain separate future changes.

## Stop Conditions

Stop this change before lifecycle, layout, or product UI work if no candidate completes the full
script, if durable integration requires committed generated Android files, or if raw notification
data cannot remain local and bounded. Record the failed row and open a narrower transport change
instead of weakening the gate.
