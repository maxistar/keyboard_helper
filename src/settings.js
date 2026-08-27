import {
  BUILTIN_LAYOUTS,
  hotkeyFromKeyboardEvent,
} from "./app_config.js";
import { createSettingsState } from "./settings_state.js";
import {
  chooseExternalLayout,
  confirmSettingsClose,
  persistSettingsDraft,
} from "./settings_actions.js";
import { parseExternalLayout } from "./app_config.js";

const elements = {
  form: document.getElementById("settingsForm"),
  status: document.getElementById("settingsStatus"),
  configPath: document.getElementById("configPath"),
  reload: document.getElementById("reloadSettingsButton"),
  recovery: document.getElementById("recoveryPanel"),
  recoveryMessage: document.getElementById("recoveryMessage"),
  replaceInvalid: document.getElementById("replaceInvalidButton"),
  layoutFieldset: document.getElementById("layoutFieldset"),
  builtinLayouts: document.getElementById("builtinLayouts"),
  layoutsError: document.getElementById("layoutsError"),
  defaultLayout: document.getElementById("defaultLayout"),
  defaultLayoutError: document.getElementById("defaultLayoutError"),
  addLayout: document.getElementById("addLayoutButton"),
  externalLayouts: document.getElementById("externalLayouts"),
  externalError: document.getElementById("externalError"),
  hotkeyValue: document.getElementById("hotkeyValue"),
  recordHotkey: document.getElementById("recordHotkeyButton"),
  clearHotkey: document.getElementById("clearHotkeyButton"),
  hotkeyError: document.getElementById("hotkeyError"),
  hotkeyWarning: document.getElementById("hotkeyWarning"),
  formError: document.getElementById("formError"),
  cancel: document.getElementById("cancelButton"),
  save: document.getElementById("saveButton"),
};

const tauri = window.__TAURI__;
let state = null;
let loading = true;
let saving = false;
let recording = false;
let closingApproved = false;

function setStatus(message, kind = "") {
  elements.status.textContent = message;
  elements.status.className = `status ${kind}`.trim();
  elements.status.hidden = !message;
}

function displayError(error, fallback = "The requested action failed.") {
  return typeof error === "string" ? error : error?.message ?? fallback;
}

function currentWindow() {
  return tauri?.window?.getCurrentWindow?.() ?? null;
}

async function confirmDiscard() {
  return confirmSettingsClose(state?.snapshot().dirty, async () => {
    if (typeof tauri?.dialog?.confirm === "function") {
      return tauri.dialog.confirm("Discard your unsaved settings?", {
        title: "Discard changes?",
        kind: "warning",
      });
    }
    return globalThis.confirm?.("Discard your unsaved settings?") ?? false;
  });
}

async function closeSettings() {
  closingApproved = true;
  const windowHandle = currentWindow();
  if (windowHandle?.destroy) await windowHandle.destroy();
  else if (windowHandle?.close) await windowHandle.close();
  else globalThis.close?.();
}

function renderBuiltinLayouts(snapshot) {
  elements.builtinLayouts.innerHTML = "";
  for (const [key, definition] of Object.entries(BUILTIN_LAYOUTS)) {
    const label = document.createElement("label");
    label.className = "layout-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = snapshot.draft.layouts[key] === true;
    input.disabled = loading || saving;
    input.dataset.layoutKey = key;
    input.addEventListener("change", () => {
      state.setLayoutEnabled(key, input.checked);
      render();
    });
    const text = document.createElement("span");
    text.textContent = definition.name;
    label.append(input, text);
    elements.builtinLayouts.appendChild(label);
  }
}

function layoutLabel(key, snapshot) {
  return BUILTIN_LAYOUTS[key]?.name ?? snapshot.externalMetadata[key]?.name ?? key;
}

