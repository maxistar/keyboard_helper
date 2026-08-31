export const BUILTIN_LAYOUTS = Object.freeze({
  qwerty: Object.freeze({ name: "QWERTY", file: "layout_qwerty.json" }),
  qwertz: Object.freeze({ name: "QWERTZ", file: "layout_qwertz.json" }),
  corne: Object.freeze({ name: "Corne", file: "layout_corne.json" }),
  dactyl: Object.freeze({ name: "Dactyl", file: "layout_dactyl.json" }),
  magic: Object.freeze({ name: "Magic", file: "layout_magic.json" }),
  mac: Object.freeze({ name: "Mac", file: "layout_mac.json" }),
});

export const BUILTIN_LAYOUT_FILES = Object.freeze(
  Object.fromEntries(Object.entries(BUILTIN_LAYOUTS).map(([key, entry]) => [key, entry.file])),
);

const MODIFIER_ALIASES = Object.freeze({
  shift: "Shift",
  meta: "Meta",
  cmd: "Meta",
  command: "Meta",
  control: "Ctrl",
  ctrl: "Ctrl",
  alt: "Alt",
  option: "Alt",
});
const MODIFIER_ORDER = ["Shift", "Ctrl", "Alt", "Meta"];
const MODIFIER_KEYS = new Set([
  "Shift", "ShiftLeft", "ShiftRight", "Control", "ControlLeft", "ControlRight",
  "Alt", "AltLeft", "AltRight", "Meta", "MetaLeft", "MetaRight",
]);
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createDefaultConfig() {
  return {
    defaultLayout: "qwerty",
    toggleHotkey: null,
    layouts: Object.fromEntries(Object.keys(BUILTIN_LAYOUTS).map((key) => [key, true])),
  };
}

export function normalizeHotkey(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parts = String(value).split("+").map((part) => part.trim()).filter(Boolean);
  const modifiers = new Set();
  let trigger = null;
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    if (trigger) return null;
    if (/^[a-z]$/i.test(part)) trigger = `Key${part.toUpperCase()}`;
    else if (/^[0-9]$/.test(part)) trigger = `Digit${part}`;
    else if (/^[A-Za-z][A-Za-z0-9]*$/.test(part)) trigger = part;
    else return null;
  }
  if (!trigger) return null;
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), trigger].join("+");
}

export function hotkeyFromKeyboardEvent(event) {
  if (event?.isComposing || MODIFIER_KEYS.has(event?.key) || MODIFIER_KEYS.has(event?.code)) {
    return { value: null, pending: true, error: null };
  }
  let trigger = event?.code;
  if (!trigger || trigger === "Unidentified" || !/^[A-Za-z][A-Za-z0-9]*$/.test(trigger)) {
    return { value: null, pending: false, error: "Press a supported non-modifier key." };
  }
  const parts = [];
  if (event.shiftKey) parts.push("Shift");
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.metaKey) parts.push("Meta");
  parts.push(trigger);
  return {
    value: parts.join("+"),
    pending: false,
    error: null,
    warning: parts.length === 1 ? "An unmodified shortcut may trigger while typing." : null,
  };
}

export function normalizeConfig(value) {
  const defaults = createDefaultConfig();
  if (!isPlainObject(value)) return defaults;
  const rawLayouts = isPlainObject(value.layouts) ? value.layouts : defaults.layouts;
  const layouts = {};
  for (const [key, source] of Object.entries(rawLayouts)) {
    if (source === true || (typeof source === "string" && source.trim())) layouts[key] = source;
  }
  if (Object.keys(layouts).length === 0) Object.assign(layouts, defaults.layouts);
  const requestedDefault = typeof value.defaultLayout === "string" ? value.defaultLayout : null;
  const defaultLayout = requestedDefault && Object.hasOwn(layouts, requestedDefault)
    ? requestedDefault
    : Object.keys(layouts)[0] ?? defaults.defaultLayout;
  const normalized = { ...value };
  delete normalized.highlightingSource;
  return {
    ...normalized,
    defaultLayout,
    toggleHotkey: normalizeHotkey(value.toggleHotkey),
    layouts,
  };
}

