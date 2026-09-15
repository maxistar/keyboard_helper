import { attachFocusLifecycle, consumeResult } from "../mini_games/runtime.js";
import { createSemanticInputAdapter } from "../mini_games/input.js";

export function createFlappyKeyBirdController({
  game,
  view,
  windowTarget = globalThis.window,
  documentTarget = globalThis.document,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis)
    ?? ((callback) => globalThis.setTimeout(() => callback(Date.now()), 16)),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) ?? globalThis.clearTimeout,
  resultConsumer = null,
} = {}) {
  let mounted = false;
  let frame = null;
  let previousFrameAt = null;
  let resultDelivered = false;
  let focusLifecycle = null;

  function render() {
    const snapshot = game.getSnapshot();
    view.render(snapshot);
    if (snapshot.phase === "game-over" && !resultDelivered) {
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

  function step(elapsedMs) {
    game.tick(elapsedMs);
    render();
  }

  function animationFrame(timestamp) {
    if (!mounted) return;
    const elapsed = previousFrameAt === null ? 0 : Math.max(0, timestamp - previousFrameAt);
    previousFrameAt = timestamp;
    if (elapsed > 0) step(elapsed);
    frame = requestFrame(animationFrame);
  }

  async function performPrimaryAction() {
    const phase = game.getSnapshot().phase;
    let operation = null;
    if (phase === "ready") operation = game.start();
    else if (phase === "paused") game.resume();
    else if (phase === "game-over") operation = game.replay();
    render();
    if (operation) {
      const outcome = await operation;
      if (outcome?.ok) resultDelivered = false;
      previousFrameAt = null;
      render();
    }
  }

  function togglePause() {
    const phase = game.getSnapshot().phase;
    if (phase === "playing") game.pause();
    else if (phase === "paused") game.resume();
    previousFrameAt = null;
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
      onPause() {
        previousFrameAt = null;
        render();
      },
    });
    render();
    frame = requestFrame(animationFrame);
    return true;
  }

  function destroy() {
    if (!mounted) return false;
    mounted = false;
    adapter.unmount();
    focusLifecycle?.destroy();
    focusLifecycle = null;
    game.cancelPendingSession?.();
    if (frame !== null) cancelFrame(frame);
    frame = null;
    previousFrameAt = null;
    return true;
  }

  return { mount, destroy, step, performPrimaryAction, togglePause };
}
