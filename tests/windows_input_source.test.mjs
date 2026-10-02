import assert from "node:assert/strict";
import test from "node:test";
import { createPlatformInputSourceAdapter } from "../src/input_source_sync_adapter.js";
import { createInputSourceLayerReconciler } from "../src/input_source_layer_reconciler.js";

const de = "windows:klid:00000407";
const ru = "windows:klid:00000419";
const config = { sources: [
  { id: "de", inputSourceId: de, baseLayer: 1, layers: [1, 2] },
  { id: "ru", inputSourceId: ru, baseLayer: 8, layers: [8, 11] },
], neutralLayers: [13], settleMs: 1000 };

function harness() {
  let listener, nativeConfig;
  let revision = 0;
  const sources = [], errors = [], writes = [], timers = new Map();
  let nextTimer = 0;
  const reconciler = createInputSourceLayerReconciler({ config,
    writeLayer: async (layer) => { writes.push(layer); },
    schedule: (callback) => { timers.set(++nextTimer, callback); return nextTimer; },
    cancel: (id) => timers.delete(id),
  });
  const snapshot = (source = de, context = "window-a", extra = {}) => ({
    layout: "corney", session: nativeConfig.session, revision: ++revision,
    currentSourceId: source, availableSourceIds: [de, ru],
    diagnostics: { platform: "windows", contextId: context, installedSourceIds: [de, ru] },
    ...extra,
  });
  const handlers = {};
  const tauri = { core: { invoke: async (command, args) => {
    if (handlers[command]) return handlers[command](args);
    if (command === "start_windows_input_source_sync") { nativeConfig = args.config; return snapshot(); }
    if (command === "refresh_windows_input_source_sync") return snapshot();
    if (command === "select_windows_input_source") return snapshot(args.sourceId);
  } }, event: { listen: async (_event, callback) => { listener = callback; return () => {}; } } };
  const adapter = createPlatformInputSourceAdapter({ platform: "windows", tauri,
    onSourceChange: (id) => { sources.push(id); reconciler.setSource(id); },
    onError: (error) => errors.push(error),
  });
  return { adapter, snapshot, sources, errors, handlers, writes, timers, reconciler,
    event: (payload) => listener({ payload }),
    flush: async () => { const callbacks = [...timers.values()]; timers.clear(); for (const fn of callbacks) await fn(); },
  };
}

test("Windows adapter starts, lists layouts, and confirms a selection", async () => {
  const h = harness();
  assert.equal(h.adapter.supported, true);
  assert.equal(await h.adapter.start("corney", config), true);
  assert.equal(h.adapter.getCurrentSourceId(), de);
  assert.deepEqual([...h.adapter.getAvailableSourceIds()], [de, ru]);
  await h.adapter.select(ru);
  assert.equal(h.adapter.getCurrentSourceId(), ru);
  assert.equal(h.sources.at(-2), null);
  await h.adapter.stop();
  assert.equal(h.adapter.getCurrentSourceId(), null);
});

test("same-language focus change cancels old timer and restarts settling", async () => {
  const h = harness(); await h.adapter.start("corney", config);
  h.reconciler.setBleStatus("connected", true); h.reconciler.setLayer(8);
  const stale = [...h.timers.values()][0];
  h.event(h.snapshot(de, "window-b"));
  await stale(); assert.deepEqual(h.writes, []);
  await h.flush(); assert.deepEqual(h.writes, [1]);
});

test("loss of confirmation cancels BLE correction; stale events cannot restore it", async () => {
  const h = harness(); await h.adapter.start("corney", config);
  h.reconciler.setBleStatus("connected", true); h.reconciler.setLayer(8);
  const old = h.snapshot();
  h.event(h.snapshot(null, null, { message: "No foreground" }));
  h.event(old);
  await h.flush(); assert.deepEqual(h.writes, []);
  assert.equal(h.adapter.getStatus().available, false);
  h.event(h.snapshot(ru));
  assert.equal(h.adapter.getCurrentSourceId(), ru);
});

