import { MobileLayoutViewerModel, ViewerCatalogStatus } from "./layout_viewer_model.js";

function required(document, id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Mobile layout viewer is missing #${id}.`);
  return element;
}

function renderKey(document, key) {
  const element = document.createElement("div");
  element.className = `viewer-key ${key.kind}`.trim();
  element.dataset.position = String(key.index);
  element.setAttribute("aria-label", key.accessibleLabel);
  element.style.setProperty("--viewer-row", key.row);
  element.style.setProperty("--viewer-col", key.col);
  element.style.setProperty("--viewer-width", key.widthUnits);
  element.style.setProperty("--viewer-height", key.heightUnits);
  element.style.setProperty("--viewer-angle", `${key.angle}deg`);
  if (key.image) {
    const image = document.createElement("img");
    image.className = "viewer-key-image";
    image.src = key.image;
    image.alt = key.accessibleLabel;
    element.append(image);
  } else {
    const label = document.createElement("span");
    label.textContent = key.label;
    element.append(label);
  }
  return element;
}

export function createMobileLayoutViewerView(document, model = new MobileLayoutViewerModel()) {
  const elements = {
    layout: required(document, "viewer-layout"),
    layers: required(document, "viewer-layers"),
    summary: required(document, "viewer-summary"),
    diagnostic: required(document, "viewer-diagnostic"),
    scroller: required(document, "viewer-scroller"),
    keyboard: required(document, "viewer-keyboard"),
    empty: required(document, "viewer-empty"),
  };
  let renderedCatalog = null;
  let renderedLayout = null;
  let layerButtons = [];

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

  function renderLayers(snapshot) {
    if (renderedLayout === snapshot.selectedLayoutKey) return;
    renderedLayout = snapshot.selectedLayoutKey;
    layerButtons = [];
    elements.layers.replaceChildren();
    for (const layer of snapshot.presentation?.layers ?? []) {
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

  function render(snapshot) {
    const ready = snapshot.catalogStatus === ViewerCatalogStatus.READY && snapshot.presentation;
    renderCatalog(snapshot);
    elements.layout.disabled = !ready;
    elements.layout.value = snapshot.selectedLayoutKey ?? "";
    elements.empty.hidden = Boolean(ready);
    elements.scroller.hidden = !ready;
    elements.layers.hidden = !ready;
    elements.diagnostic.textContent = snapshot.diagnostics.join(" ");
    elements.diagnostic.hidden = snapshot.diagnostics.length === 0;
    if (!ready) {
      elements.summary.textContent = "No bundled keyboard layout is available.";
      elements.keyboard.replaceChildren();
      return;
    }

    renderLayers(snapshot);
    layerButtons.forEach((button, index) => {
      const selected = index === snapshot.selectedLayerIndex;
      button.setAttribute("aria-pressed", String(selected));
      button.dataset.selected = String(selected);
    });
    elements.summary.textContent = `${snapshot.presentation.name} · ${snapshot.presentation.layerName}`;
    elements.keyboard.style.width = `${snapshot.presentation.width}px`;
    elements.keyboard.style.height = `${snapshot.presentation.height}px`;
    elements.keyboard.style.setProperty("--viewer-key-width", `${snapshot.presentation.keySize.w}px`);
    elements.keyboard.style.setProperty("--viewer-key-height", `${snapshot.presentation.keySize.h}px`);
    elements.keyboard.style.setProperty("--viewer-key-gap", `${snapshot.presentation.keySize.gap}px`);
    elements.keyboard.replaceChildren(...snapshot.presentation.keys.map((key) => renderKey(document, key)));
  }

  const onLayoutChange = () => model.selectLayout(elements.layout.value);
  elements.layout.addEventListener("change", onLayoutChange);
  const unsubscribe = model.subscribe(render);
  return {
    model,
    render,
    dispose() {
      unsubscribe();
      elements.layout.removeEventListener?.("change", onLayoutChange);
    },
  };
}

export function mountMobileLayoutViewer(document = globalThis.document) {
  return createMobileLayoutViewerView(document);
}
