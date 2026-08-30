export const SECONDARY_WINDOWS = Object.freeze({
  settings: Object.freeze({ label: "settings", page: "settings.html", capability: "settings" }),
  typingInvaders: Object.freeze({ label: "typing-invaders", page: "game.html", capability: "typing-invaders" }),
  selfTest: Object.freeze({ label: "keyboard-self-test", page: "self-test.html", capability: "self-test" }),
});

function errorMessage(error) {
  const message = typeof error === "string" ? error : error?.message;
  return String(message || "initialization failed").slice(0, 240);
}

export async function initializeSecondaryWindow({
  invoke,
  label,
  initialize,
  failureStage = "initialize",
}) {
  try {
    await initialize();
    await invoke?.("secondary_window_ready", {
      payload: { label, state: "ready", stage: "initialized" },
    });
  } catch (error) {
    try {
      await invoke?.("secondary_window_ready", {
        payload: { label, state: "failed", stage: failureStage, error: errorMessage(error) },
      });
    } catch {
      // Preserve the initialization error when readiness reporting is unavailable.
    }
    throw error;
  }
}

export function createReadinessGate({ label, timeoutMs = 10_000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let settled = false;
  let resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });
  const timer = setTimer(() => {
    if (settled) return;
    settled = true;
    resolveResult({ ok: false, label, stage: "timeout", error: "readiness timeout" });
  }, timeoutMs);

  return {
    result,
    accept(payload) {
      if (settled || payload?.label !== label) return false;
      settled = true;
      clearTimer(timer);
      resolveResult({
        ok: payload.state === "ready",
        label,
        stage: payload.stage,
        error: payload.error,
      });
      return true;
    },
  };
}
