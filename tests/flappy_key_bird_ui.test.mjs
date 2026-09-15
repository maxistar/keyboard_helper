import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createFlappyKeyBirdController } from "../src/flappy_key_bird/controller.js";
import { createFlappyKeyBirdView, describeFlappyState } from "../src/flappy_key_bird/view.js";

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
    this.style = {};
    this.focusCalls = 0;
    this.classList = { toggle: (name, force) => { if (force && !this.className.includes(name)) this.className += ` ${name}`; } };
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  focus() { this.focusCalls += 1; }
  click() { this.dispatch("click"); }
}

function viewHarness() {
  const ids = [
    "flappyStage", "flappyGates", "flappyBird", "flappyStatus", "flappyTargetLabel", "flappyTargetCompleted", "flappyTargetRemaining",
    "flappyFeedback", "flappyScore", "flappyGateCount", "flappyMistakes", "flappyMisses", "flappyStreak",
    "flappyMultiplier", "flappyDuration", "flappyPause", "flappyOverlay", "flappyOverlayTitle",
    "flappyOverlayDescription", "flappyRules", "flappyPrimaryAction", "flappyFinalResults", "flappyFinalScore",
    "flappyFinalGates", "flappyFinalCorrect", "flappyFinalMistakes", "flappyFinalMisses", "flappyFinalAccuracy",
    "flappyFinalStreak", "flappyFinalDuration",
  ];
  const elements = new Map(ids.map((id) => [id, new ElementStub()]));
  const document = { body: new ElementStub(), getElementById: (id) => elements.get(id), createElement: () => new ElementStub() };
  return { elements, view: createFlappyKeyBirdView(document) };
}

function snapshot(overrides = {}) {
  return {
    phase: "playing", initializing: false, width: 1000, height: 600,
    bird: { x: 200, y: 250, velocity: -20, radius: 18 },
    gates: [{ id: 1, x: 500, gapCenter: 280, width: 80, gap: 200, target: ["a", "b"], targetProgress: 1, cleared: false, passed: false }],
    activeGateId: 1, repeatingTarget: false, target: ["a", "b"], targetProgress: 1, feedback: "Correct. Keep the rhythm.",
    score: 200, clearedGates: 2, correct: 4, mistakes: 1, misses: 0, streak: 2, bestStreak: 3,
    multiplier: 2, accuracy: .8, activeDurationMs: 62000, failureReason: null,
    ...overrides,
  };
}

test("view renders moving geometry, stable target progress, lifecycle, and final results", () => {
  const { elements, view } = viewHarness();
  view.render(snapshot());
  assert.equal(elements.get("flappyStatus").textContent, "Flying");
  assert.equal(elements.get("flappyTargetCompleted").textContent, "a");
  assert.equal(elements.get("flappyTargetRemaining").textContent, "b");
  assert.equal(elements.get("flappyDuration").textContent, "1:02");
  assert.equal(elements.get("flappyGates").children.length, 1);
  assert.match(elements.get("flappyStage").getAttribute("aria-label"), /Active target ab, 1 of 2 complete/);
  assert.equal(elements.get("flappyOverlay").hidden, true);

  view.render(snapshot({ repeatingTarget: true, targetProgress: 0 }));
  assert.equal(elements.get("flappyTargetLabel").textContent, "Repeat target");
  assert.match(elements.get("flappyStage").getAttribute("aria-label"), /Repeat target ab, 0 of 2 complete/);

  view.render(snapshot({ phase: "game-over", failureReason: "missed-gate", misses: 1 }));
  assert.equal(elements.get("flappyOverlay").hidden, false);
  assert.equal(elements.get("flappyOverlayTitle").textContent, "Target missed");
  assert.equal(elements.get("flappyPrimaryAction").textContent, "Fly again");
  assert.equal(elements.get("flappyFinalGates").textContent, "2");
  assert.equal(elements.get("flappyFinalMisses").textContent, "1");
  assert.equal(elements.get("flappyFinalAccuracy").textContent, "80%");
  assert.equal(elements.get("flappyPrimaryAction").focusCalls, 1);

  view.render(snapshot({ phase: "game-over" }));
  assert.equal(elements.get("flappyPrimaryAction").focusCalls, 1);
  view.render(snapshot());
  view.render(snapshot({ phase: "game-over" }));
  assert.equal(elements.get("flappyPrimaryAction").focusCalls, 2);
});

