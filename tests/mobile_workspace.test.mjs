import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createMobileKeyboardWorkspace,
  WorkspacePresentation,
  WorkspaceSection,
} from "../src-mobile/workspace.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class ElementStub {
  constructor(document, id) {
    this.document = document;
    this.id = id;
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.inert = false;
    this.listeners = new Map();
    this.textContent = "";
    this.focusables = [];
  }
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
  }
  dispatch(type, values = {}) {
    const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...values };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { this.document.activeElement = this; }
  querySelectorAll() { return this.focusables.filter((element) => !element.hidden); }
}

class MediaStub {
  constructor(matches = false) { this.matches = matches; this.listeners = new Set(); }
  addEventListener(_type, listener) { this.listeners.add(listener); }
  removeEventListener(_type, listener) { this.listeners.delete(listener); }
  set(matches) { this.matches = matches; for (const listener of this.listeners) listener(this); }
}

function harness({ panel = false } = {}) {
  const ids = [
    "mobile-workspace", "workspace-content", "workspace-settings-open", "workspace-settings",
    "workspace-settings-close", "workspace-settings-backdrop", "workspace-settings-title",
    "workspace-section-connection", "workspace-section-layout", "workspace-section-diagnostics",
    "workspace-panel-connection", "workspace-panel-layout", "workspace-panel-diagnostics",
    "workspace-connection-state", "workspace-connection-device", "workspace-connection-battery",
  ];
  const elements = new Map();
  const document = {
    activeElement: null,
    getElementById: (id) => elements.get(id) ?? null,
  };
  ids.forEach((id) => elements.set(id, new ElementStub(document, id)));
  const settings = elements.get("workspace-settings");
  settings.focusables = [
    elements.get("workspace-settings-close"),
    elements.get("workspace-section-connection"),
    elements.get("workspace-section-layout"),
    elements.get("workspace-section-diagnostics"),
  ];
  const media = new MediaStub(panel);
  const history = {
    pushes: 0,
    backs: 0,
    pushState() { this.pushes += 1; },
    back() { this.backs += 1; },
  };
  const listeners = new Map();
  const window = {
    history,
    matchMedia: () => media,
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) ?? []), listener]); },
    removeEventListener(type, listener) { listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener)); },
    dispatch(type) { for (const listener of listeners.get(type) ?? []) listener({ type }); },
  };
  const workspace = createMobileKeyboardWorkspace(document, { window });
  return { document, elements, history, media, window, workspace };
}

test("settings uses one stateful subtree across sheet and panel presentations", () => {
  const subject = harness();
  const opener = subject.elements.get("workspace-settings-open");
  opener.focus();
  opener.dispatch("click");

  assert.equal(subject.workspace.snapshot().presentation, WorkspacePresentation.SHEET);
  assert.equal(subject.elements.get("workspace-settings").hidden, false);
  assert.equal(subject.elements.get("workspace-settings").attributes.get("role"), "dialog");
  assert.equal(subject.elements.get("workspace-settings").attributes.get("aria-modal"), "true");
  assert.equal(subject.elements.get("workspace-content").inert, true);
  assert.equal(subject.document.activeElement, subject.elements.get("workspace-settings-close"));

  subject.elements.get("workspace-section-layout").dispatch("click");
  subject.media.set(true);
  assert.equal(subject.workspace.snapshot().section, WorkspaceSection.LAYOUT);
  assert.equal(subject.workspace.snapshot().presentation, WorkspacePresentation.PANEL);
  assert.equal(subject.elements.get("workspace-settings").attributes.get("role"), "complementary");
  assert.equal(subject.elements.get("workspace-settings").attributes.has("aria-modal"), false);
  assert.equal(subject.elements.get("workspace-content").inert, false);
  assert.equal(subject.elements.get("workspace-settings-backdrop").hidden, true);
});

