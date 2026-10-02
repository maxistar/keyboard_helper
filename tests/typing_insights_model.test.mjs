import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildDailyExerciseSeries } from "../src/typing_analytics.js";
import { EN_WORDS } from "../src/typing_insights/dictionaries/en.js";
import { RU_WORDS } from "../src/typing_insights/dictionaries/ru.js";
import {
  buildInsights,
  buildPeriodView,
  correctionHotspots,
  exerciseErrorHotspots,
  keyHeatmap,
  practiceSuggestions,
} from "../src/typing_insights/model.js";
import {
  dictionaryLanguageForSource,
  KEY_LETTERS,
  pairReadings,
  practiceWords,
} from "../src/typing_insights/readings.js";

const layout = async (name) => JSON.parse(await readFile(new URL(`../src/layout_${name}.json`, import.meta.url), "utf8"));

function histogramAt(bucket, count) {
  const histogram = Array(13).fill(0);
  histogram[bucket] = count;
  return histogram;
}

function pair(fromCode, toCode, { day = "2026-09-01", bucket = 2, count = 30, corrections = 0, language = "unknown", layout: layoutKey = "qwerty" } = {}) {
  return {
    day, type: "pair", collectionType: "background", layout: layoutKey, language, fromCode, toCode,
    sampleCount: count, correctionCount: corrections, latencySumMs: 0, histogram: histogramAt(bucket, count),
  };
}

test("dictionary language mapping recognises English and Russian sources on every platform", () => {
  const cases = [
    ["com.apple.keylayout.US", "en"], ["com.apple.keylayout.ABC", "en"], ["com.apple.keylayout.British", "en"],
    ["com.apple.keylayout.Russian", "ru"], ["com.apple.keylayout.RussianWin", "ru"], ["com.apple.keylayout.German", null],
    ["xkb:layout:us", "en"], ["xkb:layout:gb:extd", "en"], ["xkb:layout:ru", "ru"], ["xkb:layout:ru:phonetic", "ru"],
    ["xkb:layout:de", null], ["xkb:group:1", null],
    ["windows:klid:00000409", "en"], ["windows:klid:00000809", "en"], ["windows:klid:00010409", "en"],
    ["windows:klid:00000419", "ru"], ["windows:klid:00000407", null],
    ["unknown", null], ["", null], [null, null],
  ];
  for (const [id, expected] of cases) assert.equal(dictionaryLanguageForSource(id), expected, String(id));
});

test("key-code tables map letters in both readings and ignore non-letter keys", () => {
  assert.equal(KEY_LETTERS.en.KeyT, "t");
  assert.equal(KEY_LETTERS.ru.KeyT, "е");
  assert.equal(KEY_LETTERS.ru.SemiColon, "ж");
  assert.equal(KEY_LETTERS.ru.BackQuote, "ё");
  assert.equal(KEY_LETTERS.en.SemiColon, undefined);
  assert.equal(KEY_LETTERS.en.Space, undefined);
  assert.equal(Object.keys(KEY_LETTERS.en).length, 26);
  assert.equal(Object.keys(KEY_LETTERS.ru).length, 33);
  assert.equal(new Set(Object.values(KEY_LETTERS.ru)).size, 33);
});

test("bundled dictionaries hold 5,000 unique lower-case words of their alphabet", () => {
  for (const [words, pattern] of [[EN_WORDS, /^[a-z]{2,}$/], [RU_WORDS, /^[а-яё]{2,}$/]]) {
    assert.equal(words.length, 5000);
    assert.equal(new Set(words).size, 5000);
    assert.equal(words.every((word) => pattern.test(word)), true);
  }
  assert.ok(EN_WORDS.indexOf("the") < EN_WORDS.indexOf("weather"));
});

test("pair readings show both languages unless the recorded language is known", () => {
  assert.deepEqual(pairReadings({ fromCode: "KeyT", toCode: "KeyH", language: "unknown" }), [
    { language: "en", letters: "th" }, { language: "ru", letters: "ер" },
  ]);
  assert.deepEqual(pairReadings({ fromCode: "KeyT", toCode: "KeyH", language: "xkb:layout:ru" }), [{ language: "ru", letters: "ер" }]);
  assert.deepEqual(pairReadings({ fromCode: "KeyT", toCode: "KeyH", language: "windows:klid:00000409" }), [{ language: "en", letters: "th" }]);
  assert.deepEqual(pairReadings({ fromCode: "KeyL", toCode: "SemiColon", language: "unknown" }), [{ language: "ru", letters: "дж" }]);
  assert.deepEqual(pairReadings({ fromCode: "Space", toCode: "KeyA", language: "unknown" }), []);
  assert.deepEqual(practiceWords(["other", "the", "then", "zzz"], "th", 2), ["other", "the"]);
  assert.deepEqual(practiceWords(EN_WORDS, "qz"), []);
});

