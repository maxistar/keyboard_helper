import { ANALYTICS_SCHEMA_VERSION, localDayKey } from "../typing_analytics.js";

export const TYPING_INVADERS_ANALYTICS_GAME = "typing-invaders";

export function createExerciseAnalytics({
  enabled = false,
  layout = "unknown",
  hasFocus = () => true,
  emitOwnership = () => {},
  record = async () => {},
  wallClock = () => new Date(),
  onError = (error) => console.error("Failed to persist exercise analytics:", error),
} = {}) {
  let analyticsEnabled = enabled === true;
  let ownsInput = false;
  let recordedGameOver = false;
  const targetMetrics = new Map();

  function publishOwnership(active) {
    if (ownsInput === active) return;
    ownsInput = active;
    emitOwnership({ active });
  }

  function persist(body) {
    const collectedAt = wallClock();
    const context = { layout: layout || "unknown", language: "unknown" };
    return Promise.resolve(record({
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      day: localDayKey(collectedAt),
      collectedAtUnixMs: collectedAt.getTime(),
      context,
      ...body,
    })).catch(onError);
  }

  function onSnapshot(snapshot, events = []) {
    publishOwnership(snapshot.phase === "playing" && hasFocus());
    if (events.some((event) => event.type === "session-started")) targetMetrics.clear();
    for (const event of events) {
      if (event.type === "target-spawned") {
        targetMetrics.set(event.target.id, { word: event.target.word, startedAtMs: snapshot.elapsedMs, mistakes: 0 });
      }
      if (event.type === "mistake" && event.targetId && targetMetrics.has(event.targetId)) {
        targetMetrics.get(event.targetId).mistakes += 1;
      }
      if (event.type === "target-destroyed" && targetMetrics.has(event.targetId)) {
        targetMetrics.get(event.targetId).completedAtMs = snapshot.elapsedMs;
      }
    }
    if (snapshot.phase !== "game-over") recordedGameOver = false;
    if (!analyticsEnabled || recordedGameOver || !events.some((event) => event.type === "game-over")) return [];
    recordedGameOver = true;
    const writes = [persist({
      type: "exercise",
      exercise: {
        game: TYPING_INVADERS_ANALYTICS_GAME, score: snapshot.score, highestWave: snapshot.highestWave,
        completedTargets: snapshot.destroyedTargets, correctCharacters: snapshot.correctChars,
        mistakes: snapshot.mistakes, accuracy: snapshot.accuracy, wpm: snapshot.wpm,
        activeDurationMs: snapshot.elapsedMs,
      },
    })];
    for (const metric of targetMetrics.values()) {
      writes.push(persist({
        type: "exerciseTarget",
        code: metric.word,
        latencyMs: metric.completedAtMs == null ? null : Math.max(0, Math.round(metric.completedAtMs - metric.startedAtMs)),
        exercise: { mistakes: metric.mistakes, completed: metric.completedAtMs != null },
      }));
    }
    return writes;
  }

  return {
    onSnapshot,
    publishOwnership,
    setEnabled(value) { analyticsEnabled = value === true; },
    getState: () => ({ enabled: analyticsEnabled, ownsInput }),
  };
}
