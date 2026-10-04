import { createTypingInvadersController } from "./controller.js";
import { createTypingInvadersGame } from "./model.js";
import { createTypingInvadersView } from "./view.js";

export function createBrowserTypingInvaders({
  documentTarget = globalThis.document,
  windowTarget = globalThis.window,
  requestFrame = globalThis.requestAnimationFrame,
  cancelFrame = globalThis.cancelAnimationFrame,
  gameOptions,
  gameFactory = createTypingInvadersGame,
  viewFactory = createTypingInvadersView,
  controllerFactory = createTypingInvadersController,
} = {}) {
  const game = gameFactory(gameOptions);
  const view = viewFactory(documentTarget);
  const controller = controllerFactory({
    game,
    view,
    documentTarget,
    windowTarget,
    requestFrame,
    cancelFrame,
  });
  controller.mount();
  return { game, view, controller, destroy: () => controller.destroy() };
}
