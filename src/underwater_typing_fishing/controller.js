import { createSemanticInputAdapter } from "../mini_games/input.js";
import { attachFocusLifecycle, consumeResult } from "../mini_games/runtime.js";

export function createFishingController({
  game,
  view,
  windowTarget = globalThis.window,
  documentTarget = globalThis.document,
  setTimer = globalThis.setInterval,
  clearTimer = globalThis.clearInterval,
  resultConsumer = null,
} = {}) {
  let mounted = false;
  let timer = null;
  let resultDelivered = false;
  let focusLifecycle = null;

  function render() {
    const snapshot = game.getSnapshot();
    view.render(snapshot);
    if (snapshot.phase === "finished" && !resultDelivered) {
      resultDelivered = true;
      void consumeResult(snapshot, resultConsumer);
    }
    return snapshot;
  }

  const inputAdapter = createSemanticInputAdapter({
    target: windowTarget,
    onToken(token, event) {
      const outcome = game.input(token);
      if (outcome.control || !outcome.ignored) event.preventDefault?.();
      render();
    },
  });

  async function performPrimaryAction() {
    const phase = game.getSnapshot().phase;
    let operation = null;
    if (phase === "ready") operation = game.start();
    else if (phase === "paused") game.resume();
    else if (phase === "finished") operation = game.replay();
    render();
    if (operation) {
      const outcome = await operation;
      if (outcome?.ok) resultDelivered = false;
      render();
      return outcome;
    }
    return { ok: true };
  }

  function togglePause() {
    const phase = game.getSnapshot().phase;
    if (phase === "playing") game.pause();
    else if (phase === "paused") game.resume();
    render();
  }

  function endSession() {
    const ended = game.finishEarly();
    render();
    return ended;
  }

  function mount() {
    if (mounted) return false;
    mounted = true;
    view.setPrimaryActionHandler(performPrimaryAction);
    view.setPauseHandler(togglePause);
    view.setEndSessionHandler(endSession);
    inputAdapter.mount();
    focusLifecycle = attachFocusLifecycle({
      session: game,
      windowTarget,
      documentTarget,
      onPause: render,
    });
    timer = setTimer(render, game.getSnapshot().renderIntervalMs ?? 250);
    render();
    return true;
  }

  function destroy() {
    if (!mounted) return false;
    mounted = false;
    inputAdapter.unmount();
    focusLifecycle?.destroy();
    focusLifecycle = null;
    game.cancelPendingSession?.();
    if (timer !== null) clearTimer(timer);
    timer = null;
    return true;
  }

  return { mount, destroy, render, performPrimaryAction, togglePause, endSession };
}
