# Windows input-source synchronization

Keyboard Helper follows the actual layout of the foreground Windows thread and respects Windows' input-method settings. It does not change the setting that remembers a separate input method for each application, or enforce a global language.

The Language menu targets the window that is foreground when the native selection request is handled. If opening Helper gives it focus, Helper is the target. Returning to another application observes that application's actual layout; with per-application input methods enabled this may restore its previous language. Selection is confirmed by reading back the target layout within one second. Focus changes, disappearing windows, permissions failures and timeouts invalidate the selection and cancel pending layer corrections.

## Configuration

Use canonical `windows:klid:` identifiers followed by eight uppercase hexadecimal digits. Layout variants have distinct IDs; do not derive IDs from a language label. The Language diagnostics list the layouts loaded in the Windows session and configured IDs that are missing. Missing choices are unavailable; Helper does not install layouts. KLIDs are resolved from Windows layout handles on a dedicated worker thread. IME profiles sharing a KLID are not distinguished.

The actual acceptance fixture is `../corney/layout_corney.json`, with this block:

```json
{
  "inputSourceSync": {
    "windows": {
      "settleMs": 1000,
      "sources": [
        { "id": "ru", "label": "Русский", "inputSourceId": "windows:klid:00000419", "baseLayer": 8, "layers": [8, 11] },
        { "id": "de", "label": "Deutsch", "inputSourceId": "windows:klid:00000407", "baseLayer": 1, "layers": [1, 2, 3, 15] },
        { "id": "en", "label": "English", "inputSourceId": "windows:klid:00000409", "baseLayer": 0, "layers": [0] }
      ],
      "neutralLayers": [13, 14, 18]
    }
  }
}
```

Observation polls every 100 ms. Context changes invalidate the previous source even when the language is unchanged, restarting settling. Brief changes between samples may not be observed. Unreadable and unmapped sources never cause a correction. Existing family/transient and neutral-layer rules, BLE confirmation, and reconnect behavior remain shared with macOS/X11. A BLE write already submitted cannot be retracted.

## Automated checks

From `keyboard_helper`, run `npm run check:js`. Tests read the actual Corney JSON. For a standalone checkout, provide the Corney checkout beside Keyboard Helper, or set `$env:CORNEY_LAYOUT_PATH` to the absolute fixture path before running tests.

From `src-tauri`, run `cargo test`. To read the real interactive desktop without selecting a language, run:

```powershell
cargo test input_source_windows::tests::reads_installed_and_foreground_layouts -- --ignored --nocapture
```

## Manual CorneyMX acceptance

1. Load the Corney JSON, connect CorneyMX over Bluetooth, and enable Input Source Sync. Check diagnostics for all three installed IDs.
2. Switch Windows through ru/de/en using its normal shortcuts. With a mismatched base layer, expect 8/1/0 respectively after 1000 ms of stable confirmed state.
3. Select each language from Helper. Verify the foreground layout changes and is confirmed; switch back to an editor and check that the resulting layer follows its actual Windows layout. Repeat with Windows' existing per-application setting as configured; do not change that setting for the app.
4. Change foreground windows during settling and selection. Old work must not correct the layer. Rapid language changes should settle only on the latest observed source.
5. Exercise family layers ru [8,11], de [1,2,3,15], en [0], and neutral [13,14,18]. Transient family and neutral layers must not be overwritten. Test an unmapped source/layer as well.
6. Exercise a selection that cannot be confirmed (for example, move focus during selection or use a protected target). Expect an explicit error and no correction based on the requested language. A later fresh observation may resume normal synchronization.
7. Disconnect and reconnect BLE, obtain a fresh authoritative keyboard layer, and confirm synchronization resumes without a stale correction.

Automated adapter/reconciler tests are not a substitute for this hardware checklist. The earlier user-confirmed BLE reconnect fix alone does not verify Windows language synchronization.
