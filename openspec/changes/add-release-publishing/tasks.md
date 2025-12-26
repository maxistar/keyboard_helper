## 1. Release automation
- [ ] 1.1 Add a GitHub Actions workflow that publishes a GitHub release when a `vMAJOR.MINOR.PATCH` tag is pushed, attaching built Tauri bundles for all supported platforms.
- [ ] 1.2 Enforce a single semver source of truth shared by `package.json` and `src-tauri/tauri.conf.json`, and ensure the tag matches that version.
- [ ] 1.3 Document the release process (version bump, tagging, trigger) in `README.md`.
- [ ] 1.4 Validate the proposal with `openspec validate add-release-publishing --strict`.
