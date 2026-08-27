import {
  GAME_RULES,
  SCORING,
  WORD_TIERS,
  getWaveConfig,
} from "./config.js";

const PLAYING = "playing";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function initialState() {
  return {
    phase: "ready",
    wave: 1,
    highestWave: 1,
    lives: GAME_RULES.initialLives,
    score: 0,
    streak: 0,
    multiplier: 1,
    correctChars: 0,
    mistakes: 0,
    destroyedTargets: 0,
    waveDestroyed: 0,
    elapsedMs: 0,
    spawnElapsedMs: 0,
    transitionElapsedMs: 0,
    targets: [],
    lockedTargetId: null,
    nextTargetId: 1,
  };
}

function cloneTarget(target) {
  return { ...target };
}

export function calculateAccuracy(correctChars, mistakes) {
  const attempts = correctChars + mistakes;
  return attempts === 0 ? 100 : (correctChars / attempts) * 100;
}

export function calculateWpm(correctChars, elapsedMs) {
  if (elapsedMs <= 0) return 0;
  return (correctChars / 5) / (elapsedMs / 60_000);
}

export function selectDistinctWord(words, targets, random = Math.random) {
  const usedInitials = new Set(targets.map((target) => target.word[0]));
  const candidates = words.filter((word) => !usedInitials.has(word[0]));
  if (candidates.length === 0) return null;
  const index = Math.floor(clamp(random(), 0, 0.999999) * candidates.length);
  return candidates[index];
}

export function createTypingInvadersGame({
  wordTiers = WORD_TIERS,
  resolveWave = getWaveConfig,
  rules = GAME_RULES,
  scoring = SCORING,
  random = Math.random,
} = {}) {
  let state = initialState();
  let events = [];

  function emit(type, detail = {}) {
    events.push({ type, ...detail });
  }

  function reset() {
    state = initialState();
    state.lives = rules.initialLives;
    state.spawnElapsedMs = resolveWave(1).spawnIntervalMs;
    events = [];
  }

  function snapshot() {
    return {
      ...state,
      accuracy: calculateAccuracy(state.correctChars, state.mistakes),
      wpm: calculateWpm(state.correctChars, state.elapsedMs),
      targets: state.targets.map(cloneTarget),
    };
  }

  function start() {
    reset();
    state.phase = PLAYING;
    emit("session-started", { wave: state.wave });
    return snapshot();
  }

  function pause(reason = "manual") {
    if (state.phase !== PLAYING) return false;
    state.phase = "paused";
    emit("paused", { reason });
    return true;
  }

  function resume() {
    if (state.phase !== "paused") return false;
    state.phase = PLAYING;
    emit("resumed");
    return true;
  }

  function finishWaveIfReady() {
    const config = resolveWave(state.wave);
    if (
      state.phase === PLAYING
      && state.waveDestroyed >= config.requiredKills
      && state.targets.length === 0
    ) {
      state.phase = "wave-transition";
      state.transitionElapsedMs = 0;
      emit("wave-complete", { wave: state.wave });
      return true;
    }
    return false;
  }

  function spawnTarget() {
    if (state.phase !== PLAYING) return null;
    const config = resolveWave(state.wave);
    if (
      state.waveDestroyed >= config.requiredKills
      || state.targets.length >= config.maxTargets
    ) return null;

    const words = wordTiers[config.tier] ?? [];
    const word = selectDistinctWord(words, state.targets, random);
    if (!word) {
      emit("spawn-deferred");
      return null;
    }

    const target = {
      id: state.nextTargetId,
      word,
      progress: 0,
      x: rules.minSpawnX + random() * (rules.maxSpawnX - rules.minSpawnX),
      y: 0,
    };
    state.nextTargetId += 1;
    state.targets.push(target);
    state.spawnElapsedMs = 0;
    emit("target-spawned", { target: cloneTarget(target) });
    return cloneTarget(target);
  }

  function loseTarget(target) {
    state.targets = state.targets.filter((entry) => entry.id !== target.id);
    if (state.lockedTargetId === target.id) state.lockedTargetId = null;
    state.lives = Math.max(0, state.lives - 1);
    state.streak = 0;
    state.multiplier = 1;
    emit("target-impact", { targetId: target.id, x: target.x, y: target.y, lives: state.lives });
    if (state.lives === 0) {
      state.phase = "game-over";
      emit("game-over", { score: state.score });
    }
  }

  function tick(deltaMs) {
    const step = clamp(Number(deltaMs) || 0, 0, rules.maxTickMs);
    if (state.phase === "wave-transition") {
      state.transitionElapsedMs += step;
      if (state.transitionElapsedMs >= rules.waveTransitionMs) {
        state.wave += 1;
        state.highestWave = Math.max(state.highestWave, state.wave);
        state.waveDestroyed = 0;
        state.transitionElapsedMs = 0;
        state.spawnElapsedMs = resolveWave(state.wave).spawnIntervalMs;
        state.phase = PLAYING;
        emit("wave-started", { wave: state.wave });
      }
      return snapshot();
    }
    if (state.phase !== PLAYING) return snapshot();

    state.elapsedMs += step;
    state.spawnElapsedMs += step;
    const config = resolveWave(state.wave);
    const escaped = [];
    state.targets.forEach((target) => {
      target.y += config.speed * (step / 1000);
      if (target.y >= rules.defenseLine) escaped.push(target);
    });
    escaped.forEach(loseTarget);
    if (state.phase !== PLAYING) return snapshot();

    if (state.spawnElapsedMs >= config.spawnIntervalMs) spawnTarget();
    finishWaveIfReady();
    return snapshot();
  }

  function registerMistake(character) {
    state.mistakes += 1;
    state.streak = 0;
    state.multiplier = 1;
    emit("mistake", { character, targetId: state.lockedTargetId });
  }

  function typeCharacter(character) {
    if (state.phase !== PLAYING || !/^[a-z]$/i.test(character ?? "")) return false;
    const normalized = character.toLowerCase();
    let target = state.targets.find((entry) => entry.id === state.lockedTargetId) ?? null;
    if (!target) {
      target = state.targets.find((entry) => entry.word[0] === normalized) ?? null;
      if (!target) {
        registerMistake(normalized);
        return false;
      }
      state.lockedTargetId = target.id;
      emit("target-locked", { targetId: target.id });
    }

    if (target.word[target.progress] !== normalized) {
      registerMistake(normalized);
      return false;
    }

    target.progress += 1;
    state.correctChars += 1;
    state.score += scoring.characterPoints * state.multiplier;
    emit("hit", { targetId: target.id, progress: target.progress });

    if (target.progress === target.word.length) {
      const completedMultiplier = state.multiplier;
      state.score += target.word.length * scoring.wordLengthBonus * completedMultiplier;
      state.destroyedTargets += 1;
      state.waveDestroyed += 1;
      state.streak += 1;
      state.multiplier = Math.min(
        scoring.maxMultiplier,
        1 + Math.floor(state.streak / scoring.wordsPerMultiplierStep),
      );
      state.targets = state.targets.filter((entry) => entry.id !== target.id);
      state.lockedTargetId = null;
      emit("target-destroyed", {
        targetId: target.id,
        word: target.word,
        x: target.x,
        y: target.y,
      });
      finishWaveIfReady();
    }
    return true;
  }

  function drainEvents() {
    const pending = events;
    events = [];
    return pending;
  }

  reset();
  return {
    start,
    replay: start,
    pause,
    resume,
    tick,
    typeCharacter,
    spawnTarget,
    getSnapshot: snapshot,
    drainEvents,
  };
}
