import assert from "node:assert/strict";
import test from "node:test";

import { reloadActiveExternalLayout } from "../src/app_menu_actions.js";
import {
  createAppMenuStateController,
  HELP_URL,
} from "../src/app_menu_state.js";

function createHarness(overrides = {}) {
  const data = {
    currentKey: "builtin",
    native: true,
    sources: { builtin: true, external: "/tmp/layout.json", ble: true },
    bleSources: { ble: { deviceName: "Keyboard" } },
    labels: { builtin: "Built in", external: "External", ble: "BLE board" },
    reloadCalls: [],
    reconnectCalls: [],
    helpCalls: [],
    gameCalls: 0,
    miniCalls: 0,
    settingsCalls: 0,
    snapshots: [],
    ...overrides,
  };

  const controller = createAppMenuStateController({
    getCurrentLayoutKey: () => data.currentKey,
    getCurrentLayoutLabel: (key) => data.labels[key] ?? key,
    getCurrentLayoutSource: () => data.sources[data.currentKey],
    getCurrentBleSource: () => data.bleSources[data.currentKey] ?? null,
    hasNativeBridge: () => data.native,
    reloadLayout: async (key) => {
      data.reloadCalls.push(key);
      return true;
    },
    reconnectBle: async (key) => {
      data.reconnectCalls.push(key);
      return true;
    },
    openTypingInvaders: async () => {
      data.gameCalls += 1;
      return true;
    },
    enterMiniMode: async () => {
      data.miniCalls += 1;
      return true;
    },
    openSettings: async () => {
      data.settingsCalls += 1;
      return true;
    },
    openHelp: async (url) => {
      data.helpCalls.push(url);
      return true;
    },
    onChange: (snapshot) => data.snapshots.push(snapshot),
  });

  return { controller, data };
}

test("menu state exposes not-configured, connecting, connected, and error BLE states", () => {
  const { controller, data } = createHarness();

  controller.setActiveLayout();
  assert.equal(controller.getSnapshot().bleState, "not-configured");
  assert.equal(controller.getSnapshot().reconnectAvailable, false);

  data.currentKey = "ble";
  controller.setActiveLayout();
  assert.equal(controller.getSnapshot().bleState, "connecting");
  assert.equal(controller.getSnapshot().reconnectAvailable, true);

  assert.equal(
    controller.handleBleStatus({ layoutKey: "old-layout", state: "error", message: "stale" }),
    false,
  );
  assert.equal(controller.getSnapshot().bleState, "connecting");

  assert.equal(
    controller.handleBleStatus({ layoutKey: "ble", state: "connected", message: null }),
    true,
  );
  assert.equal(controller.getSnapshot().bleState, "connected");

  controller.handleBleStatus({ layoutKey: "ble", state: "error", message: "Radio unavailable" });
  assert.equal(controller.getSnapshot().bleState, "error");
  assert.equal(controller.getSnapshot().bleMessage, "Radio unavailable");
});

test("Mini Mode requires the desktop bridge and serializes requests", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const native = createHarness();
  const controller = createAppMenuStateController({
    getCurrentLayoutKey: () => native.data.currentKey,
    getCurrentLayoutLabel: (key) => key,
    getCurrentLayoutSource: () => true,
    getCurrentBleSource: () => null,
    hasNativeBridge: () => true,
    reloadLayout: async () => true,
    reconnectBle: async () => true,
    openTypingInvaders: async () => true,
    enterMiniMode: async () => pending,
    openHelp: async () => true,
  });

  const first = controller.mini();
  assert.equal(controller.getSnapshot().miniPending, true);
  assert.equal(await controller.mini(), false);
  finish(true);
  assert.equal(await first, true);
  assert.equal(controller.getSnapshot().miniPending, false);

  const browser = createHarness({ native: false });
  assert.equal(browser.controller.getSnapshot().miniAvailable, false);
  assert.equal(await browser.controller.mini(), false);
  assert.equal(browser.data.miniCalls, 0);
});

