export function createBleHighlightController({
  resolvePosition,
  setComboActive,
  showPositionLabel = () => {},
  reportDiagnostic = () => {},
}) {
  const pressedPositions = new Map();
  const activeCombos = new Set();

  function handleKey(event) {
    const element = event.action === "up"
      ? pressedPositions.get(event.position) ?? resolvePosition(event.position, event.layer)
      : resolvePosition(event.position, event.layer);
    if (!element) {
      reportDiagnostic({ code: "unmatched-position", event });
      return false;
    }
    if (event.action === "down") {
      element.classList.add("pressed");
      pressedPositions.set(event.position, element);
      showPositionLabel(element, event);
    } else {
      element.classList.remove("pressed");
      pressedPositions.delete(event.position);
    }
    return true;
  }

  function handleCombo(event) {
    const active = event.action === "down";
    if (!setComboActive(event.comboId, active, event.positions)) {
      reportDiagnostic({ code: "unmatched-combo", event });
      return false;
    }
    if (active) activeCombos.add(event.comboId);
    else activeCombos.delete(event.comboId);
    return true;
  }

  function handleEvent(event) {
    if (event?.source !== "ble") return false;
    if (event.kind === "key") return handleKey(event);
    if (event.kind === "combo") return handleCombo(event);
    return false;
  }

  function clear() {
    pressedPositions.forEach((element) => element.classList.remove("pressed"));
    activeCombos.forEach((comboId) => setComboActive(comboId, false));
    pressedPositions.clear();
    activeCombos.clear();
  }

  return { handleEvent, clear };
}
