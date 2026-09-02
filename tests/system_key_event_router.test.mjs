import assert from "node:assert/strict";
import test from "node:test";

import { createGlobalOverlayHotkey } from "../src/global_overlay_hotkey.js";
import { normalizeSystemKeyEvent } from "../src/input_events.js";
import { createInputSourceController } from "../src/input_source_controller.js";
import { routeSystemKeyEvent } from "../src/system_key_event_router.js";

function normalized(code, eventType = "down") {
  return normalizeSystemKeyEvent({ key: code, event_type: eventType });
}

function createHarness() {
  let toggles = 0;
  const highlighted = [];
  const hotkeyController = createGlobalOverlayHotkey({
    hotkey: "Ctrl+KeyK",
    onToggle: () => { toggles += 1; },
  });
  const inputSourceController = createInputSourceController({
    onEvent: (event) => highlighted.push(event),
  });
  const route = (event) => routeSystemKeyEvent(event, {
    hotkeyController,
    inputSourceController,
  });
  return { route, inputSourceController, highlighted, toggles: () => toggles };
}

function activateBle(inputSourceController) {
  inputSourceController.setBleConnection({ capabilitiesValidated: true, subscribed: true });
  inputSourceController.handleEvent({
    source: "ble",
    kind: "layer",
    layer: 0,
    previousLayer: 0,
    cause: 3,
    originPosition: 255,
    sequence: 1,
    streamStart: true,
  });
}

test("system routing toggles and highlights while system input is effective", () => {
  const harness = createHarness();

  assert.deepEqual(harness.route(normalized("ControlLeft")), {
    shortcutMatched: false,
    highlighted: true,
  });
  assert.deepEqual(harness.route(normalized("KeyK")), {
    shortcutMatched: true,
    highlighted: true,
  });

  assert.equal(harness.toggles(), 1);
  assert.equal(harness.highlighted.length, 2);
});

test("system routing still toggles while BLE exclusively owns highlighting", () => {
  const harness = createHarness();
  activateBle(harness.inputSourceController);
  const highlightedBeforeShortcut = harness.highlighted.length;

  assert.equal(harness.route(normalized("ControlLeft")).highlighted, false);
  assert.deepEqual(harness.route(normalized("KeyK")), {
    shortcutMatched: true,
    highlighted: false,
  });

  assert.equal(harness.toggles(), 1);
  assert.equal(harness.highlighted.length, highlightedBeforeShortcut);
});

test("a BLE source transition does not clear a held shortcut modifier", () => {
  const harness = createHarness();
  harness.route(normalized("ControlRight"));
  activateBle(harness.inputSourceController);
  const highlightedAfterTransition = harness.highlighted.length;

  assert.deepEqual(harness.route(normalized("KeyK")), {
    shortcutMatched: true,
    highlighted: false,
  });

  assert.equal(harness.toggles(), 1);
  assert.equal(harness.highlighted.length, highlightedAfterTransition);
});
