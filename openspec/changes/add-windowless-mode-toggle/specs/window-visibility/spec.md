## ADDED Requirements
### Requirement: Windowed default
The app SHALL launch in windowed mode with window chrome visible.

#### Scenario: Default windowed at startup
- **WHEN** the app launches
- **THEN** the keyboard window renders with its border/chrome visible.

### Requirement: Window mode toggle control
The app SHALL provide a window icon control to toggle between windowed and windowless display states.

#### Scenario: Toggle to windowless
- **WHEN** the user clicks the window icon while windowed
- **THEN** the window chrome is removed, the keyboard view stays visible, and the icon indicates the windowless state.

#### Scenario: Toggle to windowed
- **WHEN** the user clicks the window icon while windowless
- **THEN** the window chrome reappears and the icon indicates the windowed state.

### Requirement: Auto-hide window chrome after inactivity
The app SHALL automatically hide window chrome after an inactivity timeout while keeping the keyboard visible.

#### Scenario: Auto-hide chrome
- **WHEN** the app is windowed and the inactivity timeout elapses
- **THEN** the window chrome disappears while the keyboard view remains visible and interactive.

#### Scenario: Restore chrome from auto-hide
- **WHEN** the chrome is hidden due to inactivity and the user clicks the window icon
- **THEN** the window chrome returns and the icon reflects the windowed state.
