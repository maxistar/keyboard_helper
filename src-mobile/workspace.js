export const WorkspacePresentation = Object.freeze({ SHEET: "sheet", PANEL: "panel" });
export const WorkspaceSection = Object.freeze({
  CONNECTION: "connection",
  LAYOUT: "layout",
  DIAGNOSTICS: "diagnostics",
});

const PANEL_QUERY = "(min-width: 720px), (orientation: landscape) and (max-height: 600px)";
const ACTIONABLE_PHASES = new Set([
  "permission-required", "disconnected", "bluetooth-unavailable", "unsupported",
  "capacity-unavailable", "failed",
]);
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])", "select:not([disabled])", "input:not([disabled])",
  "summary", "[href]", "[tabindex]:not([tabindex='-1'])",
].join(",");

function required(document, id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Mobile keyboard workspace is missing #${id}.`);
  return element;
}

function actionableKey(presentation, lifecycle) {
  const phase = presentation?.phase;
  if (!phase) return null;
  if (presentation.actions?.connect?.visible && presentation.actions.connect.enabled) return `${phase}:connect`;
  if (!ACTIONABLE_PHASES.has(phase)) return null;
  return `${phase}:${lifecycle?.reason?.code ?? "default"}`;
}

export function createMobileKeyboardWorkspace(document, options = {}) {
  const hostWindow = options.window ?? globalThis.window;
  const elements = {
    shell: required(document, "mobile-workspace"),
    content: required(document, "workspace-content"),
    open: required(document, "workspace-settings-open"),
    settings: required(document, "workspace-settings"),
    close: required(document, "workspace-settings-close"),
    backdrop: required(document, "workspace-settings-backdrop"),
    connectionState: required(document, "workspace-connection-state"),
    connectionDevice: required(document, "workspace-connection-device"),
    connectionBattery: required(document, "workspace-connection-battery"),
    sectionButtons: {
      [WorkspaceSection.CONNECTION]: required(document, "workspace-section-connection"),
      [WorkspaceSection.LAYOUT]: required(document, "workspace-section-layout"),
      [WorkspaceSection.DIAGNOSTICS]: required(document, "workspace-section-diagnostics"),
    },
    panels: {
      [WorkspaceSection.CONNECTION]: required(document, "workspace-panel-connection"),
      [WorkspaceSection.LAYOUT]: required(document, "workspace-panel-layout"),
      [WorkspaceSection.DIAGNOSTICS]: required(document, "workspace-panel-diagnostics"),
    },
  };
  const media = hostWindow?.matchMedia?.(PANEL_QUERY) ?? {
    matches: false, addEventListener() {}, removeEventListener() {},
  };
  let state = Object.freeze({
    open: false,
    section: WorkspaceSection.CONNECTION,
    presentation: media.matches ? WorkspacePresentation.PANEL : WorkspacePresentation.SHEET,
  });
  let lastFocused = null;
  let ownsHistoryEntry = false;
  let lastActionableKey;
  let dismissedActionableKey = null;

  function render() {
    const sheet = state.presentation === WorkspacePresentation.SHEET;
    elements.shell.dataset.settingsOpen = String(state.open);
    elements.shell.dataset.settingsPresentation = state.presentation;
    elements.settings.dataset.presentation = state.presentation;
    elements.settings.hidden = !state.open;
    elements.backdrop.hidden = !state.open || !sheet;
    elements.open.setAttribute("aria-expanded", String(state.open));
    elements.content.inert = state.open && sheet;
    elements.settings.setAttribute("role", sheet ? "dialog" : "complementary");
    if (sheet) elements.settings.setAttribute("aria-modal", "true");
    else elements.settings.removeAttribute("aria-modal");
    for (const section of Object.values(WorkspaceSection)) {
      const selected = section === state.section;
      elements.sectionButtons[section].setAttribute("aria-selected", String(selected));
      elements.sectionButtons[section].setAttribute("tabindex", selected ? "0" : "-1");
      elements.panels[section].hidden = !selected;
    }
  }

  function selectSection(section) {
    if (!Object.values(WorkspaceSection).includes(section)) throw new TypeError("Unknown workspace section.");
    state = Object.freeze({ ...state, section });
    render();
    return state;
  }

  function open(section = state.section, opener = document.activeElement ?? elements.open) {
    if (!Object.values(WorkspaceSection).includes(section)) throw new TypeError("Unknown workspace section.");
    if (!state.open) {
      lastFocused = opener;
      if (hostWindow?.history?.pushState && !ownsHistoryEntry) {
        hostWindow.history.pushState({ keyboardHelperWorkspaceSettings: true }, "");
        ownsHistoryEntry = true;
      }
    }
    state = Object.freeze({ ...state, open: true, section });
    render();
    elements.close.focus?.();
    return state;
  }

  function close({ fromHistory = false } = {}) {
    if (!state.open) return state;
    dismissedActionableKey = lastActionableKey ?? dismissedActionableKey;
    state = Object.freeze({ ...state, open: false });
    render();
    const restore = lastFocused;
    lastFocused = null;
    if (ownsHistoryEntry) {
      ownsHistoryEntry = false;
      if (!fromHistory) hostWindow?.history?.back?.();
    }
    restore?.focus?.();
    return state;
  }

  function updateConnection(presentation, lifecycle = null) {
    elements.connectionState.textContent = presentation?.title ?? "Getting ready";
    elements.connectionState.dataset.severity = presentation?.severity ?? "neutral";
    elements.connectionDevice.textContent = presentation?.selectedDevice?.name ?? "No keyboard";
    elements.shell.dataset.connectionPhase = presentation?.phase ?? "unknown";
    const nextActionableKey = actionableKey(presentation, lifecycle);
    elements.shell.dataset.connectionAttention = String(Boolean(nextActionableKey));
    const newlyActionable = lastActionableKey !== undefined && nextActionableKey && nextActionableKey !== lastActionableKey;
    if (newlyActionable && nextActionableKey !== dismissedActionableKey) {
      open(WorkspaceSection.CONNECTION, elements.open);
    }
    if (!nextActionableKey) dismissedActionableKey = null;
    lastActionableKey = nextActionableKey;
    return state;
  }

  function updateEvidence(snapshot) {
    elements.connectionBattery.textContent = snapshot?.battery?.status === "available"
      ? `${snapshot.battery.value}%`
      : "—";
    return state;
  }

  function onSettingsKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab" || state.presentation !== WorkspacePresentation.SHEET) return;
    const focusables = [...elements.settings.querySelectorAll(FOCUSABLE_SELECTOR)]
      .filter((element) => !element.hidden
        && !element.closest?.("[hidden]")
        && element.getAttribute?.("aria-hidden") !== "true");
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const onOpen = () => open(WorkspaceSection.CONNECTION, elements.open);
  const onClose = () => close();
  const onMediaChange = () => {
    state = Object.freeze({ ...state, presentation: media.matches ? WorkspacePresentation.PANEL : WorkspacePresentation.SHEET });
    render();
  };
  const onPopState = () => {
    ownsHistoryEntry = false;
    if (state.open) close({ fromHistory: true });
  };
  const sectionHandlers = Object.fromEntries(Object.values(WorkspaceSection).map((section) => [section, () => selectSection(section)]));

  elements.open.addEventListener("click", onOpen);
  elements.close.addEventListener("click", onClose);
  elements.backdrop.addEventListener("click", onClose);
  elements.settings.addEventListener("keydown", onSettingsKeydown);
  for (const section of Object.values(WorkspaceSection)) elements.sectionButtons[section].addEventListener("click", sectionHandlers[section]);
  media.addEventListener?.("change", onMediaChange);
  hostWindow?.addEventListener?.("popstate", onPopState);
  render();

  return {
    close, open, selectSection, updateConnection, updateEvidence,
    snapshot: () => state,
    dispose() {
      elements.open.removeEventListener?.("click", onOpen);
      elements.close.removeEventListener?.("click", onClose);
      elements.backdrop.removeEventListener?.("click", onClose);
      elements.settings.removeEventListener?.("keydown", onSettingsKeydown);
      for (const section of Object.values(WorkspaceSection)) elements.sectionButtons[section].removeEventListener?.("click", sectionHandlers[section]);
      media.removeEventListener?.("change", onMediaChange);
      hostWindow?.removeEventListener?.("popstate", onPopState);
    },
  };
}
