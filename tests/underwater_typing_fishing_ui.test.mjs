import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createFishingView, describeFishingState } from "../src/underwater_typing_fishing/view.js";

class ElementStub {
  constructor() {
    this.textContent = "";
    this.innerHTML = "";
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.disabled = false;
    this.hidden = false;
    this.className = "";
    this.focusCalls = 0;
    this.style = { setProperty: (name, value) => { this.style[name] = String(value); } };
    this.classList = { toggle: (name, force) => { if (force && !this.className.includes(name)) this.className += ` ${name}`; } };
  }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  dispatch(type) { for (const listener of this.listeners.get(type) ?? []) listener(); }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  focus() { this.focusCalls += 1; }
  click() { this.dispatch("click"); }
}

function viewHarness() {
  const ids = [
    "fishingStage", "fishingFishLayer", "fishingStatus", "fishingTargetLabel", "fishingTargetCompleted",
    "fishingTargetRemaining", "fishingVisibleTargets", "fishingFeedback", "fishingScore", "fishingCaught",
    "fishingQuota", "fishingMistakes", "fishingAccuracy", "fishingWpm", "fishingStreak", "fishingMultiplier",
    "fishingDuration", "fishingPause", "fishingEnd", "fishingOverlay", "fishingOverlayTitle",
    "fishingOverlayDescription", "fishingRules", "fishingPrimaryAction", "fishingFinalResults", "fishingFinalScore",
    "fishingFinalCaught", "fishingFinalCorrect", "fishingFinalMistakes", "fishingFinalAccuracy", "fishingFinalWpm",
    "fishingFinalStreak", "fishingFinalDuration",
  ];
  const elements = new Map(ids.map((id) => [id, new ElementStub()]));
  const document = { body: new ElementStub(), getElementById: (id) => elements.get(id), createElement: () => new ElementStub() };
  return { elements, view: createFishingView(document) };
}

function snapshot(overrides = {}) {
  return {
    phase: "playing",
    initializing: false,
    initializationError: null,
    fish: [
      { id: 1, target: ["c", "a", "t"], progress: 1, lane: 0, hooked: true },
      { id: 2, target: ["d", "o", "g"], progress: 0, lane: 1, hooked: false },
    ],
    visibleFishLimit: 3,
    hookedFishId: 1,
    lastEvent: { type: "reel", fishId: 1, serial: 2 },
    catchQuota: 12,
    caughtFish: 3,
    score: 240,
    correct: 12,
    mistakes: 2,
    accuracy: 12 / 14,
    wpm: 31.6,
    streak: 2,
    bestStreak: 4,
    multiplier: 2,
    activeDurationMs: 62000,
    completionReason: null,
    feedback: "Hooked! Keep typing to reel it in.",
    ...overrides,
  };
}

test("view exposes fish choices, hooked progress, metrics, and scene description", () => {
  const { elements, view } = viewHarness();
  view.render(snapshot());
  assert.equal(elements.get("fishingStatus").textContent, "Fishing");
  assert.equal(elements.get("fishingTargetCompleted").textContent, "c");
  assert.equal(elements.get("fishingTargetRemaining").textContent, "at");
  assert.equal(elements.get("fishingVisibleTargets").textContent, "Visible fish: cat, dog.");
  assert.equal(elements.get("fishingFishLayer").children.length, 2);
  assert.match(elements.get("fishingStage").getAttribute("aria-label"), /Hooked target cat, 1 of 3 complete/);
  assert.equal(elements.get("fishingAccuracy").textContent, "86%");
  assert.equal(elements.get("fishingWpm").textContent, "32");
  assert.equal(elements.get("fishingDuration").textContent, "1:02");
  assert.equal(elements.get("fishingOverlay").hidden, true);
});

test("view covers ready, paused, completed, early-finished, and initialization-error states", () => {
  const { elements, view } = viewHarness();
  view.render(snapshot({ phase: "ready", fish: [], hookedFishId: null, lastEvent: null }));
  assert.equal(elements.get("fishingRules").hidden, false);
  assert.equal(elements.get("fishingPrimaryAction").textContent, "Start fishing");

  view.render(snapshot({ phase: "paused" }));
  assert.equal(elements.get("fishingOverlayTitle").textContent, "Dive paused");
  assert.equal(elements.get("fishingPrimaryAction").textContent, "Resume");

  view.render(snapshot({ phase: "finished", completionReason: "completed" }));
  assert.equal(elements.get("fishingOverlayTitle").textContent, "A brilliant catch!");
  assert.equal(elements.get("fishingFinalResults").hidden, false);
  assert.equal(elements.get("fishingFinalCaught").textContent, "3");
  assert.equal(elements.get("fishingPrimaryAction").focusCalls, 1);
  view.render(snapshot({ phase: "finished", completionReason: "completed" }));
  assert.equal(elements.get("fishingPrimaryAction").focusCalls, 1);

  view.render(snapshot());
  view.render(snapshot({ phase: "finished", completionReason: "early-finished" }));
  assert.equal(elements.get("fishingOverlayTitle").textContent, "Back to the surface");
  assert.equal(elements.get("fishingPrimaryAction").focusCalls, 2);

  view.render(snapshot({ phase: "ready", initializationError: "No compatible fish", fish: [] }));
  assert.equal(elements.get("fishingStatus").textContent, "Unavailable");
  assert.equal(elements.get("fishingRules").hidden, true);
  assert.equal(elements.get("fishingOverlayDescription").textContent, "No compatible fish");
});

test("view installs one handler for each action", () => {
  const { elements, view } = viewHarness();
  const calls = { primary: 0, pause: 0, end: 0 };
  view.setPrimaryActionHandler(() => { calls.primary += 1; });
  view.setPauseHandler(() => { calls.pause += 1; });
  view.setEndSessionHandler(() => { calls.end += 1; });
  view.render(snapshot());
  view.render(snapshot({ phase: "paused" }));
  elements.get("fishingPrimaryAction").click();
  elements.get("fishingPause").click();
  elements.get("fishingEnd").click();
  assert.deepEqual(calls, { primary: 1, pause: 1, end: 1 });
});

test("presentation includes stable live regions and comprehensive reduced-motion handling", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("../src/underwater-typing-fishing.html", import.meta.url), "utf8"),
    readFile(new URL("../src/underwater_typing_fishing/game.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="fishingVisibleTargets"[^>]*aria-live="polite"/);
  assert.match(html, /id="fishingFinalResults"/);
  assert.match(html, /id="fishingEnd"/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.fishing-light-rays, \.fishing-bubbles, \.fishing-fish/);
  assert.equal(describeFishingState({ phase: "ready" }).action, "Start fishing");
  assert.equal(describeFishingState({ phase: "paused" }).action, "Resume");
  assert.equal(describeFishingState({ phase: "finished", completionReason: "early-finished" }).results, true);
});
