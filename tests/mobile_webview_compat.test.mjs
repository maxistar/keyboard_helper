import assert from "node:assert/strict";
import test from "node:test";

import { MobileLayoutViewerModel, ViewerCatalogStatus } from "../src-mobile/layout_viewer_model.js";
import { createRandomUuid, hasOwn } from "../src-mobile/webview_compat.js";

test("own-property compatibility is prototype-safe without Object.hasOwn", () => {
  const value = Object.create({ inherited: true });
  value.own = true;
  value.hasOwnProperty = () => false;

  assert.equal(hasOwn(value, "own"), true);
  assert.equal(hasOwn(value, "inherited"), false);
  assert.equal(hasOwn(value, "hasOwnProperty"), true);
});

test("baseline UUID fallback creates an RFC 4122 version-4 identity", () => {
  const baselineCrypto = {
    getRandomValues(bytes) {
      bytes.set(Array.from({ length: 16 }, (_, index) => index));
      return bytes;
    },
  };

  assert.equal(createRandomUuid(baselineCrypto), "00010203-0405-4607-8809-0a0b0c0d0e0f");
});

test("newer WebViews retain their native UUID operation", () => {
  const calls = [];
  const value = createRandomUuid({ randomUUID() { calls.push("native"); return "native-id"; } });
  assert.equal(value, "native-id");
  assert.deepEqual(calls, ["native"]);
});

test("bundled catalog initializes when Object.hasOwn is unavailable", () => {
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
