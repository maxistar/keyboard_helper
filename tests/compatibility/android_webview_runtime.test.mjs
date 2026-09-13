import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { MobileLayoutViewerModel, ViewerCatalogStatus } from "../../src-mobile/layout_viewer_model.js";
import { createRandomUuid, hasOwn } from "../../src-mobile/webview_compat.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function javaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return javaScriptFiles(target);
    return entry.name.endsWith(".js") ? [target] : [];
  }));
  return nested.flat();
}

test("declared Android runtime baseline remains API 30 with WebView 91", async () => {
  const baseline = JSON.parse(await readFile(path.join(root, "android/webview-compatibility.json"), "utf8"));
  assert.deepEqual(baseline, {
    androidApiLevel: 30,
    webViewMajor: 91,
    observedWebViewVersion: "91.0.4472.114",
    compatibilityBoundary: "src-mobile/webview_compat.js",
  });
});

test("mobile runtime does not bypass the WebView 91 compatibility boundary", async () => {
  const boundary = path.join(root, "src-mobile/webview_compat.js");
  const violations = [];
  const restricted = [
    ["Object.hasOwn", /\bObject\.hasOwn\s*\(/g],
    ["crypto.randomUUID", /\b(?:globalThis\.)?crypto\.randomUUID\s*\(/g],
  ];
  for (const file of await javaScriptFiles(path.join(root, "src-mobile"))) {
    if (file === boundary) continue;
    const source = await readFile(file, "utf8");
    for (const [api, pattern] of restricted) {
      for (const match of source.matchAll(pattern)) {
        const line = source.slice(0, match.index).split("\n").length;
        violations.push(`${path.relative(root, file)}:${line}: ${api}`);
      }
    }
  }
  assert.deepEqual(violations, [], `Post-WebView-91 APIs must use src-mobile/webview_compat.js:\n${violations.join("\n")}`);
});

test("baseline fallbacks preserve own-property, UUID, and bundled catalog behavior", () => {
  const inherited = Object.create({ inherited: true });
  inherited.own = true;
  assert.equal(hasOwn(inherited, "own"), true);
  assert.equal(hasOwn(inherited, "inherited"), false);

  const uuid = createRandomUuid({
    getRandomValues(bytes) {
      bytes.set(Array.from({ length: 16 }, (_, index) => 255 - index));
      return bytes;
    },
  });
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  const descriptor = Object.getOwnPropertyDescriptor(Object, "hasOwn");
  try {
    Object.defineProperty(Object, "hasOwn", { configurable: true, value: undefined });
    const model = new MobileLayoutViewerModel();
    assert.equal(model.snapshot().catalogStatus, ViewerCatalogStatus.READY);
    assert.equal(model.snapshot().selectedLayoutKey, "qwerty");
    assert.ok(model.snapshot().presentation.keys.length > 0);
  } finally {
    if (descriptor) Object.defineProperty(Object, "hasOwn", descriptor);
    else delete Object.hasOwn;
  }
});