test("reconnect prevents duplicates while pending and targets the active BLE layout", async () => {
  let finishReconnect;
  const pending = new Promise((resolve) => {
    finishReconnect = resolve;
  });
  const { data } = createHarness({ currentKey: "ble" });
  const snapshots = [];
  const reconnectCalls = [];
  const controller = createAppMenuStateController({
    getCurrentLayoutKey: () => data.currentKey,
    getCurrentLayoutLabel: (key) => key,
    getCurrentLayoutSource: () => data.sources[data.currentKey],
    getCurrentBleSource: () => data.bleSources[data.currentKey] ?? null,
    hasNativeBridge: () => true,
    reloadLayout: async () => true,
    reconnectBle: async (key) => {
      reconnectCalls.push(key);
      await pending;
      return true;
    },
    openTypingInvaders: async () => true,
    openHelp: async () => true,
    onChange: (snapshot) => snapshots.push(snapshot),
  });
  controller.setActiveLayout();

  const first = controller.reconnect();
  assert.equal(controller.getSnapshot().reconnectPending, true);
  assert.equal(await controller.reconnect(), false);
  assert.deepEqual(reconnectCalls, ["ble"]);

  finishReconnect();
  assert.equal(await first, true);
  assert.equal(controller.getSnapshot().reconnectPending, false);
  assert.equal(snapshots.some((snapshot) => snapshot.reconnectPending), true);
});

test("reload reports success and failure without allowing duplicate requests", async () => {
  const { controller, data } = createHarness({ currentKey: "external" });
  controller.setActiveLayout();

  assert.equal(controller.getSnapshot().reloadAvailable, true);
  assert.equal(await controller.reload(), true);
  assert.deepEqual(data.reloadCalls, ["external"]);
  assert.deepEqual(controller.getSnapshot().feedback, {
    kind: "success",
    message: "Layout reloaded.",
  });

  const failing = createAppMenuStateController({
    getCurrentLayoutKey: () => "external",
    getCurrentLayoutLabel: () => "External",
    getCurrentLayoutSource: () => "/tmp/layout.json",
    getCurrentBleSource: () => null,
    hasNativeBridge: () => true,
    reloadLayout: async () => {
      throw new Error("Invalid layout JSON");
    },
    reconnectBle: async () => true,
    openTypingInvaders: async () => true,
    openHelp: async () => true,
  });
  failing.setActiveLayout();
  assert.equal(await failing.reload(), false);
  assert.equal(failing.getSnapshot().feedback.message, "Invalid layout JSON");
});

test("layout reload action commits only a successfully loaded active definition", async () => {
  let currentKey = "external";
  let rendered = "previous";
  let committed = "previous";
  let bleRestarts = 0;
  const baseArgs = {
    key: "external",
    getCurrentLayoutKey: () => currentKey,
    getLayoutSource: () => "/tmp/layout.json",
    applyLayoutDefinition: (_key, definition) => {
      committed = definition.name;
    },
    renderBaseLayout: () => {
      rendered = committed;
    },
    restartBle: async () => {
      bleRestarts += 1;
    },
  };

  await assert.rejects(
    reloadActiveExternalLayout({
      ...baseArgs,
      loadLayoutDefinition: async () => ({ def: null, error: "Invalid JSON" }),
    }),
    /Invalid JSON/,
  );
  assert.equal(committed, "previous");
  assert.equal(rendered, "previous");
  assert.equal(bleRestarts, 0);

  assert.equal(
    await reloadActiveExternalLayout({
      ...baseArgs,
      loadLayoutDefinition: async () => ({ def: { name: "updated" }, error: null }),
    }),
    true,
  );
  assert.equal(committed, "updated");
  assert.equal(rendered, "updated");
  assert.equal(bleRestarts, 1);

  currentKey = "other";
  await assert.rejects(
    reloadActiveExternalLayout({
      ...baseArgs,
      loadLayoutDefinition: async () => ({ def: { name: "stale" }, error: null }),
    }),
    /active external layout/,
  );
});

