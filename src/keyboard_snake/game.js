import { initializeSecondaryWindow, SECONDARY_WINDOWS } from "../secondary_window_ready.js";
import { createKeyboardSnakeController } from "./controller.js";
import { createSnakeGameFromSources } from "./model.js";
import { createKeyboardSnakeView } from "./view.js";

window.addEventListener("DOMContentLoaded", async () => {
  await initializeSecondaryWindow({
    invoke: window.__TAURI__?.core?.invoke,
    label: SECONDARY_WINDOWS.keyboardSnake.label,
    initialize: async () => {
      const controller = createKeyboardSnakeController({
        game: await createSnakeGameFromSources(),
        view: createKeyboardSnakeView(document),
      });
      controller.mount();
      window.addEventListener("beforeunload", () => controller.destroy(), { once: true });
    },
  }).catch((error) => console.error("Keyboard Snake initialization failed:", error));
});
