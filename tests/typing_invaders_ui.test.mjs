import assert from "node:assert/strict";
import test from "node:test";

import {
  createTypingInvadersController,
  gameplayCharacter,
} from "../src/typing_invaders/controller.js";
import { describeOverlay, splitWord } from "../src/typing_invaders/view.js";

class EventTargetStub {
  constructor() {
    this.listeners = new Map();
    this.hidden = false;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function controllerHarness(initialPhase = "playing") {
  const state = { phase: initialPhase };
  const calls = { typed: [], paused: [], resumed: 0, started: 0, replayed: 0, renders: 0 };
  const game = {
    getSnapshot: () => ({ ...state }),
    drainEvents: () => [],
    start: () => { calls.started += 1; state.phase = "playing"; },
    replay: () => { calls.replayed += 1; state.phase = "playing"; },
    pause: (reason) => {
      if (state.phase !== "playing") return false;
      calls.paused.push(reason);
      state.phase = "paused";
      return true;
    },
    resume: () => { calls.resumed += 1; state.phase = "playing"; return true; },
    tick: () => {},
    typeCharacter: (character) => calls.typed.push(character),
  };
  const view = {
    render: () => { calls.renders += 1; },
    setActionHandler: (handler) => { view.action = handler; },
  };
  const windowTarget = new EventTargetStub();
  const documentTarget = new EventTargetStub();
  const controller = createTypingInvadersController({
    game,
    view,
    windowTarget,
    documentTarget,
    requestFrame: () => 7,
    cancelFrame: () => {},
  });
  controller.mount();
  return { calls, controller, documentTarget, state, view, windowTarget };
}

test("gameplay input accepts one plain English key and filters unsupported events", () => {
  assert.equal(gameplayCharacter({ key: "A" }), "a");
  assert.equal(gameplayCharacter({ key: "a", repeat: true }), null);
  assert.equal(gameplayCharacter({ key: "a", isComposing: true }), null);
  assert.equal(gameplayCharacter({ key: "a", ctrlKey: true }), null);
  assert.equal(gameplayCharacter({ key: "1" }), null);
  assert.equal(gameplayCharacter({ key: "Shift" }), null);
});

test("controller processes a supported key once and toggles pause with Escape", () => {
  const harness = controllerHarness();
  let prevented = 0;
  harness.windowTarget.dispatch("keydown", { key: "K", preventDefault: () => { prevented += 1; } });
  assert.deepEqual(harness.calls.typed, ["k"]);
  assert.equal(prevented, 1);

  harness.windowTarget.dispatch("keydown", { key: "Escape", preventDefault: () => {} });
  assert.deepEqual(harness.calls.paused, ["manual"]);
  harness.windowTarget.dispatch("keydown", { key: "Escape", preventDefault: () => {} });
  assert.equal(harness.calls.resumed, 1);
});

test("controller automatically pauses on blur and hidden documents", () => {
  const harness = controllerHarness();
  harness.windowTarget.dispatch("blur");
  assert.deepEqual(harness.calls.paused, ["focus"]);
  harness.state.phase = "playing";
  harness.documentTarget.hidden = true;
  harness.documentTarget.dispatch("visibilitychange");
  assert.deepEqual(harness.calls.paused, ["focus", "focus"]);
});

test("primary action starts, resumes, and replays the appropriate session state", () => {
  const ready = controllerHarness("ready");
  ready.view.action();
  assert.equal(ready.calls.started, 1);

  const paused = controllerHarness("paused");
  paused.view.action();
  assert.equal(paused.calls.resumed, 1);

  const over = controllerHarness("game-over");
  over.view.action();
  assert.equal(over.calls.replayed, 1);
});

test("overlay descriptions expose start, pause, transition, and complete results states", () => {
  const ready = describeOverlay({ phase: "ready" });
  assert.equal(ready.title, "Shift-Space Invaders");
  assert.equal(ready.action, "Start mission");
  assert.equal(describeOverlay({ phase: "playing" }).visible, false);
  assert.equal(describeOverlay({ phase: "paused" }).action, "Resume mission");
  assert.match(describeOverlay({ phase: "wave-transition", wave: 4 }).title, /4/);
  const gameOver = describeOverlay({ phase: "game-over" });
  assert.equal(gameOver.action, "Play again");
  assert.equal(gameOver.results, true);
});

test("word rendering splits completed and remaining characters", () => {
  assert.deepEqual(splitWord("orbit", 2), { completed: "or", remaining: "bit" });
});
