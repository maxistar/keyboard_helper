import { resolveKeyElement } from "./key_highlight.js";

export function createOverlayInputRouter({
  document,
  pressedKeyTracker,
  getBleHighlightController,
  setComboActive,
  clearComboActivations,
  showKeyEvent,
}) {
  let shiftHeld = false;
  let altGrHeld = false;

  function handleKey(code, type) {
    const wasShiftHeld = shiftHeld;
    const wasAltGrHeld = altGrHeld;

    if (type === "down") {
      setComboActive(code, true);
      if (code === "ShiftLeft" || code === "ShiftRight") shiftHeld = true;
      if (code === "AltGr") altGrHeld = true;
    } else if (type === "up") {
      setComboActive(code, false);
      if (code === "ShiftLeft" || code === "ShiftRight") shiftHeld = false;
      if (code === "AltGr") altGrHeld = false;
    }

    console.log(`Key ${code} ${type}`);
    if (type === "down") {
      const el = resolveKeyElement(document, code, wasShiftHeld, wasAltGrHeld);
      if (!el) return;
      showKeyEvent(code);
      el.classList.add("pressed");
      pressedKeyTracker.remember(code, el);
    } else if (type === "up") {
      const el = pressedKeyTracker.release(
        code,
        resolveKeyElement(document, code, wasShiftHeld, wasAltGrHeld),
      );
      if (!el) return;
      el.classList.remove("pressed");
    }
  }

  function clearHighlightState() {
    getBleHighlightController()?.clear();
    document.querySelectorAll(".key.pressed").forEach((element) => element.classList.remove("pressed"));
    clearComboActivations();
    pressedKeyTracker.clear();
    shiftHeld = false;
    altGrHeld = false;
  }

  function handleNormalizedInputEvent(event) {
    if (event.kind === "key" && event.source === "system") handleKey(event.code, event.action);
    else if (event.source === "ble") getBleHighlightController()?.handleEvent(event);
  }

  return {
    handleKey,
    clearHighlightState,
    handleNormalizedInputEvent,
  };
}
