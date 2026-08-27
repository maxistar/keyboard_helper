import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../src/self-test.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../src/self-test.js", import.meta.url), "utf8");
const overlayScript = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const overlayCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const capability = JSON.parse(readFileSync(new URL("../src-tauri/capabilities/self-test.json", import.meta.url), "utf8"));

test("self-test entry point exposes setup, guidance, results, and accessible status regions", () => {
  for (const id of ["layoutSelect", "layerSelect", "startButton", "selectionLabel", "retryButton", "problemButton", "skipButton", "stopButton", "resultCounts", "retestButton", "anotherLayerButton"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Activate the selected layer and release all keys before starting/);
  assert.match(html, /Modifier chords pass only after the trigger and every modifier are released/);
  assert.match(html, /global HID events from any attached keyboard/);
  assert.doesNotMatch(html, /id="keyboardPreview"/);
  assert.match(html, /existing Keyboard Helper overlay/);
});

test("self-test runtime loads its own catalog, observes native events, and disposes on close", () => {
  assert.match(script, /loadLayoutCatalog\(rawConfig/);
  assert.match(script, /listen\("key_event"/);
  assert.match(script, /controller\.handleKey/);
  assert.match(script, /Release all keys to continue/);
  assert.match(script, /snapshot\.phase === "chord-active"/);
  assert.match(script, /beforeunload/);
  assert.match(script, /controller\.dispose\(\)/);
  assert.match(script, /emitTo\("overlay", "self-test-overlay-state"/);
  assert.match(overlayScript, /listen\("self-test-overlay-state"/);
  assert.match(overlayScript, /handleKey\(key, event_type\)/);
  assert.match(overlayCss, /\.key\.self-test-expected/);
  assert.match(overlayCss, /\.key\.pressed/);
});

test("self-test window has close and destroy permissions scoped to its singleton label", () => {
  assert.deepEqual(capability.windows, ["keyboard-self-test"]);
  assert.ok(capability.permissions.includes("core:window:allow-close"));
  assert.ok(capability.permissions.includes("core:window:allow-destroy"));
});
