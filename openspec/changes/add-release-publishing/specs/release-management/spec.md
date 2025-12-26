## ADDED Requirements
### Requirement: Tag-driven releases
The system SHALL publish a GitHub release when an annotated git tag matching `vMAJOR.MINOR.PATCH` is pushed to the default branch.

#### Scenario: Release runs on semver tag
- **WHEN** a tag `vX.Y.Z` is pushed to `master`
- **THEN** CI builds the Tauri bundles for macOS, Windows, and Linux
- **AND** a GitHub release named `vX.Y.Z` is created with those bundles attached.

#### Scenario: Non-tag pushes do not publish releases
- **WHEN** commits land on `master` without a `vX.Y.Z` tag
- **THEN** CI only produces build artifacts on the workflow run
- **AND** no GitHub release entry is created.

### Requirement: Single-source versioning
The system SHALL use a single semantic version shared between `package.json` and `src-tauri/tauri.conf.json`, and release tags SHALL match that version.

#### Scenario: Version bump before tagging
- **WHEN** preparing a new release
- **THEN** maintainers update both version fields to the target semver value
- **AND** merge the version bump to `master` before creating the tag.

#### Scenario: Tag matches source version
- **WHEN** a `vX.Y.Z` tag is created
- **THEN** the tag version equals the version in `package.json` and `src-tauri/tauri.conf.json`
- **AND** the release workflow fails if the versions differ.

### Requirement: Documented release flow
The system SHALL describe how to cut and trigger a release in the README so maintainers can follow the sequence without external references.

#### Scenario: Maintainer follows documented steps
- **WHEN** a maintainer reads the release section in the README
- **THEN** they can see how to bump the version, create the `vX.Y.Z` tag, and push it to trigger the release workflow.