export function serializeConfig(original, draft) {
  const base = isPlainObject(original) ? { ...original } : {};
  delete base.highlightingSource;
  return {
    ...base,
    defaultLayout: draft.defaultLayout,
    toggleHotkey: normalizeHotkey(draft.toggleHotkey),
    layouts: { ...draft.layouts },
  };
}

export function validateConfigDraft(draft) {
  const errors = {};
  const warnings = {};
  const layouts = isPlainObject(draft?.layouts) ? draft.layouts : {};
  const enabled = Object.entries(layouts).filter(([, source]) => source === true || (typeof source === "string" && source.trim()));
  if (enabled.length === 0) errors.layouts = "Enable at least one keyboard layout.";
  if (!draft?.defaultLayout || !Object.hasOwn(layouts, draft.defaultLayout)) {
    errors.defaultLayout = "Choose an enabled startup layout.";
  }
  if (draft?.toggleHotkey && !normalizeHotkey(draft.toggleHotkey)) {
    errors.toggleHotkey = "Record a supported keyboard shortcut or clear it.";
  } else if (draft?.toggleHotkey && !String(draft.toggleHotkey).includes("+")) {
    warnings.toggleHotkey = "An unmodified shortcut may trigger while typing.";
  }
  return { valid: Object.keys(errors).length === 0, errors, warnings };
}

function normalizeLayers(source) {
  if (Array.isArray(source)) return source;
  if (!isPlainObject(source)) return [];
  return Object.values(source).filter(Boolean);
}

export function validateLayoutDefinition(value) {
  if (!isPlainObject(value)) return { valid: false, error: "The layout must be a JSON object." };
  if (typeof value.name !== "string" || !value.name.trim()) {
    return { valid: false, error: "The layout needs a display name." };
  }
  const size = value.keySize;
  if (!isPlainObject(size) || ![size.w, size.h].every((number) => Number.isFinite(number) && number > 0)) {
    return { valid: false, error: "The layout needs positive key width and height values." };
  }
  if (!Array.isArray(value.keyPositions) || value.keyPositions.length === 0 || value.keyPositions.some(
    (key) => !isPlainObject(key) || !Number.isFinite(key.row) || !Number.isFinite(key.col),
  )) {
    return { valid: false, error: "The layout needs positioned keys with numeric rows and columns." };
  }
  const layers = normalizeLayers(value.keyLayers);
  if (!layers.length || !layers.some((layer) => Array.isArray(layer) && layer.length > 0)) {
    return { valid: false, error: "The layout needs at least one compatible key layer." };
  }
  return { valid: true, error: null, definition: value };
}

export function parseExternalLayout(raw) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return validateLayoutDefinition(value);
  } catch {
    return { valid: false, error: "The selected file is not valid JSON." };
  }
}

export function slugifyLayoutKey(value) {
  const slug = String(value ?? "layout")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "layout";
}

export function createExternalLayoutEntry({ path, definition, layouts = {} }) {
  const duplicate = Object.entries(layouts).find(([, source]) => source === path);
  if (duplicate) return { duplicateKey: duplicate[0], key: null, entry: null };
  const base = slugifyLayoutKey(definition?.name || path?.split(/[\\/]/).pop()?.replace(/\.json$/i, ""));
  let key = base;
  let suffix = 2;
  while (Object.hasOwn(layouts, key) || Object.hasOwn(BUILTIN_LAYOUTS, key)) {
    key = `${base}-${suffix}`;
    suffix += 1;
  }
  return { duplicateKey: null, key, entry: { key, name: definition.name, path } };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function configurationsEqual(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

export function pickAvailableLayout(config, availableKeys, currentKey = null) {
  const preferred = config?.defaultLayout;
  if (preferred && availableKeys.includes(preferred)) return preferred;
  if (currentKey && availableKeys.includes(currentKey)) return currentKey;
  return availableKeys[0] ?? null;
}
