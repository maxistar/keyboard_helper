import { loadLayoutCatalog, normalizeLayerData } from "./layout_catalog.js";
import { buildTestPlan, createSelfTestController } from "./self_test/controller.js";
import { createOverlayPresentationPayload } from "./self_test/overlay_presentation.js";
import { initializeSecondaryWindow, SECONDARY_WINDOWS } from "./secondary_window_ready.js";

const elements = Object.fromEntries([
  "setupView", "activeView", "resultsView", "layoutSelect", "layerSelect", "catalogErrors", "testability",
  "startButton", "selectionLabel", "progressText", "progressBar", "instruction", "expectedCode",
  "receivedCode", "mismatchActions", "waitingActions", "retryButton", "problemButton", "skipButton", "stopButton",
  "resultCounts", "problemList", "retestButton", "anotherLayerButton", "closeButton", "closeResultsButton", "liveStatus",
].map((id) => [id, document.getElementById(id)]));

const tauri = window.__TAURI__;
let catalog = null;
let selectedLayoutKey = null;
let selectedLayerIndex = 0;

async function readConfig() {
  if (!tauri?.core?.invoke) return null;
  const result = await tauri.core.invoke("read_config_state");
  return result?.status === "valid" ? result.data : null;
}

function currentData() {
  const definition = catalog?.definitions[selectedLayoutKey];
  const normalized = normalizeLayerData(definition?.keyLayers);
  return { definition, ...normalized };
}

function renderSetup() {
  const { definition, layers, names } = currentData();
  elements.layerSelect.innerHTML = "";
  names.forEach((name, index) => {
    const option = document.createElement("option"); option.value = String(index); option.textContent = name; elements.layerSelect.appendChild(option);
  });
  selectedLayerIndex = Math.min(selectedLayerIndex, Math.max(0, layers.length - 1));
  elements.layerSelect.value = String(selectedLayerIndex);
  elements.layerSelect.disabled = !layers.length;
  const plan = definition ? buildTestPlan({ layoutKey: selectedLayoutKey, definition, layers, layerNames: names, layerIndex: selectedLayerIndex }) : null;
  const testable = plan?.testableIndexes.length ?? 0;
  const notTestable = plan?.entries.filter((entry) => !entry.descriptor.supported).length ?? 0;
  elements.testability.textContent = plan ? `${testable} guided positions · ${notTestable} not testable from HID events` : "No compatible layout is available.";
  elements.startButton.disabled = testable === 0;
  elements.selectionLabel.textContent = definition ? `${definition.name} · ${names[selectedLayerIndex] ?? "Layer"}` : "";
}

function publishOverlay(snapshot) {
  if (!tauri?.event?.emitTo) return;
  tauri.event
    .emitTo("overlay", "self-test-overlay-state", createOverlayPresentationPayload(snapshot))
    .catch((error) => console.error("Failed to update the overlay self-test presentation:", error));
}

function renderResults(snapshot) {
  elements.resultCounts.innerHTML = "";
  for (const [status, label] of Object.entries({ passed: "Passed", unexpected: "Unexpected", skipped: "Skipped", "not-testable": "Not testable" })) {
    const item = document.createElement("div"); item.innerHTML = `<strong>${snapshot.counts[status]}</strong>${label}`; elements.resultCounts.appendChild(item);
  }
  elements.problemList.innerHTML = "";
  for (const [index, result] of Object.entries(snapshot.results)) {
    if (!["unexpected", "skipped"].includes(result.status)) continue;
    const entry = snapshot.plan.entries[Number(index)];
    const item = document.createElement("li");
    item.textContent = `${entry.label || `Position ${Number(index) + 1}`}: expected ${result.expected || "—"}${result.received ? `, received ${result.received}` : ", no event received"}`;
    elements.problemList.appendChild(item);
  }
  elements.retestButton.disabled = snapshot.counts.unexpected + snapshot.counts.skipped === 0;
  elements.liveStatus.textContent = `Test complete. ${snapshot.counts.passed} passed, ${snapshot.counts.unexpected} unexpected, ${snapshot.counts.skipped} skipped.`;
}

