import {
  decodeBleKeyboardCapabilities,
  decodeBleKeyboardFrame,
} from "../src/ble_keyboard_decoder.js";
import {
  normalizeBleKeyboardFrame,
  normalizeSystemKeyEvent,
} from "../src/input_events.js";

/** @type {import("../src/input_events.js").SystemKeyInputEvent} */
const validSystemEvent = {
  kind: "key",
  source: "system",
  action: "down",
  code: "KeyA",
};

normalizeSystemKeyEvent({ key: validSystemEvent.code, event_type: validSystemEvent.action });
normalizeBleKeyboardFrame({
  sequence: 1,
  flags: 1,
  event: { kind: "key", action: "down", position: 0, layer: 0 },
});

/** @type {import("../src/input_events.js").SystemKeyInputEvent} */
// @ts-expect-error -- a normalized system event always owns a physical key code.
const invalidSystemEvent = { kind: "key", source: "system", action: "down" };
void invalidSystemEvent;

const capabilities = decodeBleKeyboardCapabilities(Uint8Array.from([1, 0, 7, 0, 20, 1, 0, 0]));
if (capabilities.status === "decoded") {
  const frame = decodeBleKeyboardFrame(Uint8Array.from([1, 1, 0, 3, 1, 0, 0, 0, 1, 0, 0]), capabilities.value);
  if (frame.status === "decoded" && frame.value.kind === "key") {
    frame.value.position.toFixed(0);
  }
}

if (capabilities.status === "rejected") {
  capabilities.issue.code.toUpperCase();
  // @ts-expect-error -- rejected outcomes intentionally do not expose decoded values.
  void capabilities.value;
}
