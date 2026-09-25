import assert from "node:assert/strict";
import test from "node:test";

import { createFishingController } from "../src/underwater_typing_fishing/controller.js";

class EventTargetStub {
  constructor() { this.listeners = new Map(); this.hidden = false; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener)); }
  dispatch(type, event = {}) { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event); }
}

function snapshot(overrides = {}) {
  return { phase: "ready", renderIntervalMs: 250, completionReason: null, ...overrides };
}

function harness(initial = {}) {
  const state = snapshot(initial);
  const calls = { input: [], starts: 0, replays: 0, pauses: 0, resumes: 0, ends: 0, renders: 0, cancellations: 0 };
  const game = {
    getSnapshot: () => ({ ...state }),
    input(token) { calls.input.push(token); return { control: token === "Escape", ignored: false }; },
    async start() { calls.starts += 1; state.phase = "playing"; return { ok: true }; },
    async replay() { calls.replays += 1; state.phase = "playing"; state.completionReason = null; return { ok: true }; },
    pause() { calls.pauses += 1; state.phase = "paused"; return true; },
    resume() { calls.resumes += 1; state.phase = "playing"; return true; },
    finishEarly() { calls.ends += 1; state.phase = "finished"; state.completionReason = "early-finished"; return true; },
    cancelPendingSession() { calls.cancellations += 1; },
  };
  const view = {
    render() { calls.renders += 1; },
    setPrimaryActionHandler(handler) { this.primary = handler; },
    setPauseHandler(handler) { this.pause = handler; },
    setEndSessionHandler(handler) { this.end = handler; },
  };
  return { state, calls, game, view };
}

test("controller mounts once, normalizes input, pauses on focus loss, ends, and tears down", async () => {
  const { state, calls, game, view } = harness();
  const windowTarget = new EventTargetStub();
  const documentTarget = new EventTargetStub();
  let timerCallback = null;
  let cleared = null;
  const controller = createFishingController({
    game,
    view,
    windowTarget,
    documentTarget,
    setTimer(callback) { timerCallback = callback; return 9; },
    clearTimer(id) { cleared = id; },
  });
  assert.equal(controller.mount(), true);
  assert.equal(controller.mount(), false);
  await view.primary();
  assert.equal(calls.starts, 1);

  let prevented = 0;
  windowTarget.dispatch("keydown", { type: "keydown", key: "a", preventDefault() { prevented += 1; } });
  windowTarget.dispatch("keydown", { type: "keydown", key: "b", repeat: true });
  assert.deepEqual(calls.input, ["a"]);
  assert.equal(prevented, 1);
  timerCallback();

  windowTarget.dispatch("blur");
  assert.equal(state.phase, "paused");
  assert.equal(calls.pauses, 1);
  windowTarget.dispatch("keydown", { type: "keydown", key: "x", ctrlKey: true });
  assert.deepEqual(calls.input, ["a"]);
  await view.primary();
  assert.equal(calls.resumes, 1);
  assert.equal(view.end(), true);
  assert.equal(state.phase, "finished");
  assert.equal(controller.destroy(), true);
  assert.equal(cleared, 9);
  assert.equal(calls.cancellations, 1);
  windowTarget.dispatch("keydown", { type: "keydown", key: "c" });
  assert.deepEqual(calls.input, ["a"]);
});

test("finished result is delivered once, consumer failure is isolated, and replay resets delivery", async () => {
  const { state, game, view } = harness({ phase: "finished", completionReason: "completed" });
  const deliveries = [];
  const controller = createFishingController({
    game,
    view,
    windowTarget: new EventTargetStub(),
    documentTarget: new EventTargetStub(),
    setTimer: () => 1,
    clearTimer: () => {},
    resultConsumer: { async consume(result) { deliveries.push(result.completionReason); throw new Error("offline"); } },
  });
  controller.mount();
  controller.render();
  await Promise.resolve();
  assert.deepEqual(deliveries, ["completed"]);
  await view.primary();
  assert.equal(state.phase, "playing");
  state.phase = "finished";
  state.completionReason = "early-finished";
  controller.render();
  controller.render();
  await Promise.resolve();
  assert.deepEqual(deliveries, ["completed", "early-finished"]);
  controller.destroy();
});
