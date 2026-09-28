import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAnalyticsReport,
  classifyPair,
  createBackgroundAnalytics,
  histogramPercentile,
  latencyBucketIndex,
  mergePeriodRows,
  normalizeAnalyticsSettings,
} from "../src/typing_analytics.js";
import { createExerciseAnalytics } from "../src/typing_invaders/exercise_analytics.js";

const down = (code) => ({ kind: "key", source: "system", action: "down", code });
const up = (code) => ({ kind: "key", source: "system", action: "up", code });

test("analytics settings are independent and disabled by default", () => {
  assert.deepEqual(normalizeAnalyticsSettings(), { exercise: false, background: false });
  assert.deepEqual(normalizeAnalyticsSettings({ exercise: true }), { exercise: true, background: false });
  assert.deepEqual(normalizeAnalyticsSettings({ background: true }), { exercise: false, background: true });
  assert.deepEqual(normalizeAnalyticsSettings({ exercise: true, background: true }), { exercise: true, background: true });
});

test("background aggregation counts keys and transitions without raw text", async () => {
  let clock = 100;
  const records = [];
  const analytics = createBackgroundAnalytics({
    settings: { background: true }, now: () => clock,
    context: () => ({ layout: "qwerty", language: "en" }),
    write: async (record) => records.push(record),
  });
  analytics.handle(down("KeyA")); analytics.handle(up("KeyA"));
  clock = 200;
  analytics.handle(down("KeyS"));
  await Promise.resolve();
  assert.deepEqual(records.map((record) => record.type), ["key", "key", "pair"]);
  assert.equal(records[2].latencyMs, 100);
  assert.equal(records.some((record) => Object.hasOwn(record, "character") || Object.hasOwn(record, "text")), false);
});

test("background analytics ignores BLE events entirely", async () => {
  const records = [];
  const analytics = createBackgroundAnalytics({ settings: { background: true }, write: async (record) => records.push(record) });
  assert.equal(analytics.handle({ kind: "key", source: "ble", action: "down", position: 1, layer: 0 }), false);
  await Promise.resolve();
  assert.deepEqual(records, []);
});

test("idle boundary, autorepeat, suspension, context changes, and disable reset chains", async () => {
  let clock = 0;
  let layout = "qwerty";
  const records = [];
  const analytics = createBackgroundAnalytics({
    settings: { background: true }, now: () => clock,
    context: () => ({ layout, language: "en" }), write: async (record) => records.push(record),
  });
  analytics.handle(down("KeyA"));
  clock = 100; analytics.handle(down("KeyA"));
  analytics.handle(up("KeyA")); clock = 2_000; analytics.handle(down("KeyS"));
  analytics.handle(up("KeyS")); clock = 4_001; analytics.handle(down("KeyD"));
  analytics.handle(up("KeyD")); layout = "corne"; clock = 4_100; analytics.handle(down("KeyF"));
  analytics.setSuspended(true); analytics.setSuspended(false); clock = 4_200; analytics.handle(down("KeyG"));
  analytics.setEnabled(false); analytics.setEnabled(true); clock = 4_300; analytics.handle(down("KeyH"));
  await Promise.resolve();
  const pairs = records.filter((record) => record.type === "pair");
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].fromCode, pairs[0].toCode], ["KeyA", "KeyS"]);
});

test("modifiers and correction episodes follow privacy rules", async () => {
  let clock = 0;
  const records = [];
  const analytics = createBackgroundAnalytics({ settings: { background: true }, now: () => clock, write: async (record) => records.push(record) });
  analytics.handle(down("KeyA")); analytics.handle(up("KeyA"));
  clock = 100; analytics.handle(down("KeyS")); analytics.handle(up("KeyS"));
  clock = 150; analytics.handle(down("Backspace")); analytics.handle(up("Backspace"));
  clock = 180; analytics.handle(down("Backspace")); analytics.handle(up("Backspace"));
  analytics.handle(down("ControlLeft")); analytics.handle(down("Backspace")); analytics.handle(up("Backspace")); analytics.handle(up("ControlLeft"));
  analytics.handle(down("ShiftLeft")); clock = 300; analytics.handle(down("KeyD")); analytics.handle(up("KeyD")); analytics.handle(up("ShiftLeft"));
  await Promise.resolve();
  assert.equal(records.filter((record) => record.type === "correction").length, 1);
  assert.equal(records.some((record) => record.fromCode === "ControlLeft" || record.toCode === "ShiftLeft"), false);
});

