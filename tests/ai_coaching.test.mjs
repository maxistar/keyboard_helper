import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_COACHING_TTL_MS,
  AI_OMITTED_DATA,
  createAiCoachingState,
  sanitizeAiCoachingReport,
  validateAiRecommendation,
} from "../src/ai_coaching.js";

const report = () => ({
  period: { from: "2026-09-01", to: "2026-09-30" },
  rows: [{ type: "pair", fromCode: "KeyT", toCode: "KeyH", sampleCount: 40 }],
  omittedData: [],
});

test("AI report sanitizer adds consent metadata and mandatory omissions", () => {
  const safe = sanitizeAiCoachingReport(report(), { approvedAt: "2026-09-30T12:00:00.000Z" });
  assert.equal(safe.consent.mode, "ai_coaching");
  assert.equal(safe.consent.scope, "single-report-snapshot");
  for (const item of AI_OMITTED_DATA) assert.ok(safe.omittedData.includes(item));
});

test("AI report sanitizer rejects raw and unavailable dimensions", () => {
  assert.throws(() => sanitizeAiCoachingReport({ ...report(), rawKeyLogs: ["KeyA"] }), /cannot be exported/);
  assert.throws(() => sanitizeAiCoachingReport({ ...report(), firmwareLatency: 10 }), /cannot be exported/);
});

test("AI coaching state expires, revokes, and requires enabled mode", () => {
  let now = 1000;
  const state = createAiCoachingState({ enabled: true, now: () => now });
  const approved = state.approve(report());
  assert.equal(approved.active, true);
  assert.equal(approved.expiresAt, now + AI_COACHING_TTL_MS);
  now += AI_COACHING_TTL_MS;
  assert.equal(state.snapshot().active, false);
  assert.throws(() => createAiCoachingState().approve(report()), /disabled/);
  state.setEnabled(true);
  state.approve(report());
  assert.equal(state.revoke().active, false);
});

test("recommendations need traceable evidence and reject unavailable claims", () => {
  const safe = sanitizeAiCoachingReport(report());
  assert.equal(validateAiRecommendation({ text: "Practise T-H", evidence: ["KeyT", "KeyH"] }, safe).supported, true);
  assert.equal(validateAiRecommendation({ text: "Change layer", evidence: ["layer"] }, safe).supported, false);
  assert.equal(validateAiRecommendation({ text: "Firmware is slow", firmwareLatency: 20 }, safe).supported, false);
});
