import { createTypingInvadersController } from "./controller.js";
import { createTypingInvadersGame } from "./model.js";
import { createTypingInvadersView } from "./view.js";

window.addEventListener("DOMContentLoaded", () => {
  const game = createTypingInvadersGame();
  const view = createTypingInvadersView(document);
  const controller = createTypingInvadersController({ game, view });
  controller.mount();
});
