import { initializeSecondaryWindow, SECONDARY_WINDOWS } from "../secondary_window_ready.js";
import { createFishingController } from "./controller.js";
import { createFishingGameFromSources } from "./model.js";
import { createFishingView } from "./view.js";

window.addEventListener("DOMContentLoaded", async () => {
  await initializeSecondaryWindow({
    invoke: window.__TAURI__?.core?.invoke,
    label: SECONDARY_WINDOWS.underwaterTypingFishing.label,
    initialize: async () => {
      const controller = createFishingController({
        game: createFishingGameFromSources(),
        view: createFishingView(document),
      });
      controller.mount();
      window.addEventListener("beforeunload", () => controller.destroy(), { once: true });
    },
  }).catch((error) => console.error("Underwater Typing Fishing initialization failed:", error));
});
