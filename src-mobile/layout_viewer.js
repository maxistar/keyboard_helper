import { MobileLayoutViewerModel, ViewerCatalogStatus } from "./layout_viewer_model.js";
import "./shared-generated/keyboard_viewer.js";
import { renderKeyboardLayoutInto } from "./shared-generated/keyboard_viewer.js";
import { LayoutPresentationMode } from "./layout_live_presentation.js";
import { fitKeyboardCanvas, KeyboardCanvasOrientation } from "./keyboard_canvas_fit.js";
import {
  createCanvasGestureState,
  panCanvasGesture,
  resetCanvasGesture,
  zoomCanvasGesture,
} from "./keyboard_canvas_gesture.js";

function required(document, id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Mobile layout viewer is missing #${id}.`);
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

export function createMobileLayoutViewerView(
  document,
  model = new MobileLayoutViewerModel(),
  presentationController = null,
  options = {},
) {
  const elements = {
    layout: required(document, "viewer-layout"),
    layerField: required(document, "viewer-layer-field"),
    layer: required(document, "viewer-layer"),
    liveLayer: required(document, "viewer-live-layer"),
    liveLayerName: required(document, "viewer-live-layer-name"),
    diagnostic: required(document, "viewer-diagnostic"),
    scroller: required(document, "viewer-scroller"),
    gesture: required(document, "viewer-gesture"),
    canvas: required(document, "viewer-canvas"),
    keyboard: /** @type {import("./shared-generated/keyboard_viewer.js").KeyboardLayoutViewerElement} */ (required(document, "viewer-keyboard")),
    empty: required(document, "viewer-empty"),
    liveSwitch: required(document, "viewer-live-switch"),
    streamStatus: required(document, "viewer-stream-status"),
    comboStatus: required(document, "viewer-combo-status"),
    guidance: required(document, "viewer-telemetry-guidance"),
    importLayout: required(document, "viewer-import-layout"),
    removeControls: required(document, "viewer-remove-controls"),
    removeTarget: required(document, "viewer-remove-target"),
    removeLayout: required(document, "viewer-remove-layout"),
    layoutStatus: required(document, "viewer-layout-status"),
  };
  const layoutController = options.layoutController ?? null;
  const appWindow = options.window ?? globalThis.window;
  const emptyMessage = elements.empty.textContent || "No bundled keyboard layout is available.";
  const hydratingMessage = options.hydratingMessage ?? "Restoring keyboard layout…";
  let renderedCatalog = null;
  let lastStreamTitle = null;
  let currentPresentation = null;
  let currentFit = null;
  let gestureState = createCanvasGestureState();
  let resizeObserver = null;
  let scheduledFit = null;
  const activePointers = new Map();
  let pinchBaseline = null;
  let panPointer = null;

  function stageBounds() {
    const rect = elements.scroller.getBoundingClientRect?.();
    let width = Number.isFinite(rect?.width) && rect.width > 0
      ? rect.width
      : elements.scroller.clientWidth ?? 0;
    let height = Number.isFinite(rect?.height) && rect.height > 0
      ? rect.height
      : elements.scroller.clientHeight ?? 0;
    const style = typeof appWindow?.getComputedStyle === "function"
      ? appWindow.getComputedStyle(elements.scroller)
      : null;
    const horizontalPadding = [style?.paddingLeft, style?.paddingRight]
      .map((value) => Number.parseFloat(value))
      .filter(Number.isFinite)
      .reduce((total, value) => total + value, 0);
    const verticalPadding = [style?.paddingTop, style?.paddingBottom]
      .map((value) => Number.parseFloat(value))
      .filter(Number.isFinite)
      .reduce((total, value) => total + value, 0);
    width = Math.max(0, width - horizontalPadding);
    height = Math.max(0, height - verticalPadding);
    return { width, height };
  }

  function canvasOrientation({ width, height }) {
    const query = appWindow?.matchMedia?.("(orientation: portrait)");
    if (typeof query?.matches === "boolean") {
      return query.matches ? KeyboardCanvasOrientation.PORTRAIT : KeyboardCanvasOrientation.LANDSCAPE;
    }
    return height > width ? KeyboardCanvasOrientation.PORTRAIT : KeyboardCanvasOrientation.LANDSCAPE;
  }

  function gestureGeometry(fit = currentFit) {
    const bounds = stageBounds();
    if (!fit) return null;
    return {
      canvasWidth: fit.displayedWidth,
      canvasHeight: fit.displayedHeight,
      viewportWidth: bounds.width,
      viewportHeight: bounds.height,
    };
  }

  function renderGesture() {
    if (!currentFit) return;
    elements.gesture.style.width = `${currentFit.displayedWidth}px`;
    elements.gesture.style.height = `${currentFit.displayedHeight}px`;
    elements.gesture.style.setProperty("--viewer-gesture-zoom", gestureState.zoom);
    elements.gesture.style.setProperty("--viewer-gesture-pan-x", `${gestureState.panX}px`);
    elements.gesture.style.setProperty("--viewer-gesture-pan-y", `${gestureState.panY}px`);
  }

  function resetPointerTracking() {
    activePointers.clear();
    pinchBaseline = null;
    panPointer = null;
  }

  function pointFor(event) {
    const rect = elements.scroller.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    return { x: finiteCoordinate(event?.clientX) - finiteCoordinate(rect.left), y: finiteCoordinate(event?.clientY) - finiteCoordinate(rect.top) };
  }

  function finiteCoordinate(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  function firstTwoPointers() {
    return [...activePointers.values()].slice(0, 2);
  }

  function beginPinch() {
    const [first, second] = firstTwoPointers();
    if (!first || !second) return;
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    if (distance <= 0) return;
    pinchBaseline = {
      state: gestureState,
      distance,
      focal: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    };
    panPointer = null;
  }

  function beginPan() {
    const [entry] = activePointers.entries();
    if (!entry) return;
    panPointer = { id: entry[0], point: entry[1] };
    pinchBaseline = null;
  }

  function syncPointerMode() {
    if (activePointers.size >= 2) beginPinch();
    else if (activePointers.size === 1) beginPan();
    else {
      pinchBaseline = null;
      panPointer = null;
    }
  }

  function refitCanvas() {
    scheduledFit = null;
    if (!currentPresentation) return null;
    const bounds = stageBounds();
    const fit = fitKeyboardCanvas({
      canvasWidth: currentPresentation.width,
      canvasHeight: currentPresentation.height,
      viewportWidth: bounds.width,
      viewportHeight: bounds.height,
      orientation: canvasOrientation(bounds),
    });
    if (!fit) return null;
    const orientationChanged = currentFit && currentFit.orientation !== fit.orientation;
    currentFit = fit;
    gestureState = orientationChanged
      ? resetCanvasGesture()
      : createCanvasGestureState(gestureState);
    const geometry = gestureGeometry(fit);
    if (geometry) gestureState = zoomCanvasGesture(gestureState, { zoom: gestureState.zoom }, geometry);
    elements.canvas.dataset.orientation = fit.orientation;
    elements.canvas.style.width = `${fit.displayedWidth}px`;
    elements.canvas.style.height = `${fit.displayedHeight}px`;
    elements.keyboard.style.setProperty("--viewer-canvas-scale", fit.scale);
    elements.keyboard.style.setProperty("--viewer-canvas-translate-y", `${fit.displayedHeight}px`);
    renderGesture();
    return fit;
  }

  function scheduleCanvasFit() {
    if (scheduledFit != null) return;
    const callback = () => refitCanvas();
    if (typeof appWindow?.requestAnimationFrame === "function") {
      scheduledFit = true;
      const frame = appWindow.requestAnimationFrame(callback);
      if (scheduledFit === true) scheduledFit = frame;
    } else {
      scheduledFit = true;
      callback();
    }
  }

  const onViewportChange = () => scheduleCanvasFit();
  const orientationMedia = appWindow?.matchMedia?.("(orientation: portrait)");
  orientationMedia?.addEventListener?.("change", onViewportChange);
  orientationMedia?.addListener?.(onViewportChange);
  appWindow?.addEventListener?.("resize", onViewportChange);
  const ResizeObserverImplementation = options.ResizeObserver ?? appWindow?.ResizeObserver ?? globalThis.ResizeObserver;
  if (typeof ResizeObserverImplementation === "function") {
    resizeObserver = new ResizeObserverImplementation(onViewportChange);
    resizeObserver.observe(elements.scroller);
  }

  const onPointerDown = (event) => {
    if (!Number.isInteger(event?.pointerId)) return;
    const point = pointFor(event);
    activePointers.set(event.pointerId, point);
    elements.scroller.setPointerCapture?.(event.pointerId);
    syncPointerMode();
    event.preventDefault?.();
  };
  const onPointerMove = (event) => {
    if (!activePointers.has(event?.pointerId)) return;
    const point = pointFor(event);
    activePointers.set(event.pointerId, point);
    const geometry = gestureGeometry();
    if (!geometry) return;
    if (activePointers.size >= 2) {
      const [first, second] = firstTwoPointers();
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      if (pinchBaseline && distance > 0) {
        const focal = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
        gestureState = zoomCanvasGesture(pinchBaseline.state, {
          zoom: pinchBaseline.state.zoom * distance / pinchBaseline.distance,
          fromPoint: pinchBaseline.focal,
          toPoint: focal,
        }, geometry);
        renderGesture();
      }
    } else if (panPointer?.id === event.pointerId && gestureState.zoom > 1) {
      gestureState = panCanvasGesture(gestureState, {
        x: point.x - panPointer.point.x,
        y: point.y - panPointer.point.y,
      }, geometry);
      panPointer = { id: event.pointerId, point };
      renderGesture();
    }
    event.preventDefault?.();
  };
  const onPointerEnd = (event) => {
    if (!activePointers.has(event?.pointerId)) return;
    activePointers.delete(event.pointerId);
    elements.scroller.releasePointerCapture?.(event.pointerId);
    syncPointerMode();
    event.preventDefault?.();
  };
  elements.scroller.addEventListener("pointerdown", onPointerDown);
  elements.scroller.addEventListener("pointermove", onPointerMove);
  elements.scroller.addEventListener("pointerup", onPointerEnd);
  elements.scroller.addEventListener("pointercancel", onPointerEnd);

  function renderCatalog(snapshot) {
    const signature = snapshot.layouts.map(({ key, name }) => `${key}:${name}`).join("|");
    if (signature === renderedCatalog) return;
    renderedCatalog = signature;
    const previousRemoveTarget = elements.removeTarget.value;
    elements.layout.replaceChildren();
    elements.removeTarget.replaceChildren();
    for (const layout of snapshot.layouts) {
      const option = document.createElement("option");
      option.value = layout.key;
      option.textContent = layout.name;
      elements.layout.append(option);
      if (layout.custom) {
        const removeOption = document.createElement("option");
        removeOption.value = layout.key;
        removeOption.textContent = layout.name;
        elements.removeTarget.append(removeOption);
      }
    }
    const customKeys = snapshot.layouts.filter(({ custom }) => custom).map(({ key }) => key);
    elements.removeControls.hidden = customKeys.length === 0;
    elements.removeTarget.value = customKeys.includes(previousRemoveTarget)
      ? previousRemoveTarget
      : customKeys.includes(snapshot.selectedLayoutKey) ? snapshot.selectedLayoutKey : customKeys[0] ?? "";
  }

  function renderKeyboard(snapshot) {
    elements.keyboard.dataset.viewer = "mobile";
    const state = {
      layerIndex: snapshot.selectedLayerIndex,
      layerAuthoritative: snapshot.layerAuthoritative,
      pressedPositions: snapshot.pressedPositions,
      comboPositions: snapshot.comboPositions,
      interactive: false,
    };
    if (typeof elements.keyboard.setPresentation === "function") {
      elements.keyboard.setPresentation(snapshot.presentation, state);
    } else {
      renderKeyboardLayoutInto(elements.keyboard, snapshot.presentation, state, { mobile: true, document });
    }
  }

  function renderFallbackLayerControl(container, layers, layerIndex, authoritative) {
    if ((container.localName ?? container.tagName?.toLowerCase()) === "select") {
      container.replaceChildren();
      for (const layer of layers ?? []) {
        const option = document.createElement("option");
        option.value = String(layer.index);
        option.textContent = layer.name;
        container.append(option);
      }
      container.value = String(layerIndex);
      container.disabled = authoritative || (layers?.length ?? 0) < 2;
    } else {
      container.textContent = layers?.find(({ index }) => index === layerIndex)?.name ?? "";
    }
  }

  function render(resolved = presentationController?.snapshot() ?? browsePresentation(model.snapshot())) {
    const browse = model.snapshot();
    const hydrating = browse.catalogStatus === ViewerCatalogStatus.HYDRATING;
    const ready = browse.catalogStatus === ViewerCatalogStatus.READY && resolved.presentation;
    renderCatalog(browse);
    elements.layout.disabled = !ready;
    elements.layout.value = browse.selectedLayoutKey ?? "";
    elements.removeLayout.disabled = elements.removeControls.hidden;
    elements.importLayout.disabled = !layoutController?.available;
    elements.empty.textContent = hydrating ? hydratingMessage : emptyMessage;
    elements.empty.dataset.state = hydrating ? "hydrating" : "empty";
    elements.empty.hidden = Boolean(ready);
    elements.scroller.hidden = !ready;
    const liveMode = resolved.mode === LayoutPresentationMode.LIVE;
    elements.layerField.hidden = !ready || liveMode;
    elements.liveLayer.hidden = !ready || !liveMode;
    elements.liveSwitch.checked = liveMode;
    elements.liveSwitch.disabled = !resolved.liveAvailable;
    const [streamTitle, guidance] = streamCopy(resolved);
    if (lastStreamTitle !== streamTitle) {
      elements.streamStatus.textContent = streamTitle;
      lastStreamTitle = streamTitle;
    }
    elements.guidance.textContent = guidance;
    elements.comboStatus.textContent = resolved.activeCombos.length
      ? `Active: ${resolved.activeCombos.map(({ label }) => label).join(", ")}`
      : "No active firmware-resolved combo.";
    elements.comboStatus.hidden = resolved.mode !== LayoutPresentationMode.LIVE;
    const diagnostics = [...browse.diagnostics, ...diagnosticsCopy(resolved)].slice(0, 4);
    elements.diagnostic.textContent = diagnostics.join(" ");
    elements.diagnostic.hidden = diagnostics.length === 0;
    if (!ready) {
      currentPresentation = null;
      currentFit = null;
      gestureState = resetCanvasGesture();
      resetPointerTracking();
      elements.gesture.style.width = "";
      elements.gesture.style.height = "";
      elements.canvas.style.width = "";
      elements.canvas.style.height = "";
      elements.keyboard.replaceChildren();
      return;
    }

    if (typeof elements.keyboard.renderLayerControl === "function") {
      elements.keyboard.renderLayerControl(elements.layer, resolved.presentation.layers, resolved.selectedLayerIndex, { authoritative: liveMode });
      elements.keyboard.renderLayerControl(elements.liveLayerName, resolved.presentation.layers, resolved.selectedLayerIndex, { authoritative: true });
    } else {
      renderFallbackLayerControl(elements.layer, resolved.presentation.layers, resolved.selectedLayerIndex, liveMode);
      renderFallbackLayerControl(elements.liveLayerName, resolved.presentation.layers, resolved.selectedLayerIndex, true);
    }
    currentPresentation = resolved.presentation;
    elements.keyboard.style.width = `${resolved.presentation.width}px`;
    elements.keyboard.style.height = `${resolved.presentation.height}px`;
    elements.keyboard.style.setProperty("--viewer-origin-x", `${resolved.presentation.origin.x}px`);
    elements.keyboard.style.setProperty("--viewer-origin-y", `${resolved.presentation.origin.y}px`);
    elements.keyboard.style.setProperty("--viewer-key-width", `${resolved.presentation.keySize.w}px`);
    elements.keyboard.style.setProperty("--viewer-key-height", `${resolved.presentation.keySize.h}px`);
    elements.keyboard.style.setProperty("--viewer-key-gap", `${resolved.presentation.keySize.gap}px`);
    renderKeyboard(resolved);
    scheduleCanvasFit();
  }

  function reportLayoutStatus(message, level = "info") {
    elements.layoutStatus.textContent = message;
    elements.layoutStatus.dataset.level = level;
    elements.layoutStatus.hidden = !message;
  }

  const onLayoutChange = async () => {
    try {
      if (layoutController) await layoutController.selectLayout(elements.layout.value);
      else model.selectLayout(elements.layout.value);
      const selected = model.snapshot().layouts.find(({ key }) => key === model.snapshot().selectedLayoutKey);
      if (selected?.custom) elements.removeTarget.value = selected.key;
      reportLayoutStatus("");
    } catch (error) {
      elements.layout.value = model.snapshot().selectedLayoutKey ?? "";
      reportLayoutStatus(error?.message ?? "The selected layout could not be saved.", "error");
    }
  };
  const onImportLayout = async () => {
    elements.importLayout.disabled = true;
    try {
      const result = await layoutController.importLayout(async (existing, definition) =>
        globalThis.window?.confirm?.(`Replace custom layout “${existing.name}” with “${definition.name}”?`) === true);
      const messages = {
        imported: `Imported ${result.record?.name}.`,
        replaced: `Replaced ${result.record?.name}.`,
        duplicate: `${result.record?.name} is already imported.`,
        cancelled: "",
        "cancelled-replacement": "The existing custom layout was kept.",
      };
      reportLayoutStatus(messages[result.status] ?? "Layout import finished.");
    } catch (error) {
      reportLayoutStatus(error?.message ?? "The layout could not be imported.", "error");
    } finally {
      elements.importLayout.disabled = !layoutController?.available;
    }
  };
  const onRemoveLayout = async () => {
    const entry = model.snapshot().layouts.find(({ key }) => key === elements.removeTarget.value);
    if (!entry?.custom || globalThis.window?.confirm?.(`Remove ${entry.name}?`) !== true) return;
    elements.removeLayout.disabled = true;
    try {
      await layoutController.removeLayout(entry.key);
      reportLayoutStatus(`Removed ${entry.name}.`);
    } catch (error) {
      reportLayoutStatus(error?.message ?? "The custom layout could not be removed.", "error");
      render();
    }
  };
  const onLayerRequest = (event) => {
    const layerIndex = /** @type {CustomEvent<{ layerIndex?: number }>} */ (event).detail?.layerIndex;
    if (typeof layerIndex === "number" && Number.isInteger(layerIndex)) model.selectLayer(layerIndex);
  };
  const onLayerChange = () => {
    if (typeof elements.keyboard.requestLayer !== "function") model.selectLayer(Number(elements.layer.value));
  };
  const onLiveSwitch = () => presentationController?.selectMode(
    elements.liveSwitch.checked ? LayoutPresentationMode.LIVE : LayoutPresentationMode.BROWSE,
  );
  elements.layout.addEventListener("change", onLayoutChange);
  elements.importLayout.addEventListener("click", onImportLayout);
  elements.removeLayout.addEventListener("click", onRemoveLayout);
  if (typeof elements.keyboard.requestLayer === "function") {
    elements.keyboard.addEventListener("keyboard-layer-request", onLayerRequest);
  } else {
    elements.layer.addEventListener("change", onLayerChange);
  }
  elements.liveSwitch.addEventListener("change", onLiveSwitch);
  const unsubscribe = presentationController
    ? presentationController.subscribe(render)
    : model.subscribe((snapshot) => render(browsePresentation(snapshot)));
  return {
    model,
    render,
    dispose() {
      unsubscribe();
      layoutController?.dispose?.();
      resizeObserver?.disconnect?.();
      if (scheduledFit != null && typeof scheduledFit === "number") appWindow?.cancelAnimationFrame?.(scheduledFit);
      orientationMedia?.removeEventListener?.("change", onViewportChange);
      orientationMedia?.removeListener?.(onViewportChange);
      appWindow?.removeEventListener?.("resize", onViewportChange);
      resetPointerTracking();
      elements.scroller.removeEventListener?.("pointerdown", onPointerDown);
      elements.scroller.removeEventListener?.("pointermove", onPointerMove);
      elements.scroller.removeEventListener?.("pointerup", onPointerEnd);
      elements.scroller.removeEventListener?.("pointercancel", onPointerEnd);
      elements.layout.removeEventListener?.("change", onLayoutChange);
      elements.importLayout.removeEventListener?.("click", onImportLayout);
      elements.removeLayout.removeEventListener?.("click", onRemoveLayout);
      if (typeof elements.keyboard.requestLayer === "function") {
        elements.keyboard.removeEventListener?.("keyboard-layer-request", onLayerRequest);
      } else {
        elements.layer.removeEventListener?.("change", onLayerChange);
      }
      elements.liveSwitch.removeEventListener?.("change", onLiveSwitch);
    },
    reportLayoutStatus,
  };
}

export function mountMobileLayoutViewer(document = globalThis.document) {
  return createMobileLayoutViewerView(document);
}
