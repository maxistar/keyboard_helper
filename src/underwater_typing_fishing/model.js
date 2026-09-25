import { createMiniGameRuntime, createMiniGameSession } from "../mini_games/runtime.js";
import { filterCompatibleTargets } from "../mini_games/targets.js";
import { FISHING_CONFIG, normalizeFishingConfig } from "./config.js";

export function filterFishingTargets(targets, { maximumTargetTokens = FISHING_CONFIG.maximumTargetTokens } = {}) {
  return filterCompatibleTargets(targets, { maximumTokens: maximumTargetTokens });
}

export function selectUnambiguousTargets(targets, limit, excludedInitials = new Set(), startIndex = 0) {
  const selected = [];
  const initials = new Set(excludedInitials);
  if (!Array.isArray(targets) || !targets.length || limit <= 0) return selected;
  for (let offset = 0; offset < targets.length && selected.length < limit; offset += 1) {
    const index = (startIndex + offset) % targets.length;
    const target = targets[index];
    const initial = target?.[0];
    if (!initial || initials.has(initial)) continue;
    initials.add(initial);
    selected.push({ target, index });
  }
  return selected;
}

function createFishingResults({ session, config }) {
  let score = 0;
  let correct = 0;
  let mistakes = 0;
  let caughtFish = 0;
  let streak = 0;
  let bestStreak = 0;

  function multiplier() {
    const step = Math.max(1, config.catchesPerMultiplier);
    return Math.min(config.maximumMultiplier, 1 + Math.floor(Math.max(0, streak - 1) / step));
  }

  return {
    recordCorrect() { correct += 1; },
    recordMistake() { mistakes += 1; streak = 0; },
    recordCatch(tokenCount) {
      caughtFish += 1;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
      score += Math.max(1, tokenCount) * config.pointsPerToken * multiplier();
    },
    snapshot() {
      const total = correct + mistakes;
      const activeDurationMs = session.getSnapshot().activeDurationMs;
      const minutes = activeDurationMs / 60000;
      return {
        score,
        correct,
        mistakes,
        caughtFish,
        streak,
        bestStreak,
        multiplier: multiplier(),
        accuracy: total ? correct / total : 1,
        wpm: minutes > 0 ? (correct / 5) / minutes : 0,
        activeDurationMs,
      };
    },
    reset() { score = 0; correct = 0; mistakes = 0; caughtFish = 0; streak = 0; bestStreak = 0; },
  };
}

