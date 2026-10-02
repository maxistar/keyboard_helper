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

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const queue = new Map();
  return {
    schedule(callback, ms) { const id = nextId++; queue.set(id, { callback, at: now + ms }); return id; },
    cancel(id) { queue.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, item] of [...queue].sort((a, b) => a[1].at - b[1].at)) {
        if (item.at <= now && queue.delete(id)) item.callback();
      }
    },
  };
}

function harness({ panel = false, timers = fakeTimers() } = {}) {
  const ids = [
    "mobile-workspace", "workspace-content", "workspace-settings-open", "workspace-settings",
    "workspace-settings-close", "workspace-settings-backdrop", "workspace-settings-title",
    "workspace-section-connection", "workspace-section-layout", "workspace-section-diagnostics",
    "workspace-panel-connection", "workspace-panel-layout", "workspace-panel-diagnostics",
    "workspace-connection-state", "workspace-connection-device", "workspace-connection-battery",
    "workspace-connection-notice",
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
  const workspace = createMobileKeyboardWorkspace(document, {
    window, schedule: timers.schedule, cancel: timers.cancel,
  });
  return { document, elements, history, media, timers, window, workspace };
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

test("connection indicator follows presentation severity without relying on color", () => {
  const subject = harness();
  const shell = subject.elements.get("mobile-workspace");
  const states = [
    [{ phase: "idle", title: "Ready to find a keyboard", severity: "neutral" }, "neutral"],
    [{ phase: "scanning", title: "Looking for keyboards", severity: "progress" }, "progress"],
    [{ phase: "ready", title: "Keyboard connected", severity: "success" }, "ready"],
    [{ phase: "reconnecting", title: "Reconnecting", severity: "progress" }, "progress"],
    [{ phase: "bluetooth-unavailable", title: "Bluetooth is off", severity: "attention" }, "attention"],
    [{ phase: "failed", title: "Could not connect", severity: "error" }, "problem"],
  ];
  for (const [presentation, indicator] of states) {
    subject.workspace.updateConnection(presentation);
    assert.equal(shell.dataset.connectionIndicator, indicator, presentation.phase);
    assert.equal(subject.elements.get("workspace-connection-state").textContent, presentation.title);
  }
  subject.workspace.updateConnection({ phase: "idle", title: "Ready to find a keyboard", severity: "neutral" });
  assert.equal(shell.dataset.connectionIndicator, "neutral", "no keyboard is neutral, not an error");
});

test("transient connection notice appears for ready and loss, carries battery, and hides itself", () => {
  const subject = harness();
  const notice = subject.elements.get("workspace-connection-notice");
  subject.workspace.updateConnection({ phase: "ready", title: "Keyboard connected", severity: "success", selectedDevice: { name: "Corne" } });
  assert.equal(notice.textContent, "", "notice waits for the settle window");
  subject.timers.advance(600);
  assert.equal(notice.hidden, false);
  assert.match(notice.textContent, /Keyboard connected · Corne/);
  subject.workspace.updateEvidence({ battery: { status: "available", value: 81 } });
  assert.match(notice.textContent, /Corne · 81%/);
  subject.timers.advance(4000);
  assert.equal(notice.hidden, true);
  assert.equal(notice.textContent, "");

  subject.workspace.updateConnection({ phase: "disconnected", title: "Keyboard disconnected", severity: "attention", selectedDevice: { name: "Corne" } });
  subject.timers.advance(600);
  assert.match(notice.textContent, /Keyboard disconnected · Corne/);
  assert.equal(subject.workspace.snapshot().open, true, "automatic settings elevation is unchanged");
  subject.timers.advance(4000);
  assert.equal(notice.hidden, true);
});

test("workspace source and CSS encode edge-to-edge safe-area, overflow, and reduced-motion contracts", async () => {
  const [html, css, source] = await Promise.all([
    readFile(path.join(root, "src-mobile/index.html"), "utf8"),
    readFile(path.join(root, "src-mobile/styles.css"), "utf8"),
    readFile(path.join(root, "src-mobile/workspace.js"), "utf8"),
  ]);
  assert.match(html, /id="workspace-settings"/);
  assert.equal((html.match(/id="workspace-settings"/g) ?? []).length, 1);
  assert.match(html, /id="workspace-settings-open"[^>]*aria-label="Open settings"[^>]*aria-controls="workspace-settings"[^>]*aria-expanded="false"[\s\S]*<svg[^>]*aria-hidden="true"/);
  assert.match(html, /id="workspace-settings-close"[^>]*aria-label="Close settings"[\s\S]*<span aria-hidden="true">×<\/span>/);
  assert.doesNotMatch(html, /id="workspace-settings-open"[^>]*>\s*Settings\s*<\/button>/);
  assert.doesNotMatch(html, /id="workspace-settings-close"[^>]*>\s*Close\s*<\/button>/);
  assert.match(css, /\.workspace-settings-open[\s\S]*min-width:\s*44px/);
  assert.match(css, /\.workspace-settings-close[\s\S]*min-width:\s*44px/);
  assert.match(css, /min-height:\s*100vh;\s*min-height:\s*100dvh;/);
  assert.match(css, /height:\s*100vh;\s*height:\s*100dvh;/);
  assert.match(css, /env\(safe-area-inset-top, 0px\)/);
  assert.match(css, /--android-safe-top/);
  assert.match(css, /\.shell[\s\S]*var\(--safe-top\)/);
  assert.match(css, /\.workspace-settings\[data-presentation="sheet"\][\s\S]*var\(--safe-bottom\)/);
  assert.match(css, /\.workspace-settings\[data-presentation="panel"\][\s\S]*var\(--safe-right\)/);
  assert.match(css, /\.keyboard-stage[\s\S]*min-height:\s*0/);
  assert.doesNotMatch(css, /\.keyboard-stage\s*\{[^}]*border:/);
  assert.doesNotMatch(css, /\.keyboard-stage\s*\{[^}]*padding:/);
  assert.match(css, /\.viewer-scroller[\s\S]*overflow:\s*hidden/);
  assert.match(css, /\.viewer-scroller[\s\S]*padding-inline:\s*6px/);
  assert.match(css, /\.workspace-settings-body[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.viewer-stream-status[\s\S]*position:\s*absolute/);
  assert.match(html, /id="viewer-stream-status"[\s\S]*aria-live="polite"/);
  assert.match(css, /\.workspace-settings-body[\s\S]*overflow-y:\s*auto/);
  assert.match(html, /id="workspace-connection-compact"[^>]*class="[^"]*visually-hidden[^"]*"[^>]*role="status"/);
  assert.match(html, /id="workspace-settings-open"[^>]*aria-describedby="workspace-connection-compact"/);
  assert.match(css, /\.connection-notice[\s\S]*pointer-events:\s*none/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.connection-notice/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /orientation:\s*landscape/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\(|WebSocket|write\(|startScan|connectSelected|subscribeNotifications/);
});
