import { initializeSecondaryWindow, SECONDARY_WINDOWS } from "../secondary_window_ready.js";
import { createFlappyKeyBirdController } from "./controller.js";
import { createFlappyGameFromSources } from "./model.js";
import { createFlappyKeyBirdView } from "./view.js";

window.addEventListener("DOMContentLoaded", async () => {
  await initializeSecondaryWindow({
    invoke: window.__TAURI__?.core?.invoke,
    label: SECONDARY_WINDOWS.flappyKeyBird.label,
    initialize: async () => {
      const controller = createFlappyKeyBirdController({
        game: await createFlappyGameFromSources(),
        view: createFlappyKeyBirdView(document),
      });
      controller.mount();
      window.addEventListener("beforeunload", () => controller.destroy(), { once: true });
    },
  }).catch((error) => console.error("Flappy Key-Bird initialization failed:", error));
});
