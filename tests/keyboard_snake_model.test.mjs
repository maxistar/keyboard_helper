import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSemanticKeydown } from "../src/mini_games/input.js";
import {
  attachFocusLifecycle,
  consumeResult,
  createMiniGameRuntime,
  createMiniGameSession,
  createResultAccumulator,
  resolveTargetSource,
} from "../src/mini_games/runtime.js";
import { createTargetMatcher, filterCompatibleTargets } from "../src/mini_games/targets.js";
import { createSnakeGame, createSnakeGameFromSources } from "../src/keyboard_snake/model.js";
import { SNAKE_CONFIG, SNAKE_TARGETS } from "../src/keyboard_snake/config.js";

function gameWith(overrides = {}) {
  return createSnakeGame({
    config: { columns: 5, rows: 4, tickMs: 100, targets: ["a", "bc"], ...overrides },
    random: () => 0,
  });
}

test("default beginner mode is five times slower and uses single-character targets", () => {
  assert.equal(SNAKE_CONFIG.tickMs, 900);
  assert.equal(SNAKE_TARGETS.every((target) => Array.from(target).length === 1), true);
});

test("session timing excludes paused time and resets cleanly", () => {
  let time = 0;
  const session = createMiniGameSession({ now: () => time });
  session.start();
  time = 500;
  session.pause();
  time = 900;
  session.resume();
  time = 1200;
  assert.equal(session.getSnapshot().activeDurationMs, 800);
  session.reset();
  assert.deepEqual(session.getSnapshot(), { phase: "ready", activeDurationMs: 0 });
});

test("semantic input accepts Shift and AltGraph output but rejects command input", () => {
  assert.equal(normalizeSemanticKeydown({ type: "keydown", key: "A", shiftKey: true }), "A");
  assert.equal(normalizeSemanticKeydown({ type: "keydown", key: "@", ctrlKey: true, altKey: true, getModifierState: (name) => name === "AltGraph" }), "@");
  assert.equal(normalizeSemanticKeydown({ type: "keydown", key: "a", ctrlKey: true }), null);
  assert.equal(normalizeSemanticKeydown({ type: "keydown", key: "a", repeat: true }), null);
  assert.equal(normalizeSemanticKeydown({ type: "keydown", key: "Dead" }), null);
  assert.equal(normalizeSemanticKeydown({ type: "keyup", key: "a" }), null);
  assert.equal(normalizeSemanticKeydown({ type: "keydown", key: "Enter" }), "Enter");
  assert.equal(normalizeSemanticKeydown({ type: "keydown", key: "F13" }), null);
  assert.equal(normalizeSemanticKeydown({ type: "keydown", key: "a", isComposing: true }), null);
});

test("target filtering rejects reserved, unsupported, physical, and oversized targets", () => {
  assert.deepEqual(filterCompatibleTargets([
    ["Enter"], ["ArrowUp"], ["F13"], { kind: "physical", tokens: ["a"] }, "ok", "1234567890123",
  ]), [["Enter"], ["o", "k"]]);
});

test("optional adapters fail safely without changing the local result", async () => {
  const targets = await resolveTargetSource({
    adapter: { getTargets: async () => { throw new Error("offline"); } },
    bundledTargets: ["safe"],
    filter: filterCompatibleTargets,
  });
  assert.deepEqual(targets, [["s", "a", "f", "e"]]);
  const result = { score: 10 };
  const delivery = await consumeResult(result, { consume: async () => { throw new Error("offline"); } });
  assert.equal(delivery.ok, false);
  assert.deepEqual(result, { score: 10 });
});

test("sequence matching preserves prefix and ignores input after completion", () => {
  const matcher = createTargetMatcher("ab");
  assert.equal(matcher.input("a").progress, 1);
  assert.equal(matcher.input("x").progress, 1);
  assert.equal(matcher.mistakes, 1);
  assert.equal(matcher.input("b").complete, true);
  assert.equal(matcher.input("z").ignored, true);
  assert.equal(matcher.mistakes, 1);
});

