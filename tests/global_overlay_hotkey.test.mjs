import assert from "node:assert/strict";
import test from "node:test";

import {
  createGlobalOverlayHotkey,
  parseGlobalOverlayHotkey,
} from "../src/global_overlay_hotkey.js";

function systemKey(code, action = "down") {
  return { kind: "key", source: "system", code, action };
}

test("configured shortcuts parse canonical keys and modifier aliases", () => {
  assert.deepEqual(parseGlobalOverlayHotkey("command+option+shift+k"), {
    modifiers: { shift: true, meta: true, ctrl: false, alt: true },
    triggerKey: "KeyK",
  });
  assert.deepEqual(parseGlobalOverlayHotkey("Ctrl+Digit7"), {
    modifiers: { shift: false, meta: false, ctrl: true, alt: false },
    triggerKey: "Digit7",
  });
  assert.equal(parseGlobalOverlayHotkey("Shift"), null);
  assert.equal(parseGlobalOverlayHotkey(null), null);
});

test("an exact configured chord toggles once per trigger keydown cycle", () => {
  let toggles = 0;
  const controller = createGlobalOverlayHotkey({
    hotkey: "Shift+Meta+KeyK",
    onToggle: () => { toggles += 1; },
  });

  controller.handleEvent(systemKey("ShiftLeft"));
  controller.handleEvent(systemKey("MetaRight"));
  assert.equal(controller.handleEvent(systemKey("KeyK")), true);
  assert.equal(controller.handleEvent(systemKey("KeyK")), false);
  assert.equal(toggles, 1);

  controller.handleEvent(systemKey("KeyK", "up"));
  assert.equal(controller.handleEvent(systemKey("KeyK")), true);
  assert.equal(toggles, 2);
});

test("modifier releases and unmatched modifier sets prevent toggles", () => {
  let toggles = 0;
  const controller = createGlobalOverlayHotkey({
    hotkey: "Ctrl+KeyK",
    onToggle: () => { toggles += 1; },
  });

  controller.handleEvent(systemKey("ControlLeft"));
  controller.handleEvent(systemKey("ControlLeft", "up"));
  controller.handleEvent(systemKey("KeyK"));
  controller.handleEvent(systemKey("KeyK", "up"));
  controller.handleEvent(systemKey("Alt"));
  controller.handleEvent(systemKey("ControlRight"));
  controller.handleEvent(systemKey("KeyK"));

  assert.equal(toggles, 0);
});

test("missing configuration and non-system events never toggle", () => {
  let toggles = 0;
  const controller = createGlobalOverlayHotkey({ onToggle: () => { toggles += 1; } });

  controller.handleEvent(systemKey("KeyK"));
  controller.handleEvent({ kind: "key", source: "ble", action: "down", code: "KeyK" });
  controller.handleEvent({ kind: "layer", source: "system", action: "down", code: "KeyK" });

  assert.equal(toggles, 0);
});
