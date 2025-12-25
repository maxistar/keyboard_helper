## ADDED Requirements
### Requirement: Layered key legends
The system SHALL allow each layout to define multiple legend layers as arrays aligned to the layout's keys, including a default layer and a shift layer.

#### Scenario: Default layer renders when no modifier is active
- **WHEN** a layout is loaded with no active modifier layer
- **THEN** the default layer legends are displayed for all keys by reading the default layer array positions.

#### Scenario: Shift layer renders when shift is active
- **WHEN** a shift modifier is active for the layout
- **THEN** the shift layer array is consulted for each key
- **AND** non-null entries replace the current legend for that key while null entries leave the existing legend unchanged.

#### Scenario: Shift layer deactivates on release
- **WHEN** the shift modifier is released
- **THEN** the displayed legends revert to the default layer without re-rendering unchanged keys.