function renderDefaultLayout(snapshot) {
  elements.defaultLayout.innerHTML = "";
  for (const key of Object.keys(snapshot.draft.layouts)) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = layoutLabel(key, snapshot);
    option.selected = key === snapshot.draft.defaultLayout;
    elements.defaultLayout.appendChild(option);
  }
  elements.defaultLayout.disabled = loading || saving;
  const error = snapshot.validation.errors.defaultLayout ?? "";
  elements.defaultLayoutError.textContent = error;
  elements.defaultLayout.setAttribute("aria-invalid", String(Boolean(error)));
}

function renderExternalLayouts(snapshot) {
  elements.externalLayouts.innerHTML = "";
  const entries = Object.entries(snapshot.draft.layouts).filter(([, source]) => typeof source === "string");
  if (!entries.length) {
    const empty = document.createElement("li");
    empty.className = "empty-message";
    empty.textContent = "No custom layouts added.";
    elements.externalLayouts.appendChild(empty);
  }
  for (const [key, path] of entries) {
    const metadata = snapshot.externalMetadata[key];
    const item = document.createElement("li");
    item.className = `external-layout ${metadata?.valid === false ? "invalid" : ""}`.trim();
    const detail = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = metadata?.name ?? (metadata ? key : "Checking layout…");
    const pathElement = document.createElement("span");
    pathElement.textContent = path;
    detail.append(name, pathElement);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button ghost small";
    remove.textContent = "Remove";
    remove.disabled = loading || saving;
    remove.setAttribute("aria-label", `Remove ${name.textContent} from settings; the source file will not be deleted`);
    remove.addEventListener("click", () => {
      state.removeLayout(key);
      render();
    });
    item.append(detail, remove);
    elements.externalLayouts.appendChild(item);
  }
  elements.externalError.textContent = snapshot.validation.errors.externalLayouts ?? "";
}

function render() {
  if (!state) return;
  const snapshot = state.snapshot();
  elements.configPath.textContent = snapshot.path ?? "";
  elements.layoutFieldset.disabled = loading || saving;
  elements.addLayout.disabled = loading || saving || !tauri?.dialog?.open;
  elements.recordHotkey.disabled = loading || saving;
  elements.clearHotkey.disabled = loading || saving || !snapshot.draft.toggleHotkey;
  elements.cancel.disabled = loading || saving;
  elements.save.disabled = loading || saving || !snapshot.canSave;
  elements.save.textContent = saving ? "Saving…" : "Save changes";
  elements.layoutsError.textContent = snapshot.validation.errors.layouts ?? "";
  elements.hotkeyValue.textContent = recording ? "Press shortcut…" : snapshot.draft.toggleHotkey ?? "Not set";
  elements.hotkeyValue.classList.toggle("recording", recording);
  elements.hotkeyError.textContent = snapshot.validation.errors.toggleHotkey ?? "";
  elements.hotkeyWarning.textContent = snapshot.validation.warnings.toggleHotkey ?? "";
  elements.recovery.hidden = snapshot.status !== "invalid";
  if (snapshot.status === "invalid") {
    elements.recoveryMessage.textContent = `${snapshot.error ?? "The file is malformed."} (${snapshot.path})`;
    elements.replaceInvalid.disabled = loading || saving || snapshot.replaceInvalid;
    elements.replaceInvalid.textContent = snapshot.replaceInvalid
      ? "Replacement confirmed — review and save"
      : "Replace damaged file with these settings";
  }
  renderBuiltinLayouts(snapshot);
  renderDefaultLayout(snapshot);
  renderExternalLayouts(snapshot);
}

async function validateExistingExternalLayouts() {
  const entries = Object.entries(state.snapshot().draft.layouts).filter(([, source]) => typeof source === "string");
  await Promise.all(entries.map(async ([key, path]) => {
    try {
      const raw = await tauri.core.invoke("read_layout_file", { path });
      const result = parseExternalLayout(raw);
      state.setExternalMetadata(key, result.valid
        ? { name: result.definition.name, path, valid: true }
        : { name: key, path, valid: false, error: result.error });
    } catch (error) {
      state.setExternalMetadata(key, { name: key, path, valid: false, error: displayError(error) });
    }
  }));
}