test("period view keeps analytics thresholds while the minimum sample count only hides ranked pairs", () => {
  const rows = [
    pair("KeyA", "KeyS", { day: "2026-09-01", bucket: 5, count: 20 }),
    pair("KeyA", "KeyS", { day: "2026-09-02", bucket: 5, count: 20 }),
    pair("KeyD", "KeyF", { bucket: 2, count: 100 }),
    { day: "2026-09-01", type: "key", collectionType: "background", layout: "qwerty", language: "unknown", fromCode: "KeyA", toCode: "", sampleCount: 12 },
  ];
  const view = buildPeriodView({ rows, filters: { minSamples: 50 } });
  assert.equal(view.coverage.pairSamples, 140);
  assert.equal(view.coverage.keyPresses, 12);
  assert.equal(view.coverage.hiddenByMinimum, 1);
  assert.deepEqual(view.rankedPairs.map((row) => row.fromCode), ["KeyD"]);
  const merged = view.pairs.find((row) => row.fromCode === "KeyA");
  assert.equal(merged.sampleCount, 40);
  assert.equal(merged.classification.state, "slow");

  const filtered = buildPeriodView({ rows: [...rows, pair("KeyQ", "KeyW", { layout: "corne" })], filters: { layout: "corne" } });
  assert.deepEqual(filtered.pairs.map((row) => row.fromCode), ["KeyQ"]);
});

test("daily exercise series fills empty days and respects filters", () => {
  const session = (day, layoutKey, correctCharacters) => ({ day, type: "session", collectionType: "exercise", layout: layoutKey, language: "unknown",
    exercise: { sessionCount: 1, correctCharacters, mistakes: 0, activeDurationMs: 60_000 } });
  const rows = [session("2026-09-01", "qwerty", 50), session("2026-09-03", "qwerty", 100), session("2026-09-03", "corne", 25)];
  assert.deepEqual(buildDailyExerciseSeries({ rows, from: "2026-09-01", to: "2026-09-03" }), [
    { day: "2026-09-01", sessionCount: 1, wpm: 10, accuracy: 100 },
    { day: "2026-09-02", sessionCount: 0, wpm: null, accuracy: null },
    { day: "2026-09-03", sessionCount: 2, wpm: 12.5, accuracy: 100 },
  ]);
  assert.deepEqual(buildDailyExerciseSeries({ rows, filters: { layout: "corne" } }).map(({ day, wpm }) => [day, wpm]), [["2026-09-03", 5]]);
  assert.deepEqual(buildDailyExerciseSeries({ rows, filters: { collectionType: "background" } }), []);
});

test("heatmap maps incoming-pair latency onto single base-layer positions", async () => {
  const qwerty = await layout("qwerty");
  const corne = await layout("corne");
  const pairs = [
    { ...pair("KeyA", "KeyT", { bucket: 7, count: 30 }) },
    { ...pair("KeyA", "KeyS", { bucket: 2, count: 90 }) },
    { ...pair("KeyA", "F1", { bucket: 2, count: 40 }) },
    { ...pair("KeyA", "KeyE", { bucket: 7, count: 29 }) },
  ];
  const onQwerty = keyHeatmap(pairs, qwerty);
  assert.equal(onQwerty.baselineMs, 100);
  const keyT = onQwerty.keys.find((key) => key.code === "KeyT");
  assert.deepEqual(keyT, { code: "KeyT", sampleCount: 30, medianMs: 500, ratio: 5, position: 42 });
  assert.equal(onQwerty.keys.find((key) => key.code === "KeyE").ratio, null);

  const onCorne = keyHeatmap(pairs, corne);
  assert.deepEqual(onCorne.unmapped.map(({ code, reason }) => [code, reason]), [["F1", "not-on-base-layer"]]);
  assert.equal(onCorne.keys.find((key) => key.code === "KeyT").position, 5);

  const duplicated = { name: "Dup", keySize: { w: 1, h: 1 }, keyPositions: [{ row: 0, col: 0 }, { row: 0, col: 1 }],
    keyLayers: { base: [["a", "KeyA"], ["a", "KeyA"]] } };
  assert.deepEqual(keyHeatmap([pair("KeyS", "KeyA")], duplicated).unmapped.map((key) => key.reason), ["multiple-positions"]);
});

