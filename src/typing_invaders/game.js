import { createTypingInvadersController } from "./controller.js";
import { createTypingInvadersGame } from "./model.js";
import { createTypingInvadersView } from "./view.js";
import { initializeSecondaryWindow, SECONDARY_WINDOWS } from "../secondary_window_ready.js";

window.addEventListener("DOMContentLoaded", async () => {
  await initializeSecondaryWindow({
    invoke: window.__TAURI__?.core?.invoke,
    label: SECONDARY_WINDOWS.typingInvaders.label,
    initialize: async () => {
      const game = createTypingInvadersGame();
      const view = createTypingInvadersView(document);
      const controller = createTypingInvadersController({ game, view });
      controller.mount();
    },
  }).catch((error) => console.error("Shift-Space Invaders initialization failed:", error));
});
