import { attachFocusLifecycle, consumeResult } from "../mini_games/runtime.js";
import { createSemanticInputAdapter } from "../mini_games/input.js";

export function createKeyboardSnakeController({
  game,
  view,
  windowTarget = globalThis.window,
  documentTarget = globalThis.document,
  setTimer = globalThis.setInterval,
  clearTimer = globalThis.clearInterval,
  resultConsumer = null,
} = {}) {
  let timer = null;
  let mounted = false;
  let resultDelivered = false;
  let focusLifecycle = null;

  function render() {
    const snapshot = game.getSnapshot();
    view.render(snapshot);
    if (["game-over", "finished"].includes(snapshot.phase) && !resultDelivered) {
      resultDelivered = true;
      void consumeResult(snapshot, resultConsumer);
    }
  }

  const adapter = createSemanticInputAdapter({
    target: windowTarget,
    onToken(token, event) {
      const outcome = game.input(token);
      if (outcome.control || !outcome.ignored) event.preventDefault?.();
      render();
    },
  });

  function step() {
    game.tick();
    render();
  }

  async function performPrimaryAction() {
    const phase = game.getSnapshot().phase;
    let operation = null;
    if (phase === "ready") operation = game.start();
    else if (phase === "paused") game.resume();
    else if (phase === "game-over" || phase === "finished") {
      operation = game.replay();
    }
    render();
    if (operation) {
      const outcome = await operation;
      if (outcome?.ok) resultDelivered = false;
      render();
    }
  }

  function togglePause() {
    const phase = game.getSnapshot().phase;
    if (phase === "playing") game.pause();
    else if (phase === "paused") game.resume();
    render();
  }

  function mount() {
    if (mounted) return false;
    mounted = true;
    view.setPrimaryActionHandler(performPrimaryAction);
    view.setPauseHandler(togglePause);
    adapter.mount();
    focusLifecycle = attachFocusLifecycle({
      session: game,
      windowTarget,
      documentTarget,
      onPause: render,
    });
    const tickMs = game.getSnapshot().tickMs ?? 180;
    timer = setTimer(step, tickMs);
    render();
    return true;
  }

  function destroy() {
    if (!mounted) return false;
    mounted = false;
    adapter.unmount();
    focusLifecycle?.destroy();
    focusLifecycle = null;
    game.cancelPendingSession?.();
    if (timer !== null) clearTimer(timer);
    timer = null;
    return true;
  }

  return { mount, destroy, step, performPrimaryAction, togglePause };
}
