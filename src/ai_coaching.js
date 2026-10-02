export const AI_COACHING_TTL_MS = 30 * 60 * 1000;

export const AI_OMITTED_DATA = Object.freeze([
  "raw normal-work text",
  "raw normal-work key logs",
  "firmware latency",
  "physical positions and layers",
  "combo identity",
  "keyboard device identity",
]);

const FORBIDDEN_KEYS = new Set([
  "rawText", "rawTypedText", "rawKeyLogs", "keyLog", "orderedKeyHistory",
  "applicationNames", "firmwareLatency", "physicalPositions", "layers",
  "comboIdentity", "deviceIdentity", "keyboardDeviceIdentity",
  "applicationName", "keyHistory", "layer", "comboId", "deviceId",
]);

const REPORT_FIELDS = ["schemaVersion", "period", "settings", "timing", "thresholds", "limitations"];
const ROW_FIELDS = [
  "day", "type", "collectionType", "layout", "language", "fromCode", "toCode",
  "sampleCount", "correctionCount", "latencySumMs", "histogram", "medianMs", "p90Ms",
  "baselineMedianMs", "classification",
];
const EXERCISE_FIELDS = ["sessionCount", "correctCharacters", "mistakes", "activeDurationMs", "accuracy", "wpm", "completedCount"];

function select(object, fields) {
  return Object.fromEntries(fields.filter((field) => Object.prototype.hasOwnProperty.call(object ?? {}, field)).map((field) => [field, object[field]]));
}

export function createAiCoachingReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return null;
  const safe = select(report, REPORT_FIELDS);
  safe.period = select(report.period, ["from", "to"]);
  safe.settings = select(report.settings, ["background", "exercise", "aiCoaching"]);
  safe.timing = select(report.timing, ["source", "idleGapMs", "baselineMedianMs"]);
  safe.thresholds = select(report.thresholds, ["minimumPairSamples", "slowRatio"]);
  safe.rows = Array.isArray(report.rows) ? report.rows.map((row) => ({
    ...select(row, ROW_FIELDS),
    ...(row?.exercise ? { exercise: select(row.exercise, EXERCISE_FIELDS) } : {}),
    ...(row?.classification ? { classification: select(row.classification, ["state", "ratio"]) } : {}),
  })) : [];
  safe.omittedData = [...new Set([...(Array.isArray(report.omittedData) ? report.omittedData : []), ...AI_OMITTED_DATA])];
  return safe;
}

function containsForbiddenKey(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEYS.has(key) || containsForbiddenKey(child));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function sanitizeAiCoachingReport(report, { approvedAt = new Date().toISOString() } = {}) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("AI Coaching report must be an object.");
  }
  if (containsForbiddenKey(report)) {
    throw new Error("AI Coaching report contains data that cannot be exported.");
  }
  const sanitized = createAiCoachingReport(report);
  sanitized.consent = {
    mode: "ai_coaching",
    approvedAt,
    scope: "single-report-snapshot",
  };
  return sanitized;
}

export function createAiCoachingState({ enabled = false, now = () => Date.now() } = {}) {
  let active = null;

  function clear() {
    active = null;
    return snapshot();
  }

  function snapshot() {
    if (active && active.expiresAt <= now()) active = null;
    return active ? { ...active, report: clone(active.report) } : { enabled: enabled === true, active: false };
  }

  return {
    setEnabled(value) { enabled = value === true; if (!enabled) active = null; return snapshot(); },
    approve(report) {
      if (enabled !== true) throw new Error("AI Coaching mode is disabled.");
      const approvedAt = now();
      const sanitized = sanitizeAiCoachingReport(report, { approvedAt: new Date(approvedAt).toISOString() });
      active = { enabled: true, active: true, approvedAt, expiresAt: approvedAt + AI_COACHING_TTL_MS, report: sanitized };
      return snapshot();
    },
    revoke: clear,
    snapshot,
  };
}

export function validateAiRecommendation(recommendation, report) {
  if (!recommendation || typeof recommendation !== "object" || Array.isArray(recommendation)) {
    return { supported: false, reason: "Recommendation is not a structured object." };
  }
  if (containsForbiddenKey(recommendation)) {
    return { supported: false, reason: "Recommendation claims unavailable private or device data." };
  }
  const recommendationText = JSON.stringify(recommendation).toLowerCase();
  if (["firmware", "physical position", "physical key", "layer", "combo", "chord", "device identity"].some((term) => recommendationText.includes(term))) {
    return { supported: false, reason: "Recommendation claims an unavailable firmware, physical, layer, combo, or device signal." };
  }
  const evidence = Array.isArray(recommendation.evidence) ? recommendation.evidence : [];
  const reportText = JSON.stringify(report ?? {});
  const omitted = new Set(Array.isArray(report?.omittedData) ? report.omittedData : []);
  const supported = evidence.length > 0
    && evidence.every((item) => typeof item === "string" && !omitted.has(item) && reportText.includes(item));
  return supported
    ? { supported: true, recommendation: clone(recommendation) }
    : { supported: false, reason: "Recommendation has no traceable exported aggregate evidence." };
}
