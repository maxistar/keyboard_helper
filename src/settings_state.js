import {
  BUILTIN_LAYOUTS,
  configurationsEqual,
  createDefaultConfig,
  createExternalLayoutEntry,
  normalizeConfig,
  serializeConfig,
  validateConfigDraft,
} from "./app_config.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createSettingsState(readResult) {
  const status = readResult?.status ?? "missing";
  const original = status === "valid" && readResult.data ? clone(readResult.data) : {};
  const initial = status === "valid" ? normalizeConfig(original) : createDefaultConfig();
  let baseline = clone(initial);
  let draft = clone(initial);
  let replaceInvalid = false;
  const externalMetadata = new Map();

  function setDraft(next) {
    draft = next;
    return snapshot();
  }

  function snapshot() {
    const validation = validateConfigDraft(draft);
    const unvalidatedExternal = Object.entries(draft.layouts)
      .filter(([, source]) => typeof source === "string")
      .filter(([key]) => externalMetadata.get(key)?.valid !== true)
      .map(([key]) => key);
    if (unvalidatedExternal.length) {
      validation.valid = false;
      validation.errors.externalLayouts = "Every custom layout must be readable and compatible before saving.";
    }
    const dirty = !configurationsEqual(draft, baseline) || (status === "invalid" && replaceInvalid);
    return {
      status,
      path: readResult?.sourcePath ?? readResult?.path ?? null,
      error: readResult?.error ?? null,
      sourcePath: readResult?.sourcePath ?? null,
      revision: readResult?.revision ?? "missing",
      baseline: clone(baseline),
      draft: clone(draft),
      validation,
      dirty,
      replaceInvalid,
      canSave: dirty && validation.valid && (status !== "invalid" || replaceInvalid),
      externalMetadata: Object.fromEntries(externalMetadata),
      unvalidatedExternal,
    };
  }

  function setLayoutEnabled(key, enabled) {
    const layouts = { ...draft.layouts };
    if (enabled) layouts[key] = Object.hasOwn(BUILTIN_LAYOUTS, key) ? true : layouts[key];
    else delete layouts[key];
    return setDraft({ ...draft, layouts });
  }

  function setDefaultLayout(key) {
    return setDraft({ ...draft, defaultLayout: key });
  }

  function setHotkey(value) {
    return setDraft({ ...draft, toggleHotkey: value || null });
  }

  function addExternal(path, definition) {
    const result = createExternalLayoutEntry({ path, definition, layouts: draft.layouts });
    if (result.duplicateKey) return { ...snapshot(), duplicateKey: result.duplicateKey };
    externalMetadata.set(result.key, { name: definition.name, path, valid: true });
    setDraft({ ...draft, layouts: { ...draft.layouts, [result.key]: path } });
    return { ...snapshot(), addedKey: result.key };
  }

  function removeLayout(key) {
    const layouts = { ...draft.layouts };
    delete layouts[key];
    externalMetadata.delete(key);
    return setDraft({ ...draft, layouts });
  }

  function setExternalMetadata(key, metadata) {
    externalMetadata.set(key, metadata);
    return snapshot();
  }

  function authorizeReplacement() {
    replaceInvalid = true;
    return snapshot();
  }

  function serializedConfig() {
    return serializeConfig(original, draft);
  }

  function commit() {
    baseline = clone(draft);
    replaceInvalid = false;
    return snapshot();
  }

  return {
    snapshot,
    setLayoutEnabled,
    setDefaultLayout,
    setHotkey,
    addExternal,
    removeLayout,
    setExternalMetadata,
    authorizeReplacement,
    serializedConfig,
    commit,
  };
}
