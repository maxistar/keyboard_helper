import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createBrowserTypingInvaders } from "../src/typing_invaders/browser.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class EventTargetStub {
  constructor() { this.listeners = new Map(); this.hidden = false; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function harness(gameOptions = {}) {
  const windowTarget = new EventTargetStub();
  const documentTarget = new EventTargetStub();
  const rendered = [];
  let frameCallback;
  let cancelledFrame = null;
  const view = {
    action: null,
    render(snapshot, events) { rendered.push({ snapshot, events }); },
    setActionHandler(handler) { this.action = handler; },
  };
  const session = createBrowserTypingInvaders({
    windowTarget,
    documentTarget,
    gameOptions,
    viewFactory: () => view,
    requestFrame(callback) { frameCallback = callback; return 7; },
    cancelFrame(id) { cancelledFrame = id; },
  });
  return { ...session, cancelledFrame: () => cancelledFrame, documentTarget, frameCallback: () => frameCallback, rendered, view, windowTarget };
}

const singleWave = () => ({ tier: 0, speed: 0.01, spawnIntervalMs: 1000, maxTargets: 3, requiredKills: 99 });

test("browser entry starts the shared arcade game and evaluates focused letters once", () => {
  const subject = harness({ wordTiers: [["cat"]], resolveWave: singleWave });
  assert.equal(subject.game.getSnapshot().phase, "ready");
  subject.view.action();
  assert.equal(subject.game.getSnapshot().phase, "playing");
  assert.equal(subject.game.getSnapshot().wave, 1);
  assert.equal(subject.game.spawnTarget().word, "cat");

  for (const key of "cat") {
    let prevented = 0;
    subject.windowTarget.dispatch("keydown", { key, preventDefault() { prevented += 1; } });
    assert.equal(prevented, 1);
  }
  const snapshot = subject.game.getSnapshot();
  assert.equal(snapshot.destroyedTargets, 1);
  assert.equal(snapshot.correctChars, 3);
  assert.ok(snapshot.score > 0);
  assert.ok(subject.rendered.at(-1).events.some((event) => event.type === "target-destroyed"));
  subject.destroy();
  assert.equal(subject.cancelledFrame(), 7);
});

test("browser game pauses and resumes for Escape, blur, and hidden-page visibility", () => {
  const subject = harness({ wordTiers: [["cat"]], resolveWave: singleWave });
  subject.view.action();
  subject.windowTarget.dispatch("keydown", { key: "Escape", preventDefault() {} });
  assert.equal(subject.game.getSnapshot().phase, "paused");
  subject.view.action();
  assert.equal(subject.game.getSnapshot().phase, "playing");

  subject.windowTarget.dispatch("blur");
  assert.equal(subject.game.getSnapshot().phase, "paused");
  subject.view.action();
  subject.documentTarget.hidden = true;
  subject.documentTarget.dispatch("visibilitychange");
  assert.equal(subject.game.getSnapshot().phase, "paused");
  subject.destroy();
  assert.equal(subject.windowTarget.listeners.get("keydown").size, 0);
});

test("browser game replays from game over with a fresh session", () => {
  const subject = harness({
    wordTiers: [["cat"]],
    resolveWave: () => ({ tier: 0, speed: 1, spawnIntervalMs: 100, maxTargets: 1, requiredKills: 99 }),
    rules: { initialLives: 1, defenseLine: 0.01, maxTickMs: 100, waveTransitionMs: 100, minSpawnX: 0.1, maxSpawnX: 0.9 },
    random: () => 0,
  });
  subject.view.action();
  subject.game.spawnTarget();
  subject.game.tick(100);
  assert.equal(subject.game.getSnapshot().phase, "game-over");
  subject.view.action();
  const replay = subject.game.getSnapshot();
  assert.equal(replay.phase, "playing");
  assert.equal(replay.wave, 1);
  assert.equal(replay.score, 0);
  assert.equal(replay.targets.length, 0);
  subject.destroy();
});

test("browser entry has no Tauri, desktop configuration, lesson, or analytics dependency", async () => {
  const source = await readFile(path.join(root, "src/typing_invaders/browser.js"), "utf8");
  assert.match(source, /createTypingInvadersGame/);
  assert.match(source, /createTypingInvadersView/);
  assert.match(source, /createTypingInvadersController/);
  assert.doesNotMatch(source, /__TAURI__|read_config_state|typing_analytics|typing_lessons|secondary_window_ready/);
});
