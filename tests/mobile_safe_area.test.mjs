import assert from "node:assert/strict";
import test from "node:test";

import {
  SAFE_AREA_CHANGE_EVENT,
  applySafeInsets,
  installSafeAreaFallback,
  normalizeSafeInsets,
  readNativeSafeInsets,
} from "../src-mobile/safe_area.js";

function documentStub() {
  const values = new Map();
  return {
    documentElement: {
      style: {
        setProperty(name, value) { values.set(name, value); },
      },
    },
    values,
  };
}

function windowStub() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) ?? []), listener]); },
    removeEventListener(type, listener) { listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener)); },
    dispatch(type, detail) { for (const listener of listeners.get(type) ?? []) listener({ type, detail }); },
  };
}

test("safe inset normalization rejects unsafe or malformed native values", () => {
  assert.deepEqual(normalizeSafeInsets({ top: 12.4, right: -2, bottom: "16", left: Infinity }), {
    top: 12, right: 0, bottom: 16, left: 0,
  });
});

test("native bridge snapshot supplies Android 11 fallback before an event arrives", () => {
  const hostWindow = {
    KeyboardHelperSafeInsets: { snapshot: () => '{"top":24,"right":0,"bottom":48,"left":0}' },
  };
  assert.deepEqual(readNativeSafeInsets(hostWindow), { top: 24, right: 0, bottom: 48, left: 0 });
});

test("safe inset events refresh root CSS variables and dispose cleanly", () => {
  const document = documentStub();
  const hostWindow = windowStub();
  hostWindow.__keyboardHelperSafeInsets = { top: 20, right: 0, bottom: 34, left: 0 };
  const fallback = installSafeAreaFallback(document, hostWindow);
  assert.equal(document.values.get("--android-safe-top"), "20px");
  assert.equal(document.values.get("--android-safe-bottom"), "34px");

  hostWindow.dispatch(SAFE_AREA_CHANGE_EVENT, { top: 0, right: 18, bottom: 22, left: 18 });
  assert.equal(document.values.get("--android-safe-right"), "18px");
  assert.equal(document.values.get("--android-safe-left"), "18px");

  fallback.dispose();
  hostWindow.dispatch(SAFE_AREA_CHANGE_EVENT, { top: 99, right: 0, bottom: 0, left: 0 });
  assert.equal(document.values.get("--android-safe-top"), "0px");
});

test("safe inset application is a no-op without a DOM root", () => {
  assert.deepEqual(applySafeInsets(null, { top: 1 }), { top: 0, right: 0, bottom: 0, left: 0 });
});