function render(snapshot) {
  const setup = snapshot.phase === "setup";
  const complete = snapshot.phase === "complete";
  elements.setupView.hidden = !setup;
  elements.activeView.hidden = setup || complete;
  elements.resultsView.hidden = !complete;
  if (setup) { renderSetup(); return; }
  elements.selectionLabel.textContent = `${snapshot.plan.layoutName} · ${snapshot.plan.layerName}`;
  if (complete) { renderResults(snapshot); elements.retestButton.focus(); return; }
  const current = snapshot.current;
  elements.progressText.textContent = `Position ${snapshot.cursor + 1} of ${snapshot.total}`;
  elements.progressBar.max = snapshot.total; elements.progressBar.value = snapshot.cursor;
  const keyLabel = current.label || current.rawCode;
  elements.instruction.textContent = snapshot.phase === "waiting-clean"
    ? "Release all keys to continue"
    : snapshot.phase === "chord-active"
      ? `Release ${keyLabel}${current.descriptor.modifiers.length ? " and its modifiers" : ""}`
      : snapshot.phase === "mismatch"
        ? "Unexpected output received"
        : `Press ${keyLabel}`;
  elements.expectedCode.textContent = current.rawCode;
  elements.receivedCode.textContent = snapshot.received ?? "—";
  elements.mismatchActions.hidden = snapshot.phase !== "mismatch";
  elements.waitingActions.hidden = snapshot.phase === "mismatch";
  elements.skipButton.disabled = snapshot.phase === "waiting-clean";
  elements.liveStatus.textContent = `${elements.instruction.textContent}. Expected ${current.rawCode}${snapshot.received ? `. Received ${snapshot.received}` : ""}.`;
  if (snapshot.phase === "mismatch") elements.retryButton.focus();
}

const controller = createSelfTestController({
  onChange: (snapshot) => {
    render(snapshot);
    publishOverlay(snapshot);
  },
});

function startSelectedPlan() {
  const { definition, layers, names } = currentData();
  if (!definition) return;
  controller.start(buildTestPlan({ layoutKey: selectedLayoutKey, definition, layers, layerNames: names, layerIndex: selectedLayerIndex }));
}

async function closeWindow() {
  controller.dispose();
  const handle = tauri?.window?.getCurrentWindow?.();
  if (handle?.destroy) await handle.destroy(); else if (handle?.close) await handle.close(); else globalThis.close?.();
}

elements.layoutSelect.addEventListener("change", () => { selectedLayoutKey = elements.layoutSelect.value; selectedLayerIndex = 0; renderSetup(); });
elements.layerSelect.addEventListener("change", () => { selectedLayerIndex = Number(elements.layerSelect.value); renderSetup(); });
elements.startButton.addEventListener("click", startSelectedPlan);
elements.retryButton.addEventListener("click", () => controller.retry());
elements.problemButton.addEventListener("click", () => controller.markProblem());
elements.skipButton.addEventListener("click", () => controller.skip());
elements.stopButton.addEventListener("click", () => { if (globalThis.confirm("Stop this test and discard its progress?")) controller.stop(); });
elements.retestButton.addEventListener("click", () => controller.retestProblems());
elements.anotherLayerButton.addEventListener("click", () => controller.stop());
elements.closeButton.addEventListener("click", closeWindow);
elements.closeResultsButton.addEventListener("click", closeWindow);

async function initialize() {
  try {
    const rawConfig = await readConfig();
    catalog = await loadLayoutCatalog(rawConfig, {
      readExternal: tauri?.core?.invoke ? (path) => tauri.core.invoke("read_layout_file", { path }) : null,
    });
    const seeded = new URLSearchParams(window.location.search).get("layout");
    selectedLayoutKey = catalog.definitions[seeded] ? seeded : catalog.config.defaultLayout;
    if (!catalog.definitions[selectedLayoutKey]) selectedLayoutKey = Object.keys(catalog.definitions)[0] ?? null;
    elements.layoutSelect.innerHTML = "";
    for (const [key, definition] of Object.entries(catalog.definitions)) {
      const option = document.createElement("option"); option.value = key; option.textContent = definition.name ?? key; option.selected = key === selectedLayoutKey; elements.layoutSelect.appendChild(option);
    }
    elements.layoutSelect.disabled = !selectedLayoutKey;
    elements.catalogErrors.textContent = catalog.errors.join(" ");
    renderSetup();
    if (tauri?.event?.listen) {
      await tauri.event.listen("key_event", (event) => controller.handleKey(event.payload?.key, event.payload?.event_type));
    }
    publishOverlay(controller.getSnapshot());
  } catch (error) {
    elements.catalogErrors.textContent = `Could not load keyboard layouts: ${error?.message ?? error}`;
    elements.testability.textContent = "Guided testing is unavailable.";
    throw error;
  }
}

window.addEventListener("beforeunload", () => controller.dispose());
initializeSecondaryWindow({
  invoke: tauri?.core?.invoke,
  label: SECONDARY_WINDOWS.selfTest.label,
  failureStage: "asset-loading",
  initialize,
}).catch((error) => console.error("Self-test initialization failed:", error));
