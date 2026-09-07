# Android Companion Development

## Scope

The current Android target is the Stage 1 Keyboard Helper Companion shell. It verifies mobile
application startup and lifecycle separation from the desktop app. It does not request Bluetooth
permissions, scan for keyboards, connect to BLE devices, render keyboard layouts, or control
firmware layers.

## Agreed Platform Values

- Display name: `Keyboard Helper Companion`
- Application ID: `me.maxistar.keyboardhelper.companion`
- Minimum Android API level: 24
- Physical acceptance device: a phone running Android 12 / API level 31 or newer
- Frontend: `src-mobile/`, selected by `src-tauri/tauri.android.conf.json`
- Generated Android project: `src-tauri/gen/android/`, regenerated locally and ignored by Git

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

`src-tauri/gen/` is intentionally ignored. Do not place durable application configuration, source
of truth, signing material, or machine-specific SDK paths there. Android identity, frontend, and
minimum API settings belong in `src-tauri/tauri.android.conf.json`.

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
does not satisfy the agreed Android 12 / API level 31-or-newer acceptance authority.

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
