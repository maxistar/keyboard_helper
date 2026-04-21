import assert from "node:assert/strict";
import test from "node:test";

import {
  createPressedKeyTracker,
  resolveKeyElement,
} from "../src/key_highlight.js";

function createRoot(codes) {
  const elements = new Map(
    codes.map((code) => [
      `.key[data-key="${code}"]`,
      { dataset: { key: code }, classList: new Set() },
    ]),
  );

  return {
    querySelector(selector) {
      return elements.get(selector) ?? null;
    },
    elements,
  };
}

test("resolveKeyElement falls back to the physical key code when modifier-specific entry is absent", () => {
  const root = createRoot(["Num7"]);

  const element = resolveKeyElement(root, "Num7", true, false);

  assert.equal(element?.dataset.key, "Num7");
});

test("pressed key tracker releases the exact element remembered on keydown", () => {
  const root = createRoot(["Num7", "Shift+Num7"]);
  const tracker = createPressedKeyTracker();

  const pressedElement = root.querySelector('.key[data-key="Num7"]');
  const fallbackElement = root.querySelector('.key[data-key="Shift+Num7"]');

  tracker.remember("Num7", pressedElement);
  const released = tracker.release("Num7", fallbackElement);

  assert.equal(released, pressedElement);
  assert.equal(tracker.release("Num7", fallbackElement), fallbackElement);
});
