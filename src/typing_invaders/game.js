import { createTypingInvadersController } from "./controller.js";
import { createTypingInvadersGame } from "./model.js";
import { createTypingInvadersView } from "./view.js";
import { initializeSecondaryWindow, SECONDARY_WINDOWS } from "../secondary_window_ready.js";
import { createExerciseAnalytics } from "./exercise_analytics.js";
import { createLessonCatalog, createLessonTargetProvider, createWeakSpotLesson } from "../typing_lessons.js";
import { buildAnalyticsReport } from "../typing_analytics.js";
import { loadLayoutDefinition } from "../layout_catalog.js";

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
      const select = document.getElementById("lessonSelect");
      const diagnostics = document.getElementById("lessonDiagnostics");
      const weakSpotReading = document.getElementById("weakSpotReading");
      const weakSpotReadingLabel = document.getElementById("weakSpotReadingLabel");
      const layoutKey = config?.defaultLayout;
      const layoutSource = config?.layouts?.[layoutKey];
      const loadedLayout = layoutKey ? await loadLayoutDefinition(layoutKey, layoutSource, {
        readExternal: (path) => tauri?.core?.invoke?.("read_layout_file", { path }),
      }) : { definition: null };
      const catalog = createLessonCatalog({
        imported: config?.typingLessons ?? [],
        layoutDefinition: loadedLayout.definition,
      });
      let weakPairs = [];
      const applySelectedLesson = () => {
        const lesson = catalog.lessons.find((entry) => entry.id === select.value) ?? null;
        const provider = lesson ? createLessonTargetProvider(lesson) : null;
        game.setTargetProvider(provider);
        const issues = provider?.diagnostics ?? [];
        diagnostics.textContent = issues.length ? `${issues.length} lesson target${issues.length === 1 ? " is" : "s are"} unavailable in Invaders.` : "";
      };
      const addLessonOption = (lesson) => {
        if (select.querySelector(`option[value="${lesson.id}"]`)) return;
        const option = document.createElement("option");
        option.value = lesson.id;
        option.textContent = lesson.name;
        select.appendChild(option);
      };
      try {
        const rows = await tauri?.core?.invoke?.("read_typing_analytics", { from: null, to: null }) ?? [];
        const report = buildAnalyticsReport({ settings: config?.typingAnalytics, rows });
        weakPairs = report.rows.filter((row) => row.type === "pair" && (row.classification?.state === "slow" || row.correctionCount > 0));
        const weak = createWeakSpotLesson(weakPairs);
        if (weak.lesson) catalog.lessons.push(weak.lesson);
        if (weak.pending.length) {
          weakSpotReadingLabel.hidden = false;
          diagnostics.textContent = "Choose a reading to use personal weak spots with unknown language context.";
        }
      } catch { /* Lessons remain available when analytics has no local data. */ }
      catalog.lessons.forEach(addLessonOption);
      weakSpotReading.addEventListener("change", () => {
        if (!weakSpotReading.value) return;
        const weak = createWeakSpotLesson(weakPairs, { language: weakSpotReading.value });
        if (!weak.lesson) return;
        const index = catalog.lessons.findIndex((entry) => entry.id === weak.lesson.id);
        if (index >= 0) catalog.lessons[index] = weak.lesson;
        else catalog.lessons.push(weak.lesson);
        addLessonOption(weak.lesson);
        if (select.value === weak.lesson.id) applySelectedLesson();
        else diagnostics.textContent = "";
      });
      select.addEventListener("change", applySelectedLesson);
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
