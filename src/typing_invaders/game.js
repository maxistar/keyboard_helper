import { createTypingInvadersController } from "./controller.js";
import { createTypingInvadersGame } from "./model.js";
import { createTypingInvadersView } from "./view.js";
import { initializeSecondaryWindow, SECONDARY_WINDOWS } from "../secondary_window_ready.js";
import { createExerciseAnalytics } from "./exercise_analytics.js";

window.addEventListener("DOMContentLoaded", async () => {
  await initializeSecondaryWindow({
    invoke: window.__TAURI__?.core?.invoke,
    label: SECONDARY_WINDOWS.typingInvaders.label,
    initialize: async () => {
      const tauri = window.__TAURI__;
      const configState = await tauri?.core?.invoke?.("read_config_state");
      const config = configState?.status === "valid" ? configState.data : {};
      const game = createTypingInvadersGame();
      const view = createTypingInvadersView(document);
      const analytics = createExerciseAnalytics({
        enabled: config?.typingAnalytics?.exercise === true,
        layout: config?.defaultLayout,
        hasFocus: () => document.hasFocus(),
        emitOwnership: (payload) => void tauri?.event?.emit?.("typing-exercise-ownership", payload),
        record: (record) => tauri?.core?.invoke?.("record_typing_analytics", { record }),
      });
      const controller = createTypingInvadersController({ game, view, onSnapshot: analytics.onSnapshot });
      controller.mount();
      tauri?.event?.listen?.("app-settings-saved", async () => {
        const latest = await tauri.core.invoke("read_config_state");
        analytics.setEnabled(latest?.status === "valid" && latest.data?.typingAnalytics?.exercise === true);
      }).catch((error) => console.error("Failed to refresh exercise analytics settings:", error));
      window.addEventListener("focus", () => analytics.publishOwnership(game.getSnapshot().phase === "playing"));
      window.addEventListener("pagehide", () => analytics.publishOwnership(false), { once: true });
    },
  }).catch((error) => console.error("Shift-Space Invaders initialization failed:", error));
});
