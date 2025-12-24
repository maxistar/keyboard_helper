## ADDED Requirements
### Requirement: Tilted ergonomic keys
Layouts SHALL render keys with rotation when a key definition includes an `angle` value in degrees.

#### Scenario: Rotate angled keys
- **WHEN** a key object specifies an `angle` number
- **THEN** the rendered key cap is rotated by that angle while keeping its position within the layout grid.

#### Scenario: Non-angled keys unaffected
- **WHEN** a key object omits an `angle` value
- **THEN** the key renders without rotation and current styling/behavior remain unchanged.
