import { MobileLayoutViewerModel, ViewerCatalogStatus } from "./layout_viewer_model.js";
import { LayoutPresentationMode } from "./layout_live_presentation.js";

function required(document, id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Mobile layout viewer is missing #${id}.`);
  return element;
}

function renderKeyContent(document, element, key, pressed, combo) {
  const children = [];
  if (key.image) {
    const image = document.createElement("img");
    image.className = "viewer-key-image";
    image.src = key.image;
    image.alt = "";
    children.push(image);
  } else {
    const label = document.createElement("span");
    label.textContent = key.label;
    children.push(label);
  }
  if (pressed || combo) {
    const state = document.createElement("span");
    state.className = "viewer-key-state";
    state.textContent = pressed ? "DOWN" : "COMBO";
    children.push(state);
  }
  element.replaceChildren(...children);
}

function updateKey(document, element, key, pressedPositions, comboPositions) {
  const pressed = pressedPositions.has(key.index);
  const combo = comboPositions.has(key.index);
  element.className = `viewer-key ${key.kind}`.trim();
  element.dataset.position = String(key.index);
  element.dataset.pressed = String(pressed);
  element.dataset.combo = String(combo);
  element.setAttribute("aria-label", `${key.accessibleLabel}${pressed ? ", pressed" : combo ? ", active combo" : ""}`);
  element.setAttribute("aria-pressed", String(pressed || combo));
  element.style.setProperty("--viewer-row", key.row);
  element.style.setProperty("--viewer-col", key.col);
  element.style.setProperty("--viewer-width", key.widthUnits);
  element.style.setProperty("--viewer-height", key.heightUnits);
  element.style.setProperty("--viewer-angle", `${key.angle}deg`);
  renderKeyContent(document, element, key, pressed, combo);
}

function renderKey(document, key, pressedPositions, comboPositions) {
  const element = document.createElement("div");
  element.setAttribute("role", "img");
  updateKey(document, element, key, pressedPositions, comboPositions);
  return element;
}

function streamCopy(snapshot) {
  const copy = {
    idle: ["Browse mode", "Connect an enhanced keyboard to follow its live state."],
    unavailable: ["Live unavailable", "This keyboard does not provide a supported read-only event stream. Browse remains available."],
    subscribing: ["Starting Live", "Approve pairing if Android asks, then keep Keyboard Helper in the foreground."],
    "awaiting-stream-start": ["Waiting for Live", "The subscription is ready; waiting for this phone's stream boundary."],
    live: ["Live telemetry active", "Physical key, combo, and firmware-owned layer state are shown without controlling the keyboard."],
    failed: ["Live enrollment failed", "Keep the connection ready, confirm pairing, then disconnect and reconnect to retry."],
    stale: ["Live telemetry ended", "Transient key and combo indicators were cleared. Browse remains available."],
  };
  if (snapshot.telemetryStatus === "unavailable" && snapshot.telemetryReason?.code === "unsupported-protocol-major") {
    return ["Unsupported telemetry version", "Update Keyboard Helper or the keyboard firmware to a compatible version. Browse remains available."];
  }
  if (snapshot.telemetryStatus === "unavailable" && snapshot.telemetryReason?.code === "event-kinds-unavailable") {
    return ["Live events unavailable", "This firmware advertises no supported read-only event kinds. Browse remains available."];
  }
  if (snapshot.telemetryStatus === "unavailable" && snapshot.telemetryReason?.code === "event-characteristic-unavailable") {
    return ["Live extension incomplete", "The event characteristic is absent. Browse and connection details remain available."];
  }
  return copy[snapshot.telemetryStatus] ?? copy.idle;
}

