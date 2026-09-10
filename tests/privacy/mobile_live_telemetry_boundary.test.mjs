import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("mobile Live telemetry remains read-only, ephemeral, foreground, and platform-isolated", async () => {
  const files = [
    "src/ble_keyboard_decoder.js",
    "src-mobile/telemetry_session.js",
    "src-mobile/layout_live_presentation.js",
    "src-mobile/layout_viewer.js",
    "src-mobile/app.js",
  ];
  const source = (await Promise.all(files.map((file) => readFile(path.join(root, file), "utf8")))).join("\n");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|WebSocket|EventSource|fetch\(|XMLHttpRequest|analytics|foreground service/iu);
  assert.doesNotMatch(source, /writeCharacteristic|remoteLayer|writeLayer|setActiveLayer|HID usage|unicode|inferred text/iu);
  assert.doesNotMatch(source, /main\.js|menu\.js|overlay_mode|global_overlay|input_source|ble_layer_sync/iu);
  assert.doesNotMatch(source, /setInterval|RECONNECT_DELAYS|connectSelected|startScan/iu);
  assert.match(source, /subscribeNotifications/);
  assert.match(source, /COMBO_VISUAL_EXPIRY_MS = 800/);
});
