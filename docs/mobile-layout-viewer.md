# Mobile layout viewer

The mobile layout viewer is a local, visual browser for bundled and user-imported Keyboard Helper
layouts. It does not require Bluetooth permission, a connected keyboard, or network access. The BLE
diagnostic panel remains a separate surface and does not control viewer state.

## Using the viewer

1. Choose a bundled or custom keyboard from **Keyboard layout**.
2. Choose a layer from the layer controls below it. Changing layouts returns to that layout's first
   layer.
3. Swipe horizontally inside the labelled keyboard region when a layout is wider than the screen.

Text and image legends use the same normalized meaning as the desktop viewer. A missing or
transparent entry on a selected layer falls back to the base-layer legend. Image keys keep an
accessible text label. Controls expose programmatic names, visible keyboard focus, and selected
states that do not rely on color alone.

The last explicitly selected layout is saved and restored at its first layer after a cold launch.
The active layer remains process-local, and the viewer never infers a layout from a BLE device. If
the saved custom record is missing or invalid, the app repairs the preference to the deterministic
bundled default (QWERTY when available).

## Importing a custom layout

1. Choose **Import layout** and select one JSON document with Android's system picker.
2. The app validates the same layout structure and bounds used by the desktop and bundled catalog.
3. A valid definition is copied into app-private storage and selected. The source URI is not kept.

The first import format supports textual legends only. External image paths, remote URLs, data URIs,
and other image references are rejected; use text labels instead. An exact duplicate selects the
existing record without another write. Different content with the same normalized custom name asks
before replacing the existing record while preserving its identity.

The removal selector lists only custom entries, so you can remove either the selected layout or an
inactive custom layout without first changing the viewer. Removing the selected entry falls
back to the bundled default and clears transient layer and Live presentation. Clearing application
data or uninstalling removes all custom layouts and the saved selection. Layouts are not synchronized
with the desktop app, another phone, or a cloud service.

## Updating bundled layouts

Desktop layout JSON files in `src/` are canonical. After changing a bundled definition or one of
its referenced images, run:

```sh
npm run sync:mobile-layouts
npm run check:js
```

The sync command validates every canonical definition, regenerates
`src-mobile/bundled_layout_definitions.js`, copies the canonical pure semantics module from
`src/layout_semantics.js` to `src-mobile/layout_semantics.generated.js`, copies the shared input-event
and BLE decoder modules into `src-mobile/shared-generated/`, and copies only referenced images into
`src-mobile/assets/images/`. The generated copies keep `src/` authoritative while ensuring every
runtime import stays inside Android's packaged `src-mobile/` frontend. Do not edit generated mobile
files directly. Tests require exact shared-source equality plus exact catalog and presentation
parity for every layout and layer.

## Troubleshooting

- If one layout is invalid, the viewer reports a bounded diagnostic while keeping other valid
  layouts available. For bundled data, fix the canonical JSON and regenerate the bundle. For a
  custom layout, correct the source JSON and import it again.
- If import reports an image limitation, replace image legends with text; importing a directory or
  companion image files is not supported.
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
