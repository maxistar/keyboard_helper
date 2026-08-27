export function gameplayCharacter(event) {
  if (
    event?.repeat
    || event?.isComposing
    || event?.ctrlKey
    || event?.metaKey
    || event?.altKey
    || !/^[a-z]$/i.test(event?.key ?? "")
  ) return null;
  return event.key.toLowerCase();
}

export function createTypingInvadersController({
  game,
  view,
  windowTarget = window,
  documentTarget = document,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
} = {}) {
  let frameId = null;
  let lastTimestamp = null;
  let mounted = false;

  function render() {
    view.render(game.getSnapshot(), game.drainEvents());
  }

  function performPrimaryAction() {
    const phase = game.getSnapshot().phase;
    if (phase === "ready") game.start();
    else if (phase === "game-over") game.replay();
    else if (phase === "paused") game.resume();
    render();
  }

  function onKeydown(event) {
    const phase = game.getSnapshot().phase;
    if (event.key === "Escape" && !event.repeat) {
      if (phase === "playing") game.pause("manual");
      else if (phase === "paused") game.resume();
      else return;
      event.preventDefault?.();
      render();
      return;
    }
    if (phase !== "playing") return;
    const character = gameplayCharacter(event);
    if (!character) return;
    event.preventDefault?.();
    game.typeCharacter(character);
    render();
  }

  function pauseForFocus() {
    if (game.pause("focus")) render();
  }

  function onVisibilityChange() {
    if (documentTarget.hidden) pauseForFocus();
  }

  function step(timestamp) {
    if (lastTimestamp === null) lastTimestamp = timestamp;
    const delta = Math.max(0, timestamp - lastTimestamp);
    lastTimestamp = timestamp;
    game.tick(delta);
    render();
  }

  function frame(timestamp) {
    step(timestamp);
    frameId = requestFrame(frame);
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    view.setActionHandler(performPrimaryAction);
    windowTarget.addEventListener("keydown", onKeydown);
    windowTarget.addEventListener("blur", pauseForFocus);
    documentTarget.addEventListener("visibilitychange", onVisibilityChange);
    render();
    frameId = requestFrame(frame);
  }

  function destroy() {
    if (!mounted) return;
    mounted = false;
    windowTarget.removeEventListener("keydown", onKeydown);
    windowTarget.removeEventListener("blur", pauseForFocus);
    documentTarget.removeEventListener("visibilitychange", onVisibilityChange);
    if (frameId !== null) cancelFrame(frameId);
    frameId = null;
    lastTimestamp = null;
  }

  return { mount, destroy, step, onKeydown, pauseForFocus, performPrimaryAction };
}
