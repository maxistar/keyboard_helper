import assert from "node:assert/strict";
import test from "node:test";

import { createInputSourceLayerReconciler } from "../src/input_source_layer_reconciler.js";
import {
  createPlatformInputSourceAdapter,
  createUnsupportedInputSourceAdapter,
} from "../src/input_source_sync_adapter.js";

const syncConfig = {
  platform: "linux",
  adapter: "x11",
  sources: [
    { id: "de", label: "DE", inputSourceId: "xkb:layout:de", baseLayer: 1, layers: [1] },
    { id: "us", label: "US", inputSourceId: "xkb:layout:us", baseLayer: 2, layers: [2] },
  ],
  neutralLayers: [],
  settleMs: 0,
};

test("creates unsupported adapter for platforms without an implementation", async () => {
  const adapter = createUnsupportedInputSourceAdapter({ platform: "linux" });
  assert.equal(adapter.supported, false);
  assert.equal(adapter.getStatus().platform, "linux");
  assert.match(adapter.getStatus().message, /Linux/);
  assert.equal(await adapter.start("layout", syncConfig), false);
  assert.deepEqual([...adapter.getAvailableSourceIds()], []);
  await assert.rejects(adapter.select("de"), /not available/);
});

test("browser or missing Tauri bridge uses unsupported macOS adapter", async () => {
  const adapter = createPlatformInputSourceAdapter({ platform: "macos", tauri: null });
  assert.equal(adapter.supported, false);
  assert.equal(adapter.getStatus().reason, "native-bridge-unavailable");
  assert.equal(await adapter.refresh(), null);
});

test("Linux native bridge selects the implemented adapter before runtime probing", () => {
  const tauri = {
    core: { async invoke() {} },
    event: { async listen() { return () => {}; } },
  };
  const adapter = createPlatformInputSourceAdapter({ platform: "linux", tauri });
  assert.equal(adapter.supported, true);
  assert.equal(adapter.getStatus().available, false);
  assert.equal(adapter.getStatus().reason, "not-started");
  assert.deepEqual(adapter.capabilities, { observe: true, select: true, listAvailable: true });
});

test("unsupported adapter does not feed guessed sources into reconciliation", async () => {
  const writes = [];
  const adapter = createUnsupportedInputSourceAdapter({ platform: "linux" });
  const reconciler = createInputSourceLayerReconciler({
    config: syncConfig,
    writeLayer: (layer) => {
      writes.push(layer);
      return Promise.resolve();
    },
    settleMs: 0,
  });

  await adapter.start("layout", syncConfig);
  reconciler.setBleStatus("connected", true);
  reconciler.setLayer(1);

  assert.deepEqual(writes, []);
  assert.equal(reconciler.getState().status, "waiting");
});

test("failed X11 startup never feeds reconciliation or writes a BLE layer", async () => {
  const writes = [];
  const reconciler = createInputSourceLayerReconciler({
    config: syncConfig,
    writeLayer: async (layer) => writes.push(layer),
    settleMs: 0,
  });
  const tauri = {
    core: {
      async invoke(command) {
        if (command === "start_x11_input_source_sync") {
          throw { reason: "wayland-session", message: "X11 is unavailable under Wayland" };
        }
      },
    },
    event: { async listen() { return () => {}; } },
  };
  const adapter = createPlatformInputSourceAdapter({
    platform: "linux",
    tauri,
    onSourceChange: (sourceId) => reconciler.setSource(sourceId),
  });

  assert.equal(await adapter.start("corney", syncConfig), false);
  reconciler.setBleStatus("connected", true);
  reconciler.setLayer(1);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(adapter.getStatus().reason, "wayland-session");
  assert.deepEqual(writes, []);
  assert.equal(reconciler.getState().status, "waiting");
});
