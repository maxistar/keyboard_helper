export const ANALYTICS_SCHEMA_VERSION = 1;
export const IDLE_GAP_MS = 2_000;
export const MIN_PAIR_SAMPLES = 30;
export const SLOW_RATIO = 1.5;
export const RETENTION_DAYS = 90;
export const LATENCY_BUCKETS_MS = Object.freeze([50, 75, 100, 125, 150, 200, 300, 500, 750, 1_000, 1_500, 2_000]);

const MODIFIERS = new Set([
  "ShiftLeft", "ShiftRight", "Shift", "ControlLeft", "ControlRight", "Control",
  "AltLeft", "AltRight", "AltGr", "Alt", "MetaLeft", "MetaRight", "Meta",
]);
const SHORTCUT_MODIFIERS = new Set(["ControlLeft", "ControlRight", "Control", "AltLeft", "Alt", "MetaLeft", "MetaRight", "Meta"]);
const BACKSPACE_KEYS = new Set(["Backspace"]);

export function normalizeAnalyticsSettings(value) {
  return Object.freeze({
    exercise: value?.exercise === true,
    background: value?.background === true,
  });
}

export function latencyBucketIndex(latencyMs) {
  const index = LATENCY_BUCKETS_MS.findIndex((limit) => latencyMs <= limit);
  return index < 0 ? LATENCY_BUCKETS_MS.length : index;
}

export function histogramPercentile(histogram, percentile) {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (!total) return null;
  const target = Math.max(1, Math.ceil(total * percentile));
  let seen = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    seen += histogram[index];
    if (seen >= target) return LATENCY_BUCKETS_MS[index] ?? IDLE_GAP_MS;
  }
  return IDLE_GAP_MS;
}

export function classifyPair({ sampleCount, medianMs, baselineMedianMs }) {
  if (sampleCount < MIN_PAIR_SAMPLES) return { state: "insufficient-data", slow: false };
  if (!(baselineMedianMs > 0) || !(medianMs >= 0)) return { state: "baseline-unavailable", slow: false };
  const ratio = medianMs / baselineMedianMs;
  return { state: ratio >= SLOW_RATIO ? "slow" : "typical", slow: ratio >= SLOW_RATIO, ratio };
}

export function localDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createBackgroundAnalytics({
  settings = {},
  context = () => ({ layout: "unknown", language: "unknown" }),
  now = () => performance.now(),
  wallClock = () => new Date(),
  write = async () => {},
} = {}) {
  let enabled = normalizeAnalyticsSettings(settings).background;
  let suspended = false;
  let held = new Set();
  let modifiers = new Set();
  let previous = null;
  let lastTransition = null;
  let correctionEpisode = false;
  let generation = 0;

  function resetTransient() {
    held = new Set();
    modifiers = new Set();
    previous = null;
    lastTransition = null;
    correctionEpisode = false;
    generation += 1;
  }

  async function persist(record) {
    const currentGeneration = generation;
    const collectedAt = wallClock();
    await write({ schemaVersion: ANALYTICS_SCHEMA_VERSION, day: localDayKey(collectedAt), collectedAtUnixMs: collectedAt.getTime(), ...record });
    return currentGeneration === generation;
  }

  function hasShortcutModifier() {
    return [...modifiers].some((key) => SHORTCUT_MODIFIERS.has(key));
  }

  function handle(event) {
    if (!event || event.source !== "system" || event.kind !== "key") return false;
    const key = event.code;
    if (event.action === "up") {
      held.delete(key);
      modifiers.delete(key);
      return false;
    }
    if (held.has(key)) return false;
    held.add(key);
    if (MODIFIERS.has(key)) {
      modifiers.add(key);
      if (SHORTCUT_MODIFIERS.has(key)) previous = null;
      return false;
    }
    if (!enabled || suspended) return false;
    if (hasShortcutModifier()) {
      previous = null;
      lastTransition = null;
      correctionEpisode = false;
      return false;
    }

    const timestamp = now();
    const currentContext = context();
    if (BACKSPACE_KEYS.has(key)) {
      if (!correctionEpisode && lastTransition && timestamp - lastTransition.timestamp <= IDLE_GAP_MS) {
        correctionEpisode = true;
        void persist({ type: "correction", context: lastTransition.context, fromCode: lastTransition.fromCode, toCode: lastTransition.toCode });
        return true;
      }
      return false;
    }
    correctionEpisode = false;
    void persist({ type: "key", context: currentContext, code: key });

    if (previous) {
      const elapsed = timestamp - previous.timestamp;
      const sameContext = previous.context.layout === currentContext.layout
        && previous.context.language === currentContext.language;
      if (elapsed <= IDLE_GAP_MS && sameContext) {
        lastTransition = { context: currentContext, fromCode: previous.code, toCode: key, timestamp };
        void persist({
          type: "pair", context: currentContext, fromCode: previous.code, toCode: key,
          latencyBucket: latencyBucketIndex(elapsed), latencyMs: Math.round(elapsed),
        });
      } else {
        lastTransition = null;
      }
    }
    previous = { code: key, timestamp, context: currentContext };
    return true;
  }

  return {
    handle,
    resetTransient,
    setEnabled(value) { enabled = value === true; resetTransient(); },
    setSuspended(value) { suspended = value === true; resetTransient(); },
    getState: () => ({ enabled, suspended, generation }),
  };
}

const EXERCISE_SUM_FIELDS = ["sessionCount", "totalScore", "completedTargets", "correctCharacters", "mistakes", "activeDurationMs", "completedCount"];

