# Project Context

## Purpose
Desktop helper to visualize keyboard layouts and highlight pressed keys in real time. Useful for validating custom mechanical keyboard layouts (e.g., Corne, Datil Manyfold) and demonstrating live key presses.

## Tech Stack
- Tauri 2 (Rust core + JavaScript frontend)
- Rust 2021 with `tauri`, `rdev`, `serde`
- Frontend: vanilla HTML/CSS/JS (no bundler), Tauri JS API for events/commands
- macOS builds use `macos-private-api` feature for global keyboard access

## Project Conventions

### Code Style
- Favor plain functions and DOM APIs; no frameworks/bundlers.
- Keep layout definitions as structured JSON-like data and render dynamically.
- Use `const`/`let`, arrow functions, and early returns; keep files small and readable.
- Keep styling in CSS (inline in `index.html` currently) with CSS custom properties for sizing/colors.

### Architecture Patterns
- Single-window Tauri app.
- Rust side exposes commands (`start_keyboard_listener`) and emits `key_event` to all windows.
- `rdev` provides global keyboard events; translated to DOM-friendly codes before emission.
- Frontend renders keyboard layouts from data objects and toggles `.pressed` class based on `key_event`.

### Testing Strategy
- No automated tests yet; manual verification via `npm run tauri dev`:
  - Switch between layouts (QWERTY, Corne, Datil Manyfold).
  - Press keys and confirm corresponding key caps highlight on key down and release.
  - Confirm listener handles repeat start gracefully (no double spawn).

### Git Workflow
- Not formalized in repo; default to feature branches merged into `main`/`master`.
- Prefer small, self-contained commits with clear messages; avoid rewriting shared history.

## Domain Context
- Focused on mechanical/split keyboard layouts and visualizing scancodes (`KeyA`, `Digit1`, etc.).
- Assumes key codes follow standard DOM KeyboardEvent code strings for mapping UI elements.

## Important Constraints
- Global key listening requires OS accessibility permissions; on macOS uses private API feature.
- `rdev` key coverage varies by platform; unmapped keys surface as `Unknown`.
- App relies on Tauri runtime; frontend expects `window.__TAURI__` to exist (non-browser use).

## External Dependencies
- `tauri` runtime and JS API for commands/events.
- `rdev` crate for cross-platform global keyboard listener.
- `tauri-plugin-opener` dependency present (currently unused in code).