export function createFishingGame({
  config: providedConfig = FISHING_CONFIG,
  targetProvider = null,
  bundledTargets = providedConfig.targets ?? FISHING_CONFIG.targets,
  now,
} = {}) {
  const config = normalizeFishingConfig(providedConfig);
  let targets = filterFishingTargets(bundledTargets, config);
  const session = createMiniGameSession({ now });
  const results = createFishingResults({ session, config });
  let fish = [];
  let hookedFishId = null;
  let nextFishId = 1;
  let targetCursor = 0;
  let feedback = "Type the first letter of any fish to cast your line.";
  let completionReason = null;
  let eventSerial = 0;
  let lastEvent = null;

  function emitEvent(type, fishId = null) {
    eventSerial += 1;
    lastEvent = { type, fishId, serial: eventSerial };
  }

  function addFish(count = 1) {
    const excluded = new Set(fish.map((entry) => entry.target[0]));
    const selections = selectUnambiguousTargets(targets, count, excluded, targetCursor);
    for (const selection of selections) {
      const occupiedLanes = new Set(fish.map((entry) => entry.lane));
      const lane = Array.from({ length: config.visibleFish }, (_, index) => index)
        .find((candidate) => !occupiedLanes.has(candidate)) ?? 0;
      fish.push({
        id: nextFishId,
        target: [...selection.target],
        progress: 0,
        lane,
      });
      nextFishId += 1;
      targetCursor = (selection.index + 1) % targets.length;
    }
    return selections.length;
  }

  function resetGameState(nextTargets = targets) {
    targets = nextTargets;
    fish = [];
    hookedFishId = null;
    nextFishId = 1;
    targetCursor = 0;
    feedback = "Type the first letter of any fish to cast your line.";
    completionReason = null;
    eventSerial = 0;
    lastEvent = null;
    addFish(config.visibleFish);
  }

  const runtime = createMiniGameRuntime({
    session,
    results,
    targetProvider,
    bundledTargets,
    filterTargets: (values) => filterFishingTargets(values, config),
    prepareSession: (nextTargets) => nextTargets,
    commitSession: resetGameState,
  });

  function snapshot() {
    const initialization = runtime.getInitializationState();
    const result = results.snapshot();
    return {
      ...session.getSnapshot(),
      ...initialization,
      ...result,
      fish: fish.map((entry) => ({ ...entry, target: [...entry.target], hooked: entry.id === hookedFishId })),
      hookedFishId,
      hookedFish: fish.find((entry) => entry.id === hookedFishId) ?? null,
      visibleFishLimit: config.visibleFish,
      catchQuota: config.catchQuota,
      catchesRemaining: Math.max(0, config.catchQuota - result.caughtFish),
      completionReason,
      feedback: initialization.initializationError ?? feedback,
      lastEvent: lastEvent && { ...lastEvent },
      renderIntervalMs: config.renderIntervalMs,
    };
  }

  function recordMistake(message, fishId = null) {
    results.recordMistake();
    feedback = message;
    emitEvent("mistake", fishId);
    return { matched: false, complete: false, mistake: true };
  }

  function catchFish(entry) {
    results.recordCatch(entry.target.length);
    emitEvent("catch", entry.id);
    fish = fish.filter((candidate) => candidate.id !== entry.id);
    hookedFishId = null;
    if (results.snapshot().caughtFish >= config.catchQuota) {
      completionReason = "completed";
      feedback = "Catch complete. The reef is thriving!";
      session.finish();
    } else {
      addFish(1);
      feedback = "Fish caught! Choose another target.";
    }
  }

  function advanceFish(entry, token, newlyHooked = false) {
    if (entry.target[entry.progress] !== token) {
      return recordMistake("The fish pulled away, but your progress is safe.", entry.id);
    }
    entry.progress += 1;
    results.recordCorrect();
    const complete = entry.progress === entry.target.length;
    if (complete) catchFish(entry);
    else {
      hookedFishId = entry.id;
      feedback = "Hooked! Keep typing to reel it in.";
      emitEvent(newlyHooked ? "hook" : "reel", entry.id);
    }
    return { matched: true, complete, progress: entry.progress };
  }

  function input(token) {
    const phase = session.getSnapshot().phase;
    if (token === "Escape") {
      if (phase === "playing") session.pause();
      else if (phase === "paused") session.resume();
      return { control: true };
    }
    if (phase !== "playing") return { matched: false, ignored: true };
    const hooked = fish.find((entry) => entry.id === hookedFishId);
    if (hooked) return advanceFish(hooked, token);
    const selected = fish.find((entry) => entry.target[0] === token);
    if (!selected) return recordMistake("No fish starts with that key. Try a visible target.");
    hookedFishId = selected.id;
    return advanceFish(selected, token, true);
  }

  function start() {
    if (session.getSnapshot().phase !== "ready") return Promise.resolve({ ok: false, ignored: true });
    return runtime.startNewSession();
  }

  function replay() {
    if (session.getSnapshot().phase !== "finished") return Promise.resolve({ ok: false, ignored: true });
    return runtime.startNewSession();
  }

  function pause() {
    if (session.getSnapshot().phase !== "playing") return false;
    session.pause();
    return true;
  }

  function resume() {
    if (session.getSnapshot().phase !== "paused") return false;
    session.resume();
    return true;
  }

  function finishEarly() {
    if (!["playing", "paused"].includes(session.getSnapshot().phase)) return false;
    completionReason = "early-finished";
    feedback = "Dive ended. Here is your catch.";
    session.finish();
    return true;
  }

  resetGameState(targets);
  return {
    start,
    replay,
    pause,
    resume,
    finishEarly,
    input,
    getSnapshot: snapshot,
    cancelPendingSession: runtime.invalidatePending,
  };
}

export function createFishingGameFromSources(options = {}) {
  return createFishingGame(options);
}
