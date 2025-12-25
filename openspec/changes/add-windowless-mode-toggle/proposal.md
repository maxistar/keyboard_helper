# Change: Add windowless mode toggle

## Why
Users want to hide the app window chrome for an unobtrusive overlay while still being able to bring the border back when needed.

## What Changes
- Default to windowed mode on launch.
- Add a window icon control that toggles between windowed and windowless states.
- Reflect the current state in the icon.
- Auto-hide the window border after inactivity and restore it when the icon is clicked.

## Impact
- Affected specs: window-visibility
- Affected code: Tauri window configuration/commands, frontend window icon and mode state handling
