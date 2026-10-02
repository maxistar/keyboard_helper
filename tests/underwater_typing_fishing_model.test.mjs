import assert from "node:assert/strict";
import test from "node:test";

import { FISHING_CONFIG_LIMITS, normalizeFishingConfig } from "../src/underwater_typing_fishing/config.js";
import {
  createFishingGame,
  filterFishingTargets,
  selectUnambiguousTargets,
} from "../src/underwater_typing_fishing/model.js";

function testConfig(overrides = {}) {
  return {
    visibleFish: 3,
    catchQuota: 3,
    maximumTargetTokens: 8,
    pointsPerToken: 10,
    catchesPerMultiplier: 1,
    maximumMultiplier: 2,
    renderIntervalMs: 250,
    targets: ["cat", "dog", "eel", "cod"],
    ...overrides,
  };
}

async function started(options = {}) {
  const game = createFishingGame({ config: testConfig(), ...options });
  assert.equal((await game.start()).ok, true);
  return game;
}

function type(game, value) {
  for (const token of Array.from(value)) game.input(token);
}

test("configuration clamps every gameplay bound", () => {
  const config = normalizeFishingConfig({
    visibleFish: -2,
    catchQuota: 1000,
    maximumTargetTokens: 0,
    pointsPerToken: Infinity,
    catchesPerMultiplier: 0,
    maximumMultiplier: 99,
  });
  assert.equal(config.visibleFish, FISHING_CONFIG_LIMITS.visibleFish.minimum);
  assert.equal(config.catchQuota, FISHING_CONFIG_LIMITS.catchQuota.maximum);
  assert.equal(config.maximumTargetTokens, FISHING_CONFIG_LIMITS.maximumTargetTokens.minimum);
  assert.equal(config.pointsPerToken, 10);
  assert.equal(config.catchesPerMultiplier, FISHING_CONFIG_LIMITS.catchesPerMultiplier.minimum);
  assert.equal(config.maximumMultiplier, FISHING_CONFIG_LIMITS.maximumMultiplier.maximum);
});

test("target filtering and population selection reject unsupported and ambiguous targets", () => {
  const filtered = filterFishingTargets([
    "cat", "cod", "dog", ["ArrowUp"], { kind: "physical", tokens: ["x"] }, "toolongword",
  ], { maximumTargetTokens: 8 });
  assert.deepEqual(filtered, [["c", "a", "t"], ["c", "o", "d"], ["d", "o", "g"]]);
  assert.deepEqual(
    selectUnambiguousTargets(filtered, 3).map(({ target }) => target.join("")),
    ["cat", "dog"],
  );
});

test("starting creates stable fish with distinct initials and sparse pools show fewer fish", async () => {
  const game = await started({
    config: testConfig({ visibleFish: 4, targets: ["cat", "cod", "cape", "dog"] }),
  });
  const fish = game.getSnapshot().fish;
  assert.equal(fish.length, 2);
  assert.equal(new Set(fish.map((entry) => entry.target[0])).size, 2);
  assert.deepEqual(fish.map(({ id, lane }) => ({ id, lane })), [{ id: 1, lane: 0 }, { id: 2, lane: 1 }]);
});

test("first token hooks and advances once while mistakes preserve the completed prefix", async () => {
  const game = await started();
  const selected = game.getSnapshot().fish.find((entry) => entry.target.join("") === "cat");
  const hook = game.input("c");
  assert.equal(hook.progress, 1);
  assert.equal(game.getSnapshot().hookedFishId, selected.id);
  assert.equal(game.getSnapshot().fish.find((entry) => entry.id === selected.id).progress, 1);

  game.input("x");
  let state = game.getSnapshot();
  assert.equal(state.mistakes, 1);
  assert.equal(state.hookedFishId, selected.id);
  assert.equal(state.fish.find((entry) => entry.id === selected.id).progress, 1);

  game.input("a");
  game.input("t");
  state = game.getSnapshot();
  assert.equal(state.caughtFish, 1);
  assert.equal(state.hookedFishId, null);
  assert.equal(state.correct, 3);
  assert.equal(new Set(state.fish.map((entry) => entry.lane)).size, state.fish.length);
});

test("a wrong initial records one mistake without selecting a fish", async () => {
  const game = await started();
  assert.equal(game.input("z").mistake, true);
  const state = game.getSnapshot();
  assert.equal(state.mistakes, 1);
  assert.equal(state.hookedFishId, null);
  assert.equal(state.fish.every((entry) => entry.progress === 0), true);
});

test("catches score exactly once, use a bounded multiplier, replenish, and complete the quota", async () => {
  let time = 0;
  const game = createFishingGame({
    config: testConfig({ visibleFish: 1, catchQuota: 3, targets: ["a", "b", "c"], maximumMultiplier: 2 }),
    now: () => time,
  });
  await game.start();
  type(game, "a");
  assert.equal(game.getSnapshot().score, 10);
  type(game, "b");
  assert.equal(game.getSnapshot().score, 30);
  time = 60000;
  type(game, "c");
  const state = game.getSnapshot();
  assert.equal(state.phase, "finished");
  assert.equal(state.completionReason, "completed");
  assert.equal(state.caughtFish, 3);
  assert.equal(state.score, 50);
  assert.equal(state.bestStreak, 3);
  assert.equal(state.multiplier, 2);
  assert.equal(state.wpm, 3 / 5);
  assert.equal(game.input("c").ignored, true);
  assert.equal(game.getSnapshot().caughtFish, 3);
});

test("time alone never removes fish or ends Zen play", async () => {
  let time = 0;
  const game = await started({ now: () => time });
  const before = game.getSnapshot().fish;
  time = 60 * 60 * 1000;
  const after = game.getSnapshot();
  assert.equal(after.phase, "playing");
  assert.deepEqual(after.fish, before);
  assert.equal(after.mistakes, 0);
});

test("early finish reports results and replay re-resolves targets and resets all state", async () => {
  let calls = 0;
  const game = createFishingGame({
    config: testConfig({ visibleFish: 1, catchQuota: 2, targets: ["z"] }),
    targetProvider: { async getTargets() { calls += 1; return calls === 1 ? ["a"] : ["b"]; } },
  });
  await game.start();
  type(game, "a");
  assert.equal(game.finishEarly(), true);
  assert.equal(game.getSnapshot().completionReason, "early-finished");
  await game.replay();
  const replay = game.getSnapshot();
  assert.equal(calls, 2);
  assert.equal(replay.phase, "playing");
  assert.equal(replay.caughtFish, 0);
  assert.equal(replay.score, 0);
  assert.equal(replay.mistakes, 0);
  assert.equal(replay.fish[0].target.join(""), "b");
});

test("provider failure falls back and an empty source fails closed", async () => {
  const fallback = createFishingGame({
    config: testConfig({ visibleFish: 1, targets: ["safe"] }),
    targetProvider: { async getTargets() { throw new Error("offline"); } },
  });
  assert.equal((await fallback.start()).ok, true);
  assert.equal(fallback.getSnapshot().fish[0].target.join(""), "safe");

  const empty = createFishingGame({ config: testConfig({ targets: [] }), bundledTargets: [] });
  assert.equal((await empty.start()).ok, false);
  assert.equal(empty.getSnapshot().phase, "ready");
  assert.match(empty.getSnapshot().feedback, /No compatible/);
});
