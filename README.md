# Keyboard Helper

Desktop helper to visualize split/ergonomic keyboard layouts (Corne, QWERTZ, Dactyl, Magic) and highlight pressed keys in real time. Built with vanilla HTML/CSS/JS on top of Tauri.

## Clone

```bash
git clone https://github.com/maxistar/keyboard_helper.git
cd keyboard_helper
```

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [Rust](https://rustup.rs/) toolchain (`rustup` recommended)
- Platform dependencies for Tauri v2: [tauri.app/start/prerequisites](https://v2.tauri.app/start/prerequisites/)

The Tauri CLI is a dev dependency — `npm install` pulls it in automatically.

## Start the app (dev)

Install dependencies and launch the Tauri dev window:

```bash
npm install
npm run tauri dev
```

## Build a release binary

Produce a packaged release build (bundles Rust + frontend):

```bash
npm run tauri build
```

Artifacts will be written to `src-tauri/target/release/` (per-platform bundles such as `.app`, `.dmg`, `.exe`, `.msi`, or distributable archives). Use the standard Tauri CLI flags for platform-specific targets if you need to cross-compile.

On macOS, the packaged application is named `Keyboard Helper.app`. When upgrading from an older `Keyboard Layout.app` release, quit the old application and remove that bundle before installing the new one. Existing `~/.keyri.json` settings remain compatible. If key highlighting stops after the replacement, remove the stale application entry from **System Settings → Privacy & Security → Input Monitoring**, add `Keyboard Helper.app`, and launch it again.

The application bundle name is user-facing; the internal executable remains `keyboard-app`. External shortcut tools can toggle the running overlay with:

```bash
/Applications/Keyboard\ Helper.app/Contents/MacOS/keyboard-app --toggle
```

## Tray behavior

Closing the window hides the app to the system tray instead of quitting. Use the tray menu to restore the window or quit the app.

## Mini Mode

Choose **Mini Mode** from the overlay menu to shrink the current keyboard into a compact, frameless window. On macOS, the same action is available as **View → Enter Mini Mode**. Mini Mode keeps the active layer, live key highlights, combo borders, and BLE updates running while hiding the regular menu and status indicators.

- Drag the compact overlay from the empty padding around the keyboard.
- Choose the arrow icon in the upper-right corner (labelled **Restore full size**) to return to the exact full-size window geometry.
- Layout changes and external layout reloads resize the compact window automatically.
- Mini Mode is temporary: every fresh application launch starts in full mode.

If entering or restoring Mini Mode fails, the overlay shows a temporary error and keeps a usable recovery control on screen.

## Shift-Space Invaders

The desktop application includes a word-typing arcade game. Open the application menu and choose **Shift-Space Invaders** to launch it in a separate window; choosing the action again focuses the existing game window.

- Select an alien by typing the first letter of its visible English word, then finish the word to destroy it.
- Each correct character fires a hit. A mistake keeps the completed prefix but resets the score multiplier.
- Press `Esc` to pause or resume. Moving focus away from the game pauses it automatically.
- Later waves introduce longer words, faster targets, shorter spawn intervals, and more simultaneous targets.
- The game-over screen reports score, highest wave, destroyed targets, accuracy, and words per minute.

The first release uses curated English words and keeps results only for the current session. It does not save profiles, achievements, or high scores. The game window is available through the native Tauri application; the standalone browser frontend does not create desktop windows.

## Guided Keyboard Self-test

Open the overlay menu, expand **Keyboard**, and choose **Keyboard Self-test**. The desktop app opens one separate test window (or focuses the existing one), initially selecting the overlay's current layout and its base layer.

1. Choose a configured built-in or external layout and the layer you want to verify.
2. Activate that layer on the physical keyboard yourself, then choose **Start guided test**.
3. Press and release the highlighted physical position. An unexpected output can be retried or recorded as a problem; use **Skip this position** when a key produces no event.
4. Review passed, unexpected, skipped, and not-testable positions. You can retest only the problems or return to choose another layer.

The self-test window is a compact controller; the existing overlay remains the only keyboard visualization. Guided outlines are added by physical position while normal live pressed-key highlighting continues, so the expected position and the received key can be seen together. The controller does not switch the overlay or firmware layer—make sure its layout/layer selectors match what the overlay and keyboard currently show.

The report exists only until the self-test window closes. It verifies the configured global HID output, not raw ZMK switch or matrix health: events can come from any attached keyboard, and combos, macros, hold-tap timing, layer activation, and unsupported/multi-step codes are outside the first version.

## Release process

Releases are cut from `master` with semantic version tags.

- Version source: keep `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` on the same semver (e.g., `0.2.0`). Update all three before tagging so the JS package, Tauri config, and Rust crate stay aligned.
- Trigger: create an annotated tag `vMAJOR.MINOR.PATCH` on `master` and push it; CI will build macOS/Windows/Linux bundles and publish a GitHub release with the assets attached. The job should fail if the tag does not match the version in both files.
- Steps:
  1. Bump the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`, commit, and merge to `master`.
  2. Draft release notes (highlights, fixes, platform notes). Keep them short and paste them into the GitHub release description after CI creates it.
  3. Tag the merge commit (`git tag -a v0.2.0 -m "Release v0.2.0"`) and push the tag (`git push origin v0.2.0`).
  4. Watch the release workflow in GitHub Actions; when it finishes, open the generated GitHub release for `v0.2.0`, paste the release notes into the description, and publish/save.
- Non-tag pushes to `master` still run the build and upload artifacts to the workflow run but do not create a GitHub release entry.

## App configuration & external layouts

Open the application menu and choose **Settings** to select the startup layout, enable built-in layouts, record the show/hide shortcut, or add an external layout with a file picker. Changes are validated before they are saved and apply to the running overlay.

Advanced users can still edit the compatible JSON configuration directly. The app looks for `~/.keyri.json` first and then the legacy `~/keyri.json`; the Settings window writes new changes to `~/.keyri.json`.

- Fields:
  - `defaultLayout`: key of the layout to select at startup (must exist in `layouts`).
  - `layouts`: object mapping layout keys to either `true` (use built-in) or a filesystem path (load external JSON).
- Layout combos (layout-specific): add a `combos` array inside a layout file with entries like `{ "key1": { "row": 1, "col": 4 }, "key2": { "row": 1, "col": 5 }, "code": "Enter" }`.
- Layout file format: JSON with `name`, optional `bleLayerSource`, optional `inputSourceSync`, `keySize` (`w`, `h`, `gap` in px), `keyPositions` (array of `{row,col}` with optional `w`/`h` overrides), and `keyLayers`. `keyLayers` can be an object with `default`, `shift`, etc., or an array where index 0 is the base layer. Each layer entry is `[label, code]` (or an object with `text`/`image` for custom labels).
- `bleLayerSource` is optional and enables BLE-authoritative layer updates for the selected keyboard only. Shape:
  - `deviceName`: BLE keyboard name to match
  - `serviceUuid`: custom GATT service UUID
  - `characteristicUuid`: custom active-layer characteristic UUID
  - `format`: currently `int32-le`
- References: see built-in layouts for structure (`src/layout_corne.json`, `src/layout_qwertz.json`, `src/layout_dactyl.json`, `src/layout_mac.json`, `src/layout_magic.json`). Copy one, edit, and point your config at the new path. Keep a personal config in `~/.keyri.json`.
- If no config file is found, the Settings window starts from all built-in layouts with QWERTY selected. A malformed config is never silently replaced: recovery requires confirmation and creates a timestamped backup. Unreadable external layouts produce a visible error while the overlay falls back to an available built-in layout.

## BLE layer sync

If the selected layout defines `bleLayerSource`, the app attempts to connect to that keyboard over BLE and listen for active-layer notifications. When BLE sync is active, the on-screen layer indicator follows the keyboard's reported layer and key highlighting remains independent.

- If BLE sync starts successfully, the app bootstraps the current layer and then updates immediately from notifications.
- If BLE metadata is absent, BLE startup fails, or the BLE feed disconnects, the app falls back to the existing non-BLE behavior.
- BLE sync starts and stops automatically when you switch layouts.

### macOS input-source and ZMK layer synchronization

A layout may add `inputSourceSync.macos` to make the selected macOS input source authoritative for its ZMK language family. This capability is macOS-only and requires the same `bleLayerSource` characteristic to support encrypted **Write with response** and Notify. Windows, Linux, browser execution, layouts without metadata, and malformed metadata retain ordinary read-only BLE observation and local layer preview.

Each source has a unique app ID and label, the exact installed macOS `inputSourceId`, one stable `baseLayer`, and all related language layers. `neutralLayers` lists utility layers that belong to neither language. Family and neutral layer indexes must exist and must not overlap. Non-base family layers and neutral layers defer correction; the app only corrects a stable foreign base layer after `settleMs`. This optional interval defaults to `1000` milliseconds and accepts integers from `0` through `60000`.

```json
{
  "inputSourceSync": {
    "macos": {
      "settleMs": 1000,
      "sources": [
        {
          "id": "de",
          "label": "Deutsch",
          "inputSourceId": "com.apple.keylayout.German",
          "baseLayer": 4,
          "layers": [4, 5, 6, 16]
        },
        {
          "id": "ru",
          "label": "Русский",
          "inputSourceId": "com.apple.keylayout.Russian",
          "baseLayer": 9,
          "layers": [9, 10, 12, 17]
        }
      ],
      "neutralLayers": [13, 18]
    }
  }
}
```

Use `defaults read ~/Library/Preferences/com.apple.HIToolbox.plist AppleEnabledInputSources` to inspect enabled sources. The configured value must be the exact Text Input Source Services `kTISPropertyInputSourceID`; plist fields vary by source type, so treat names and bundle fields as discovery hints rather than transforming them. A configured but uninstalled ID is shown as unavailable and is never replaced by a guessed or cycled source. See `../corney/layout_corney.json` for the full Corney layout example.
