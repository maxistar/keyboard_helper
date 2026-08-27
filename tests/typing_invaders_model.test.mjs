import assert from "node:assert/strict";
import test from "node:test";

import {
  GAME_RULES,
  WORD_TIERS,
  getWaveConfig,
  validateGameConfig,
} from "../src/typing_invaders/config.js";
import {
  calculateAccuracy,
  calculateWpm,
  createTypingInvadersGame,
  selectDistinctWord,
} from "../src/typing_invaders/model.js";

const fastRules = {
  ...GAME_RULES,
  defenseLine: 0.2,
  maxTickMs: 100,
  waveTransitionMs: 100,
};

function testWave(overrides = {}) {
  return {
    tier: 0,
    speed: 1,
    spawnIntervalMs: 100,
    maxTargets: 3,
    requiredKills: 1,
    ...overrides,
  };
}

function gameHarness({ words = ["cat", "dog", "elk"], wave = testWave(), random = () => 0 } = {}) {
  return createTypingInvadersGame({
    wordTiers: [words],
    resolveWave: () => wave,
    rules: fastRules,
    random,
  });
}

function typeWord(game, word) {
  for (const character of word) game.typeCharacter(character);
}

test("bundled word and wave configuration is valid and bounded", () => {
  assert.equal(validateGameConfig(), true);
  assert.equal(validateGameConfig({ wordTiers: [["Not-lowercase"]] }), false);
  assert.equal(getWaveConfig(999), getWaveConfig(8));
  assert.ok(WORD_TIERS.every((tier) => tier.every((word) => word.length <= 9)));
});

test("session lifecycle pauses time, transitions waves, and replay resets all counters", () => {
  const game = gameHarness();
  assert.equal(game.getSnapshot().phase, "ready");
  game.start();
  assert.equal(game.getSnapshot().phase, "playing");
  assert.equal(game.pause(), true);
  game.tick(100);
  assert.equal(game.getSnapshot().elapsedMs, 0);
  assert.equal(game.resume(), true);

  game.spawnTarget();
  typeWord(game, "cat");
  assert.equal(game.getSnapshot().phase, "wave-transition");
  game.tick(100);
  assert.equal(game.getSnapshot().wave, 2);
  assert.equal(game.getSnapshot().phase, "playing");

  game.replay();
  const replayed = game.getSnapshot();
  assert.equal(replayed.wave, 1);
  assert.equal(replayed.score, 0);
  assert.equal(replayed.destroyedTargets, 0);
  assert.equal(replayed.targets.length, 0);
});

test("spawning keeps target initials distinct and defers when no word is suitable", () => {
  assert.equal(selectDistinctWord(["cat", "code"], [{ word: "dog" }], () => 0), "cat");
  assert.equal(selectDistinctWord(["cat", "code"], [{ word: "cab" }], () => 0), null);

  const game = gameHarness({ words: ["cat", "code"] });
  game.start();
  assert.equal(game.spawnTarget().word, "cat");
  assert.equal(game.spawnTarget(), null);
  assert.ok(game.drainEvents().some((event) => event.type === "spawn-deferred"));
});

test("typing locks a target, preserves progress on mistakes, and destroys on completion", () => {
  const game = gameHarness({ wave: testWave({ requiredKills: 3 }) });
  game.start();
  game.spawnTarget();
  assert.equal(game.typeCharacter("C"), true);
  assert.equal(game.getSnapshot().lockedTargetId, 1);
  assert.equal(game.getSnapshot().targets[0].progress, 1);

  assert.equal(game.typeCharacter("x"), false);
  assert.equal(game.getSnapshot().targets[0].progress, 1);
  assert.equal(game.getSnapshot().mistakes, 1);
  game.typeCharacter("a");
  game.typeCharacter("t");

  const state = game.getSnapshot();
  assert.equal(state.destroyedTargets, 1);
  assert.equal(state.targets.length, 0);
  assert.equal(state.lockedTargetId, null);
  assert.ok(game.drainEvents().some((event) => event.type === "target-destroyed"));
});

test("incorrect unlocked input counts once without selecting a target", () => {
  const game = gameHarness();
  game.start();
  game.spawnTarget();
  assert.equal(game.typeCharacter("z"), false);
  const state = game.getSnapshot();
  assert.equal(state.mistakes, 1);
  assert.equal(state.lockedTargetId, null);
});

test("escaping targets cost lives, clear locks, and the final impact ends the game", () => {
  const game = gameHarness({ wave: testWave({ maxTargets: 1, requiredKills: 10 }) });
  game.start();
  for (let life = fastRules.initialLives; life > 0; life -= 1) {
    game.spawnTarget();
    game.typeCharacter("c");
    game.tick(100);
    game.tick(100);
    assert.equal(game.getSnapshot().lives, life - 1);
  }
  const state = game.getSnapshot();
  assert.equal(state.phase, "game-over");
  assert.equal(state.lockedTargetId, null);
  assert.equal(state.targets.length, 0);
});

test("streak multiplier is bounded and a mistake resets it", () => {
  const game = gameHarness({ wave: testWave({ requiredKills: 99 }) });
  game.start();
  for (let index = 0; index < 15; index += 1) {
    game.spawnTarget();
    typeWord(game, "cat");
  }
  assert.equal(game.getSnapshot().multiplier, 5);
  game.spawnTarget();
  game.typeCharacter("z");
  assert.equal(game.getSnapshot().multiplier, 1);
  assert.equal(game.getSnapshot().streak, 0);
});

test("accuracy and WPM use correct character attempts and active elapsed time", () => {
  assert.equal(calculateAccuracy(9, 1), 90);
  assert.equal(calculateAccuracy(0, 0), 100);
  assert.equal(calculateWpm(50, 60_000), 10);

  const game = gameHarness({ wave: testWave({ speed: 0.001, requiredKills: 5 }) });
  game.start();
  game.tick(100);
  game.spawnTarget();
  game.typeCharacter("c");
  game.typeCharacter("x");
  assert.equal(game.getSnapshot().accuracy, 50);
  assert.ok(game.getSnapshot().wpm > 0);
});
