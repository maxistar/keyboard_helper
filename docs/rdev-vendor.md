# rdev vendor patch

Keyboard Helper vendors `rdev` because upstream `rdev 0.5.3` resolves
`Event.name` inside the macOS event tap callback. Keyboard Helper only consumes
physical `EventType::KeyPress` and `EventType::KeyRelease` values, but upstream
still performs the layout-aware name lookup before our callback can ignore it.
On macOS 15 this can crash while accessing input-source/layout APIs.

## Current patch

The vendored source is copied from crates.io `rdev 0.5.3` and patched in
`src-tauri/vendor/rdev/src/macos/common.rs`:

- keep the upstream physical key, mouse, wheel, and flag event mapping;
- replace the `EventType::KeyPress(_)` call to
  `keyboard_state.create_string_for_key(code, flags)` with `let name = None`;
- document why names are intentionally unresolved on macOS.

This preserves Keyboard Helper behavior because the app serializes the `Key`
variant name from `EventType`, not `Event.name`.

## Refreshing the vendor

1. Create a spike branch and try the upstream dependency first:

```toml
rdev = "0.5.3"
```

2. Build and smoke test on macOS before removing the vendor. Exercise global
   keyboard listening with normal keys, modifier keys, layout switching, and any
   input methods known to have crashed before.

3. If upstream still crashes, copy the registry source into the vendor folder:

```bash
rm -rf src-tauri/vendor/rdev
cp -R ~/.cargo/registry/src/*/rdev-0.5.3 src-tauri/vendor/rdev
```

4. Reapply the macOS patch in `src-tauri/vendor/rdev/src/macos/common.rs` so the
   `if let Some(event_type) = option_type` block sets `let name = None` without
   calling `keyboard_state.create_string_for_key(...)`.

5. Point `src-tauri/Cargo.toml` back to the vendored dependency:

```toml
# Vendored rdev from crates.io 0.5.3 with macOS key-name lookup disabled to avoid macOS 15 event tap crashes.
rdev = { path = "vendor/rdev" }
```

6. Run the checks that are available on the host:

```bash
npm test
cargo check --manifest-path src-tauri/Cargo.toml
```

On Linux, `cargo check` also requires the Tauri GTK/WebKit/AppIndicator
development packages. A missing `gdk-3.0.pc` is an environment issue, not an
`rdev` regression.

## Upstreaming

A useful upstream `rdev` issue or PR should frame this as a fallible/optional
macOS name-resolution problem: `listen()` should be able to emit physical key
events even when `Event.name` cannot be safely resolved. Compatible fixes could
include returning `None` on macOS lookup failure, adding `ListenOptions` with
`resolve_names: false`, or gating name resolution behind an opt-in feature.