test("hotspots keep passive corrections and exercise errors apart", () => {
  const view = buildPeriodView({ rows: [pair("KeyT", "KeyH", { corrections: 6 }), pair("KeyA", "KeyS", { corrections: 0 }),
    { day: "2026-09-01", type: "target", collectionType: "exercise", layout: "qwerty", language: "unknown", fromCode: "moon", toCode: "",
      sampleCount: 4, correctionCount: 3, exercise: { completedCount: 2 } }] });
  const corrections = correctionHotspots(view.rankedPairs);
  assert.deepEqual(corrections.map(({ kind, label, fromCode, rate }) => [kind, label, fromCode, rate]), [["possible-correction", "Possible correction", "KeyT", 0.2]]);
  const errors = exerciseErrorHotspots(view.report.rows);
  assert.deepEqual(errors, [{ kind: "exercise-error", label: "Exercise error", target: "moon", mistakes: 3, attempts: 4, completed: 2 }]);
  assert.equal(corrections.some((hotspot) => /error/i.test(hotspot.label)), false);
});

test("practice suggestions cite signals and list words per reading", () => {
  const dictionaries = { en: EN_WORDS, ru: RU_WORDS };
  const suggestions = practiceSuggestions({
    slow: [{ fromCode: "KeyT", toCode: "KeyH", language: "unknown", medianMs: 300, baselineMs: 100, ratio: 3, sampleCount: 40 }],
    corrections: [
      { fromCode: "KeyT", toCode: "KeyH", language: "unknown", correctionCount: 5, sampleCount: 40 },
      { fromCode: "KeyG", toCode: "KeyH", language: "xkb:layout:ru", correctionCount: 2, sampleCount: 31 },
      { fromCode: "Space", toCode: "KeyQ", language: "unknown", correctionCount: 1, sampleCount: 30 },
    ],
    exerciseErrors: [{ target: "moon", mistakes: 3, attempts: 4 }],
    dictionaries,
  });
  assert.deepEqual(suggestions.map((suggestion) => suggestion.kind), ["slow", "possible-correction", "possible-correction", "exercise-error"]);
  const [slow, ruOnly, nonLetter, exercise] = suggestions;
  assert.match(slow.signal, /median 300 ms vs baseline 100 ms/);
  assert.deepEqual(slow.readings.map((reading) => reading.language), ["en", "ru"]);
  assert.equal(slow.readings[0].words.length, 10);
  assert.ok(slow.readings[0].words.every((word) => word.includes("th")));
  assert.ok(slow.readings[1].words.every((word) => word.includes("ер")));
  assert.deepEqual(ruOnly.readings.map((reading) => [reading.language, reading.letters]), [["ru", "пр"]]);
  assert.deepEqual(nonLetter.readings, []);
  assert.match(nonLetter.signal, /possible corrections in 30 background transitions/);
  assert.equal(exercise.label, "Exercise error");
  assert.match(exercise.signal, /3 exercise errors/);
});

test("insights summary reports data availability instead of zeros", async () => {
  const empty = buildInsights({ rows: [], layoutDefinition: await layout("qwerty") });
  assert.equal(empty.empty, true);
  assert.equal(empty.summary.exerciseWpm, null);
  assert.equal(empty.summary.possibleCorrectionRate, null);

  const insights = buildInsights({
    rows: [pair("KeyT", "KeyH", { bucket: 7, count: 40, corrections: 4 }), pair("KeyA", "KeyS", { bucket: 2, count: 160 })],
    layoutDefinition: await layout("qwerty"),
    dictionaries: { en: EN_WORDS, ru: RU_WORDS },
  });
  assert.equal(insights.summary.slowPairCount, 1);
  assert.equal(insights.summary.possibleCorrectionRate, 2);
  assert.equal(insights.summary.exerciseWpm, null);
  assert.equal(insights.slowPairs[0].fromCode, "KeyT");
  assert.equal(insights.suggestions[0].readings.length, 2);
});
