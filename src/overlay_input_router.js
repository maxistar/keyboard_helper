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