test("Help uses the fixed setup URL and exposes opener failures as feedback", async () => {
  const { controller, data } = createHarness();
  assert.equal(await controller.help(), true);
  assert.deepEqual(data.helpCalls, [HELP_URL]);

  const failing = createAppMenuStateController({
    getCurrentLayoutKey: () => "builtin",
    getCurrentLayoutLabel: () => "Built in",
    getCurrentLayoutSource: () => true,
    getCurrentBleSource: () => null,
    hasNativeBridge: () => false,
    reloadLayout: async () => false,
    reconnectBle: async () => false,
    openTypingInvaders: async () => false,
    openHelp: async () => {
      throw new Error("No default browser");
    },
  });
  assert.equal(await failing.help(), false);
  assert.deepEqual(failing.getSnapshot().feedback, {
    kind: "error",
    message: "No default browser",
  });
});

test("game launch requires native availability, prevents duplicates, and reports failure", async () => {
  let finishLaunch;
  const pending = new Promise((resolve) => {
    finishLaunch = resolve;
  });
  const native = createHarness();
  const controller = createAppMenuStateController({
    getCurrentLayoutKey: () => native.data.currentKey,
    getCurrentLayoutLabel: (key) => key,
    getCurrentLayoutSource: () => true,
    getCurrentBleSource: () => null,
    hasNativeBridge: () => true,
    reloadLayout: async () => true,
    reconnectBle: async () => true,
    openTypingInvaders: async () => pending,
    openHelp: async () => true,
  });

  const first = controller.launchGame();
  assert.equal(controller.getSnapshot().gamePending, true);
  assert.equal(await controller.launchGame(), false);
  finishLaunch(true);
  assert.equal(await first, true);
  assert.equal(controller.getSnapshot().gamePending, false);

  const unavailable = createHarness({ native: false });
  assert.equal(unavailable.controller.getSnapshot().gameAvailable, false);
  assert.equal(await unavailable.controller.launchGame(), false);
  assert.equal(unavailable.data.gameCalls, 0);

  const failing = createAppMenuStateController({
    getCurrentLayoutKey: () => "builtin",
    getCurrentLayoutLabel: () => "Built in",
    getCurrentLayoutSource: () => true,
    getCurrentBleSource: () => null,
    hasNativeBridge: () => true,
    reloadLayout: async () => true,
    reconnectBle: async () => true,
    openTypingInvaders: async () => { throw new Error("Window unavailable"); },
    openHelp: async () => true,
  });
  assert.equal(await failing.launchGame(), false);
  assert.equal(failing.getSnapshot().feedback.message, "Window unavailable");
});

test("Settings requires native availability, prevents duplicates, and reports failure", async () => {
  let finishOpen;
  const pending = new Promise((resolve) => { finishOpen = resolve; });
  const base = createHarness();
  const controller = createAppMenuStateController({
    getCurrentLayoutKey: () => base.data.currentKey,
    getCurrentLayoutLabel: (key) => key,
    getCurrentLayoutSource: () => true,
    getCurrentBleSource: () => null,
    hasNativeBridge: () => true,
    reloadLayout: async () => true,
    reconnectBle: async () => true,
    openTypingInvaders: async () => true,
    openSettings: async () => pending,
    openHelp: async () => true,
  });
  const first = controller.settings();
  assert.equal(controller.getSnapshot().settingsPending, true);
  assert.equal(await controller.settings(), false);
  finishOpen(true);
  assert.equal(await first, true);
  assert.equal(controller.getSnapshot().settingsPending, false);

  const unavailable = createHarness({ native: false });
  assert.equal(unavailable.controller.getSnapshot().settingsAvailable, false);
  assert.equal(await unavailable.controller.settings(), false);
  assert.equal(unavailable.data.settingsCalls, 0);

  const failing = createAppMenuStateController({
    getCurrentLayoutKey: () => "builtin",
    getCurrentLayoutLabel: () => "Built in",
    getCurrentLayoutSource: () => true,
    getCurrentBleSource: () => null,
    hasNativeBridge: () => true,
    reloadLayout: async () => true,
    reconnectBle: async () => true,
    openTypingInvaders: async () => true,
    openSettings: async () => { throw new Error("Settings window unavailable"); },
    openHelp: async () => true,
  });
  assert.equal(await failing.settings(), false);
  assert.equal(failing.getSnapshot().feedback.message, "Settings window unavailable");
});
