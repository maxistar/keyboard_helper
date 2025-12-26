# Change: Add release publishing and documentation

## Why
Release artifacts are built on pushes to `master`, but no GitHub release is created and maintainers lack guidance on versioning or how to trigger a release.

## What Changes
- Add a tag-driven GitHub Actions workflow that turns built Tauri bundles into a published GitHub release with attached assets.
- Standardize versioning from a single semver shared between `package.json` and `src-tauri/tauri.conf.json`.
- Document the release process (version bumps, tagging, triggers) in the README.

## Impact
- Affected specs: release-management
- Affected code: .github/workflows/tauri-release.yml, README.md