test("unarmed food is not consumed while armed food grows and scores", async () => {
  const config = { columns: 3, rows: 1, tickMs: 100, targets: ["a"], pointsPerFood: 25 };
  const unarmed = createSnakeGame({ config, random: () => 0.99 });
  await unarmed.start();
  unarmed.tick();
  assert.deepEqual(unarmed.getSnapshot().food, { x: 2, y: 0 });
  assert.equal(unarmed.getSnapshot().snake.length, 1);
  assert.equal(unarmed.getSnapshot().score, 0);

  const armed = createSnakeGame({ config, random: () => 0.99 });
  await armed.start();
  armed.input("a");
  armed.tick();
  assert.equal(armed.getSnapshot().snake.length, 2);
  assert.equal(armed.getSnapshot().score, 25);
  assert.equal(armed.getSnapshot().consumedFood, 1);
});

test("turns are queued once, reversal depends on body length, and controls do not affect accuracy", async () => {
  const single = gameWith();
  await single.start();
  assert.equal(single.input("ArrowLeft").accepted, true);
  assert.equal(single.getSnapshot().mistakes, 0);

  const body = gameWith({ initialSnake: [{ x: 2, y: 1 }, { x: 1, y: 1 }] });
  await body.start();
  assert.equal(body.input("ArrowLeft").accepted, false);
  assert.equal(body.input("ArrowUp").accepted, true);
  assert.equal(body.input("ArrowLeft").accepted, false);
});

test("moving into the vacating tail is legal and board edges wrap", async () => {
  const tail = gameWith({
    initialSnake: [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 1 }],
  });
  await tail.start();
  assert.equal(tail.tick(), true);
  assert.deepEqual(tail.getSnapshot().snake[0], { x: 2, y: 1 });

  const wrap = createSnakeGame({
    config: { columns: 3, rows: 2, tickMs: 100, targets: ["a"], initialSnake: [{ x: 2, y: 0 }] },
    random: () => 0,
  });
  await wrap.start();
  wrap.tick();
  assert.deepEqual(wrap.getSnapshot().snake[0], { x: 0, y: 0 });
  wrap.input("ArrowUp");
  wrap.tick();
  assert.deepEqual(wrap.getSnapshot().snake[0], { x: 0, y: 1 });
});

test("replay starts a clean active run", async () => {
  const game = createSnakeGame({
    config: {
      columns: 5,
      rows: 4,
      tickMs: 100,
      targets: ["a"],
      initialSnake: [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 1 }, { x: 3, y: 1 }],
    },
    random: () => 0,
  });
  await game.start();
  game.input("x");
  game.tick();
  assert.equal(game.getSnapshot().phase, "game-over");
  await game.replay();
  const replay = game.getSnapshot();
  assert.equal(replay.phase, "playing");
  assert.equal(replay.mistakes, 0);
  assert.equal(replay.score, 0);
});

test("new sessions resolve providers again and reset timing and results atomically", async () => {
  let providerCalls = 0;
  let time = 0;
  const session = createMiniGameSession({ now: () => time });
  const results = createResultAccumulator({ session });
  const committed = [];
  const runtime = createMiniGameRuntime({
    session,
    results,
    targetProvider: { getTargets: async () => [providerCalls++ === 0 ? "a" : "b"] },
    bundledTargets: ["z"],
    filterTargets: filterCompatibleTargets,
    commitSession: (targets) => committed.push(targets),
  });

  assert.equal((await runtime.startNewSession()).ok, true);
  results.recordCorrect();
  results.recordFood({ score: 10 });
  time = 500;
  session.gameOver();
  assert.equal((await runtime.startNewSession()).ok, true);
  assert.equal(providerCalls, 2);
  assert.deepEqual(committed, [[["a"]], [["b"]]]);
  assert.deepEqual(results.snapshot(), {
    score: 0, correct: 0, mistakes: 0, accuracy: 1, consumedFood: 0, activeDurationMs: 0,
  });
  assert.equal(session.getSnapshot().phase, "playing");
});

