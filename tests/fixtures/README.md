# Golden product fixtures

These files are reviewed examples of supported Keyboard Helper metadata. Tests
should reuse them before inventing a private schema variant.

- `layouts/` contains minimal layouts that preserve the same positional,
  layered, combo/chord, BLE, and input-source shapes as production layouts.
- `configs/` contains startup, external-layout, and intentionally invalid draft
  configurations.
- `ble/` contains transport-state examples; no physical BLE device is required.
- `future/` reserves versioned locations for approved analytics, lesson, mobile,
  and BLE-event contracts. Files there are documentation until the owning
  OpenSpec change defines their runtime schema.

Changing a fixture is a contract change: update every consumer and keep the
invalid examples invalid for the documented reason.