function mergeExercise(left, right) {
  if (!left || !right) return left ?? right ?? null;
  const merged = { ...left };
  for (const field of EXERCISE_SUM_FIELDS) {
    if (field in left || field in right) merged[field] = (left[field] ?? 0) + (right[field] ?? 0);
  }
  if ("highestWave" in left || "highestWave" in right) merged.highestWave = Math.max(left.highestWave ?? 0, right.highestWave ?? 0);
  return merged;
}

// Daily rows are merged over the report period so sample thresholds and baselines use the same scope.
export function mergePeriodRows(rows) {
  const merged = new Map();
  for (const row of rows) {
    const key = [row.type, row.collectionType, row.layout, row.language, row.fromCode, row.toCode].join("\0");
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...row, days: row.day ? [row.day] : [], histogram: row.histogram ? [...row.histogram] : row.histogram });
      continue;
    }
    if (row.day && !current.days.includes(row.day)) current.days.push(row.day);
    current.sampleCount = (current.sampleCount ?? 0) + (row.sampleCount ?? 0);
    current.correctionCount = (current.correctionCount ?? 0) + (row.correctionCount ?? 0);
    current.latencySumMs = (current.latencySumMs ?? 0) + (row.latencySumMs ?? 0);
    if (row.histogram) {
      const histogram = current.histogram ?? [];
      row.histogram.forEach((count, index) => { histogram[index] = (histogram[index] ?? 0) + count; });
      current.histogram = histogram;
    }
    current.exercise = mergeExercise(current.exercise, row.exercise);
  }
  return [...merged.values()].map((row) => {
    const periodRow = { ...row, days: [...row.days].sort() };
    delete periodRow.day;
    return periodRow;
  });
}

function exerciseSummary(exercise) {
  if (!exercise || !("correctCharacters" in exercise)) return exercise ?? null;
  const correct = exercise.correctCharacters ?? 0;
  const mistakes = exercise.mistakes ?? 0;
  const durationMs = exercise.activeDurationMs ?? 0;
  return {
    ...exercise,
    accuracy: correct + mistakes === 0 ? null : (correct / (correct + mistakes)) * 100,
    wpm: durationMs > 0 ? (correct / 5) / (durationMs / 60_000) : null,
  };
}

export function buildAnalyticsReport({ settings, rows = [], from = null, to = null, filters = {} } = {}) {
  const selectedRows = mergePeriodRows(rows.filter((row) => (
    (!filters.layout || row.layout === filters.layout)
    && (!filters.language || row.language === filters.language)
    && (!filters.collectionType || row.collectionType === filters.collectionType)
  )));
  const baselineByContext = new Map();
  for (const row of selectedRows.filter((entry) => entry.type === "pair")) {
    const key = `${row.collectionType ?? "background"}\0${row.layout ?? "unknown"}\0${row.language ?? "unknown"}`;
    const histogram = baselineByContext.get(key) ?? Array(LATENCY_BUCKETS_MS.length + 1).fill(0);
    row.histogram?.forEach((count, index) => { histogram[index] += count; });
    baselineByContext.set(key, histogram);
  }
  const baselineMedianMs = baselineByContext.size === 1
    ? histogramPercentile([...baselineByContext.values()][0], 0.5)
    : null;
  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    period: { from, to },
    settings: normalizeAnalyticsSettings(settings),
    timing: { source: "monotonic-host-collection", idleGapMs: IDLE_GAP_MS, baselineMedianMs },
    thresholds: { minimumPairSamples: MIN_PAIR_SAMPLES, slowRatio: SLOW_RATIO },
    omittedData: [
      "background characters and words", "application names", "ordered individual-key history",
      "firmware latency", "physical positions and layers", "combo identity", "keyboard device identity",
    ],
    limitations: ["System event coverage and AltGr identification vary by platform.", "Multiple keyboards share the same layout and language context."],
    rows: selectedRows.map((row) => {
      if (row.type === "session") return { ...row, exercise: exerciseSummary(row.exercise) };
      if (row.type !== "pair") return row;
      const key = `${row.collectionType ?? "background"}\0${row.layout ?? "unknown"}\0${row.language ?? "unknown"}`;
      const matchingBaseline = histogramPercentile(baselineByContext.get(key) ?? [], 0.5);
      const medianMs = histogramPercentile(row.histogram ?? [], 0.5);
      return { ...row, medianMs, p90Ms: histogramPercentile(row.histogram ?? [], 0.9), baselineMedianMs: matchingBaseline,
        classification: classifyPair({ sampleCount: row.sampleCount, medianMs, baselineMedianMs: matchingBaseline }) };
    }),
  };
}

function* daysBetween(from, to) {
  const cursor = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  for (let guard = 0; cursor <= end && guard < 400; guard += 1) {
    yield localDayKey(cursor);
    cursor.setDate(cursor.getDate() + 1);
  }
}

// Daily exercise trend points; days without sessions inside [from, to] are returned with null metrics.
export function buildDailyExerciseSeries({ rows = [], from = null, to = null, filters = {} } = {}) {
  const byDay = new Map();
  for (const row of rows) {
    if (row.type !== "session" || !row.day) continue;
    if (filters.layout && row.layout !== filters.layout) continue;
    if (filters.language && row.language !== filters.language) continue;
    if (filters.collectionType && row.collectionType !== filters.collectionType) continue;
    byDay.set(row.day, mergeExercise(byDay.get(row.day), row.exercise));
  }
  const days = from && to ? [...daysBetween(from, to)] : [...byDay.keys()].sort();
  return days.map((day) => {
    const exercise = exerciseSummary(byDay.get(day));
    return {
      day,
      sessionCount: exercise?.sessionCount ?? 0,
      wpm: exercise?.wpm ?? null,
      accuracy: exercise?.accuracy ?? null,
    };
  });
}
