# Incremental TypeScript checking

Keyboard Helper uses TypeScript as a strict, no-emit checker for selected JavaScript modules. The
desktop and Android applications still load committed `.js` files directly; type checking does not
produce application files and is not a transpilation or bundling step.

Run the gate with:

```bash
npm run typecheck
```

`npm run check:js` runs linting, this type check, and the JavaScript tests.

## Checked scope

The authoritative, reviewable file list is the `files` array in `tsconfig.check.json`. The
hand-maintained scope owns these contracts:

- `src/input_events.js`: normalized system and BLE event unions;
- `src/ble_keyboard_decoder.js`: capabilities, frame variants, and decoder outcomes;
- `src/input_source_sync_config.js`: validated input-source configuration;
- `src/input_source_layer_reconciler.js`: reconciliation state and layer-write boundary;
- `src/input_source_controller.js`: system/BLE ownership and callback contracts;
- `src/overlay_input_router.js`: overlay key-routing and highlight bridge;
- `src/overlay_layouts.js`: layout registry composition, layout-source records, and runtime validation boundaries;
- `src/overlay_presentation.js`: overlay DOM rendering, layer indicator, BLE status, and combo borders;
- `src/overlay_language_sync.js`: native input-source adapter and reconciliation controller wiring;
- `src/overlay_ble_runtime.js`: BLE native event listeners, status guards, and frame normalization boundary;
- `src/overlay_self_test_bridge.js`: self-test source and layer-lease event bridge;
- `src/overlay_actions.js`: overlay menu actions and desktop command boundary;
- `src/overlay_mode.js`: mini-mode state, native geometry callback, and view presentation boundary;
- `src/overlay_app.js`: desktop overlay composition wiring and startup sequencing;
- `src/main.js`: direct ES module bootstrap.

`type-fixtures/contracts.js` contains compile-only positive and negative contract examples. Shared
input-event and decoder source copied into `src-mobile/shared-generated/` remains generated from the
canonical checked modules and must not acquire an independent type schema.

Node scripts, runtime tests, large generated layout payloads, and other legacy modules are not yet admitted. Their exclusion does not imply that they are type-safe.

## Coverage ratchet

- A hand-maintained file admitted to `tsconfig.check.json` remains checked. Removal requires a
  documented structural reason such as deletion, replacement, or transfer to generated ownership.
- New behavior or extending a checked contract must preserve checking for its producers and consumers.
- Prefer exported JSDoc typedefs beside the canonical runtime contract. Use a narrow declaration
  file only for an external or native boundary that cannot be described locally.
- `@ts-nocheck` and `@ts-ignore` are prohibited in the checked scope. The scope verifier enforces
  this rule before the compiler runs.
- `@ts-expect-error` is limited to locally explained intentional boundaries and compile-only
  negative fixtures. The compiler rejects stale directives when the expected diagnostic vanishes.
- Runtime validation remains mandatory for layouts, persisted records, native responses, and BLE
  bytes. Static types do not make external input trusted.

## Next coverage candidate

The remaining desktop overlay legacy modules most adjacent to the checked composition root are
`src/menu.js`, `src/app_menu_state.js`, `src/ble_highlight.js`, and `src/typing_analytics.js`.
Admitting them should happen in focused batches because each has substantial DOM or stateful runtime
surface. The mobile BLE lifecycle also remains a larger future candidate: a strict diagnostic
inventory reaches both `src-mobile/ble_lifecycle.js` and its imported `ble_transport.js`, exposing a
broad set of untyped reducer events, effects, snapshots, transport operations, listeners, timers,
and native BLE values.

Moving to native `.ts` files, emitted output, or a Vite-style frontend build is a separate future
architecture decision.

## Verification note

On 2026-09-14 the desktop release binary and Linux `.deb` bundle completed, Rust tests passed, and
the Android `aarch64` native library compiled. The APK packaging step reached the Gradle Wrapper but
could not download Gradle 8.14.3 from `services.gradle.org` before the network timeout; retry the
Android packaging gate in an environment with the wrapper distribution available.