test("classification uses histogram medians and exact sample boundaries", () => {
  assert.equal(latencyBucketIndex(50), 0);
  assert.equal(latencyBucketIndex(2_001), 12);
  assert.equal(histogramPercentile([0, 2, 1], 0.5), 75);
  assert.equal(classifyPair({ sampleCount: 29, medianMs: 150, baselineMedianMs: 100 }).state, "insufficient-data");
  assert.equal(classifyPair({ sampleCount: 30, medianMs: 150, baselineMedianMs: 100 }).state, "slow");
  assert.equal(classifyPair({ sampleCount: 30, medianMs: 149, baselineMedianMs: 100 }).state, "typical");
  assert.equal(classifyPair({ sampleCount: 30, medianMs: 100, baselineMedianMs: null }).state, "baseline-unavailable");
});

test("reports expose aggregates and privacy omissions", () => {
  const histogram = Array(13).fill(0); histogram[2] = 30;
  const report = buildAnalyticsReport({
    settings: { background: true }, from: "2026-09-01", to: "2026-09-28",
    rows: [{ type: "pair", sampleCount: 30, histogram, fromCode: "KeyA", toCode: "KeyS" }],
  });
  assert.equal(report.rows[0].classification.state, "typical");
  assert.ok(report.omittedData.includes("background characters and words"));
  assert.equal(JSON.stringify(report).includes("application names"), true);
});

test("AltGr typing is a modifier: no key count, no pair, and no chain break", async () => {
  let clock = 0;
  const records = [];
  const analytics = createBackgroundAnalytics({ settings: { background: true }, now: () => clock, write: async (record) => records.push(record) });
  analytics.handle(down("KeyA")); analytics.handle(up("KeyA"));
  clock = 100; analytics.handle(down("AltGr"));
  clock = 150; analytics.handle(down("KeyQ")); analytics.handle(up("KeyQ")); analytics.handle(up("AltGr"));
  await Promise.resolve();
  assert.equal(records.some((record) => [record.code, record.fromCode, record.toCode].includes("AltGr")), false);
  assert.deepEqual(records.filter((record) => record.type === "pair").map(({ fromCode, toCode }) => [fromCode, toCode]), [["KeyA", "KeyQ"]]);
});

test("reports merge daily rows so the 30-observation threshold applies to the whole period", () => {
  const dayRow = (day, bucket, count, fromCode = "KeyA", toCode = "KeyS") => {
    const histogram = Array(13).fill(0); histogram[bucket] = count;
    return { day, type: "pair", collectionType: "background", layout: "qwerty", language: "en", fromCode, toCode,
      sampleCount: count, correctionCount: 1, latencySumMs: count * 100, histogram };
  };
  const rows = [
    dayRow("2026-09-01", 5, 10), dayRow("2026-09-02", 5, 10), dayRow("2026-09-03", 5, 10),
    dayRow("2026-09-01", 2, 60, "KeyD", "KeyF"),
  ];
  const merged = mergePeriodRows(rows);
  assert.equal(merged.length, 2);
  const slowPair = merged.find((row) => row.fromCode === "KeyA");
  assert.equal(slowPair.sampleCount, 30);
  assert.equal(slowPair.correctionCount, 3);
  assert.deepEqual(slowPair.days, ["2026-09-01", "2026-09-02", "2026-09-03"]);

  const report = buildAnalyticsReport({ settings: { background: true }, rows, from: "2026-09-01", to: "2026-09-03" });
  const reported = report.rows.find((row) => row.fromCode === "KeyA");
  assert.equal(reported.sampleCount, 30);
  assert.equal(reported.medianMs, 200);
  assert.equal(reported.baselineMedianMs, 100);
  assert.equal(reported.classification.state, "slow");

  const partial = buildAnalyticsReport({ settings: { background: true }, rows: rows.slice(0, 2).concat(rows[3]) });
  assert.equal(partial.rows.find((row) => row.fromCode === "KeyA").classification.state, "insufficient-data");
});

