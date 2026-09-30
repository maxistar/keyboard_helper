import { loadLayoutCatalog } from "../layout_catalog.js";
import { initializeSecondaryWindow, SECONDARY_WINDOWS } from "../secondary_window_ready.js";
import { createInsightsController } from "./controller.js";
import { sanitizeAiCoachingReport } from "../ai_coaching.js";

const byId = (id) => document.getElementById(id);

function confirmAiCoachingReport(document, preview) {
  const dialog = document.createElement("div");
  dialog.className = "ai-coaching-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "aiCoachingDialogTitle");
  dialog.innerHTML = `
    <div class="ai-coaching-dialog-form">
      <h2>Approve AI Coaching report</h2>
      <pre class="ai-coaching-preview"></pre>
      <p>This creates one approved aggregate snapshot for the local AI Coaching client.</p>
      <div class="dialog-actions">
        <button data-action="cancel" class="button secondary" type="button">Cancel</button>
        <button data-action="approve" class="button primary" type="button">Approve report</button>
      </div>
    </div>`;
  dialog.querySelector("h2").id = "aiCoachingDialogTitle";
  dialog.querySelector(".ai-coaching-preview").textContent = preview;
  document.body.appendChild(dialog);
  return new Promise((resolve) => {
    const close = (approved) => {
      resolve(approved);
      dialog.remove();
    };
    dialog.querySelector('[data-action="cancel"]').addEventListener("click", () => close(false), { once: true });
    const approve = dialog.querySelector('[data-action="approve"]');
    approve.addEventListener("click", () => close(true), { once: true });
    approve.focus();
  });
}

function showAiCoachingNotice(document, message, kind = "success") {
  const existing = document.querySelector(".ai-coaching-notice");
  existing?.remove();
  const notice = document.createElement("div");
  notice.className = `ai-coaching-notice ${kind}`;
  notice.setAttribute("role", "status");
  notice.textContent = message;
  document.querySelector("main")?.prepend(notice);
}

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
          prepareAi: byId("prepareAiButton"),
          status: byId("insightsStatus"),
          content: byId("insightsContent"),
        },
        readRows: (from, to) => tauri.core.invoke("read_typing_analytics", { from, to }),
        readSettings: async () => {
          const latest = await tauri.core.invoke("read_config_state");
          return latest?.status === "valid" ? latest.data?.typingAnalytics ?? {} : {};
        },
        readRecommendations: () => tauri.core.invoke("read_ai_coaching_recommendations"),
        catalog: { definitions: catalog.definitions, defaultLayout: catalog.config?.defaultLayout ?? null },
        openSettings: () => tauri?.core?.invoke?.("open_settings").catch((error) => console.error("Failed to open Settings:", error)),
        prepareAiCoaching: async (report) => {
          try {
            const safeReport = sanitizeAiCoachingReport(report);
            const preview = [
              `Period: ${safeReport.period?.from ?? "start"} to ${safeReport.period?.to ?? "today"}`,
              `Aggregate rows: ${safeReport.rows?.length ?? 0}`,
              `Omitted: ${safeReport.omittedData.join(", ")}`,
            ].join("\n");
            const approved = await confirmAiCoachingReport(document, preview);
            if (!approved) return;
            await tauri.core.invoke("approve_ai_coaching_report", { report: safeReport, aiCoachingEnabled: true });
            showAiCoachingNotice(document, "Report approved. Available to the local MCP client for up to 30 minutes or until Keyboard Helper closes.");
          } catch (error) {
            console.error("Failed to approve AI Coaching report:", error);
            showAiCoachingNotice(document, `Could not prepare the AI Coaching report: ${error?.message ?? error}`, "error");
          }
        },
      });
      await controller.load();
      tauri?.event?.listen?.("typing-analytics-deleted", () => controller.load())
        .catch((error) => console.error("Failed to listen for analytics deletion:", error));
    },
  }).catch((error) => console.error("Typing Insights initialization failed:", error));
});
