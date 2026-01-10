# Change: Combo keys

## Why
Some layouts benefit from chorded inputs where two keys pressed together emit a single logical key, reducing finger travel and improving ergonomics.

## What Changes
- Support two-key combos that emit a configured keycode (e.g., D+F -> Enter).
- Render a thin border to visually group keys that belong to a combo.
- Highlight the combo's border when its keycode is emitted.
- Extend layout files with a `combos` section describing each combo by key positions and keycode (layout-specific only).

## Impact
- Affected specs: combo-keys (new)
- Affected code: layout config parsing, layout rendering, key-event handling
