import assert from "node:assert/strict";
import test from "node:test";

import { createInputSourceLayerReconciler } from "../src/input_source_layer_reconciler.js";
import {
  createPlatformInputSourceAdapter,
  createUnsupportedInputSourceAdapter,
} from "../src/input_source_sync_adapter.js";

const syncConfig = {
  platform: "linux",
  sources: [
    { id: "de", label: "DE", inputSourceId: "de", baseLayer: 1, layers: [1] },
    { id: "us", label: "US", inputSourceId: "us", baseLayer: 2, layers: [2] },
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
