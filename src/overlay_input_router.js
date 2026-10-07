import { resolveKeyElement } from "./key_highlight.js";

/**
 * @typedef {import("./key_highlight.js").PressedKeyTracker} PressedKeyTracker
 * @typedef {{ kind?: string, source?: string, code?: unknown, action?: unknown }} NormalizedInputEvent
 * @typedef {{ clear(): void, handleEvent(event: NormalizedInputEvent): void }} BleHighlightController
 * @typedef {{
 *   document: Document,
 *   pressedKeyTracker: PressedKeyTracker,
 *   getBleHighlightController: () => BleHighlightController | null | undefined,
 *   setComboActive: (code: string, active: boolean) => void,
 *   clearComboActivations: () => void,
 *   showKeyEvent: (code: string) => void,
 *   resolvePosition?: ((code: string, wasShiftHeld: boolean, wasAltGrHeld: boolean) => number | null) | null,
 *   setPositionPressed?: ((position: number, active: boolean) => boolean) | null,
 *   clearPressed?: (() => void) | null,
 * }} OverlayInputRouterOptions
 */

/**
 * @param {OverlayInputRouterOptions} options
 */
export function createOverlayInputRouter({
  document,
  pressedKeyTracker,
  getBleHighlightController,
  setComboActive,
  clearComboActivations,
  showKeyEvent,
  resolvePosition = null,
  setPositionPressed = null,
  clearPressed = null,
}) {
  let shiftHeld = false;
  let altGrHeld = false;

  /**
   * @param {string} code
   * @param {"down" | "up" | string} type
   */
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
      const target = resolvePosition
        ? resolvePosition(code, wasShiftHeld, wasAltGrHeld)
        : resolveKeyElement(document, code, wasShiftHeld, wasAltGrHeld);
      if (target === null || target === undefined) return;
      showKeyEvent(code);
      if (setPositionPressed && typeof target === "number") setPositionPressed(target, true);
      else if (typeof target !== "number") target.classList.add("pressed");
      pressedKeyTracker.remember(code, target);
    } else if (type === "up") {
      const fallback = resolvePosition
        ? resolvePosition(code, wasShiftHeld, wasAltGrHeld)
        : resolveKeyElement(document, code, wasShiftHeld, wasAltGrHeld);
      const target = pressedKeyTracker.release(
        code,
        fallback,
      );
      if (target === null || target === undefined) return;
      if (setPositionPressed && typeof target === "number") setPositionPressed(target, false);
      else if (typeof target !== "number") target.classList.remove("pressed");
    }
  }

  function clearHighlightState() {
    getBleHighlightController()?.clear();
    if (clearPressed) clearPressed();
    else document.querySelectorAll(".key.pressed").forEach((element) => element.classList.remove("pressed"));
    clearComboActivations();
    pressedKeyTracker.clear();
    shiftHeld = false;
    altGrHeld = false;
  }

  /**
   * @param {NormalizedInputEvent} event
   */
  function handleNormalizedInputEvent(event) {
    if (event.kind === "key" && event.source === "system" && typeof event.code === "string" && typeof event.action === "string") {
      handleKey(event.code, event.action);
    } else if (event.source === "ble") {
      getBleHighlightController()?.handleEvent(event);
    }
  }

  return {
    handleKey,
    clearHighlightState,
    handleNormalizedInputEvent,
  };
}
