# Change: Add CI release builds on master

## Why
We need an automated GitHub Actions pipeline that builds Tauri binaries whenever changes land on `master`, so releases are packaged consistently without manual steps.

## What Changes
- Add a GitHub Actions workflow triggered on pushes to `master` to build Tauri release artifacts (npm + Rust).
- Upload built bundles for each runner platform as workflow artifacts.

## Impact
- Affected specs: ci-pipeline
- Affected code: .github/workflows/tauri-release.yml
