export const ConnectionIndicator = Object.freeze({
  NEUTRAL: "neutral",
  READY: "ready",
  PROGRESS: "progress",
  ATTENTION: "attention",
  PROBLEM: "problem",
});

export const ConnectionNoticeKind = Object.freeze({ READY: "ready", LOST: "lost" });

const LOST_PHASES = new Set(["disconnected", "failed"]);
const INDICATOR_BY_SEVERITY = Object.freeze({
  success: ConnectionIndicator.READY,
  progress: ConnectionIndicator.PROGRESS,
  attention: ConnectionIndicator.ATTENTION,
  error: ConnectionIndicator.PROBLEM,
});

export function connectionIndicatorState(presentation) {
  return INDICATOR_BY_SEVERITY[presentation?.severity] ?? ConnectionIndicator.NEUTRAL;
}

function noticeKind(presentation) {
  if (presentation?.phase === "ready") return ConnectionNoticeKind.READY;
  if (LOST_PHASES.has(presentation?.phase)) return ConnectionNoticeKind.LOST;
  return null;
}

export function connectionNoticeText(kind, deviceName, battery) {
  const device = deviceName ? ` · ${deviceName}` : "";
  if (kind === ConnectionNoticeKind.READY) return `Keyboard connected${device}${battery ? ` · ${battery}` : ""}`;
  return `Keyboard disconnected${device}`;
}

/**
 * Decides when a short-lived connection notice is due from successive lifecycle presentations.
 * A notice is only emitted after the state has stayed unchanged for `settleMs`, so rapid BLE
 * flapping collapses into the final state, and a loss is only reported after a shown "ready".
 */
export function createConnectionNoticeController({
  render,
  schedule = (callback, ms) => globalThis.setTimeout(callback, ms),
  cancel = (handle) => globalThis.clearTimeout(handle),
  settleMs = 600,
  displayMs = 4000,
} = {}) {
  if (typeof render !== "function") throw new TypeError("A notice render callback is required.");
  let pending = null;
  let settleTimer = null;
  let hideTimer = null;
  let lastShown = null;
  let visibleKind = null;
  let deviceName = "";
  let battery = "";

  function paint() {
    render(visibleKind ? connectionNoticeText(visibleKind, deviceName, battery) : null, visibleKind);
  }

  function hide() {
    hideTimer = null;
    visibleKind = null;
    paint();
  }

  function settle() {
    settleTimer = null;
    const kind = pending;
    pending = null;
    if (!kind || kind === lastShown) return;
    if (kind === ConnectionNoticeKind.LOST && lastShown !== ConnectionNoticeKind.READY) return;
    lastShown = kind;
    visibleKind = kind;
    paint();
    if (hideTimer != null) cancel(hideTimer);
    hideTimer = schedule(hide, displayMs);
  }

  return {
    observe(presentation) {
      deviceName = presentation?.selectedDevice?.name ?? deviceName;
      const kind = noticeKind(presentation);
      if (settleTimer != null) cancel(settleTimer);
      settleTimer = null;
      pending = kind;
      if (kind) settleTimer = schedule(settle, settleMs);
    },
    setBattery(value) {
      battery = value ?? "";
      if (visibleKind === ConnectionNoticeKind.READY) paint();
    },
    dispose() {
      if (settleTimer != null) cancel(settleTimer);
      if (hideTimer != null) cancel(hideTimer);
      settleTimer = null;
      hideTimer = null;
      pending = null;
      visibleKind = null;
    },
  };
}
