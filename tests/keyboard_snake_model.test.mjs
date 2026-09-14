import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSemanticKeydown } from "../src/mini_games/input.js";
import { consumeResult, createMiniGameSession, resolveTargetSource } from "../src/mini_games/runtime.js";
import { createTargetMatcher, filterCompatibleTargets } from "../src/mini_games/targets.js";
import { createSnakeGame } from "../src/keyboard_snake/model.js";
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

test("unarmed food is not consumed while armed food grows and scores", () => {
  const config = { columns: 3, rows: 1, tickMs: 100, targets: ["a"], pointsPerFood: 25 };
  const unarmed = createSnakeGame({ config, random: () => 0.99 });
  unarmed.start();
  unarmed.tick();
  assert.deepEqual(unarmed.getSnapshot().food, { x: 2, y: 0 });
  assert.equal(unarmed.getSnapshot().snake.length, 1);
  assert.equal(unarmed.getSnapshot().score, 0);

  const armed = createSnakeGame({ config, random: () => 0.99 });
  armed.start();
  armed.input("a");
  armed.tick();
  assert.equal(armed.getSnapshot().snake.length, 2);
  assert.equal(armed.getSnapshot().score, 25);
  assert.equal(armed.getSnapshot().consumedFood, 1);
});

test("turns are queued once, reversal depends on body length, and controls do not affect accuracy", () => {
  const single = gameWith();
  single.start();
  assert.equal(single.input("ArrowLeft").accepted, true);
  assert.equal(single.getSnapshot().mistakes, 0);

  const body = gameWith({ initialSnake: [{ x: 2, y: 1 }, { x: 1, y: 1 }] });
  body.start();
  assert.equal(body.input("ArrowLeft").accepted, false);
  assert.equal(body.input("ArrowUp").accepted, true);
  assert.equal(body.input("ArrowLeft").accepted, false);
});

test("moving into the vacating tail is legal and board edges wrap", () => {
  const tail = gameWith({
    initialSnake: [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 1 }],
  });
  tail.start();
  assert.equal(tail.tick(), true);
  assert.deepEqual(tail.getSnapshot().snake[0], { x: 2, y: 1 });

  const wrap = createSnakeGame({
    config: { columns: 3, rows: 2, tickMs: 100, targets: ["a"], initialSnake: [{ x: 2, y: 0 }] },
    random: () => 0,
  });
  wrap.start();
  wrap.tick();
  assert.deepEqual(wrap.getSnapshot().snake[0], { x: 0, y: 0 });
  wrap.input("ArrowUp");
  wrap.tick();
  assert.deepEqual(wrap.getSnapshot().snake[0], { x: 0, y: 1 });
});

test("replay starts a clean active run", () => {
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
  game.start();
  game.input("x");
  game.tick();
  assert.equal(game.getSnapshot().phase, "game-over");
  game.replay();
  const replay = game.getSnapshot();
  assert.equal(replay.phase, "playing");
  assert.equal(replay.mistakes, 0);
  assert.equal(replay.score, 0);
});