test("sheet traps focus, closes with Escape, and restores the opener", () => {
  const subject = harness();
  const opener = subject.elements.get("workspace-settings-open");
  opener.focus();
  opener.dispatch("click");
  const settings = subject.elements.get("workspace-settings");
  const last = subject.elements.get("workspace-section-diagnostics");
  last.focus();
  const tab = settings.dispatch("keydown", { key: "Tab", shiftKey: false });
  assert.equal(tab.defaultPrevented, true);
  assert.equal(subject.document.activeElement, subject.elements.get("workspace-settings-close"));

  settings.dispatch("keydown", { key: "Escape" });
  assert.equal(subject.workspace.snapshot().open, false);
  assert.equal(subject.document.activeElement, opener);
  assert.equal(subject.elements.get("workspace-content").inert, false);
});

test("Android-style history back dismisses settings without losing the active section", () => {
  const subject = harness();
  const opener = subject.elements.get("workspace-settings-open");
  opener.focus();
  subject.workspace.open(WorkspaceSection.DIAGNOSTICS, opener);
  assert.equal(subject.history.pushes, 1);
  subject.window.dispatch("popstate");
  assert.equal(subject.workspace.snapshot().open, false);
  assert.equal(subject.workspace.snapshot().section, WorkspaceSection.DIAGNOSTICS);
  assert.equal(subject.document.activeElement, opener);
  assert.equal(subject.history.backs, 0);
});

test("actionable lifecycle transitions elevate connection once and passive evidence stays quiet", () => {
  const subject = harness();
  subject.workspace.updateConnection({ phase: "permission-required", title: "Bluetooth access needed", severity: "attention", selectedDevice: null });
  assert.equal(subject.workspace.snapshot().open, false, "initial actionable state remains compact");
  subject.workspace.updateConnection({ phase: "ready", title: "Keyboard connected", severity: "success", selectedDevice: { name: "Corne" } });
  subject.workspace.updateConnection({ phase: "failed", title: "Could not connect", severity: "error", selectedDevice: { name: "Corne" } });
  assert.equal(subject.workspace.snapshot().open, true);
  assert.equal(subject.workspace.snapshot().section, WorkspaceSection.CONNECTION);
  subject.workspace.close();
  subject.workspace.updateEvidence({ battery: { status: "available", value: 81 } });
  assert.equal(subject.workspace.snapshot().open, false);
  subject.workspace.updateConnection({ phase: "failed", title: "Could not connect", severity: "error", selectedDevice: { name: "Corne" } });
  assert.equal(subject.workspace.snapshot().open, false, "dismissed state does not reopen for the same condition");
  subject.workspace.updateConnection({ phase: "ready", title: "Keyboard connected", severity: "success", selectedDevice: { name: "Corne" } });
  subject.workspace.updateConnection({ phase: "disconnected", title: "Keyboard disconnected", severity: "attention", selectedDevice: { name: "Corne" } });
  assert.equal(subject.workspace.snapshot().open, true, "a new actionable transition is elevated");
});

test("workspace source and CSS encode native-inset viewport, overflow, and reduced-motion contracts", async () => {
  const [html, css, source] = await Promise.all([
    readFile(path.join(root, "src-mobile/index.html"), "utf8"),
    readFile(path.join(root, "src-mobile/styles.css"), "utf8"),
    readFile(path.join(root, "src-mobile/workspace.js"), "utf8"),
  ]);
  assert.match(html, /id="workspace-settings"/);
  assert.equal((html.match(/id="workspace-settings"/g) ?? []).length, 1);
  assert.match(css, /min-height:\s*100vh;\s*min-height:\s*100dvh;/);
  assert.match(css, /height:\s*100vh;\s*height:\s*100dvh;/);
  assert.doesNotMatch(css, /env\(safe-area-inset-/);
  assert.match(css, /\.shell[\s\S]*padding:\s*10px/);
  assert.match(css, /\.keyboard-stage[\s\S]*min-height:\s*0/);
  assert.match(css, /\.viewer-scroller[\s\S]*overflow:\s*auto/);
  assert.match(css, /\.viewer-stream-status[\s\S]*position:\s*absolute/);
  assert.match(html, /id="viewer-stream-status"[\s\S]*aria-live="polite"/);
  assert.match(css, /\.workspace-settings-body[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /orientation:\s*landscape/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\(|WebSocket|write\(|startScan|connectSelected|subscribeNotifications/);
});
