import test from "node:test";
import assert from "node:assert/strict";
import { createPracticeQueue, createPracticeQueueProvider } from "../src/practice_queue.js";

const target = (word, lessonId, targetId) => ({ word, tokens: [...word], lessonId, targetId, targetType: "word" });

test("practice queue merges deterministically, deduplicates, keeps reasons, and caps", () => {
  const result = createPracticeQueue({
    sources: [
      { reason: "Selected lesson", targets: [target("alpha", "lesson", "a"), target("beta", "lesson", "b")] },
      { reason: "Slow transition", targets: [target("alpha", "lesson", "a"), target("gamma", "weak", "g")] },
    ],
    limit: 2,
  });
  assert.deepEqual(result.items.map((item) => item.word), ["alpha", "beta"]);
  assert.deepEqual(result.items[0].reasons, ["Selected lesson", "Slow transition"]);
  assert.equal(result.diagnostics[0].code, "queue-cap");
});

test("practice queue filters incompatible targets and preserves stable identity", () => {
  const result = createPracticeQueue({ sources: [{ reason: "Weak spot", targets: [target("ab", "weak", "pair-a-b"), target("A!", "weak", "bad")] }] });
  assert.equal(result.items[0].queueId, "weak:pair-a-b");
  assert.equal(result.diagnostics[0].code, "incompatible-target");
});

test("queue provider consumes each target once and avoids active duplicate words", () => {
  const provider = createPracticeQueueProvider([target("alpha", "lesson", "a"), target("beta", "lesson", "b")]);
  assert.equal(provider.next().word, "alpha");
  assert.equal(provider.next({ activeTargets: [{ word: "beta" }] }), null);
});

test("an empty compatible queue fails closed without inventing arcade targets", () => {
  const result = createPracticeQueue({ sources: [{ reason: "Unsupported lesson", targets: [{ word: "A!", tokens: ["A", "!"] }] }] });
  assert.deepEqual(result.items, []);
  assert.equal(result.diagnostics[0].code, "incompatible-target");
  assert.equal(createPracticeQueueProvider(result.items).next(), null);
});
