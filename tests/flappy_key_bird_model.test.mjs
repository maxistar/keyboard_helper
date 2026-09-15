import test from "node:test";
import assert from "node:assert/strict";
import { FLAPPY_CONFIG } from "../src/flappy_key_bird/config.js";
import { createFlappyGame, createFlappyGameFromSources } from "../src/flappy_key_bird/model.js";

function configWith(overrides = {}) {
  return {
    ...FLAPPY_CONFIG,
    width: 1000,
    height: 1000,
    birdX: 100,
    birdRadius: 5,
    initialBirdY: 500,
    fixedStepMs: 10,
    maximumFrameMs: 1000,
    gravity: 100,
    impulseVelocity: -100,
    maximumUpwardVelocity: -150,
    gateWidth: 20,
    gateGap: 900,
    gateSpeed: 0,
    gateSpacing: 300,
    initialGateX: 500,
    targetActivationX: 800,
    minimumGapCenter: 500,
    maximumGapCenter: 500,
    initialGateCount: 2,
    targets: ["ab"],
    ...overrides,
  };
}

test("fixed-step physics is equivalent across render cadences and clamps delayed frames", async () => {
  const config = configWith();
  const frequent = createFlappyGame({ config, random: () => 0.5 });
  const batched = createFlappyGame({ config, random: () => 0.5 });
  await frequent.start();
  await batched.start();

  for (let index = 0; index < 10; index += 1) frequent.tick(10);
  batched.tick(100);
  assert.equal(frequent.getSnapshot().bird.y, batched.getSnapshot().bird.y);
  assert.equal(frequent.getSnapshot().bird.velocity, batched.getSnapshot().bird.velocity);

  const clamped = createFlappyGame({ config: configWith({ maximumFrameMs: 30 }) });
  await clamped.start();
  assert.equal(clamped.tick(1000), 3);
});

test("correct sequence tokens flap with a velocity cap while mistakes preserve progress", async () => {
  const game = createFlappyGame({ config: configWith({ gravity: 0 }) });
  await game.start();

  assert.equal(game.input("a").matched, true);
  assert.equal(game.getSnapshot().bird.velocity, -100);
  assert.equal(game.input("x").matched, false);
  assert.equal(game.getSnapshot().bird.velocity, -100);
  assert.equal(game.getSnapshot().targetProgress, 1);
  assert.equal(game.input("b").complete, true);

  const snapshot = game.getSnapshot();
  assert.equal(snapshot.bird.velocity, -150);
  assert.equal(snapshot.correct, 2);
  assert.equal(snapshot.mistakes, 1);
  assert.equal(snapshot.accuracy, 2 / 3);
  assert.equal(snapshot.gates[0].cleared, true);
});

test("a cleared target repeats for lift without duplicate score until the next gate activates", async () => {
  const game = createFlappyGame({
    config: configWith({
      width: 10000,
      height: 10000,
      initialBirdY: 5000,
      maximumFrameMs: 10000,
      gateGap: 10000,
      gateSpeed: 100,
      gateSpacing: 900,
      minimumGapCenter: 5000,
      maximumGapCenter: 5000,
      targets: ["ab", "cd"],
    }),
  });
  await game.start();

  game.input("a");
  game.input("b");
  let snapshot = game.getSnapshot();
  assert.equal(snapshot.gates[0].cleared, true);
  assert.equal(snapshot.repeatingTarget, true);
  assert.deepEqual(snapshot.target, ["a", "b"]);
  assert.equal(snapshot.targetProgress, 0);
  assert.match(snapshot.feedback, /Repeat ab/);

  game.tick(1600);
  assert.equal(game.getSnapshot().bird.velocity, 10);
  game.input("a");
  assert.equal(game.getSnapshot().bird.velocity, -100);
  game.input("x");
  assert.equal(game.getSnapshot().targetProgress, 1);
  game.input("b");

  snapshot = game.getSnapshot();
  assert.equal(snapshot.repeatingTarget, true);
  assert.equal(snapshot.targetProgress, 0);
  assert.equal(snapshot.correct, 4);
  assert.equal(snapshot.mistakes, 1);
  assert.equal(snapshot.accuracy, 4 / 5);
  assert.equal(snapshot.score, 0);
  assert.equal(snapshot.clearedGates, 0);

  game.tick(4400);
  snapshot = game.getSnapshot();
  assert.equal(snapshot.repeatingTarget, false);
  assert.deepEqual(snapshot.target, ["c", "d"]);
  assert.equal(snapshot.score, 100);
  assert.equal(snapshot.clearedGates, 1);
});

