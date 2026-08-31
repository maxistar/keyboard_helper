import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeBleKeyboardFrame,
  normalizeHighlightingPolicy,
  normalizeSystemKeyEvent,
} from "../src/input_events.js";

test("system listener events normalize into the shared input model", () => {
  assert.deepEqual(normalizeSystemKeyEvent({ key: "KeyA", event_type: "down" }), {
    kind: "key", source: "system", action: "down", code: "KeyA",
  });
  assert.equal(normalizeSystemKeyEvent({ key: "KeyA", event_type: "repeat" }), null);
});

test("BLE key frames contain physical context and no HID or text fields", () => {
  const event = normalizeBleKeyboardFrame({
    sequence: 42,
    flags: 1,
    event: { kind: "key", action: "down", position: 17, layer: 2, keycode: 4, text: "a" },
  });
  assert.deepEqual(event, {
    source: "ble", sequence: 42, streamStart: true,
    kind: "key", action: "down", position: 17, layer: 2,
  });
  assert.equal(Object.hasOwn(event, "keycode"), false);
  assert.equal(Object.hasOwn(event, "text"), false);
});

test("BLE combo frames retain semantic identity and participant positions only", () => {
  const event = normalizeBleKeyboardFrame({
    sequence: 43,
    flags: 0,
    event: { kind: "combo", action: "down", comboId: 9, positions: [17, 18], layer: 1, behavior: "&kp ESC" },
  });
  assert.deepEqual(event, {
    source: "ble", sequence: 43, streamStart: false,
    kind: "combo", action: "down", comboId: 9, positions: [17, 18], layer: 1,
  });
  assert.equal(Object.hasOwn(event, "behavior"), false);
});

test("the layer snapshot can carry STREAM_START readiness without pretending to be a key", () => {
  assert.deepEqual(normalizeBleKeyboardFrame({
    sequence: 1,
    flags: 3,
    event: { kind: "layer", layer: 2, previousLayer: 0, cause: 3, originPosition: 255 },
  }), {
    source: "ble", sequence: 1, streamStart: true,
    kind: "layer", layer: 2, previousLayer: 0, cause: 3, originPosition: 255,
  });
});

test("malformed BLE events are rejected and unknown policies migrate to Auto", () => {
  assert.equal(normalizeBleKeyboardFrame({ sequence: 1, flags: 0, event: { kind: "key", action: "down", position: -1, layer: 0 } }), null);
  assert.equal(normalizeBleKeyboardFrame({ sequence: 1, flags: 0, event: { kind: "combo", action: "down", comboId: 0, positions: [], layer: 0 } }), null);
  assert.equal(normalizeHighlightingPolicy("future"), "auto");
});
