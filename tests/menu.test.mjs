import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMenu } from "../src/menu.js";

class ClassListStub {
  constructor(owner) {
    this.owner = owner;
  }

  values() {
    return new Set(this.owner.className.split(/\s+/).filter(Boolean));
  }

  write(values) {
    this.owner.className = [...values].join(" ");
  }

  add(...names) {
    const values = this.values();
    names.forEach((name) => values.add(name));
    this.write(values);
  }

  remove(...names) {
    const values = this.values();
    names.forEach((name) => values.delete(name));
    this.write(values);
  }

  contains(name) {
    return this.values().has(name);
  }

  toggle(name, force) {
    const values = this.values();
    const enabled = force === undefined ? !values.has(name) : Boolean(force);
    if (enabled) values.add(name);
    else values.delete(name);
    this.write(values);
    return enabled;
  }
}

class EventTargetStub {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== listener),
    );
  }

  async trigger(type, event = {}) {
    event.target ??= this;
    event.currentTarget = this;
    if (!event.preventDefault) {
      event.defaultPrevented = false;
      event.preventDefault = () => {
        event.defaultPrevented = true;
      };
    }
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      await listener(event);
    }
    return event;
  }
}

function matchesSelector(element, selector) {
  if (selector === "button:not([disabled])") {
    return element.tagName === "BUTTON" && !element.disabled;
  }
  if (selector.startsWith(".")) return element.classList.contains(selector.slice(1));
  if (selector.startsWith("#")) return element.id === selector.slice(1);
  const roleMatch = selector.match(/^\[role="([^"]+)"\]$/);
  if (roleMatch) return element.getAttribute("role") === roleMatch[1];
  return element.tagName === selector.toUpperCase();
}

