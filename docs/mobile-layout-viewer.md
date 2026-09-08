# Mobile layout viewer

The mobile layout viewer is a local, visual browser for the keyboard layouts bundled with Keyboard
Helper. It does not require Bluetooth permission, a connected keyboard, or network access. The BLE
diagnostic panel remains a separate surface and does not control viewer state.

## Using the viewer

1. Choose a bundled keyboard from **Layout**.
2. Choose a layer from the layer controls below it. Changing layouts returns to that layout's first
   layer.
3. Swipe horizontally inside the labelled keyboard region when a layout is wider than the screen.

Text and image legends use the same normalized meaning as the desktop viewer. A missing or
transparent entry on a selected layer falls back to the base-layer legend. Image keys keep an
accessible text label. Controls expose programmatic names, visible keyboard focus, and selected
states that do not rely on color alone.

Selection is intentionally process-local. Rotation during the same process retains the current
layout and layer; a cold launch or recreated process returns to the deterministic default, QWERTY
when it is available. The viewer does not save a preference or infer a layout from a BLE device.

## Updating bundled layouts

Desktop layout JSON files in `src/` are canonical. After changing a bundled definition or one of
its referenced images, run:

```sh
npm run sync:mobile-layouts
npm run check:js
```

The sync command validates every canonical definition, regenerates
`src-mobile/bundled_layout_definitions.js`, copies the canonical pure semantics module from
`src/layout_semantics.js` to `src-mobile/layout_semantics.generated.js`, and copies only referenced
images into `src-mobile/assets/images/`. Do not edit either generated mobile file directly. Tests
require exact source equality for the semantics module plus exact catalog and presentation parity
for every layout and layer.

## Troubleshooting

- If one layout is invalid, the viewer reports a bounded diagnostic while keeping other valid
  layouts available. Fix the canonical JSON and regenerate the bundle.
- If no layouts can be loaded, the viewer shows an actionable empty state instead of failing the
  whole mobile shell.
- If a wide keyboard appears clipped, scroll inside the keyboard region; page-level horizontal
  scrolling is intentionally disabled.
- Bluetooth errors affect only the diagnostic panel. Layout and layer controls should remain
  usable before permission, while scanning, after a disconnect, and when BLE is unavailable.

## Verification record

Automated verification for `add-mobile-layout-viewer` includes the complete JavaScript suite,
Rust tests, desktop no-bundle build, Android arm64 APK build, strict OpenSpec validation, and diff
whitespace validation. Physical acceptance additionally covers all bundled layouts and layers,
image and transparent legends, portrait and short-landscape scrolling, safe areas, rotation,
cold-process reset, and regression of the existing BLE diagnostic flow.

Physical acceptance passed on 2026-09-08 using a Xiaomi 2511FPC34G running Android API 36. QWERTY,
QWERTZ, Corne, Dactyl, Magic, and Mac were exercised across all available layers. The maintainer
confirmed readable text and image legends, transparent-entry fallback, spans, contained horizontal
touch navigation, portrait and short-landscape safe-area behavior, rotation without in-process
selection loss, and deterministic QWERTY reset after process recreation. The viewer remained usable
with Nearby devices permission denied and no keyboard connected. After permission was restored, the
existing BLE diagnostic flow remained operational and independent of viewer state. Result: accepted;
stock connection product UX may proceed.
