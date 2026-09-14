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

The authoritative, reviewable file list is the `files` array in `tsconfig.check.json`. The initial
hand-maintained scope owns these contracts:

- `src/input_events.js`: normalized system and BLE event unions;
- `src/ble_keyboard_decoder.js`: capabilities, frame variants, and decoder outcomes;
- `src/input_source_sync_config.js`: validated input-source configuration;
- `src/input_source_layer_reconciler.js`: reconciliation state and layer-write boundary;
- `src/input_source_controller.js`: system/BLE ownership and callback contracts.

`type-fixtures/contracts.js` contains compile-only positive and negative contract examples. Shared
input-event and decoder source copied into `src-mobile/shared-generated/` remains generated from the
canonical checked modules and must not acquire an independent type schema.

DOM-heavy entry points, Node scripts and runtime tests, large generated layout payloads, and other
legacy modules are not yet admitted. Their exclusion does not imply that they are type-safe.

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

The mobile BLE lifecycle was assessed for the initial scope. A strict diagnostic inventory reaches
both `src-mobile/ble_lifecycle.js` and its imported `ble_transport.js`, exposing a broad set of
untyped reducer events, effects, snapshots, transport operations, listeners, timers, and native BLE
values. Admitting only the reducer would therefore require either broad boundary declarations or a
larger coordinated transport typing change. It is intentionally deferred as the next coverage
candidate so this first gate does not weaken strictness or disguise the dependency boundary.

Moving to native `.ts` files, emitted output, or a Vite-style frontend build is a separate future
architecture decision.

## Verification note

On 2026-09-14 the desktop release binary and Linux `.deb` bundle completed, Rust tests passed, and
the Android `aarch64` native library compiled. The APK packaging step reached the Gradle Wrapper but
could not download Gradle 8.14.3 from `services.gradle.org` before the network timeout; retry the
Android packaging gate in an environment with the wrapper distribution available.
