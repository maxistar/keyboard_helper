# Product quality gates

## Local checks

Run the same fast checks used by pull requests from the application repository:

```bash
npm ci
npm run check:js
npm run test:privacy
npm run test:compatibility
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm --prefix website ci
npm --prefix website run build
```

`quality.yml` repeats JavaScript and Rust source checks on Ubuntu, Windows, and
macOS 15. Linux needs the Tauri GTK/WebKit/AppIndicator development packages.
Native window behavior, WebView2, platform packaging, macOS architecture, and
signing cannot be established by a different host: those checks remain on their
own runners.

The Windows package job starts the release executable with
`--quality-smoke-secondary-windows`. This test-only startup switch is inert in a
normal launch. It opens Settings, Shift-Space Invaders, and Keyboard Self-test
through their production commands and checks page readiness, visibility,
single-instance reuse, minimized-window restoration, focus, and clean close.
The structured JSON report is retained as the
`windows-secondary-window-smoke` workflow artifact.

The smoke is a required Windows matrix step. A failure blocks the package matrix
and therefore prevents the release publication job from running.

## Fixtures and extension suites

Reviewed shared contracts live under `tests/fixtures`. A layout, config, BLE,
or other versioned contract change must add a compatibility test that proves
backward compatibility, a migration, or an intentional explicit rejection.
Register it under `tests/compatibility` so `npm run test:compatibility` owns it.

Analytics and MCP changes must add privacy assertions under `tests/privacy` for
every applicable boundary: disabled mode, consent, raw typed text, raw key-log
retention, approval, approval expiration, and diagnostic/export redaction.
Retained artifacts must pass through the diagnostic redaction contract and must
not contain typed content, credentials, tokens, or private configuration values.

## Repository boundaries

The planning repository owns OpenSpec and documentation checks. Its workflow
runs strict OpenSpec validation for planning changes. The `keyboard_helper`
repository owns application, website, package, Windows smoke, privacy, and
compatibility checks. These are repository-local gates; neither repository
claims to block the other's release until an explicit shared status mechanism
is approved and configured.

## Release safety and recovery

A tag first passes the source matrix, production website build, version check,
all four platform package jobs, the required Windows smoke, and macOS
architecture and ad-hoc-signature verification. Only the final `publish` job
can create a normal GitHub release. A failed required prerequisite therefore
leaves workflow artifacts for diagnosis but no completed release.

Workflow artifacts use the repository's configured GitHub Actions retention.
After a failure, download the relevant build or smoke artifact, fix the source
or CI issue, delete and recreate the tag only if the tagged commit must change,
then re-run the full tagged workflow. Do not manually create a normal release
from a partially successful run.
