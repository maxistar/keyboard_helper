import assert from "node:assert/strict";
import test from "node:test";

import { createReadinessGate, initializeSecondaryWindow } from "../src/secondary_window_ready.js";

test("matching readiness resolves a gate and a duplicate is ignored", async () => {
  const gate = createReadinessGate({ label: "settings" });
  assert.equal(gate.accept({ label: "settings", state: "ready", stage: "initialized" }), true);
  assert.equal(gate.accept({ label: "settings", state: "ready", stage: "duplicate" }), false);
  assert.deepEqual(await gate.result, { ok: true, label: "settings", stage: "initialized", error: undefined });
});

test("stale readiness is ignored", async () => {
  const gate = createReadinessGate({ label: "settings" });
  assert.equal(gate.accept({ label: "typing-invaders", state: "ready" }), false);
  assert.equal(gate.accept({ label: "settings", state: "ready", stage: "initialized" }), true);
  assert.equal((await gate.result).ok, true);
});

test("failed readiness reports a bounded error", async () => {
  const calls = [];
  const error = new Error("broken window");
  await assert.rejects(() => initializeSecondaryWindow({
    label: "settings",
    invoke: async (command, args) => calls.push([command, args]),
    initialize: async () => { throw error; },
  }), error);
  assert.equal(calls[0][1].payload.state, "failed");
  assert.equal(calls[0][1].payload.error, "broken window");
});

test("readiness timeout settles without hanging", async () => {
  let callback;
  const gate = createReadinessGate({
    label: "settings",
    timeoutMs: 25,
    setTimer: (fn) => { callback = fn; return 1; },
    clearTimer: () => {},
  });
  callback();
  assert.deepEqual(await gate.result, {
    ok: false,
    label: "settings",
    stage: "timeout",
    error: "readiness timeout",
  });
});
