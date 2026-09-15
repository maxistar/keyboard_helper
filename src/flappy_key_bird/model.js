import { createMiniGameRuntime, createMiniGameSession } from "../mini_games/runtime.js";
import { createTargetMatcher, filterCompatibleTargets } from "../mini_games/targets.js";
import { FLAPPY_CONFIG } from "./config.js";

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function createFlappyResults({ session, config }) {
  let score = 0;
  let correct = 0;
  let mistakes = 0;
  let misses = 0;
  let clearedGates = 0;
  let streak = 0;
  let bestStreak = 0;

  function multiplier() {
    const step = Math.max(1, config.gatesPerMultiplier ?? 1);
    return Math.min(config.maximumMultiplier ?? 1, 1 + Math.floor(Math.max(0, streak - 1) / step));
  }

  return {
    recordCorrect() { correct += 1; },
    recordMistake() { mistakes += 1; streak = 0; },
    recordMiss() { misses += 1; streak = 0; },
    recordGate() {
      clearedGates += 1;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
      score += (config.pointsPerGate ?? 100) * multiplier();
    },
    reset() {
      score = 0;
      correct = 0;
      mistakes = 0;
      misses = 0;
      clearedGates = 0;
      streak = 0;
      bestStreak = 0;
    },
    snapshot() {
      const attempts = correct + mistakes;
      return {
        score,
        correct,
        mistakes,
        misses,
        clearedGates,
        streak,
        bestStreak,
        multiplier: multiplier(),
        accuracy: attempts ? correct / attempts : 1,
        activeDurationMs: session.getSnapshot().activeDurationMs,
      };
    },
  };
}

export async function createFlappyGameFromSources({
  targetProvider = null,
  bundledTargets = FLAPPY_CONFIG.targets,
  config = FLAPPY_CONFIG,
  ...options
} = {}) {
  return createFlappyGame({
    ...options,
    targetProvider,
    bundledTargets,
    config: { ...config, targets: bundledTargets },
  });
}