function diagnosticsCopy(snapshot) {
  const issues = [];
  for (const item of snapshot.mismatches) {
    if (item.kind === "layer") issues.push(`Layer ${item.layer} is not available in the selected layout.`);
    if (item.kind === "position") issues.push(`Position ${item.position} is not available in the selected layout.`);
    if (item.kind === "combo") issues.push(`Combo ${item.comboId} has no exact match in the selected layout.`);
  }
  for (const item of snapshot.diagnostics) {
    if (item.code === "sequence-gap") issues.push("Some live events were missed; held indicators were cleared.");
    else if (item.code === "keyboard-diagnostic") issues.push(item.message);
    else if (item.code === "frame-rejected") issues.push("An invalid keyboard telemetry frame was ignored.");
    else if (item.code === "event-kind-not-advertised") issues.push("The keyboard sent an event kind it did not advertise.");
    else if (item.code === "invalid-stream-start") issues.push("The keyboard stream did not begin with the required layer snapshot.");
  }
  return [...new Set(issues)].slice(0, 4);
}

function browsePresentation(snapshot) {
  return {
    mode: LayoutPresentationMode.BROWSE,
    liveAvailable: false,
    selectedLayoutKey: snapshot.selectedLayoutKey,
    selectedLayerIndex: snapshot.selectedLayerIndex,
    activeLayer: null,
    layerAuthoritative: false,
    presentation: snapshot.presentation,
    pressedPositions: [],
    comboPositions: [],
    activeCombos: [],
    mismatches: [],
    telemetryStatus: "idle",
    telemetryReason: null,
    diagnostics: [],
  };
}