test("failed selection publishes no guessed source or BLE correction", async () => {
  const h = harness(); await h.adapter.start("corney", config);
  h.reconciler.setBleStatus("connected", true); h.reconciler.setLayer(8);
  h.handlers.select_windows_input_source = () => h.snapshot(null, null, { message: "Target changed" });
  await assert.rejects(h.adapter.select(ru), /Target changed/);
  await h.flush(); assert.deepEqual(h.writes, []);
  assert.equal(h.adapter.getCurrentSourceId(), null);
  await assert.rejects(h.adapter.select("windows:klid:00010409"), /unavailable/);
});

test("late selection response cannot affect a stopped session", async () => {
  const h = harness(); await h.adapter.start("corney", config);
  let resolve;
  const response = h.snapshot(ru);
  h.handlers.select_windows_input_source = () => new Promise((r) => { resolve = r; });
  const pending = h.adapter.select(ru);
  const rejection = assert.rejects(pending, /session changed/);
  await h.adapter.stop(); resolve(response); await rejection;
  assert.equal(h.adapter.getCurrentSourceId(), null);
});

test("refresh failure clears source and failed startup remains unavailable", async () => {
  const h = harness(); await h.adapter.start("corney", config);
  h.handlers.refresh_windows_input_source_sync = () => { throw new Error("Unreadable"); };
  await h.adapter.refresh(); assert.equal(h.adapter.getCurrentSourceId(), null);
  h.handlers.start_windows_input_source_sync = () => { throw new Error("No session"); };
  assert.equal(await h.adapter.start("corney", config), false);
  assert.equal(h.adapter.getStatus().available, false);
});

test("neutral, transient, and unmapped states never write; rapid sources use newest", async () => {
  const h = harness(); await h.adapter.start("corney", config);
  h.reconciler.setBleStatus("connected", true);
  for (const layer of [13, 11, 99]) { h.reconciler.setLayer(layer); await h.flush(); }
  h.reconciler.setLayer(8);
  h.event(h.snapshot("windows:klid:00010409")); await h.flush();
  assert.deepEqual(h.writes, []);
  h.event(h.snapshot(de)); h.event(h.snapshot(ru)); await h.flush();
  assert.deepEqual(h.writes, []);
  h.event(h.snapshot(de)); await h.flush(); assert.deepEqual(h.writes, [1]);
});

test("focus moves during pending selection without writing an unconfirmed source", async () => {
  const h = harness(); await h.adapter.start("corney", config);
  h.reconciler.setBleStatus("connected", true); h.reconciler.setLayer(8);
  let resolve;
  h.handlers.select_windows_input_source = ({ session }) => {
    assert.equal(session, h.snapshot().session);
    return new Promise((r) => { resolve = r; });
  };
  const pending = h.adapter.select(ru);
  const rejected = assert.rejects(pending, /Target changed/);
  h.event(h.snapshot(de, "window-b"));
  await h.flush(); assert.deepEqual(h.writes, []);
  resolve(h.snapshot(null, "window-b", { message: "Target changed" }));
  await rejected;
  await h.flush(); assert.deepEqual(h.writes, []);
  h.event(h.snapshot(de, "window-b"));
  await h.flush(); assert.deepEqual(h.writes, [1]);
});

test("late refresh from replaced session cannot overwrite its confirmed source", async () => {
  const h = harness(); await h.adapter.start("corney", config);
  let resolve;
  const old = h.snapshot(ru);
  h.handlers.refresh_windows_input_source_sync = () => new Promise((r) => { resolve = r; });
  const pending = h.adapter.refresh();
  await h.adapter.start("corney", config);
  resolve(old); await pending;
  assert.equal(h.adapter.getCurrentSourceId(), de);
  h.event(old);
  assert.equal(h.adapter.getCurrentSourceId(), de);
});

test("restarting during selection resumes observation in the new session", async () => {
  const h = harness(); await h.adapter.start("corney", config);
  let resolve;
  const old = h.snapshot(ru);
  h.handlers.select_windows_input_source = () => new Promise((r) => { resolve = r; });
  const rejected = assert.rejects(h.adapter.select(ru), /session changed/);
  await h.adapter.start("corney", config);
  resolve(old); await rejected;
  h.event(h.snapshot(ru));
  assert.equal(h.adapter.getCurrentSourceId(), ru);
});
