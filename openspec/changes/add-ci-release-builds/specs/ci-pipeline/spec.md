## ADDED Requirements
### Requirement: Release builds on master
The system SHALL run a CI workflow on pushes to `master` that builds Tauri release artifacts and publishes the outputs as downloadable workflow artifacts.

#### Scenario: Build release on master push
- **WHEN** a commit is pushed to the `master` branch
- **THEN** the workflow installs dependencies and runs `npm run tauri build` to produce release binaries for that platform.

#### Scenario: Upload release artifacts
- **WHEN** the release build completes
- **THEN** the produced bundles for the runner platform are uploaded as workflow artifacts for download.
