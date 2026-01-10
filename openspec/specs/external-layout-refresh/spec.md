# external-layout-refresh Specification

## Purpose
TBD - created by archiving change add-external-layout-refresh. Update Purpose after archive.
## Requirements
### Requirement: Refresh external layout on selection
The application SHALL reload an external layout file each time the user selects that layout.

#### Scenario: User selects an external layout after editing the file
- **WHEN** the user selects an external layout whose file has changed
- **THEN** the latest file contents are loaded for rendering

### Requirement: Report external layout load failure
The application SHALL surface an error if reloading an external layout fails and it SHALL keep the previous layout active.

#### Scenario: External layout reload fails
- **WHEN** the external layout file is missing or invalid
- **THEN** an error is shown and the previously active layout remains selected

