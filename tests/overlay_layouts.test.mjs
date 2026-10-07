import assert from "node:assert/strict";
import test from "node:test";

import { createOverlayLayoutRegistry } from "../src/overlay_layouts.js";

test("built-in layout fetches bypass the WebView asset cache", async () => {
  const requests = [];
  const definition = {
    name: "Fresh layout",
    keySize: { w: 1, h: 1, gap: 0 },
    keyPositions: [{ row: 0, col: 0 }],
    keyLayers: { default: [["A", "KeyA"]] },
  };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, text: async () => JSON.stringify(definition) };
  };

  try {
    const registry = createOverlayLayoutRegistry();
    const result = await registry.loadLayoutDefinition("qwerty", true);
    registry.dispose();

    assert.equal(result.error, null);
    assert.equal(result.def?.name, "Fresh layout");
    assert.deepEqual(requests, [{ url: "layout_qwerty.json", options: { cache: "no-store" } }]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