class ElementStub extends EventTargetStub {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.classList = new ClassListStub(this);
    this.id = "";
    this.textContent = "";
    this.innerHTML = "";
    this.disabled = false;
    this.tabIndex = 0;
    this.title = "";
    this.scrolledIntoView = false;
    this.rect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
    this.offsetWidth = 0;
    this.offsetHeight = 0;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "id") this.id = String(value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  contains(target) {
    if (target === this) return true;
    return this.children.some((child) => child.contains(target));
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  scrollIntoView() {
    this.scrolledIntoView = true;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  setRect(rect) {
    const left = rect.left ?? 0;
    const top = rect.top ?? 0;
    const width = rect.width ?? 0;
    const height = rect.height ?? 0;
    this.rect = {
      left,
      top,
      width,
      height,
      right: rect.right ?? left + width,
      bottom: rect.bottom ?? top + height,
    };
    this.offsetWidth = width;
    this.offsetHeight = height;
  }

  async click() {
    if (this.disabled) return;
    await this.trigger("click", { target: this });
  }
}

class DocumentStub extends EventTargetStub {
  constructor() {
    super();
    this.root = new ElementStub("main", this);
    this.menuRoot = new ElementStub("div", this);
    this.menuRoot.id = "menuRoot";
    this.root.appendChild(this.menuRoot);
    this.activeElement = null;
    this.documentElement = { clientWidth: 1024, clientHeight: 768 };
  }

  createElement(tagName) {
    return new ElementStub(tagName, this);
  }

  getElementById(id) {
    if (id === "menuRoot") return this.menuRoot;
    return this.querySelector(`#${id}`);
  }

  querySelectorAll(selector) {
    return this.root.querySelectorAll(selector);
  }

  querySelector(selector) {
    return this.root.querySelector(selector);
  }
}

class WindowStub extends EventTargetStub {
  constructor() {
    super();
    this.innerWidth = 1024;
    this.innerHeight = 768;
  }
}

function createEnvironment(callbacks = {}) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const document = new DocumentStub();
  const window = new WindowStub();
  globalThis.document = document;
  globalThis.window = window;
  let controls;
  const calls = { layout: [], reload: 0, reconnect: 0, mini: 0, game: 0, settings: 0, help: 0 };
  const layoutOptions = [
    { key: "alpha", label: "Alpha" },
    { key: "beta", label: "Beta" },
    { key: "gamma", label: "Gamma with a very long display name" },
  ];
  controls = createMenu({
    layoutOptions,
    onLayoutSelect: callbacks.onLayoutSelect ?? (async (key) => {
      calls.layout.push(key);
      controls.update({ currentLayoutKey: key, currentLayoutLabel: key.toUpperCase() });
      return true;
    }),
    onReloadLayout: callbacks.onReloadLayout ?? (async () => {
      calls.reload += 1;
      return true;
    }),
    onReconnectBle: callbacks.onReconnectBle ?? (async () => {
      calls.reconnect += 1;
      return true;
    }),
    onMiniMode: callbacks.onMiniMode ?? (async () => {
      calls.mini += 1;
      return true;
    }),
    onStartGame: callbacks.onStartGame ?? (async () => {
      calls.game += 1;
      return true;
    }),
    onSettings: callbacks.onSettings ?? (async () => {
      calls.settings += 1;
      return true;
    }),
    onHelp: callbacks.onHelp ?? (async () => {
      calls.help += 1;
      return true;
    }),
  });

  const restore = () => {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  };
  return { calls, controls, document, window, restore };
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("menu stacking layer stays above combo-key borders", () => {
  const menuCss = readFileSync(new URL("../src/menu.css", import.meta.url), "utf8");
  const appCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const menuLayer = Number(menuCss.match(/--app-menu-z-index:\s*(\d+)/)?.[1]);
  const comboLayer = Number(appCss.match(/\.combo-border\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);

  assert.ok(menuLayer > comboLayer, `expected menu layer ${menuLayer} above combo layer ${comboLayer}`);
  assert.match(menuCss, /z-index:\s*calc\(var\(--app-menu-z-index\) \+ 1\)/);
});

test("menu renders the root hierarchy, synchronized summaries, and contextual controls", () => {
  const env = createEnvironment();
  try {
    env.controls.update({
      currentLayoutKey: "beta",
      currentLayoutLabel: "Beta board",
      bleState: "connected",
      reloadAvailable: true,
      reconnectAvailable: false,
      miniAvailable: true,
      gameAvailable: true,
      settingsAvailable: true,
    });

    const root = env.document.querySelector(".menu-root");
    const rootItems = root.querySelectorAll('[role="menuitem"]');
    assert.equal(root.getAttribute("role"), "menu");
    assert.equal(rootItems.length, 6);
    assert.equal(env.document.querySelector(".menu-parent-keyboard").getAttribute("aria-haspopup"), "menu");
    assert.equal(env.document.querySelector(".menu-parent-connection").getAttribute("aria-haspopup"), "menu");
    assert.equal(env.document.querySelector(".menu-parent-keyboard").querySelector(".menu-root-summary").textContent, "Beta board");
    assert.equal(env.document.querySelector(".menu-parent-connection").querySelector(".menu-root-summary").textContent, "BLE connected");
    assert.equal(env.document.querySelector(".menu-current-layout").textContent, "Beta board");
    assert.equal(env.document.querySelector(".menu-ble-status").dataset.state, "connected");

    const radios = env.document.querySelectorAll('[role="menuitemradio"]');
    assert.deepEqual(radios.map((radio) => radio.getAttribute("aria-checked")), ["false", "true", "false"]);
    assert.equal(env.document.querySelector(".menu-action-reload").disabled, false);
    assert.equal(env.document.querySelector(".menu-action-reconnect").disabled, true);
    assert.equal(env.document.querySelector(".menu-action-mini").disabled, false);
    assert.equal(env.document.querySelector(".menu-action-game").disabled, false);
    assert.equal(env.document.querySelector(".menu-action-settings").disabled, false);

    env.controls.update({ reloadPending: true, reconnectAvailable: true, reconnectPending: true, miniPending: true, gamePending: true, settingsPending: true });
    assert.equal(env.document.querySelector(".menu-action-reload").textContent, "Reloading…");
    assert.equal(env.document.querySelector(".menu-action-reload").disabled, true);
    assert.equal(env.document.querySelector(".menu-action-reconnect").textContent, "Reconnecting…");
    assert.equal(env.document.querySelector(".menu-action-mini").textContent, "Entering Mini Mode…");
    assert.equal(env.document.querySelector(".menu-action-game").textContent, "Launching…");
    assert.equal(env.document.querySelector(".menu-action-settings").textContent, "Opening Settings…");
  } finally {
    env.restore();
  }
});

test("keyboard navigation traverses levels and dismissal restores focus correctly", async () => {
  const env = createEnvironment();
  try {
    env.controls.update({ currentLayoutKey: "beta", currentLayoutLabel: "Beta" });
    const toggle = env.document.querySelector(".menu-toggle");
    const root = env.document.querySelector(".menu-root");
    const keyboard = env.document.querySelector(".menu-parent-keyboard");
    const connection = env.document.querySelector(".menu-parent-connection");
    const keyboardFlyout = env.document.querySelector(".menu-flyout-keyboard");
    const radios = env.document.querySelectorAll('[role="menuitemradio"]');

    await toggle.click();
    assert.equal(root.classList.contains("open"), true);
    assert.equal(env.document.activeElement, keyboard);

    await keyboard.trigger("keydown", { key: "ArrowDown" });
    assert.equal(env.document.activeElement, connection);
    await connection.trigger("keydown", { key: "Home" });
    assert.equal(env.document.activeElement, keyboard);

    await keyboard.trigger("keydown", { key: "ArrowRight" });
    assert.equal(keyboard.getAttribute("aria-expanded"), "true");
    assert.equal(keyboardFlyout.classList.contains("open"), true);
    assert.equal(env.document.activeElement, radios[1]);

    await radios[1].trigger("keydown", { key: "ArrowDown" });
    assert.equal(env.document.activeElement, radios[2]);
    assert.equal(radios[2].scrolledIntoView, true);
    await radios[2].trigger("keydown", { key: "ArrowLeft" });
    assert.equal(keyboardFlyout.classList.contains("open"), false);
    assert.equal(env.document.activeElement, keyboard);

    await keyboard.trigger("keydown", { key: "ArrowRight" });
    await env.document.trigger("keydown", { key: "Escape" });
    assert.equal(root.classList.contains("open"), false);
    assert.equal(keyboardFlyout.classList.contains("open"), false);
    assert.equal(env.document.activeElement, toggle);

    await toggle.click();
    const tabEvent = await env.document.trigger("keydown", { key: "Tab" });
    assert.equal(root.classList.contains("open"), false);
    assert.equal(tabEvent.defaultPrevented, false);

    await toggle.click();
    const outside = env.document.createElement("div");
    await env.document.trigger("click", { target: outside });
    assert.equal(root.classList.contains("open"), false);
  } finally {
    env.restore();
  }
});

test("contextual flyouts switch exclusively and actions preserve their close behavior", async () => {
  const env = createEnvironment();
  try {
    env.controls.update({
      currentLayoutKey: "alpha",
      currentLayoutLabel: "Alpha",
      reloadAvailable: true,
      reconnectAvailable: true,
      miniAvailable: true,
      gameAvailable: true,
    });
    const toggle = env.document.querySelector(".menu-toggle");
    const root = env.document.querySelector(".menu-root");
    const keyboardParent = env.document.querySelector(".menu-parent-keyboard");
    const connectionParent = env.document.querySelector(".menu-parent-connection");
    const keyboardFlyout = env.document.querySelector(".menu-flyout-keyboard");
    const connectionFlyout = env.document.querySelector(".menu-flyout-connection");
    const radios = env.document.querySelectorAll('[role="menuitemradio"]');

    await toggle.click();
    await keyboardParent.click();
    assert.equal(keyboardFlyout.classList.contains("open"), true);
    await connectionParent.click();
    assert.equal(keyboardFlyout.classList.contains("open"), false);
    assert.equal(connectionFlyout.classList.contains("open"), true);

    await connectionParent.click();
    await keyboardParent.click();
    await env.document.querySelector(".menu-action-reload").click();
    assert.equal(env.calls.reload, 1);
    assert.equal(keyboardFlyout.classList.contains("open"), true);

    env.controls.update({ feedback: { kind: "success", message: "Layout reloaded." } });
    assert.equal(env.document.querySelector(".menu-feedback-keyboard").textContent, "Layout reloaded.");
    assert.equal(env.document.querySelector(".menu-feedback-keyboard").classList.contains("visible"), true);

    await radios[1].click();
    assert.deepEqual(env.calls.layout, ["beta"]);
    assert.equal(root.classList.contains("open"), false);
    assert.equal(radios[1].getAttribute("aria-checked"), "true");

    await toggle.click();
    await connectionParent.click();
    await env.document.querySelector(".menu-action-reconnect").click();
    assert.equal(env.calls.reconnect, 1);
    assert.equal(connectionFlyout.classList.contains("open"), true);

    env.controls.closeMenu();
    await toggle.click();
    await env.document.querySelector(".menu-action-mini").click();
    assert.equal(env.calls.mini, 1);
    assert.equal(root.classList.contains("open"), false);

    await env.document.querySelector(".menu-action-game").click();
    assert.equal(env.calls.game, 1);
    assert.equal(root.classList.contains("open"), false);

    await toggle.click();
    env.controls.update({ settingsAvailable: true });
    await env.document.querySelector(".menu-action-settings").click();
    assert.equal(env.calls.settings, 1);
    assert.equal(root.classList.contains("open"), false);

    await toggle.click();
    await env.document.querySelector(".menu-action-help").click();
    assert.equal(env.calls.help, 1);
    assert.equal(root.classList.contains("open"), false);
  } finally {
    env.restore();
  }
});

test("hover intent supports diagonal entry and cancels obsolete submenu requests", async () => {
  const env = createEnvironment();
  try {
    const toggle = env.document.querySelector(".menu-toggle");
    const keyboardParent = env.document.querySelector(".menu-parent-keyboard");
    const connectionParent = env.document.querySelector(".menu-parent-connection");
    const keyboardFlyout = env.document.querySelector(".menu-flyout-keyboard");
    const connectionFlyout = env.document.querySelector(".menu-flyout-connection");
    await toggle.click();

    await keyboardParent.trigger("pointerenter");
    await connectionParent.trigger("pointerenter");
    await wait(140);
    assert.equal(keyboardFlyout.classList.contains("open"), false);
    assert.equal(connectionFlyout.classList.contains("open"), true);

    await connectionParent.trigger("pointerleave");
    await connectionFlyout.trigger("pointerenter");
    await wait(140);
    assert.equal(connectionFlyout.classList.contains("open"), true);

    await connectionFlyout.trigger("pointerleave");
    await wait(140);
    assert.equal(connectionFlyout.classList.contains("open"), false);
  } finally {
    env.restore();
  }
});

test("flyouts prefer left placement, fall back right, and clamp inside the viewport", async () => {
  const env = createEnvironment();
  try {
    const toggle = env.document.querySelector(".menu-toggle");
    const keyboardParent = env.document.querySelector(".menu-parent-keyboard");
    const keyboardFlyout = env.document.querySelector(".menu-flyout-keyboard");
    keyboardFlyout.setRect({ width: 260, height: 200 });
    await toggle.click();

    keyboardParent.setRect({ left: 700, right: 940, top: 20, width: 240, height: 40 });
    await keyboardParent.click();
    assert.equal(keyboardFlyout.dataset.side, "left");
    assert.equal(keyboardFlyout.style.left, "432px");
    assert.equal(keyboardFlyout.style.top, "20px");

    await keyboardParent.click();
    keyboardParent.setRect({ left: 20, right: 220, top: 700, width: 200, height: 40 });
    await keyboardParent.click();
    assert.equal(keyboardFlyout.dataset.side, "right");
    assert.equal(keyboardFlyout.style.left, "228px");
    assert.equal(keyboardFlyout.style.top, "560px");

    await keyboardParent.click();
    env.window.innerWidth = 300;
    keyboardParent.setRect({ left: 20, right: 250, top: 20, width: 230, height: 40 });
    await keyboardParent.click();
    assert.equal(keyboardFlyout.dataset.side, "overlap");
    assert.equal(keyboardFlyout.style.left, "8px");
  } finally {
    env.restore();
  }
});

test("failed direct actions keep the root open and route accessible feedback there", async () => {
  const env = createEnvironment({
    onMiniMode: async () => false,
    onStartGame: async () => false,
    onSettings: async () => false,
    onHelp: async () => false,
  });
  try {
    env.controls.update({ miniAvailable: true, gameAvailable: true, settingsAvailable: true });
    const toggle = env.document.querySelector(".menu-toggle");
    const root = env.document.querySelector(".menu-root");
    await toggle.click();

    await env.document.querySelector(".menu-action-mini").click();
    env.controls.update({ feedback: { kind: "error", message: "Mini geometry unavailable" } });
    assert.equal(root.classList.contains("open"), true);
    assert.equal(env.document.querySelector(".menu-feedback-root").textContent, "Mini geometry unavailable");

    await env.document.querySelector(".menu-action-game").click();
    env.controls.update({ feedback: { kind: "error", message: "Window unavailable" } });
    assert.equal(root.classList.contains("open"), true);
    assert.equal(env.document.querySelector(".menu-feedback-root").textContent, "Window unavailable");

    await env.document.querySelector(".menu-action-settings").click();
    env.controls.update({ feedback: { kind: "error", message: "Settings unavailable" } });
    assert.equal(root.classList.contains("open"), true);
    assert.equal(env.document.querySelector(".menu-feedback-root").textContent, "Settings unavailable");

    await env.document.querySelector(".menu-action-help").click();
    env.controls.update({ feedback: { kind: "error", message: "Help unavailable" } });
    assert.equal(root.classList.contains("open"), true);
    assert.equal(env.document.querySelector(".menu-feedback-root").textContent, "Help unavailable");
  } finally {
    env.restore();
  }
});
