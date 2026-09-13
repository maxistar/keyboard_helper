# Android Companion Development

## Scope

The current Android target is the foreground Keyboard Helper Companion. It supports an explicit BLE
permission, bounded scan, selected-device connection, read-only discovery/read/subscription flow,
bounded foreground reconnect, bundled layout viewing, and purpose-bounded custom JSON layout import.
It persists validated private layout snapshots and the selected layout identity, but not devices,
active layers, telemetry, or connection intent. It never controls firmware layers or runs BLE work
in the background. See `android-ble-transport-proof.md` for the BLE adapter,
`android-ble-lifecycle.md` for lifecycle policy, and `mobile-layout-viewer.md` for layout behavior.

## Agreed Platform Values

- Display name: `Keyboard Helper Companion`
- Application ID: `me.maxistar.keyboardhelper.companion`
- Minimum Android API level: 24
- UI/runtime compatibility baseline: Android 11 / API level 30 with Android System WebView 91
- Physical acceptance device: a phone running Android 12 / API level 31 or newer
- Frontend: `src-mobile/`, selected by `src-tauri/tauri.android.conf.json`
- Generated Android project: `src-tauri/gen/android/`, regenerated locally and ignored by Git
- Android launcher source: `android/icons/companion-launcher.svg`, synchronized after generation
- Android runtime activity source: `android/runtime/MainActivity.kt`, synchronized after generation

The existing desktop identifier remains `me.maxistar.keyri-app`.

## Verified Development Host Baseline

The initial development environment recorded on 2026-09-07 uses:

- macOS 26.6.2 on Apple silicon
- Node.js 24.16.0 and npm 11.13.0
- Tauri CLI 2.9.4 and Tauri API 2.9.0
- Rust 1.96.0 with the `aarch64-linux-android` target
- JDK 21
- Android SDK platforms 33 through 37
- Android SDK Build Tools 34 through 37
- Android NDK 30.0.14904198
- Android Debug Bridge 37.0.0

Use the current Tauri 2 prerequisites when preparing another host. Confirm the active environment
before initialization:

```bash
node --version
npm --version
rustc --version
rustup target list --installed
java -version
adb version
npm run tauri -- info
```

Set `JAVA_HOME`, `ANDROID_HOME`, and `NDK_HOME` to the installed JDK, Android SDK, and NDK when they
are not already supplied by the shell or Android Studio.

## Initialize or Regenerate Android

Install JavaScript dependencies, then generate the ignored Android project non-interactively:

```bash
npm ci
npm run android:init
```

The initialization script uses `--skip-targets-install`: it does not download Rust targets and
therefore remains deterministic on restricted or offline development hosts. Install the required
target explicitly before initialization; the current acceptance baseline uses
`rustup target add aarch64-linux-android`.

After Tauri creates the ignored project, the same command runs `android:sync-project`. That
project-owned step replaces generated placeholder artwork with the six-key Keyboard Helper
Companion launcher family and installs the inset-aware `MainActivity`. The activity keeps
edge-to-edge enabled while bounding the Tauri content viewport with Android system-bar and display
cutout insets. Run the complete synchronization directly after inspecting or regenerating Android
state:

```bash
npm run android:sync-project
```

The source uses a 108-by-108 adaptive viewport. All six keycaps remain inside the central mask-safe
region; launcher masks may change the outer background shape but must not clip the keys. Themed
icons intentionally use a single-color silhouette selected by Android. `android:sync-icons` and
`android:sync-runtime` remain available for focused maintenance, but development and build commands
always use the complete project sync. Do not edit synchronized resources or `MainActivity.kt` under
`src-tauri/gen/android/` by hand: they are derived output and will be replaced.

`src-tauri/gen/` is intentionally ignored. Do not place durable application configuration, source
of truth, signing material, icon artwork, runtime overlays, or machine-specific SDK paths there.
Android identity, frontend, and minimum API settings belong in `src-tauri/tauri.android.conf.json`;
launcher artwork belongs in `android/icons/`, and the activity overlay belongs in
`android/runtime/`.

