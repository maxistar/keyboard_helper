import { loadLayoutCatalog, normalizeLayerData } from "./layout_catalog.js";
import { buildTestPlan, createSelfTestController } from "./self_test/controller.js";
import { createOverlayPresentationPayload } from "./self_test/overlay_presentation.js";
import { initializeSecondaryWindow, SECONDARY_WINDOWS } from "./secondary_window_ready.js";
import { normalizeBleKeyboardFrame, normalizeSystemKeyEvent } from "./input_events.js";
import { createSelfTestLayerSession } from "./self_test/layer_session.js";

const elements = Object.fromEntries([
  "setupView", "activeView", "resultsView", "layoutSelect", "layerSelect", "catalogErrors", "testability",
  "startButton", "selectionLabel", "progressText", "progressBar", "instruction", "expectedCode",
  "receivedCode", "mismatchActions", "waitingActions", "retryButton", "problemButton", "skipButton", "stopButton",
  "resultCounts", "problemList", "retestButton", "anotherLayerButton", "closeButton", "closeResultsButton", "liveStatus",
  "transportDiagnostics",
  "layerControlStatus", "layerControlActions", "layerRetryButton", "manualContinueButton", "resultEvidence",
].map((id) => [id, document.getElementById(id)]));

const tauri = window.__TAURI__;
let catalog = null;
let selectedLayoutKey = null;
let selectedLayerIndex = 0;
let effectiveInputSource = "system";
let layerSessionState = { mode: "idle", message: null };
let layerSession = null;
let handledCompletionRevision = 0;

async function readConfig() {
  if (!tauri?.core?.invoke) return null;
  const result = await tauri.core.invoke("read_config_state");
  return result?.status === "valid" ? result.data : null;
}

function currentData() {
  const definition = catalog?.definitions[selectedLayoutKey];
  const normalized = normalizeLayerData(
    definition?.keyLayers,
    definition?.layerMetadata,
    definition?.keyPositions?.length,
  );
  return { definition, ...normalized };
}

function buildSelectedPlan() {
  const { definition, layers, names, layerKeys, layerMetadata } = currentData();
  if (!definition) return null;
  return buildTestPlan({
    layoutKey: selectedLayoutKey,
    definition,
    layers,
    layerNames: names,
    layerKeys,
    layerMetadata,
    layerIndex: selectedLayerIndex,
    inputSource: effectiveInputSource,
  });
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
  const plan = buildSelectedPlan();
  const testable = plan?.testableIndexes.length ?? 0;
  const notTestable = plan?.entries.filter((entry) => entry.kind === "key" && !entry.testable).length ?? 0;
  const combos = plan?.entries.filter((entry) => entry.kind === "combo").length ?? 0;
  elements.testability.textContent = plan
    ? `${testable} guided items${combos ? ` · ${combos} firmware combos` : ""} · HID output verification${effectiveInputSource === "ble" ? " · optional BLE position diagnostics" : " · no BLE position telemetry"}${notTestable ? ` · ${notTestable} not testable` : ""}`
    : "No compatible layout is available.";
  const activating = layerSessionState.mode === "activating";
  elements.startButton.disabled = testable === 0 || activating;
  elements.layoutSelect.disabled = !layers.length || activating;
  elements.layerSelect.disabled = !layers.length || activating;
  elements.selectionLabel.textContent = definition ? `${definition.name} · ${names[selectedLayerIndex] ?? "Layer"}` : "";
}

function renderLayerControlState() {
  const { mode, message } = layerSessionState;
  elements.layerControlStatus.dataset.state = mode;
  elements.layerControlStatus.textContent = message ?? (mode === "idle"
    ? "Layer activation will be selected when the test starts."
    : "");
  elements.layerControlActions.hidden = !["lost", "error"].includes(mode);
}

function publishOverlay(snapshot) {
  if (!tauri?.event?.emitTo) return;
  tauri.event
    .emitTo("overlay", "self-test-overlay-state", createOverlayPresentationPayload(snapshot))
    .catch((error) => console.error("Failed to update the overlay self-test presentation:", error));
}

