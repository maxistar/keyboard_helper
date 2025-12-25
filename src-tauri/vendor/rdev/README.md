# Vendored rdev (macOS fix)

This copy of `rdev` is vendored to avoid a crash on macOS 15 when listening for global keyboard events. The upstream macOS implementation calls into `TIS*` APIs to derive localized key names, which triggers a dispatch queue assertion (`islGetInputSourceListWithAdditions`) when invoked off the main thread. Since this app only needs key codes, the macOS path was patched to skip key-name lookup.

Key change:
- `src/macos/common.rs`: return `None` for `name` instead of calling `create_string_for_key` in the event tap callback.

If upstream fixes this, we can remove this vendor directory and return to the crates.io dependency.
