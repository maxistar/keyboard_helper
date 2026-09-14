export const SESSION_PHASES = Object.freeze(["ready", "playing", "paused", "game-over", "finished"]);

export function createMiniGameSession({ now = () => Date.now(), onChange = () => {} } = {}) {
  let phase = "ready";
  let activeStartedAt = null;
  let activeDurationMs = 0;

  function snapshot() {
    return { phase, activeDurationMs: activeDurationMs + (phase === "playing" && activeStartedAt !== null ? Math.max(0, now() - activeStartedAt) : 0) };
  }
  function emit() { onChange(snapshot()); }
  function setPhase(next) {
    if (!SESSION_PHASES.includes(next) || next === phase) return snapshot();
    const current = now();
    if (phase === "playing" && activeStartedAt !== null) activeDurationMs += Math.max(0, current - activeStartedAt);
    activeStartedAt = next === "playing" ? current : null;
    phase = next;
    emit();
    return snapshot();
  }
  return {
    getSnapshot: snapshot,
    start() { return setPhase("playing"); },
    pause() { return setPhase("paused"); },
    resume() { return setPhase("playing"); },
    gameOver() { return setPhase("game-over"); },
    finish() { return setPhase("finished"); },
    reset() { phase = "ready"; activeStartedAt = null; activeDurationMs = 0; emit(); return snapshot(); },
  };
}

export function createResultAccumulator({ session = null } = {}) {
  let correct = 0;
  let mistakes = 0;
  let consumedFood = 0;
  let score = 0;
  return {
    recordCorrect(count = 1) { correct += Math.max(0, count); },
    recordMistake(count = 1) { mistakes += Math.max(0, count); },
    recordFood({ score: points = 1 } = {}) { consumedFood += 1; score += points; },
    snapshot() {
      const total = correct + mistakes;
      const duration = session?.getSnapshot?.().activeDurationMs ?? 0;
      return { score, correct, mistakes, accuracy: total ? correct / total : 1, consumedFood, activeDurationMs: duration };
    },
    reset() { correct = 0; mistakes = 0; consumedFood = 0; score = 0; },
  };
}

export async function resolveTargetSource({ adapter, bundledTargets = [], filter = (value) => value } = {}) {
  try {
    const provided = await adapter?.getTargets?.();
    const usable = filter(provided);
    if (Array.isArray(usable) && usable.length) return usable;
  } catch {
    // Optional adapters must never prevent the bundled game from starting.
  }
  return filter(bundledTargets);
}

export function createMiniGameRuntime({
  session = createMiniGameSession(),
  results = null,
  targetProvider = null,
  bundledTargets = [],
  filterTargets = (value) => value,
  prepareSession = (targets) => targets,
  commitSession = () => {},
  onInitializationChange = () => {},
} = {}) {
  const resultAccumulator = results ?? createResultAccumulator({ session });
  let generation = 0;
  let pending = null;
  let initializationError = null;

  function state() {
    return {
      generation,
      initializing: pending !== null,
      initializationError,
    };
  }

  function emit() {
    onInitializationChange(state());
  }

  function startNewSession() {
    if (pending) return pending;
    const requestGeneration = generation + 1;
    generation = requestGeneration;
    initializationError = null;

    const operation = (async () => {
      try {
        const targets = await resolveTargetSource({
          adapter: targetProvider,
          bundledTargets,
          filter: filterTargets,
        });
        if (!Array.isArray(targets) || targets.length === 0) {
          throw new Error("No compatible mini-game targets are available.");
        }
        const prepared = await prepareSession(targets.map((target) => (
          Array.isArray(target) ? [...target] : target
        )));
        if (generation !== requestGeneration) {
          return { ok: false, stale: true };
        }
        commitSession(prepared);
        resultAccumulator.reset();
        session.reset();
        session.start();
        return { ok: true, generation: requestGeneration };
      } catch (error) {
        if (generation !== requestGeneration) {
          return { ok: false, stale: true };
        }
        initializationError = error instanceof Error
          ? error.message
          : "Mini-game session initialization failed.";
        return { ok: false, error };
      }
    })();

    pending = operation;
    emit();
    void operation.finally(() => {
      if (pending !== operation) return;
      pending = null;
      emit();
    });
    return operation;
  }

  function invalidatePending() {
    generation += 1;
    pending = null;
    initializationError = null;
    emit();
  }

  return {
    session,
    results: resultAccumulator,
    startNewSession,
    invalidatePending,
    getInitializationState: state,
  };
}

export function attachFocusLifecycle({
  session,
  windowTarget = globalThis.window,
  documentTarget = globalThis.document,
  onPause = () => {},
} = {}) {
  let mounted = false;
  const pause = () => {
    if (session?.getSnapshot?.().phase !== "playing") return false;
    session.pause();
    onPause(session.getSnapshot?.());
    return true;
  };
  const visibility = () => { if (documentTarget?.hidden) pause(); };
  function mount() {
    if (mounted) return false;
    mounted = true;
    documentTarget?.addEventListener?.("visibilitychange", visibility);
    windowTarget?.addEventListener?.("blur", pause);
    return true;
  }
  mount();
  return {
    mount,
    pause,
    destroy() {
      if (!mounted) return false;
      mounted = false;
      documentTarget?.removeEventListener?.("visibilitychange", visibility);
      windowTarget?.removeEventListener?.("blur", pause);
      return true;
    },
  };
}

export async function consumeResult(result, consumer) {
  try {
    await consumer?.consume?.(result);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