test("reports derive aggregate exercise WPM and accuracy across sessions and days", () => {
  const session = (day, exercise) => ({ day, type: "session", collectionType: "exercise", layout: "qwerty", language: "unknown",
    fromCode: "", toCode: "", sampleCount: exercise.sessionCount, exercise: { game: "typing-invaders", ...exercise } });
  const report = buildAnalyticsReport({ settings: { exercise: true }, rows: [
    session("2026-09-01", { sessionCount: 1, correctCharacters: 50, mistakes: 5, activeDurationMs: 60_000, highestWave: 2, totalScore: 10 }),
    session("2026-09-02", { sessionCount: 2, correctCharacters: 25, mistakes: 0, activeDurationMs: 30_000, highestWave: 4, totalScore: 5 }),
  ] });
  assert.equal(report.rows.length, 1);
  const { exercise } = report.rows[0];
  assert.equal(exercise.sessionCount, 3);
  assert.equal(exercise.highestWave, 4);
  assert.equal(exercise.wpm, 10);
  assert.equal(Math.round(exercise.accuracy * 100) / 100, 93.75);
});

function exerciseHarness({ enabled, focused = true }) {
  const ownership = [];
  const records = [];
  let hasFocus = focused;
  const analytics = createExerciseAnalytics({
    enabled, layout: "qwerty", hasFocus: () => hasFocus,
    emitOwnership: (payload) => ownership.push(payload.active),
    record: async (record) => records.push(record),
    wallClock: () => new Date(2026, 8, 28, 12),
  });
  return { analytics, ownership, records, setFocus(value) { hasFocus = value; } };
}

const playing = (overrides = {}) => ({ phase: "playing", elapsedMs: 0, score: 0, highestWave: 1, destroyedTargets: 0,
  correctChars: 0, mistakes: 0, accuracy: 100, wpm: 0, ...overrides });

test("exercise ownership is published on play, focus loss, and exit regardless of the exercise setting", () => {
  for (const enabled of [false, true]) {
    const h = exerciseHarness({ enabled });
    h.analytics.onSnapshot({ ...playing(), phase: "ready" }, []);
    h.analytics.onSnapshot(playing(), [{ type: "session-started" }]);
    h.setFocus(false);
    h.analytics.onSnapshot(playing(), []);
    h.setFocus(true);
    h.analytics.onSnapshot(playing(), []);
    h.analytics.onSnapshot({ ...playing(), phase: "destroyed" }, []);
    assert.deepEqual(h.ownership, [true, false, true, false], `enabled=${enabled}`);
  }
});

test("exercise sessions record aggregate and per-target metrics only when enabled", async () => {
  const run = async (enabled) => {
    const h = exerciseHarness({ enabled });
    h.analytics.onSnapshot(playing(), [{ type: "session-started" }, { type: "target-spawned", target: { id: 1, word: "moon" } },
      { type: "target-spawned", target: { id: 2, word: "star" } }]);
    h.analytics.onSnapshot(playing({ elapsedMs: 800 }), [{ type: "mistake", targetId: 1 }, { type: "target-destroyed", targetId: 1 }]);
    const writes = h.analytics.onSnapshot(
      { ...playing({ elapsedMs: 2_000, score: 40, destroyedTargets: 1, correctChars: 4, mistakes: 1, accuracy: 80, wpm: 24 }), phase: "game-over" },
      [{ type: "game-over", score: 40 }],
    );
    h.analytics.onSnapshot({ ...playing(), phase: "game-over" }, [{ type: "game-over" }]);
    await Promise.all(writes);
    return h.records;
  };
  assert.deepEqual(await run(false), []);
  const records = await run(true);
  assert.deepEqual(records.map((record) => record.type), ["exercise", "exerciseTarget", "exerciseTarget"]);
  assert.equal(records[0].day, "2026-09-28");
  assert.deepEqual(records[0].context, { layout: "qwerty", language: "unknown" });
  assert.equal(records[0].exercise.correctCharacters, 4);
  assert.equal(records[0].exercise.mistakes, 1);
  assert.deepEqual(records.slice(1).map(({ code, latencyMs, exercise }) => [code, latencyMs, exercise]), [
    ["moon", 800, { mistakes: 1, completed: true }],
    ["star", null, { mistakes: 0, completed: false }],
  ]);
});