test("cleared gates score with a bounded streak multiplier", async () => {
  const game = createFlappyGame({
    config: configWith({
      height: 300,
      initialBirdY: 150,
      gravity: 0,
      impulseVelocity: 0,
      maximumUpwardVelocity: 0,
      fixedStepMs: 100,
      gateWidth: 10,
      gateGap: 300,
      gateSpeed: 100,
      gateSpacing: 30,
      initialGateX: 90,
      targetActivationX: 200,
      minimumGapCenter: 150,
      maximumGapCenter: 150,
      initialGateCount: 3,
      targets: ["a"],
      pointsPerGate: 100,
      gatesPerMultiplier: 2,
      maximumMultiplier: 3,
    }),
  });
  await game.start();

  game.input("a");
  game.tick(100);
  game.input("a");
  game.tick(300);
  game.input("a");
  game.tick(300);

  const snapshot = game.getSnapshot();
  assert.equal(snapshot.phase, "playing");
  assert.equal(snapshot.clearedGates, 3);
  assert.equal(snapshot.streak, 3);
  assert.equal(snapshot.bestStreak, 3);
  assert.equal(snapshot.multiplier, 2);
  assert.equal(snapshot.score, 400);
});

test("an unresolved passed gate records a miss and ends the run", async () => {
  const game = createFlappyGame({
    config: configWith({
      height: 300,
      initialBirdY: 150,
      gravity: 0,
      fixedStepMs: 100,
      gateWidth: 10,
      gateGap: 300,
      gateSpeed: 100,
      initialGateX: 90,
      targetActivationX: 200,
      minimumGapCenter: 150,
      maximumGapCenter: 150,
    }),
  });
  await game.start();
  game.tick(100);
  const snapshot = game.getSnapshot();
  assert.equal(snapshot.phase, "game-over");
  assert.equal(snapshot.failureReason, "missed-gate");
  assert.equal(snapshot.misses, 1);
});

test("gate and playfield collisions stop simulation", async () => {
  const gateCollision = createFlappyGame({
    config: configWith({
      height: 300,
      initialBirdY: 50,
      gravity: 0,
      gateWidth: 20,
      gateGap: 40,
      initialGateX: 95,
      targetActivationX: 200,
      minimumGapCenter: 150,
      maximumGapCenter: 150,
    }),
  });
  await gateCollision.start();
  gateCollision.tick(10);
  assert.equal(gateCollision.getSnapshot().failureReason, "gate-collision");
  assert.equal(gateCollision.tick(100), 0);

  const boundaryCollision = createFlappyGame({
    config: configWith({ initialBirdY: 5, gravity: 0 }),
  });
  await boundaryCollision.start();
  boundaryCollision.tick(10);
  assert.equal(boundaryCollision.getSnapshot().failureReason, "boundary-collision");
});

test("replay re-resolves provider targets and resets the complete run", async () => {
  let calls = 0;
  const game = await createFlappyGameFromSources({
    config: configWith({ initialBirdY: 5, gravity: 0 }),
    bundledTargets: ["z"],
    targetProvider: {
      async getTargets() {
        calls += 1;
        return calls === 1 ? ["a"] : ["b"];
      },
    },
  });

  await game.start();
  assert.deepEqual(game.getSnapshot().target, ["a"]);
  game.input("x");
  game.tick(10);
  assert.equal(game.getSnapshot().phase, "game-over");
  await game.replay();

  const replay = game.getSnapshot();
  assert.equal(calls, 2);
  assert.equal(replay.phase, "playing");
  assert.deepEqual(replay.target, ["b"]);
  assert.equal(replay.mistakes, 0);
  assert.equal(replay.misses, 0);
  assert.equal(replay.score, 0);
  assert.equal(replay.bird.y, 5);
});
