import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createOverlayModeController,
  createOverlayModeView,
  MINI_TARGET_SCALE,
  OVERLAY_MODES,
} from "../src/overlay_mode.js";

function harness(overrides = {}) {
  const calls = [];
  const errors = [];
  const controller = createOverlayModeController({
    enterNative: async (bounds) => {
      calls.push(["enter", bounds]);
      return { scale: 0.65, decorations: false };
    },
    updateNative: async (bounds) => {
      calls.push(["update", bounds]);
      return { scale: 0.6, decorations: false };
    },
    restoreNative: async () => {
      calls.push(["restore"]);
      return { decorations: true };
    },
    measureContent: () => ({ width: 1000, height: 400 }),
    applyMode: (mode, geometry) => calls.push(["view", mode, geometry]),
    setDecorationMode: (mode, geometry) => calls.push(["decorations", mode, geometry]),
    reportError: (message) => errors.push(message),
    ...overrides,
  });
  return { calls, controller, errors };
}

test("starts full, serializes entry, and restores through the native geometry bridge", async () => {
  let finishEntry;
  const pending = new Promise((resolve) => { finishEntry = resolve; });
  const env = harness({
    enterNative: async (bounds) => {
      env.calls.push(["enter", bounds]);
      return pending;
    },
  });
  assert.equal(env.controller.getMode(), OVERLAY_MODES.FULL);

  const first = env.controller.enterMini();
  assert.equal(env.controller.getMode(), OVERLAY_MODES.ENTERING_MINI);
  assert.equal(await env.controller.enterMini(), false);
  finishEntry({ scale: 0.65, decorations: false });
  assert.equal(await first, true);
  assert.equal(env.controller.getMode(), OVERLAY_MODES.MINI);
  assert.deepEqual(env.calls.find(([name]) => name === "enter")[1], {
    contentWidth: 1000,
    contentHeight: 400,
    targetScale: MINI_TARGET_SCALE,
  });

  assert.equal(await env.controller.enterMini(), true);
  assert.equal(env.calls.filter(([name]) => name === "enter").length, 1);
  assert.equal(await env.controller.restoreFull(), true);
  assert.equal(env.controller.getMode(), OVERLAY_MODES.FULL);
});

test("entry failure rolls native state back and returns to full presentation", async () => {
  const env = harness({ enterNative: async () => { throw new Error("monitor unavailable"); } });
  assert.equal(await env.controller.enterMini(), false);
  assert.equal(env.controller.getMode(), OVERLAY_MODES.FULL);
  assert.equal(env.calls.some(([name]) => name === "restore"), true);
  assert.deepEqual(env.errors, ["monitor unavailable"]);
});

test("failed restoration leaves Mini Mode and its restore affordance active", async () => {
  const env = harness({ restoreNative: async () => { throw new Error("resize denied"); } });
  assert.equal(await env.controller.enterMini(), true);
  assert.equal(await env.controller.restoreFull(), false);
  assert.equal(env.controller.getMode(), OVERLAY_MODES.MINI);
  assert.deepEqual(env.errors, ["resize denied"]);
  assert.equal(env.calls.at(-2)[1], OVERLAY_MODES.MINI);
});

test("a successful render refresh resizes only an active mini overlay", async () => {
  const env = harness();
  assert.equal(await env.controller.refreshMiniGeometry(), false);
  await env.controller.enterMini();
  assert.equal(await env.controller.refreshMiniGeometry(), true);
  assert.equal(env.calls.filter(([name]) => name === "update").length, 1);
  assert.equal(env.controller.getMode(), OVERLAY_MODES.MINI);
});

test("mini presentation keeps one accessible restore control and a drag surface", () => {
  const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(html, /id="restoreFullSize"[\s\S]*aria-label="Restore full size"[\s\S]*title="Restore full size"/);
  assert.match(html, /class="mini-surface"[^>]*data-tauri-drag-region/);
  assert.match(css, /body\.mini-mode #menuRoot,[\s\S]*\.layers-indicator,[\s\S]*\.key-event-indicator/);
  assert.match(css, /transform:\s*scale\(var\(--mini-scale, 0\.65\)\)/);
  assert.match(css, /body\.mini-mode \.restore-full-size[\s\S]*z-index:\s*22000/);
});

test("view reserves transformed keyboard bounds and always initializes full", () => {
  const classes = new Set(["mini-mode"]);
  const body = {
    dataset: {},
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
  };
  const values = new Map();
  const frameValues = new Map();
  const stage = {
    style: { setProperty: (name, value) => values.set(name, value) },
    parentElement: { style: { setProperty: (name, value) => frameValues.set(name, value) } },
  };
  const restoreButton = { hidden: false };
  const view = createOverlayModeView({
    body,
    stage,
    layout: { offsetWidth: 1000, offsetHeight: 400, style: {} },
    restoreButton,
  });

  view.applyMode(OVERLAY_MODES.FULL);
  assert.equal(classes.has("mini-mode"), false);
  assert.equal(restoreButton.hidden, true);

  view.applyMode(OVERLAY_MODES.MINI, { scale: 0.65 });
  assert.equal(classes.has("mini-mode"), true);
  assert.equal(restoreButton.hidden, false);
  assert.equal(values.get("--mini-scale"), "0.65");
  assert.equal(frameValues.get("--mini-stage-width"), "650px");
  assert.equal(frameValues.get("--mini-stage-height"), "260px");
});
