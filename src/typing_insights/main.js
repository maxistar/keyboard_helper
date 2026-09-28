import { loadLayoutCatalog } from "../layout_catalog.js";
import { initializeSecondaryWindow, SECONDARY_WINDOWS } from "../secondary_window_ready.js";
import { createInsightsController } from "./controller.js";

const byId = (id) => document.getElementById(id);

window.addEventListener("DOMContentLoaded", async () => {
  const tauri = window.__TAURI__;
  await initializeSecondaryWindow({
    invoke: tauri?.core?.invoke,
    label: SECONDARY_WINDOWS.typingInsights.label,
    initialize: async () => {
      const configState = await tauri?.core?.invoke?.("read_config_state");
      const config = configState?.status === "valid" ? configState.data : null;
      const catalog = await loadLayoutCatalog(config, {
        readExternal: tauri?.core?.invoke ? (path) => tauri.core.invoke("read_layout_file", { path }) : null,
        createImageBitmapApi: globalThis.createImageBitmap?.bind(globalThis),
      });
      const controller = createInsightsController({
        document,
        elements: {
          from: byId("filterFrom"),
          to: byId("filterTo"),
          layout: byId("filterLayout"),
          language: byId("filterLanguage"),
          source: byId("filterSource"),
          minSamples: byId("filterMinSamples"),
          refresh: byId("refreshButton"),
          status: byId("insightsStatus"),
          content: byId("insightsContent"),
        },
        readRows: (from, to) => tauri.core.invoke("read_typing_analytics", { from, to }),
        readSettings: async () => {
          const latest = await tauri.core.invoke("read_config_state");
          return latest?.status === "valid" ? latest.data?.typingAnalytics ?? {} : {};
        },
        catalog: { definitions: catalog.definitions, defaultLayout: catalog.config?.defaultLayout ?? null },
        openSettings: () => tauri?.core?.invoke?.("open_settings").catch((error) => console.error("Failed to open Settings:", error)),
      });
      await controller.load();
      tauri?.event?.listen?.("typing-analytics-deleted", () => controller.load())
        .catch((error) => console.error("Failed to listen for analytics deletion:", error));
    },
  }).catch((error) => console.error("Typing Insights initialization failed:", error));
});