If generated state becomes stale, remove only `src-tauri/gen/android/`, rerun
`npm run android:init`, and review the regenerated manifest before continuing. Never remove the
whole repository or an unresolved path.

## Prepare a Physical Device

1. Enable Developer options and USB debugging on an Android 12 / API level 31 or newer phone.
2. Connect the phone over USB and accept its debugging authorization prompt.
3. Verify that exactly the intended device is available:

   ```bash
   adb devices -l
   ```

4. If multiple devices are attached, pass the chosen device identifier to the Tauri command rather
   than relying on an implicit selection.

## Build and Run

Start a development build on the connected device:

```bash
npm run android:dev
```

Build a debug APK for the recorded arm64 acceptance baseline without starting a device session:

```bash
npm run android:build
```

Use the Tauri CLI directly with another `--target` when validating a different device ABI.

Use `adb logcat` while reproducing startup or lifecycle failures. Inspect the package installed on
the device with:

```bash
adb shell dumpsys package me.maxistar.keyboardhelper.companion
```

Remove the development installation with:

```bash
adb uninstall me.maxistar.keyboardhelper.companion
```

## Android 11 / WebView 91 Compatibility Smoke

Android API level and Android System WebView version are separate compatibility inputs. The
deterministic UI/runtime baseline for this repository is an API level 30 emulator with WebView
`91.0.4472.114`; the emulator does not replace physical BLE acceptance.

1. Start the API 30 emulator and record its identity and viewport:

   ```bash
   adb devices -l
   adb shell getprop ro.build.version.sdk
   adb shell dumpsys webviewupdate
   adb shell wm size
   adb shell wm density
   ```

2. Run `npm run android:sync-project`, build the debug APK with `npm run android:build`, and install
   the generated APK on the selected emulator.
3. Force-stop the package, launch `me.maxistar.keyboardhelper.companion/.MainActivity`, and confirm
   the initial `Getting ready` shell is replaced by live application state.
4. Confirm the bundled layout selector is populated, the deterministic default layout and first
   layer render, and the keyboard stage is non-empty without a BLE connection.
5. In portrait, confirm the application bar starts below the status bar and the keyboard stage ends
   above the navigation bar. Rotate to landscape and confirm controls remain contained without
   doubled margins or document-level scrolling.
6. Background and resume the application, then force-stop and relaunch it. Confirm both paths return
   to initialized application state.
7. Record OS/API, exact WebView version, viewport, APK identity, and pass/fail results. Label this as
   UI/runtime evidence only; retain API 31+ physical-device results as the BLE authority.

Two characteristic failures identify drift. A persistent `Getting ready` state with an empty layout
selector and stage indicates that startup used a browser API newer than the declared WebView
baseline. Content beneath the status or navigation bar indicates that the generated project was not
synchronized with the committed inset-aware activity or that its Android view contract changed.

### Recorded WebView 91 Compatibility Verification

On 2026-09-13 the ignored Android project was regenerated, synchronized, and built before installing
version `0.6.4` (`versionCode=6004`, `minSdk=24`, `targetSdk=36`, `arm64-v8a`) on the API level 30
`sdk_gphone_arm64` emulator. The emulator used Android System WebView `91.0.4472.114`, a
1080-by-2280 display, and 440 dpi. The debug APK SHA-256 was
`887639cb65c5a2b326ad4f85185cbb2f14e1d588f0a7fde38ccf0947e86d237e`.

Two cold launches completed in 450 ms and 453 ms. Both left the static loading shell, populated the
selector with QWERTY, and rendered the default layer and physical keys. Portrait and landscape
screens remained outside the status and navigation bars without duplicate padding or document-level
scrolling. Background/resume retained process 11530; force-stop/relaunch created process 11842 and
returned to initialized state. The emulator's original portrait and automatic-rotation settings were
restored after the check.

