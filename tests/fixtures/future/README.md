# Reserved fixture contracts

Add fixtures here only with the OpenSpec change that owns their behavior:

- `analytics/` — aggregate-only analytics and privacy-mode examples.
- `lessons/` — versioned lesson targets and compatibility examples.
- `mobile/` — mobile layout metadata and BLE lifecycle examples.
- `ble-events/` — versioned capability and event frames.

Each future fixture must state its schema version, expected compatibility or
rejection behavior, and prohibited sensitive fields where applicable.
