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