test("view keeps one full-surface action handler across renders", () => {
  const { elements, view } = viewHarness();
  let primary = 0;
  let pauses = 0;
  view.setPrimaryActionHandler(() => { primary += 1; });
  view.setPauseHandler(() => { pauses += 1; });
  view.render(snapshot({ phase: "ready" }));
  view.render(snapshot({ phase: "paused" }));
  elements.get("flappyPrimaryAction").click();
  elements.get("flappyPause").click();
  assert.equal(primary, 1);
  assert.equal(pauses, 1);
});

test("controller owns semantic input, frame stepping, focus pause, replay, and result delivery", async () => {
  const state = snapshot({ phase: "ready" });
  const calls = { input: [], ticks: [], starts: 0, pauses: 0, resumes: 0, replays: 0, renders: 0, cancelled: [] };
  const game = {
    getSnapshot: () => ({ ...state }),
    input(token) { calls.input.push(token); return { control: token === "Escape", ignored: false }; },
    tick(elapsed) { calls.ticks.push(elapsed); },
    async start() { calls.starts += 1; state.phase = "playing"; return { ok: true }; },
    pause() { calls.pauses += 1; state.phase = "paused"; },
    resume() { calls.resumes += 1; state.phase = "playing"; },
    async replay() { calls.replays += 1; state.phase = "playing"; return { ok: true }; },
    cancelPendingSession() { calls.cancelled.push("session"); },
  };
  const view = {
    render() { calls.renders += 1; },
    setPrimaryActionHandler(handler) { this.primary = handler; },
    setPauseHandler(handler) { this.pause = handler; },
  };
  const windowTarget = new EventTargetStub();
  const documentTarget = new EventTargetStub();
  const frames = [];
  let frameId = 0;
  const deliveries = [];
  const controller = createFlappyKeyBirdController({
    game, view, windowTarget, documentTarget,
    requestFrame(callback) { frames.push(callback); frameId += 1; return frameId; },
    cancelFrame(id) { calls.cancelled.push(id); },
    resultConsumer: { async consume(result) { deliveries.push(result.phase); } },
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
  frames.shift()(100);
  frames.shift()(125);
  assert.deepEqual(calls.ticks, [25]);

  windowTarget.dispatch("blur");
  assert.equal(state.phase, "paused");
  await view.primary();
  assert.equal(calls.resumes, 1);
  state.phase = "game-over";
  controller.step(16);
  controller.step(16);
  await Promise.resolve();
  assert.deepEqual(deliveries, ["game-over"]);
  await view.primary();
  assert.equal(calls.replays, 1);
  state.phase = "game-over";
  controller.step(16);
  await Promise.resolve();
  assert.deepEqual(deliveries, ["game-over", "game-over"]);
  assert.equal(controller.destroy(), true);
  windowTarget.dispatch("keydown", { type: "keydown", key: "c" });
  assert.deepEqual(calls.input, ["a"]);
  assert.deepEqual(calls.cancelled, ["session", 3]);
});

test("Flappy presentation includes non-visual feedback and reduced-motion support", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("../src/flappy-key-bird.html", import.meta.url), "utf8"),
    readFile(new URL("../src/flappy_key_bird/game.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /id="flappyFinalResults"/);
  assert.match(html, /id="flappyPrimaryAction"[^>]*>Start flight<\/button>/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.equal(describeFlappyState({ phase: "ready" }).action, "Start flight");
  assert.equal(describeFlappyState({ phase: "paused" }).action, "Resume");
  assert.equal(describeFlappyState({ phase: "game-over", failureReason: "missed-gate" }).results, true);
});