export function createFlappyGame({
  config = FLAPPY_CONFIG,
  random = Math.random,
  now,
  targetProvider = null,
  bundledTargets = config.targets,
} = {}) {
  const filterTargets = (values) => filterCompatibleTargets(values, {
    reserved: ["Escape"],
    maximumTokens: config.maximumTargetTokens ?? 6,
  });
  const session = createMiniGameSession({ now });
  const results = createFlappyResults({ session, config });
  let targets = filterTargets(bundledTargets);
  let targetIndex = 0;
  let nextGateId = 1;
  let birdY = config.initialBirdY;
  let birdVelocity = 0;
  let gates = [];
  let activeGateId = null;
  let repeatTarget = null;
  let accumulatorMs = 0;
  let feedback = "Type the target in rhythm to stay airborne.";
  let failureReason = null;

  function normalizedRandom() {
    return clamp(Number(random()) || 0, 0, 0.999999);
  }

  function nextTarget() {
    const target = targets[targetIndex % targets.length] ?? [];
    targetIndex += 1;
    return [...target];
  }

  function createGate(x) {
    const centerRange = config.maximumGapCenter - config.minimumGapCenter;
    const target = nextTarget();
    return {
      id: nextGateId++,
      x,
      gapCenter: config.minimumGapCenter + normalizedRandom() * centerRange,
      target,
      matcher: createTargetMatcher(target),
      cleared: false,
      passed: false,
      missed: false,
    };
  }

  function activeGate() {
    return gates.find((gate) => gate.id === activeGateId) ?? null;
  }

  function syncActiveGate() {
    const previous = activeGateId;
    const next = gates.find((gate) => !gate.cleared
      && !gate.passed
      && gate.x <= config.targetActivationX
      && gate.x + config.gateWidth >= config.birdX - config.birdRadius);
    activeGateId = next?.id ?? null;
    if (next) {
      repeatTarget = null;
      if (activeGateId !== previous) feedback = "Type the gate target to flap.";
    }
  }

  function resetGameState(nextTargets = targets) {
    targets = nextTargets;
    targetIndex = 0;
    nextGateId = 1;
    birdY = config.initialBirdY;
    birdVelocity = 0;
    accumulatorMs = 0;
    feedback = "Type the target in rhythm to stay airborne.";
    failureReason = null;
    gates = Array.from({ length: config.initialGateCount }, (_, index) => (
      createGate(config.initialGateX + index * config.gateSpacing)
    ));
    activeGateId = null;
    repeatTarget = null;
    syncActiveGate();
  }

  const runtime = createMiniGameRuntime({
    session,
    results,
    targetProvider,
    bundledTargets,
    filterTargets,
    prepareSession: (nextTargets) => nextTargets,
    commitSession: resetGameState,
  });

  function endRun(reason, { miss = false } = {}) {
    if (session.getSnapshot().phase !== "playing") return false;
    if (miss) results.recordMiss();
    failureReason = reason;
    feedback = reason === "missed-gate"
      ? "The target window closed before the gate was cleared."
      : "Collision ended the run.";
    session.gameOver();
    return true;
  }

  function gateCollides(gate) {
    const horizontal = config.birdX + config.birdRadius >= gate.x
      && config.birdX - config.birdRadius <= gate.x + config.gateWidth;
    if (!horizontal) return false;
    const gapTop = gate.gapCenter - config.gateGap / 2;
    const gapBottom = gate.gapCenter + config.gateGap / 2;
    return birdY - config.birdRadius <= gapTop || birdY + config.birdRadius >= gapBottom;
  }

  function replenishGates() {
    gates = gates.filter((gate) => gate.x + config.gateWidth >= 0);
    while (gates.length < config.initialGateCount) {
      const rightmost = gates.reduce((maximum, gate) => Math.max(maximum, gate.x), config.initialGateX - config.gateSpacing);
      gates.push(createGate(rightmost + config.gateSpacing));
    }
  }

  function advanceFixedStep() {
    const seconds = config.fixedStepMs / 1000;
    birdVelocity += config.gravity * seconds;
    birdY += birdVelocity * seconds;
    gates.forEach((gate) => { gate.x -= config.gateSpeed * seconds; });

    if (birdY - config.birdRadius <= 0 || birdY + config.birdRadius >= config.height) {
      endRun("boundary-collision");
      return false;
    }

    for (const gate of gates) {
      if (gateCollides(gate)) {
        if (!gate.cleared && !gate.missed) {
          gate.missed = true;
          results.recordMiss();
        }
        endRun("gate-collision");
        return false;
      }
      if (!gate.passed && gate.x + config.gateWidth < config.birdX - config.birdRadius) {
        gate.passed = true;
        if (!gate.cleared) {
          gate.missed = true;
          endRun("missed-gate", { miss: true });
          return false;
        }
        results.recordGate();
        feedback = "Gate cleared. Get ready for the next target.";
      }
    }

    replenishGates();
    syncActiveGate();
    return true;
  }

  function tick(elapsedMs = config.fixedStepMs) {
    if (session.getSnapshot().phase !== "playing") return 0;
    accumulatorMs += clamp(Number(elapsedMs) || 0, 0, config.maximumFrameMs);
    let steps = 0;
    while (accumulatorMs >= config.fixedStepMs && session.getSnapshot().phase === "playing") {
      accumulatorMs -= config.fixedStepMs;
      advanceFixedStep();
      steps += 1;
    }
    return steps;
  }

  function input(token) {
    const phase = session.getSnapshot().phase;
    if (token === "Escape") {
      if (phase === "playing") session.pause();
      else if (phase === "paused") session.resume();
      return { control: true };
    }
    if (phase !== "playing") return { matched: false, ignored: true };
    const gate = activeGate();
    const matcher = gate?.matcher ?? repeatTarget?.matcher;
    if (!matcher || matcher.complete) return { matched: false, ignored: true };
    const outcome = matcher.input(token);
    if (outcome.matched) {
      results.recordCorrect();
      birdVelocity = Math.max(
        config.maximumUpwardVelocity,
        Math.min(0, birdVelocity) + config.impulseVelocity,
      );
      if (outcome.complete) {
        if (gate) {
          gate.cleared = true;
          repeatTarget = {
            gateId: gate.id,
            matcher: createTargetMatcher(gate.target),
          };
          feedback = `Gate cleared. Repeat ${gate.target.join("")} to keep altitude.`;
          syncActiveGate();
        } else {
          const target = matcher.target.join("");
          matcher.reset();
          feedback = `Repeat complete. Type ${target} again to keep altitude.`;
        }
      } else {
        feedback = repeatTarget && !gate
          ? "Correct. Continue the repeat target."
          : "Correct. Keep the rhythm.";
      }
    } else {
      results.recordMistake();
      feedback = repeatTarget && !gate
        ? "Wrong key. Repeat progress is preserved."
        : "Wrong key. Target progress is preserved.";
    }
    return outcome;
  }

  function snapshot() {
    const initialization = runtime.getInitializationState();
    const gate = activeGate();
    const repeating = gate ? null : repeatTarget;
    const matcher = gate?.matcher ?? repeating?.matcher;
    return {
      ...session.getSnapshot(),
      ...initialization,
      width: config.width,
      height: config.height,
      fixedStepMs: config.fixedStepMs,
      bird: { x: config.birdX, y: birdY, velocity: birdVelocity, radius: config.birdRadius },
      gates: gates.map((entry) => ({
        id: entry.id,
        x: entry.x,
        gapCenter: entry.gapCenter,
        width: config.gateWidth,
        gap: config.gateGap,
        target: [...entry.target],
        targetProgress: entry.matcher.progress,
        cleared: entry.cleared,
        passed: entry.passed,
      })),
      activeGateId: gate?.id ?? repeating?.gateId ?? null,
      repeatingTarget: Boolean(repeating),
      target: matcher?.target ?? [],
      targetProgress: matcher?.progress ?? 0,
      feedback: initialization.initializationError ?? feedback,
      failureReason,
      ...results.snapshot(),
    };
  }

  function reset() {
    runtime.invalidatePending();
    results.reset();
    session.reset();
    resetGameState(filterTargets(bundledTargets));
    return snapshot();
  }

  function start() {
    if (session.getSnapshot().phase !== "ready") return Promise.resolve({ ok: false, ignored: true });
    return runtime.startNewSession();
  }

  function replay() {
    if (session.getSnapshot().phase !== "game-over") return Promise.resolve({ ok: false, ignored: true });
    return runtime.startNewSession();
  }

  resetGameState(targets);
  return {
    getSnapshot: snapshot,
    reset,
    start,
    replay,
    pause: () => session.pause(),
    resume: () => session.resume(),
    input,
    tick,
    cancelPendingSession: runtime.invalidatePending,
  };
}
