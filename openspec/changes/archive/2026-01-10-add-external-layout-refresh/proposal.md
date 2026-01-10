# Change: Refresh external layouts on selection

## Why
Iterating on custom layout files is slow when the app requires a full restart to pick up changes.

## What Changes
- Re-load external layout files each time a user selects that layout.
- If a reload fails, display the error and keep the previous selection unchanged.

## Impact
- Affected specs: external-layout-refresh (new)
- Affected code: frontend layout switching, config/layout loading path
