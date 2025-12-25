# Change: Multi-layer key legends

## Why
Layouts currently render a single set of legends, so pressed modifiers (e.g., Shift) are not reflected visually.

## What Changes
- Add layered legend support so layouts define both default and Shift layers.
- Switch displayed legends based on active modifiers (first use case: Shift shows uppercase legends).

## Impact
- Affected specs: render-key-legends
- Affected code: frontend layout data and key rendering logic
