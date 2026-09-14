import assert from "node:assert/strict";
import test from "node:test";

import { createKeyboardSnakeController } from "../src/keyboard_snake/controller.js";
import { createKeyboardSnakeView, describeSnakeState } from "../src/keyboard_snake/view.js";

class EventTargetStub {
  constructor() { this.listeners = new Map(); this.hidden = false; }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener)); }
  dispatch(type, event = {}) { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event); }
}

class ElementStub extends EventTargetStub {
  constructor() {
    super();
    this.textContent = "";
    this.innerHTML = "";
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.disabled = false;
    this.hidden = false;
    this.className = "";
    this.style = { values: new Map(), setProperty: (key, value) => this.style.values.set(key, String(value)) };
    this.classList = { toggle: (name, force) => { if (force) this.className += ` ${name}`; } };
  }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  click() { this.dispatch("click"); }
}

function viewHarness() {
  const ids = [
    "snakeBoard", "snakeStatus", "snakeTargetCompleted", "snakeTargetRemaining", "snakeFeedback",
    "snakeScore", "snakeMistakes", "snakeAccuracy", "snakeFoodCount", "snakeDuration", "snakePause",
    "snakeOverlay", "snakeOverlayTitle", "snakeOverlayDescription", "snakeRules", "snakePrimaryAction", "snakeFinalResults",
    "snakeFinalScore", "snakeFinalFood", "snakeFinalCorrect", "snakeFinalMistakes", "snakeFinalAccuracy", "snakeFinalDuration",
  ];
  const elements = new Map(ids.map((id) => [id, new ElementStub()]));
  const document = { body: new ElementStub(), getElementById: (id) => elements.get(id), createElement: () => new ElementStub() };
  return { elements, view: createKeyboardSnakeView(document) };
}

function snapshot(overrides = {}) {
  return {
    phase: "playing", columns: 4, rows: 3, tickMs: 100, snake: [{ x: 1, y: 1 }], food: { x: 2, y: 1 },
    target: ["a", "b"], targetProgress: 1, targetArmed: false, feedback: "Correct. Keep typing.", score: 10,
    correct: 1, mistakes: 1, accuracy: .5, consumedFood: 1, activeDurationMs: 62000,
    ...overrides,
  };
}

test("view exposes target progress, live stats, lifecycle, and complete results", () => {
  const { elements, view } = viewHarness();
  view.render(snapshot());
  assert.equal(elements.get("snakeStatus").textContent, "Playing");
  assert.equal(elements.get("snakeTargetCompleted").textContent, "a");
  assert.equal(elements.get("snakeTargetRemaining").textContent, "b");
  assert.equal(elements.get("snakeDuration").textContent, "1:02");
  assert.equal(elements.get("snakeOverlay").hidden, true);

  view.render(snapshot({ phase: "game-over" }));
  assert.equal(elements.get("snakeOverlay").hidden, false);
  assert.equal(elements.get("snakePrimaryAction").textContent, "Play again");
  assert.equal(elements.get("snakeFinalCorrect").textContent, "1");
  assert.equal(elements.get("snakeFinalMistakes").textContent, "1");

  view.render(snapshot({ phase: "ready" }));
  assert.equal(elements.get("snakeRules").hidden, false);
  view.render(snapshot({ phase: "paused" }));
  assert.equal(elements.get("snakeRules").hidden, true);
});

test("view lifecycle actions keep one native click handler", () => {
  const { elements, view } = viewHarness();
  let primary = 0;
  let pauses = 0;
  view.setPrimaryActionHandler(() => { primary += 1; });
  view.setPauseHandler(() => { pauses += 1; });
  view.render(snapshot({ phase: "ready" }));
  view.render(snapshot({ phase: "paused" }));
  elements.get("snakePrimaryAction").click();
  elements.get("snakePause").click();
  assert.equal(primary, 1);
  assert.equal(pauses, 1);
});

test("controller mounts once, processes input once, pauses on focus loss, and replays", async () => {
  const state = snapshot({ phase: "ready" });
  const calls = { input: [], ticks: 0, starts: 0, resumes: 0, pauses: 0, replays: 0, renders: 0, timers: 0 };
  const game = {
    getSnapshot: () => ({ ...state }),
    input: (token) => { calls.input.push(token); return { control: token === "Escape" }; },
    tick: () => { calls.ticks += 1; },
    start: async () => { calls.starts += 1; state.phase = "playing"; return { ok: true }; },
    pause: () => { calls.pauses += 1; state.phase = "paused"; },
    resume: () => { calls.resumes += 1; state.phase = "playing"; },
    replay: async () => { calls.replays += 1; state.phase = "playing"; return { ok: true }; },
  };
  const view = {
    render: () => { calls.renders += 1; },
    setPrimaryActionHandler: (handler) => { view.primary = handler; },
    setPauseHandler: (handler) => { view.pause = handler; },
  };
  const windowTarget = new EventTargetStub();
  const documentTarget = new EventTargetStub();
  const controller = createKeyboardSnakeController({
    game, view, windowTarget, documentTarget,
    setTimer: () => { calls.timers += 1; return 7; }, clearTimer: () => {},
  });
  assert.equal(controller.mount(), true);
  assert.equal(controller.mount(), false);
  assert.equal(calls.timers, 1);
  await view.primary();
  assert.equal(calls.starts, 1);
  windowTarget.dispatch("keydown", { type: "keydown", key: "a", preventDefault() {} });
  assert.deepEqual(calls.input, ["a"]);
  windowTarget.dispatch("blur");
  assert.equal(state.phase, "paused");
  await view.primary();
  assert.equal(calls.resumes, 1);
  state.phase = "game-over";
  await view.primary();
  assert.equal(calls.replays, 1);
  assert.equal(controller.destroy(), true);
  windowTarget.dispatch("keydown", { type: "keydown", key: "b" });
  assert.deepEqual(calls.input, ["a"]);
});

test("controller delivers each completed result once across asynchronous replay", async () => {
  const state = snapshot({ phase: "game-over" });
  const deliveries = [];
  const game = {
    getSnapshot: () => ({ ...state }),
    input: () => ({ ignored: true }),
    tick: () => {},
    pause: () => { state.phase = "paused"; },
    resume: () => { state.phase = "playing"; },
    replay: async () => { state.phase = "playing"; return { ok: true }; },
  };
  const view = { render() {}, setPrimaryActionHandler(handler) { this.primary = handler; }, setPauseHandler() {} };
  const controller = createKeyboardSnakeController({
    game,
    view,
    windowTarget: new EventTargetStub(),
    documentTarget: new EventTargetStub(),
    setTimer: () => 1,
    clearTimer: () => {},
    resultConsumer: { consume: async (result) => deliveries.push(result.phase) },
  });
  controller.mount();
  controller.step();
  await Promise.resolve();
  assert.deepEqual(deliveries, ["game-over"]);
  await view.primary();
  state.phase = "game-over";
  controller.step();
  controller.step();
  await Promise.resolve();
  assert.deepEqual(deliveries, ["game-over", "game-over"]);
  controller.destroy();
});

test("state descriptions cover ready, pause, active, and completion", () => {
  assert.equal(describeSnakeState({ phase: "ready" }).action, "Start game");
  assert.equal(describeSnakeState({ phase: "playing" }).overlay, false);
  assert.equal(describeSnakeState({ phase: "paused" }).action, "Resume");
  assert.equal(describeSnakeState({ phase: "game-over" }).results, true);
});
