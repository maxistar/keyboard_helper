import {
  buildAnalyticsReport,
  buildDailyExerciseSeries,
  histogramPercentile,
  LATENCY_BUCKETS_MS,
  MIN_PAIR_SAMPLES,
} from "../typing_analytics.js";
import { normalizeHidDescriptor } from "../hid_descriptor.js";
import { normalizeKeyEntry, normalizeLayerData } from "../layout_semantics.js";
import { pairReadings, practiceWords } from "./readings.js";
import { createAiCoachingReport } from "../ai_coaching.js";

export const SIGNAL_LABELS = Object.freeze({
  slow: "Slow transition",
  "possible-correction": "Possible correction",
  "exercise-error": "Exercise error",
});
export const MAX_SUGGESTIONS = 8;
export const WORDS_PER_READING = 10;

const emptyHistogram = () => Array(LATENCY_BUCKETS_MS.length + 1).fill(0);

function addHistogram(target, source = []) {
  source.forEach((count, index) => { target[index] = (target[index] ?? 0) + count; });
  return target;
}

function round(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Period report with dashboard filters. Thresholds and baselines come unchanged from
 * buildAnalyticsReport; the minimum sample count only hides pairs from ranked views.
 */
export function buildPeriodView({ rows = [], settings = {}, filters = {} } = {}) {
  const report = buildAnalyticsReport({
    settings,
    rows,
    from: filters.from ?? null,
    to: filters.to ?? null,
    filters: { layout: filters.layout, language: filters.language, collectionType: filters.collectionType },
  });
  const minimumSamples = Math.max(0, Number(filters.minSamples) || 0);
  const pairs = report.rows.filter((row) => row.type === "pair");
  const rankedPairs = pairs.filter((row) => (row.sampleCount ?? 0) >= minimumSamples);
  const coverage = {
    pairSamples: pairs.reduce((sum, row) => sum + (row.sampleCount ?? 0), 0),
    keyPresses: report.rows.filter((row) => row.type === "key").reduce((sum, row) => sum + (row.sampleCount ?? 0), 0),
    pairCount: pairs.length,
    classifiedPairs: pairs.filter((row) => (row.sampleCount ?? 0) >= MIN_PAIR_SAMPLES).length,
    insufficientPairs: pairs.filter((row) => (row.sampleCount ?? 0) < MIN_PAIR_SAMPLES).length,
    hiddenByMinimum: pairs.length - rankedPairs.length,
  };
  return { report, pairs, rankedPairs, coverage, minimumSamples };
}

export function slowPairs(rankedPairs) {
  return rankedPairs
    .filter((row) => row.classification?.state === "slow")
    .map((row) => ({
      fromCode: row.fromCode,
      toCode: row.toCode,
      layout: row.layout,
      language: row.language,
      medianMs: row.medianMs,
      p90Ms: row.p90Ms,
      baselineMs: row.baselineMedianMs,
      ratio: round(row.classification.ratio, 2),
      correctionCount: row.correctionCount ?? 0,
      sampleCount: row.sampleCount ?? 0,
      days: row.days ?? [],
    }))
    .sort((left, right) => right.ratio - left.ratio || right.sampleCount - left.sampleCount);
}

export function correctionHotspots(rankedPairs) {
  return rankedPairs
    .filter((row) => (row.correctionCount ?? 0) > 0 && (row.sampleCount ?? 0) > 0)
    .map((row) => ({
      kind: "possible-correction",
      label: SIGNAL_LABELS["possible-correction"],
      fromCode: row.fromCode,
      toCode: row.toCode,
      language: row.language,
      correctionCount: row.correctionCount,
      sampleCount: row.sampleCount,
      rate: row.correctionCount / row.sampleCount,
    }))
    .sort((left, right) => right.rate - left.rate || right.correctionCount - left.correctionCount);
}

export function exerciseErrorHotspots(reportRows) {
  return reportRows
    .filter((row) => row.type === "target" && (row.correctionCount ?? 0) > 0)
    .map((row) => ({
      kind: "exercise-error",
      label: SIGNAL_LABELS["exercise-error"],
      target: row.fromCode,
      mistakes: row.correctionCount,
      attempts: row.sampleCount ?? 0,
      completed: row.exercise?.completedCount ?? 0,
    }))
    .sort((left, right) => right.mistakes - left.mistakes || left.target.localeCompare(right.target));
}

export function exerciseSummary(reportRows) {
  let correct = 0;
  let mistakes = 0;
  let durationMs = 0;
  let sessions = 0;
  for (const row of reportRows) {
    if (row.type !== "session" || !row.exercise) continue;
    correct += row.exercise.correctCharacters ?? 0;
    mistakes += row.exercise.mistakes ?? 0;
    durationMs += row.exercise.activeDurationMs ?? 0;
    sessions += row.exercise.sessionCount ?? 0;
  }
  return {
    sessions,
    wpm: sessions && durationMs > 0 ? round((correct / 5) / (durationMs / 60_000)) : null,
    accuracy: sessions && correct + mistakes > 0 ? round((correct / (correct + mistakes)) * 100) : null,
  };
}

/**
 * Maps key codes to base-layer positions of a layout definition. Only unmodified HID descriptors
 * count; a code on several positions is ambiguous and stays unmapped.
 */
export function baseLayerPositions(definition) {
  const positions = new Map();
  if (!definition?.keyLayers) return positions;
  const [baseLayer = []] = normalizeLayerData(definition.keyLayers).layers;
  baseLayer.forEach((entry, index) => {
    const descriptor = normalizeHidDescriptor(normalizeKeyEntry(entry).code);
    if (!descriptor.supported || descriptor.modifiers.length) return;
    const list = positions.get(descriptor.trigger) ?? [];
    list.push(index);
    positions.set(descriptor.trigger, list);
  });
  return positions;
}

export function keyHeatmap(pairs, definition) {
  const byKey = new Map();
  const baselineHistogram = emptyHistogram();
  for (const row of pairs) {
    addHistogram(baselineHistogram, row.histogram);
    const entry = byKey.get(row.toCode) ?? { histogram: emptyHistogram(), sampleCount: 0 };
    addHistogram(entry.histogram, row.histogram);
    entry.sampleCount += row.sampleCount ?? 0;
    byKey.set(row.toCode, entry);
  }
  const baselineMs = histogramPercentile(baselineHistogram, 0.5);
  const positions = baseLayerPositions(definition);
  const keys = [];
  const unmapped = [];
  for (const [code, entry] of [...byKey].sort(([left], [right]) => left.localeCompare(right))) {
    const matches = positions.get(code) ?? [];
    const medianMs = histogramPercentile(entry.histogram, 0.5);
    const measured = entry.sampleCount >= MIN_PAIR_SAMPLES && baselineMs > 0 && medianMs != null;
    const metric = { code, sampleCount: entry.sampleCount, medianMs, ratio: measured ? round(medianMs / baselineMs, 2) : null };
    if (matches.length === 1) keys.push({ ...metric, position: matches[0] });
    else unmapped.push({ ...metric, reason: matches.length ? "multiple-positions" : "not-on-base-layer" });
  }
  return { baselineMs, keys, unmapped };
}

function suggestionReadings(pair, dictionaries) {
  return pairReadings(pair).map((reading) => ({
    ...reading,
    words: practiceWords(dictionaries[reading.language] ?? [], reading.letters, WORDS_PER_READING),
  }));
}

export function practiceSuggestions({ slow = [], corrections = [], exerciseErrors = [], dictionaries = {} }) {
  const suggestions = [];
  const seen = new Set();
  const add = (suggestion, key) => {
    if (seen.has(key) || suggestions.length >= MAX_SUGGESTIONS) return;
    seen.add(key);
    suggestions.push(suggestion);
  };
  for (const pair of slow) {
    add({
      kind: "slow",
      label: SIGNAL_LABELS.slow,
      fromCode: pair.fromCode,
      toCode: pair.toCode,
      signal: `median ${pair.medianMs} ms vs baseline ${pair.baselineMs} ms (x${pair.ratio}) over ${pair.sampleCount} transitions`,
      sampleCount: pair.sampleCount,
      readings: suggestionReadings(pair, dictionaries),
    }, `${pair.fromCode}>${pair.toCode}`);
  }
  for (const hotspot of corrections) {
    add({
      kind: "possible-correction",
      label: SIGNAL_LABELS["possible-correction"],
      fromCode: hotspot.fromCode,
      toCode: hotspot.toCode,
      signal: `${hotspot.correctionCount} possible corrections in ${hotspot.sampleCount} background transitions`,
      sampleCount: hotspot.sampleCount,
      readings: suggestionReadings(hotspot, dictionaries),
    }, `${hotspot.fromCode}>${hotspot.toCode}`);
  }
  for (const error of exerciseErrors) {
    add({
      kind: "exercise-error",
      label: SIGNAL_LABELS["exercise-error"],
      target: error.target,
      signal: `${error.mistakes} exercise errors across ${error.attempts} attempts`,
      sampleCount: error.attempts,
      readings: [],
    }, `target:${error.target}`);
  }
  return suggestions;
}

/** Builds every dashboard view from daily aggregate rows and the selected filters. */
export function buildInsights({ rows = [], settings = {}, filters = {}, layoutDefinition = null, dictionaries = {} } = {}) {
  const period = buildPeriodView({ rows, settings, filters });
  const slow = slowPairs(period.rankedPairs);
  const corrections = correctionHotspots(period.rankedPairs);
  const exerciseErrors = filters.collectionType === "background" ? [] : exerciseErrorHotspots(period.report.rows);
  const exercise = exerciseSummary(period.report.rows);
  const correctionTotal = period.pairs.reduce((sum, row) => sum + (row.correctionCount ?? 0), 0);
  return {
    empty: rows.length === 0,
    // The same aggregate report backs both the visible dashboard and the AI coaching preview.
    // It contains no raw text or key history.
    report: createAiCoachingReport(period.report),
    summary: {
      exerciseWpm: exercise.wpm,
      exerciseAccuracy: exercise.accuracy,
      exerciseSessions: exercise.sessions,
      possibleCorrectionRate: period.coverage.pairSamples ? round((correctionTotal / period.coverage.pairSamples) * 100) : null,
      slowPairCount: slow.length,
      coverage: period.coverage,
    },
    slowPairs: slow,
    correctionHotspots: corrections,
    exerciseErrors,
    heatmap: keyHeatmap(period.pairs, layoutDefinition),
    trends: buildDailyExerciseSeries({ rows, from: filters.from, to: filters.to, filters }),
    suggestions: practiceSuggestions({ slow, corrections, exerciseErrors, dictionaries }),
    contexts: {
      layouts: [...new Set(rows.map((row) => row.layout).filter(Boolean))].sort(),
      languages: [...new Set(rows.map((row) => row.language).filter(Boolean))].sort(),
    },
    limitations: period.report.limitations,
    omittedData: period.report.omittedData,
  };
}