This is UI/runtime compatibility evidence only. The separate newer physical-device UI regression
and the existing API 31+ physical BLE acceptance remain distinct evidence.

### Recorded Newer Physical-Device UI Regression

On 2026-09-13 the same synchronized version `0.6.4` debug APK was installed on a physical Xiaomi
`2511FPC34G` running Android 16 / API level 36 with a 1268-by-2756 display at 520 dpi. A cold launch
completed in 447 ms. Portrait and landscape presentation remained outside the status and navigation
bars, the bundled Corney layout opened in Browse mode with its layer controls and keyboard visible,
and the Settings entry opened the existing keyboard connection workflow as expected. Automatic
rotation was restored after the check.

This newer-device result is a UI regression check only. It does not replace or alter the previously
recorded physical BLE acceptance evidence; no BLE keyboard state was changed during this check.

## Stage 1 Physical Acceptance

On the physical phone:

1. Install from a clean state and cold-start the app in portrait.
2. Confirm the launcher label and status surface say `Keyboard Helper Companion`.
3. Confirm no Bluetooth, nearby-device, location, notification, or background-service permission
   prompt appears.
4. Rotate to landscape and confirm the status surface remains readable.
5. Return to portrait, background the app, and resume it.
6. Close the process, relaunch it, and confirm one usable shell initializes.
7. Confirm the app contains no overlay, tray, global-listener, self-test, game, layout, BLE, or
   remote-layer controls.

## Launcher Icon Acceptance

After installing a synchronized build on a supported physical phone:

1. Confirm the launcher shows six rounded keys and that none are clipped by the device mask.
2. Inspect the icon in one smaller system surface, such as recent apps or application settings.
3. On Android 13 or newer, enable themed icons and confirm the monochrome six-key silhouette remains
   recognizable without its teal and amber colors.
4. Launch, background, relaunch, and rotate the app. Confirm the launcher label and package identity
   are unchanged and the compact application bar still begins with keyboard status rather than the
   removed decorative mark or `Companion` title.

An emulator may supplement compatibility checks, but it does not satisfy this physical acceptance
gate.

## Recorded Bootstrap Verification

On 2026-09-07 the ignored Android project was generated from absent local state with
`npm run android:init`, then the arm64 debug APK was built with `npm run android:build`. The APK was
installed on an API level 35 arm64 emulator and passed cold start, portrait, landscape,
background/resume, force-stop/relaunch, clean uninstall/install, and empty runtime-permission
checks. This verifies reproducibility on the recorded host; the Android 12+ physical-phone gate
remains intentionally separate and pending.

The same APK also passed a supplementary physical-device smoke on a Xiaomi Mi 9 Lite running
Android 11 / API level 30: clean install, portrait and landscape rendering, hot resume with the
same process, cold relaunch with a new process, an empty runtime-permission set, and no app-process
crash entries. Its first WebView render took about five seconds after installation. This result
predated the populated mobile layout workspace and therefore is not WebView 91 compatibility
evidence for the current frontend. It also does not satisfy the agreed Android 12 / API level
31-or-newer BLE acceptance authority.

Final physical acceptance was completed on 2026-09-07 using a Xiaomi `2511FPC34G` running Android
16 / API level 36. The arm64 debug APK was installed from an absent package state, declared
`minSdk=24` and `targetSdk=36`, and cold-started in 452 ms. Portrait and landscape presentation were
readable, background/resume retained the same process, force-stop/relaunch created a new healthy
process, the app-specific crash log was empty, and the clean installation exposed no runtime
permissions or permission prompt. Device auto-rotation was restored after the landscape check.

## Desktop Regression Gate

Android bootstrap is incomplete unless the desktop path remains healthy:

```bash
npm run check:js
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --debug
```

The desktop build must retain its existing identity and overlay entry surface without requiring an
Android runtime or connected device.
