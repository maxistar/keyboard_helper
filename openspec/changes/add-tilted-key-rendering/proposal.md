# Change: Add tilted ergonomic key rendering

## Why
Layouts for ergonomic keyboards include angled keys; current rendering keeps all keys upright, so Corne keys with `angle: -10` metadata never display as tilted.

## What Changes
- Render keys with provided `angle` metadata so ergonomic layouts visually tilt keys (e.g., Corne outer columns at -10°).
- Keep non-angled keys unchanged while preserving legends and pressed highlighting.

## Impact
- Affected specs: keyboard-visualization
- Affected code: layout rendering logic in `src/layout_*.js`, DOM/key rendering helpers.