function renderResults(snapshot) {
  elements.resultCounts.innerHTML = "";
  for (const [status, label] of Object.entries({ passed: "Passed (HID)", unexpected: "Unexpected", skipped: "Skipped", "not-testable": "Not testable" })) {
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
  const passedResults = Object.values(snapshot.results).filter((result) => result.status === "passed");
  const corroborated = passedResults.filter((result) => result.bleCorroborated).length;
  const warnings = passedResults.filter((result) => result.blePositionWarning).length;
  elements.resultEvidence.textContent = `${snapshot.counts.passed} ordinary items passed from system HID evidence. ${corroborated} had matching BLE position corroboration.${warnings ? ` ${warnings} had a BLE position warning.` : ""}`;
  elements.liveStatus.textContent = `Test complete. ${snapshot.counts.passed} passed, ${snapshot.counts.unexpected} unexpected, ${snapshot.counts.skipped} skipped.`;
}

function render(snapshot) {
  renderLayerControlState();
  const latestDiagnostic = snapshot.diagnostics?.at(-1);
  elements.transportDiagnostics.textContent = latestDiagnostic
    ? `BLE diagnostic: ${latestDiagnostic.code}${latestDiagnostic.message ? ` — ${latestDiagnostic.message}` : ""}`
    : "";
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
      : snapshot.phase === "paused"
        ? (snapshot.pauseReason ?? "Layer confirmation is required before continuing")
      : snapshot.phase === "mismatch"
        ? "Unexpected output received"
        : `Press ${keyLabel}`;
  elements.expectedCode.textContent = current.rawCode;
  elements.receivedCode.textContent = snapshot.received ?? "—";
  elements.mismatchActions.hidden = snapshot.phase !== "mismatch";
  elements.waitingActions.hidden = snapshot.phase === "mismatch";
  elements.skipButton.disabled = ["waiting-clean", "paused"].includes(snapshot.phase);
  elements.liveStatus.textContent = `${elements.instruction.textContent}. Expected ${current.rawCode}${snapshot.received ? `. Received ${snapshot.received}` : ""}.`;
  if (snapshot.phase === "mismatch") elements.retryButton.focus();
}

const controller = createSelfTestController({
  onChange: (snapshot) => {
    layerSession?.handleControllerSnapshot(snapshot);
    render(snapshot);
    publishOverlay(snapshot);
    if (snapshot.phase === "complete" && snapshot.completionRevision > handledCompletionRevision) {
      handledCompletionRevision = snapshot.completionRevision;
      void layerSession?.release();
    }
  },
});

layerSession = createSelfTestLayerSession({
  emit: (event, payload) => tauri?.event?.emitTo
    ? tauri.event.emitTo("overlay", event, payload)
    : Promise.resolve(),
  startPlan: (plan) => controller.start(plan),
  pauseTest: (reason) => controller.pause(reason),
  resumeTest: () => controller.resume(),
  onState: (state) => {
    layerSessionState = state;
    render(controller.getSnapshot());
  },
});

async function startSelectedPlan() {
  const plan = buildSelectedPlan();
  if (plan) await layerSession.start(plan);
}

async function closeWindow() {
  await layerSession.release();
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
elements.stopButton.addEventListener("click", async () => {
  if (!globalThis.confirm("Stop this test and discard its progress?")) return;
  await layerSession.release();
  controller.stop();
});
elements.retestButton.addEventListener("click", async () => {
  const plan = controller.createRetestPlan();
  if (plan) await layerSession.start(plan);
});
elements.anotherLayerButton.addEventListener("click", async () => {
  await layerSession.release();
  controller.stop();
});
elements.layerRetryButton.addEventListener("click", () => layerSession.retry());
elements.manualContinueButton.addEventListener("click", () => layerSession.continueManually());
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
      await tauri.event.listen("key_event", (event) => {
        const input = normalizeSystemKeyEvent(event.payload);
        if (input) controller.handleKey(input.code, input.action);
      });
      await tauri.event.listen("ble_keyboard_event", (event) => {
        if (effectiveInputSource !== "ble" || event.payload?.layout !== selectedLayoutKey) return;
        const input = normalizeBleKeyboardFrame(event.payload?.frame);
        if (input?.kind === "key") controller.handlePhysicalKey(input.position, input.action);
        if (input?.kind === "combo") controller.handleCombo(input.comboId, input.positions, input.action);
        if (input?.kind === "diagnostic") controller.reportDiagnostic("firmware-diagnostic", input);
      });
      await tauri.event.listen("ble_keyboard_diagnostic", (event) => {
        if (event.payload?.layout !== selectedLayoutKey) return;
        controller.reportDiagnostic(event.payload?.code ?? "ble-diagnostic", {
          message: event.payload?.message,
        });
      });
      await tauri.event.listen("self-test-source-state", (event) => {
        const next = event.payload?.effectiveSource === "ble" ? "ble" : "system";
        if (next === effectiveInputSource) return;
        const previous = effectiveInputSource;
        effectiveInputSource = next;
        controller.handleSourceTransition(previous, next, event.payload?.reason);
        if (controller.getSnapshot().phase === "setup") renderSetup();
      });
      await tauri.event.listen("self-test-layer-lease-status", (event) => {
        layerSession.handleLeaseStatus(event.payload ?? {});
      });
      await tauri.event.emitTo("overlay", "self-test-source-request", {});
    }
    publishOverlay(controller.getSnapshot());
  } catch (error) {
    elements.catalogErrors.textContent = `Could not load keyboard layouts: ${error?.message ?? error}`;
    elements.testability.textContent = "Guided testing is unavailable.";
    throw error;
  }
}

window.addEventListener("beforeunload", () => {
  void layerSession.release();
  controller.dispose();
});
initializeSecondaryWindow({
  invoke: tauri?.core?.invoke,
  label: SECONDARY_WINDOWS.selfTest.label,
  failureStage: "asset-loading",
  initialize,
}).catch((error) => console.error("Self-test initialization failed:", error));
