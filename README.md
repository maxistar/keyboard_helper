# Keyboard Layout Visualizer (Tauri)

Desktop helper to visualize split/ergonomic keyboard layouts (Corne, QWERTZ, Dactyl, Magic) and highlight pressed keys in real time. Built with vanilla HTML/CSS/JS on top of Tauri.

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

## Tray behavior

Closing the window hides the app to the system tray instead of quitting. Use the tray menu to restore the window or quit the app.

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

You can point the app at external layout files and pick a default layout via a user config. The app looks for `~/.keyri.json` first and then `~/keyri.json`.

- Fields:
  - `defaultLayout`: key of the layout to select at startup (must exist in `layouts`).
  - `layouts`: object mapping layout keys to either `true` (use built-in) or a filesystem path (load external JSON).
- Layout combos (layout-specific): add a `combos` array inside a layout file with entries like `{ "key1": { "row": 1, "col": 4 }, "key2": { "row": 1, "col": 5 }, "code": "Enter" }`.
- Layout file format: JSON with `name`, `keySize` (`w`, `h`, `gap` in px), `keyPositions` (array of `{row,col}` with optional `w`/`h` overrides), and `keyLayers`. `keyLayers` can be an object with `default`, `shift`, etc., or an array where index 0 is the base layer. Each layer entry is `[label, code]` (or an object with `text`/`image` for custom labels).
- References: see built-in layouts for structure (`src/layout_corne.json`, `src/layout_qwertz.json`, `src/layout_dactyl.json`, `src/layout_mac.json`, `src/layout_magic.json`). Copy one, edit, and point your config at the new path. Keep a personal config in `~/.keyri.json`.
- If no config file is found, the app loads all built-in layouts and defaults to QWERTY. External layout paths must be readable from the filesystem; otherwise the app falls back to built-ins.
