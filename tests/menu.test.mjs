import assert from "node:assert/strict";
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
    this.className = "";
    this.classList = new ClassListStub(this);
    this.id = "";
    this.textContent = "";
    this.innerHTML = "";
    this.disabled = false;
    this.tabIndex = 0;
    this.title = "";
    this.scrolledIntoView = false;
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

function createEnvironment(callbacks = {}) {
  const previousDocument = globalThis.document;
  const document = new DocumentStub();
  globalThis.document = document;
  let controls;
  const calls = { layout: [], reload: 0, reconnect: 0, game: 0, help: 0 };
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
    onStartGame: callbacks.onStartGame ?? (async () => {
      calls.game += 1;
      return true;
    }),
    onHelp: callbacks.onHelp ?? (async () => {
      calls.help += 1;
      return true;
    }),
  });

  const restore = () => {
    globalThis.document = previousDocument;
  };
  return { calls, controls, document, restore };
}

test("menu renders state, radio selection, statuses, and action availability", () => {
  const env = createEnvironment();
  try {
    env.controls.update({
      currentLayoutKey: "beta",
      currentLayoutLabel: "Beta board",
      bleState: "connected",
      reloadAvailable: true,
      reconnectAvailable: false,
      gameAvailable: true,
      feedback: { kind: "success", message: "Layout reloaded." },
    });

    assert.equal(env.document.querySelector(".menu-current-layout").textContent, "Beta board");
    assert.equal(env.document.querySelector(".menu-ble-status").dataset.state, "connected");
    const radios = env.document.querySelectorAll('[role="radio"]');
    assert.deepEqual(radios.map((radio) => radio.getAttribute("aria-checked")), ["false", "true", "false"]);
    assert.equal(env.document.querySelector(".menu-action-reload").disabled, false);
    assert.equal(env.document.querySelector(".menu-action-reconnect").disabled, true);
    assert.equal(env.document.querySelector(".menu-action-game").disabled, false);
    assert.equal(
      env.document.querySelector(".menu-action-game").textContent,
      "Start Shift-Space Invaders",
    );
    assert.equal(env.document.querySelector(".menu-feedback").textContent, "Layout reloaded.");

    env.controls.update({ reloadPending: true, reconnectAvailable: true, reconnectPending: true });
    assert.equal(env.document.querySelector(".menu-action-reload").textContent, "Reloading…");
    assert.equal(env.document.querySelector(".menu-action-reload").disabled, true);
    assert.equal(env.document.querySelector(".menu-action-reconnect").textContent, "Reconnecting…");
    env.controls.update({ gamePending: true });
    assert.equal(env.document.querySelector(".menu-action-game").textContent, "Launching…");
    assert.equal(env.document.querySelector(".menu-action-game").disabled, true);
  } finally {
    env.restore();
  }
});

test("menu manages focus, radio arrow navigation, Escape, and outside dismissal", async () => {
  const env = createEnvironment();
  try {
    env.controls.update({ currentLayoutKey: "beta", currentLayoutLabel: "Beta" });
    const toggle = env.document.querySelector(".menu-toggle");
    const panel = env.document.querySelector(".menu-panel");
    const radios = env.document.querySelectorAll('[role="radio"]');

    await toggle.click();
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(panel.classList.contains("open"), true);
    assert.equal(env.document.activeElement, radios[1]);

    await radios[1].trigger("keydown", { key: "ArrowDown", target: radios[1] });
    assert.equal(env.document.activeElement, radios[2]);
    assert.equal(radios[2].scrolledIntoView, true);

    await env.document.trigger("keydown", { key: "Escape" });
    assert.equal(panel.classList.contains("open"), false);
    assert.equal(env.document.activeElement, toggle);
    assert.equal(toggle.getAttribute("aria-expanded"), "false");

    await toggle.click();
    const outside = env.document.createElement("div");
    await env.document.trigger("click", { target: outside });
    assert.equal(panel.classList.contains("open"), false);
  } finally {
    env.restore();
  }
});

test("layout selection updates externally and successful actions invoke callbacks", async () => {
  const env = createEnvironment();
  try {
    env.controls.update({
      currentLayoutKey: "alpha",
      currentLayoutLabel: "Alpha",
      reloadAvailable: true,
      reconnectAvailable: true,
      gameAvailable: true,
    });
    const toggle = env.document.querySelector(".menu-toggle");
    const panel = env.document.querySelector(".menu-panel");
    const radios = env.document.querySelectorAll('[role="radio"]');

    await toggle.click();
    await radios[1].click();
    assert.deepEqual(env.calls.layout, ["beta"]);
    assert.equal(radios[1].getAttribute("aria-checked"), "true");
    assert.equal(panel.classList.contains("open"), false);

    await toggle.click();
    await env.document.querySelector(".menu-action-reload").click();
    await env.document.querySelector(".menu-action-reconnect").click();
    assert.equal(env.calls.reload, 1);
    assert.equal(env.calls.reconnect, 1);

    await env.document.querySelector(".menu-action-game").click();
    assert.equal(env.calls.game, 1);
    assert.equal(panel.classList.contains("open"), false);

    await toggle.click();
    await env.document.querySelector(".menu-action-help").click();
    assert.equal(env.calls.help, 1);
    assert.equal(panel.classList.contains("open"), false);

    env.controls.update({ currentLayoutKey: "gamma", currentLayoutLabel: "External event" });
    assert.equal(radios[2].getAttribute("aria-checked"), "true");
    assert.equal(env.document.querySelector(".menu-current-layout").textContent, "External event");
  } finally {
    env.restore();
  }
});

test("failed game launch keeps the menu open for accessible feedback", async () => {
  const env = createEnvironment({ onStartGame: async () => false });
  try {
    env.controls.update({
      gameAvailable: true,
      feedback: { kind: "error", message: "Window unavailable" },
    });
    const toggle = env.document.querySelector(".menu-toggle");
    const panel = env.document.querySelector(".menu-panel");
    await toggle.click();
    await env.document.querySelector(".menu-action-game").click();
    assert.equal(panel.classList.contains("open"), true);
    assert.equal(env.document.querySelector(".menu-feedback").textContent, "Window unavailable");
  } finally {
    env.restore();
  }
});

test("failed Help keeps the menu open and exposes accessible feedback", async () => {
  let controls;
  const env = createEnvironment({
    onHelp: async () => {
      controls.update({ feedback: { kind: "error", message: "No default browser" } });
      return false;
    },
  });
  controls = env.controls;
  try {
    const toggle = env.document.querySelector(".menu-toggle");
    const panel = env.document.querySelector(".menu-panel");
    await toggle.click();
    await env.document.querySelector(".menu-action-help").click();

    assert.equal(panel.classList.contains("open"), true);
    const feedback = env.document.querySelector(".menu-feedback");
    assert.equal(feedback.textContent, "No default browser");
    assert.equal(feedback.getAttribute("aria-live"), "polite");
  } finally {
    env.restore();
  }
});
