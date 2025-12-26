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

## Release process

Releases are cut from `master` with semantic version tags.

- Version source: keep `package.json` and `src-tauri/tauri.conf.json` on the same semver (e.g., `0.2.0`). Update both before tagging.
- Trigger: create an annotated tag `vMAJOR.MINOR.PATCH` on `master` and push it; CI will build macOS/Windows/Linux bundles and publish a GitHub release with the assets attached. The job should fail if the tag does not match the version in both files.
- Steps:
  1. Bump the version in `package.json` and `src-tauri/tauri.conf.json`, commit, and merge to `master`.
  2. Tag the merge commit (`git tag -a v0.2.0 -m "Release v0.2.0"`) and push the tag (`git push origin v0.2.0`).
  3. Watch the release workflow in GitHub Actions; when it finishes, download artifacts from the GitHub release.
- Non-tag pushes to `master` still run the build and upload artifacts to the workflow run but do not create a GitHub release entry.
- Status: Release publishing is specified in `openspec/changes/add-release-publishing`; until the release workflow is implemented, download artifacts from the workflow run on `master`.