export function createMobileLayoutViewerView(document, model = new MobileLayoutViewerModel(), presentationController = null) {
  const elements = {
    layout: required(document, "viewer-layout"),
    layers: required(document, "viewer-layers"),
    summary: required(document, "viewer-summary"),
    diagnostic: required(document, "viewer-diagnostic"),
    scroller: required(document, "viewer-scroller"),
    keyboard: required(document, "viewer-keyboard"),
    empty: required(document, "viewer-empty"),
    browseMode: required(document, "viewer-mode-browse"),
    liveMode: required(document, "viewer-mode-live"),
    streamStatus: required(document, "viewer-stream-status"),
    currentLayer: required(document, "viewer-current-layer"),
    comboStatus: required(document, "viewer-combo-status"),
    guidance: required(document, "viewer-telemetry-guidance"),
  };
  let renderedCatalog = null;
  let renderedLayout = null;
  let renderedKeyboard = null;
  let keyElements = [];
  let layerButtons = [];
  let lastStreamTitle = null;

  function renderCatalog(snapshot) {
    const signature = snapshot.layouts.map(({ key, name }) => `${key}:${name}`).join("|");
    if (signature === renderedCatalog) return;
    renderedCatalog = signature;
    elements.layout.replaceChildren();
    for (const layout of snapshot.layouts) {
      const option = document.createElement("option");
      option.value = layout.key;
      option.textContent = layout.name;
      elements.layout.append(option);
    }
  }

  function renderLayers(browse) {
    if (renderedLayout === browse.selectedLayoutKey) return;
    renderedLayout = browse.selectedLayoutKey;
    layerButtons = [];
    elements.layers.replaceChildren();
    for (const layer of browse.presentation?.layers ?? []) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "viewer-layer";
      button.dataset.layerIndex = String(layer.index);
      button.textContent = layer.name;
      button.addEventListener("click", () => model.selectLayer(layer.index));
      layerButtons.push(button);
      elements.layers.append(button);
    }
  }

  function renderKeyboard(snapshot) {
    const pressed = new Set(snapshot.pressedPositions);
    const combos = new Set(snapshot.comboPositions);
    const signature = `${snapshot.selectedLayoutKey}:${snapshot.presentation.keys.length}`;
    if (signature !== renderedKeyboard) {
      renderedKeyboard = signature;
      keyElements = snapshot.presentation.keys.map((key) => renderKey(document, key, pressed, combos));
      elements.keyboard.replaceChildren(...keyElements);
    } else {
      snapshot.presentation.keys.forEach((key, index) => updateKey(document, keyElements[index], key, pressed, combos));
    }
  }

  function render(resolved = presentationController?.snapshot() ?? browsePresentation(model.snapshot())) {
    const browse = model.snapshot();
    const ready = browse.catalogStatus === ViewerCatalogStatus.READY && resolved.presentation;
    renderCatalog(browse);
    elements.layout.disabled = !ready;
    elements.layout.value = browse.selectedLayoutKey ?? "";
    elements.empty.hidden = Boolean(ready);
    elements.scroller.hidden = !ready;
    elements.layers.hidden = !ready;
    elements.browseMode.setAttribute("aria-pressed", String(resolved.mode === LayoutPresentationMode.BROWSE));
    elements.liveMode.setAttribute("aria-pressed", String(resolved.mode === LayoutPresentationMode.LIVE));
    elements.liveMode.disabled = !resolved.liveAvailable;
    const [streamTitle, guidance] = streamCopy(resolved);
    if (lastStreamTitle !== streamTitle) {
      elements.streamStatus.textContent = streamTitle;
      lastStreamTitle = streamTitle;
    }
    elements.guidance.textContent = guidance;
    elements.currentLayer.textContent = resolved.mode === LayoutPresentationMode.LIVE
      ? resolved.layerAuthoritative ? `Firmware layer: ${resolved.presentation.layerName}` : "Firmware layer unavailable"
      : `Browsing: ${resolved.presentation?.layerName ?? "no layer"}`;
    elements.comboStatus.textContent = resolved.activeCombos.length
      ? `Active: ${resolved.activeCombos.map(({ label }) => label).join(", ")}`
      : "No active firmware-resolved combo.";
    elements.comboStatus.hidden = resolved.mode !== LayoutPresentationMode.LIVE;
    const diagnostics = [...browse.diagnostics, ...diagnosticsCopy(resolved)].slice(0, 4);
    elements.diagnostic.textContent = diagnostics.join(" ");
    elements.diagnostic.hidden = diagnostics.length === 0;
    if (!ready) {
      elements.summary.textContent = "No bundled keyboard layout is available.";
      elements.keyboard.replaceChildren();
      renderedKeyboard = null;
      keyElements = [];
      return;
    }

    renderLayers(browse);
    layerButtons.forEach((button, index) => {
      const selected = index === resolved.selectedLayerIndex;
      button.setAttribute("aria-pressed", String(selected));
      button.dataset.selected = String(selected);
      button.disabled = resolved.mode === LayoutPresentationMode.LIVE;
    });
    elements.summary.textContent = `${resolved.mode === LayoutPresentationMode.LIVE ? "Live" : "Browse"} · ${resolved.presentation.name} · ${resolved.presentation.layerName}`;
    elements.keyboard.style.width = `${resolved.presentation.width}px`;
    elements.keyboard.style.height = `${resolved.presentation.height}px`;
    elements.keyboard.style.setProperty("--viewer-key-width", `${resolved.presentation.keySize.w}px`);
    elements.keyboard.style.setProperty("--viewer-key-height", `${resolved.presentation.keySize.h}px`);
    elements.keyboard.style.setProperty("--viewer-key-gap", `${resolved.presentation.keySize.gap}px`);
    renderKeyboard(resolved);
  }

  const onLayoutChange = () => model.selectLayout(elements.layout.value);
  const onBrowseMode = () => presentationController?.selectMode(LayoutPresentationMode.BROWSE);
  const onLiveMode = () => presentationController?.selectMode(LayoutPresentationMode.LIVE);
  elements.layout.addEventListener("change", onLayoutChange);
  elements.browseMode.addEventListener("click", onBrowseMode);
  elements.liveMode.addEventListener("click", onLiveMode);
  const unsubscribe = presentationController
    ? presentationController.subscribe(render)
    : model.subscribe((snapshot) => render(browsePresentation(snapshot)));
  return {
    model,
    render,
    dispose() {
      unsubscribe();
      elements.layout.removeEventListener?.("change", onLayoutChange);
      elements.browseMode.removeEventListener?.("click", onBrowseMode);
      elements.liveMode.removeEventListener?.("click", onLiveMode);
    },
  };
}

export function mountMobileLayoutViewer(document = globalThis.document) {
  return createMobileLayoutViewerView(document);
}
