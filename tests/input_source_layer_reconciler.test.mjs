import assert from "node:assert/strict";
import test from "node:test";

import { createInputSourceLayerReconciler } from "../src/input_source_layer_reconciler.js";

const config = {
  sources: [
    { id: "de", inputSourceId: "de.source", baseLayer: 4, layers: [4, 5, 6] },
    { id: "ru", inputSourceId: "ru.source", baseLayer: 9, layers: [9, 10, 12] },
  ],
  neutralLayers: [13],
};

function harness(writeLayer = async () => {}, options = {}) {
  let scheduled = null;
  let scheduledDelay = null;
  const writes = [];
  const states = [];
  const reconciler = createInputSourceLayerReconciler({
    config,
    writeLayer: async (...args) => {
      writes.push(args);
      return writeLayer(...args);
    },
    onStateChange: (state) => states.push(state),
    settleMs: options.settleMs,
    schedule: (callback, delay) => {
      scheduled = callback;
      scheduledDelay = delay;
      return 1;
    },
    cancel: () => {
      scheduled = null;
    },
  });
  return {
    reconciler,
    writes,
    states,
    getScheduledDelay: () => scheduledDelay,
    runScheduled: async () => {
      const callback = scheduled;
      scheduled = null;
      await callback?.();
    },
  };
}

test("startup match is synchronized without a write", () => {
  const { reconciler, writes } = harness();
  reconciler.setBleStatus("connected", true);
  reconciler.setLayer(5);
  reconciler.setSource("de.source");
  assert.equal(reconciler.getState().status, "synced");
  assert.deepEqual(writes, []);
});

test("uses a 1000 ms default and accepts a configured settling interval", () => {
  const defaultHarness = harness();
  defaultHarness.reconciler.setBleStatus("connected", true);
  defaultHarness.reconciler.setLayer(4);
  defaultHarness.reconciler.setSource("ru.source");
  assert.equal(defaultHarness.getScheduledDelay(), 1000);

  const configuredHarness = harness(async () => {}, { settleMs: 200 });
  configuredHarness.reconciler.setBleStatus("connected", true);
  configuredHarness.reconciler.setLayer(4);
  configuredHarness.reconciler.setSource("ru.source");
  assert.equal(configuredHarness.getScheduledDelay(), 200);
});

test("stable foreign base layer is corrected after settling", async () => {
  const { reconciler, writes, runScheduled } = harness();
  reconciler.setBleStatus("connected", true);
  reconciler.setLayer(4);
  reconciler.setSource("ru.source");
  assert.equal(reconciler.getState().status, "settling");
  await runScheduled();
  assert.deepEqual(writes, [[9, [9, 10, 12]]]);
});

test("either physical language-macro event order cancels correction", async () => {
  for (const order of ["source-first", "layer-first"]) {
    const { reconciler, writes, runScheduled } = harness();
    reconciler.setBleStatus("connected", true);
    reconciler.setSource("de.source");
    reconciler.setLayer(4);
    if (order === "source-first") {
      reconciler.setSource("ru.source");
      reconciler.setLayer(10);
    } else {
      reconciler.setLayer(10);
      reconciler.setSource("ru.source");
    }
    await runScheduled();
    assert.equal(reconciler.getState().status, "synced");
    assert.deepEqual(writes, []);
  }
});

test("rapid source changes replace obsolete settling work", async () => {
  const { reconciler, writes, runScheduled } = harness();
  reconciler.setBleStatus("connected", true);
  reconciler.setLayer(4);
  reconciler.setSource("ru.source");
  reconciler.setSource("de.source");
  await runScheduled();
  assert.equal(reconciler.getState().status, "synced");
  assert.deepEqual(writes, []);
});

test("transient and neutral layers defer correction", () => {
  const { reconciler } = harness();
  reconciler.setBleStatus("connected", true);
  reconciler.setSource("ru.source");
  reconciler.setLayer(5);
  assert.equal(reconciler.getState().status, "deferred");
  reconciler.setLayer(13);
  assert.equal(reconciler.getState().status, "deferred");
});

test("unknown source and layer never write", async () => {
  const { reconciler, writes, runScheduled } = harness();
  reconciler.setBleStatus("connected", true);
  reconciler.setLayer(99);
  reconciler.setSource("unknown.source");
  assert.equal(reconciler.getState().status, "unsupported-source");
  reconciler.setSource("de.source");
  assert.equal(reconciler.getState().status, "unmapped-layer");
  await runScheduled();
  assert.deepEqual(writes, []);
});

test("offline mismatch heals after writable reconnect", async () => {
  const { reconciler, writes, runScheduled } = harness();
  reconciler.setLayer(4);
  reconciler.setSource("ru.source");
  assert.equal(reconciler.getState().status, "offline");
  reconciler.setBleStatus("connected", true);
  await runScheduled();
  assert.deepEqual(writes, [[9, [9, 10, 12]]]);
});

test("write rejection becomes an explicit error", async () => {
  const { reconciler, runScheduled } = harness(async () => {
    throw new Error("confirmation timeout");
  });
  reconciler.setBleStatus("connected", true);
  reconciler.setLayer(4);
  reconciler.setSource("ru.source");
  await runScheduled();
  assert.equal(reconciler.getState().status, "error");
  assert.match(reconciler.getState().message, /confirmation timeout/);
});

test("self-test suspension cancels reconciliation and resumes from authoritative state", async () => {
  const { reconciler, writes, runScheduled } = harness();
  reconciler.setBleStatus("connected", true);
  reconciler.setLayer(4);
  reconciler.setSource("ru.source");
  assert.equal(reconciler.getState().status, "settling");
  reconciler.setSuspended(true);
  assert.equal(reconciler.getState().status, "suspended");
  await runScheduled();
  assert.deepEqual(writes, []);
  reconciler.setLayer(10);
  assert.equal(reconciler.getState().status, "suspended");
  reconciler.setSuspended(false);
  assert.equal(reconciler.getState().status, "synced");
  assert.deepEqual(writes, []);
});
