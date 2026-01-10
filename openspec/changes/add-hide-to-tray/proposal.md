# Change: Hide window to tray on close

## Why
Users expect the app to keep running in the background when they close the window so key visualization can continue without a visible window.

## What Changes
- When the window is closed, the app hides to the system tray instead of quitting.
- Tray menu provides restore and quit actions.
- Visual indication that the app remains active after close.

## Impact
- Affected specs: hide-window-to-tray (new)
- Affected code: Tauri window lifecycle handling, tray configuration, frontend close behavior
