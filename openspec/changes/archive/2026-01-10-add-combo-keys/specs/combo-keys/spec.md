## ADDED Requirements
### Requirement: Combo key configuration
The application SHALL accept a `combos` configuration defining two-key combos by key positions and an output keycode.

#### Scenario: Combo configuration is present
- **WHEN** the config file includes a `combos` list
- **THEN** the application loads the combo definitions for rendering and highlighting

### Requirement: Combo rendering
The application SHALL render a thin border grouping the two keys that belong to each configured combo.

#### Scenario: Combo is configured
- **WHEN** the layout is rendered
- **THEN** each configured combo is shown as a border around its two keys

### Requirement: Combo highlight on keycode
The application SHALL highlight the combo border when the configured combo keycode is received.

#### Scenario: Combo keycode received
- **WHEN** a key event matches a configured combo output keycode
- **THEN** the corresponding combo border is highlighted
