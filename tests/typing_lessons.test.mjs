import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILTIN_LESSONS,
  compatibleTargets,
  createLessonCatalog,
  createLessonTargetProvider,
  createWeakSpotLesson,
  parseLessonJson,
  validateLesson,
} from "../src/typing_lessons.js";
import { createTargetMatcher, normalizeTarget, targetMetadata } from "../src/mini_games/targets.js";

const lesson = {
  id: "my-lesson", name: "My lesson", targets: [
    { id: "alpha", type: "word", value: "alpha", tags: { domain: "code", ignored: "no" } },
    { id: "symbols", type: "symbols", value: "{}" },
    { id: "layer-one", type: "layer-transition", value: "raise", layer: "raise" },
  ],
};

test("lesson schema rejects malformed IDs, duplicates, and invalid weights", () => {
  const result = validateLesson({ ...lesson, id: "Invalid", targets: [
    { id: "same", type: "word", value: "cat", weight: 0 },
    { id: "same", type: "made-up", value: "dog" },
  ] });
  assert.equal(result.valid, false);
  assert.deepEqual(result.diagnostics.map(({ code }) => code), ["lesson-id", "target-weight", "target-duplicate", "target-type"]);
  assert.equal(parseLessonJson("not JSON").valid, false);
});

test("catalog includes built-ins and keeps valid imported lessons", () => {
  const catalog = createLessonCatalog({ imported: [lesson, { id: "bad", targets: [] }] });
  assert.equal(catalog.lessons.length, BUILTIN_LESSONS.length + 1);
  assert.ok(catalog.lessons.some((entry) => entry.id === "my-lesson"));
  assert.ok(catalog.diagnostics.some((entry) => entry.code === "lesson-name"));
});

test("Invaders receives only alphabetic words and keeps stable target identity", () => {
  const parsed = validateLesson(lesson);
  const result = compatibleTargets(parsed.lesson, "invaders");
  assert.deepEqual(result.compatible.map((target) => target.id), ["alpha"]);
  assert.equal(result.diagnostics.length, 2);
  const provider = createLessonTargetProvider(parsed.lesson, { random: () => 0 });
  const target = provider.next();
  assert.equal(target.word, "alpha");
  assert.equal(target.lessonId, "my-lesson");
  assert.equal(target.targetId, "alpha");
  assert.equal(target.targetType, "word");
  assert.deepEqual(target.analyticsTags, { domain: "code" });
});

test("layout-specific targets report unavailable layout metadata", () => {
  const result = validateLesson(lesson, { layoutDefinition: { keyPositions: [{}], keyLayers: { default: [[]] } } });
  assert.equal(result.valid, true);
  assert.ok(result.diagnostics.some((entry) => entry.code === "layout-layer"));
  const catalog = createLessonCatalog({ imported: [lesson], layoutDefinition: { keyPositions: [{}], keyLayers: { default: [[]] } } });
  const imported = catalog.lessons.find((entry) => entry.id === lesson.id);
  assert.ok(imported);
  assert.ok(imported.targets.find((target) => target.id === "layer-one").unavailable);
});

test("target-specific metadata is validated without loaded layout metadata", () => {
  const result = validateLesson({
    id: "bad-metadata", name: "Bad metadata", targets: [
      { id: "position", type: "physical-position", value: "a", position: "zero" },
      { id: "layer", type: "layer-transition", value: "a" },
      { id: "combo", type: "combo", value: "a" },
    ],
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.diagnostics.map(({ code }) => code), ["target-position", "target-layer", "target-combo"]);
});

test("semantic adapters filter evidence targets and preserve identity through matching", async () => {
  const provider = createLessonTargetProvider(lesson, { mode: "snake" });
  assert.ok(provider.diagnostics.some((entry) => entry.code === "semantic-evidence"));
  const targets = await provider.getTargets();
  const normalized = normalizeTarget(targets[0]);
  assert.deepEqual(normalized, ["a", "l", "p", "h", "a"]);
  assert.deepEqual(targetMetadata(normalized), {
    lessonId: "my-lesson", targetId: "alpha", targetType: "word", analyticsTags: { domain: "code" },
  });
  const matcher = createTargetMatcher(normalized);
  let outcome;
  for (const token of normalized) outcome = matcher.input(token);
  assert.equal(outcome.complete, true);
  assert.equal(outcome.targetMetadata.targetId, "alpha");
});

test("semantic adapters preserve named keys as individual tokens", async () => {
  const sequenceLesson = validateLesson({
    id: "named-keys", name: "Named keys", targets: [
      { id: "confirm", type: "key-sequence", value: "confirm", tokens: ["Enter", "y"] },
    ],
  }).lesson;
  const provider = createLessonTargetProvider(sequenceLesson, { mode: "fishing" });
  const [target] = await provider.getTargets();
  assert.deepEqual(target.tokens, ["Enter", "y"]);
  assert.equal(provider.diagnostics.length, 0);
});

test("unknown-language weak spots require a reading while known context does not", () => {
  const pair = { fromCode: "KeyA", toCode: "KeyS", language: "unknown" };
  const pending = createWeakSpotLesson([pair]);
  assert.equal(pending.lesson, null);
  assert.equal(pending.pending.length, 1);
  const russian = createWeakSpotLesson([pair], { language: "ru" });
  assert.equal(russian.lesson.targets[0].value, "фы");
  const known = createWeakSpotLesson([{ ...pair, language: "xkb:layout:us" }]);
  assert.equal(known.lesson.targets[0].value, "as");
});
