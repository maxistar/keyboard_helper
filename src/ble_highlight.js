export function createBleHighlightController({
  resolvePosition,
  setPositionPressed = null,
  getPositionLabel = null,
  setComboActive,
  showPositionLabel = () => {},
  reportDiagnostic = () => {},
}) {
  const pressedPositions = new Map();
  const activeCombos = new Set();

  function handleKey(event) {
    const target = event.action === "up"
      ? pressedPositions.get(event.position) ?? resolvePosition(event.position, event.layer)
      : resolvePosition(event.position, event.layer);
    if (target === null || target === undefined) {
      reportDiagnostic({ code: "unmatched-position", event });
      return false;
    }
    if (event.action === "down") {
      if (setPositionPressed) setPositionPressed(/** @type {number} */ (target), true);
      else if (typeof target !== "number") target.classList.add("pressed");
      pressedPositions.set(event.position, target);
      showPositionLabel(getPositionLabel ? getPositionLabel(target) : target, event);
    } else {
      if (setPositionPressed) setPositionPressed(/** @type {number} */ (target), false);
      else if (typeof target !== "number") target.classList.remove("pressed");
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
    if (setPositionPressed) pressedPositions.forEach((position) => setPositionPressed(/** @type {number} */ (position), false));
    else pressedPositions.forEach((element) => { if (typeof element !== "number") element.classList.remove("pressed"); });
    activeCombos.forEach((comboId) => setComboActive(comboId, false));
    pressedPositions.clear();
    activeCombos.clear();
  }

  return { handleEvent, clear };
}