async function addExternalLayout() {
  elements.externalError.textContent = "";
  try {
    const result = await chooseExternalLayout({
      state,
      openFile: () => tauri.dialog.open({
        multiple: false,
        directory: false,
        filters: [{ name: "Keyboard layout", extensions: ["json"] }],
      }),
      readFile: (path) => tauri.core.invoke("read_layout_file", { path }),
    });
    if (result.status === "invalid") elements.externalError.textContent = result.error;
    if (result.status === "duplicate") {
      elements.externalError.textContent = "That layout file is already configured.";
    }
    render();
  } catch (error) {
    elements.externalError.textContent = displayError(error, "Could not add that layout file.");
  }
}

function finishRecording() {
  recording = false;
  window.removeEventListener("keydown", captureHotkey, true);
  render();
}

function captureHotkey(event) {
  event.preventDefault();
  event.stopPropagation();
  const result = hotkeyFromKeyboardEvent(event);
  if (result.pending) {
    elements.hotkeyError.textContent = "Keep holding modifiers and press another key.";
    return;
  }
  if (result.error) {
    elements.hotkeyError.textContent = result.error;
    return;
  }
  state.setHotkey(result.value);
  finishRecording();
}

function startRecording() {
  recording = true;
  elements.hotkeyError.textContent = "";
  window.addEventListener("keydown", captureHotkey, true);
  render();
  elements.hotkeyValue.focus?.();
}

async function save(event) {
  event.preventDefault();
  const snapshot = state.snapshot();
  if (!snapshot.canSave || saving) return;
  saving = true;
  elements.formError.textContent = "";
  elements.reload.hidden = true;
  render();
  try {
    await persistSettingsDraft({ invoke: tauri.core.invoke, state });
    state.commit();
    setStatus("Settings saved. Refreshing the keyboard overlay…", "success");
    await closeSettings();
  } catch (error) {
    const message = displayError(error, "Could not save settings.");
    elements.formError.textContent = message;
    setStatus("Settings were not saved.", "error");
    if (message.includes("changed since")) elements.reload.hidden = false;
  } finally {
    saving = false;
    render();
  }
}

async function initialize() {
  if (!tauri?.core?.invoke) {
    setStatus("Settings are available in the desktop application only.", "error");
    return;
  }
  try {
    const result = await tauri.core.invoke("read_config_state");
    state = createSettingsState(result);
    await validateExistingExternalLayouts();
    loading = false;
    setStatus(result.status === "missing"
      ? "No settings file yet. Built-in defaults are ready to use."
      : result.status === "invalid"
        ? "Review the defaults below, then explicitly confirm replacement."
        : "");
    render();
  } catch (error) {
    setStatus(displayError(error, "Could not load settings."), "error");
  }
}

elements.defaultLayout.addEventListener("change", () => {
  state.setDefaultLayout(elements.defaultLayout.value);
  render();
});
elements.addLayout.addEventListener("click", addExternalLayout);
elements.recordHotkey.addEventListener("click", startRecording);
elements.clearHotkey.addEventListener("click", () => {
  if (recording) finishRecording();
  state.setHotkey(null);
  render();
});
elements.replaceInvalid.addEventListener("click", () => {
  state.authorizeReplacement();
  render();
});
elements.cancel.addEventListener("click", async () => {
  if (await confirmDiscard()) await closeSettings();
});
elements.reload.addEventListener("click", () => globalThis.location.reload());
elements.form.addEventListener("submit", save);

const windowHandle = currentWindow();
windowHandle?.onCloseRequested?.(async (event) => {
  if (closingApproved || !state?.snapshot().dirty) return;
  event.preventDefault();
  if (await confirmDiscard()) await closeSettings();
});

initialize();