test("new-session initialization falls back, fails closed, and rejects stale work", async () => {
  const fallback = createMiniGameRuntime({
    targetProvider: { getTargets: async () => [{ kind: "physical", tokens: ["a"] }] },
    bundledTargets: ["safe"],
    filterTargets: filterCompatibleTargets,
  });
  assert.equal((await fallback.startNewSession()).ok, true);

  const empty = createMiniGameRuntime({
    bundledTargets: [],
    filterTargets: filterCompatibleTargets,
  });
  const failed = await empty.startNewSession();
  assert.equal(failed.ok, false);
  assert.equal(empty.session.getSnapshot().phase, "ready");
  assert.match(empty.getInitializationState().initializationError, /No compatible/);

  const resolvers = [];
  const commits = [];
  const stale = createMiniGameRuntime({
    targetProvider: { getTargets: () => new Promise((resolve) => resolvers.push(resolve)) },
    bundledTargets: ["z"],
    filterTargets: filterCompatibleTargets,
    commitSession: (targets) => commits.push(targets),
  });
  const first = stale.startNewSession();
  assert.strictEqual(stale.startNewSession(), first);
  stale.invalidatePending();
  const second = stale.startNewSession();
  resolvers[1](["b"]);
  assert.equal((await second).ok, true);
  resolvers[0](["a"]);
  assert.equal((await first).stale, true);
  assert.deepEqual(commits, [[["b"]]]);
});

test("shared focus lifecycle mounts once, pauses active play once, tears down, and remounts", () => {
  class Target {
    constructor() { this.hidden = false; this.listeners = new Map(); }
    addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
    removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener)); }
    dispatch(type) { for (const listener of this.listeners.get(type) ?? []) listener(); }
  }
  const windowTarget = new Target();
  const documentTarget = new Target();
  const session = createMiniGameSession();
  let notifications = 0;
  const lifecycle = attachFocusLifecycle({ session, windowTarget, documentTarget, onPause: () => { notifications += 1; } });
  assert.equal(lifecycle.mount(), false);
  windowTarget.dispatch("blur");
  assert.equal(session.getSnapshot().phase, "ready");
  session.start();
  windowTarget.dispatch("blur");
  assert.equal(session.getSnapshot().phase, "paused");
  assert.equal(notifications, 1);
  documentTarget.hidden = true;
  documentTarget.dispatch("visibilitychange");
  assert.equal(notifications, 1);
  assert.equal(lifecycle.destroy(), true);
  session.resume();
  windowTarget.dispatch("blur");
  assert.equal(session.getSnapshot().phase, "playing");
  assert.equal(lifecycle.mount(), true);
  windowTarget.dispatch("blur");
  assert.equal(notifications, 2);
});

test("provider-backed Snake refreshes targets on replay and bundled fallback stays available", async () => {
  let calls = 0;
  const game = await createSnakeGameFromSources({
    targetProvider: { getTargets: async () => [calls++ === 0 ? "a" : "b"] },
    config: {
      columns: 5, rows: 4, tickMs: 100, targets: ["z"],
      initialSnake: [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 1 }, { x: 3, y: 1 }],
    },
    random: () => 0,
  });
  await game.start();
  assert.deepEqual(game.getSnapshot().target, ["a"]);
  game.tick();
  assert.equal(game.getSnapshot().phase, "game-over");
  await game.replay();
  assert.deepEqual(game.getSnapshot().target, ["b"]);
  assert.equal(calls, 2);

  const fallbackGame = await createSnakeGameFromSources({
    targetProvider: { getTargets: async () => { throw new Error("offline"); } },
    bundledTargets: ["z"],
    config: { columns: 3, rows: 2, tickMs: 100, targets: ["z"] },
  });
  assert.equal((await fallbackGame.start()).ok, true);
  assert.deepEqual(fallbackGame.getSnapshot().target, ["z"]);
});

test("filling the final free cell completes the board", async () => {
  const game = createSnakeGame({
    config: { columns: 2, rows: 1, tickMs: 100, targets: ["a"], initialSnake: [{ x: 0, y: 0 }] },
    random: () => 0.99,
  });
  await game.start();
  game.input("a");
  game.tick();
  const complete = game.getSnapshot();
  assert.equal(complete.phase, "finished");
  assert.equal(complete.snake.length, 2);
  assert.equal(complete.food, null);
});
