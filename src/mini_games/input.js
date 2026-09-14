export const DEFAULT_NAMED_KEYS = Object.freeze([
  "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Backspace", "Tab",
]);

const MODIFIER_KEYS = new Set([
  "Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "NumLock", "ScrollLock",
]);
const UNSUPPORTED_KEYS = new Set(["Dead", "Process", "Unidentified"]);

function isPrintableKey(key) {
  return key === " " || Array.from(key).length === 1;
}

function hasAltGraph(event) {
  return event.altGraphKey === true || event.getModifierState?.("AltGraph") === true;
}

export function normalizeSemanticKeydown(event, { namedKeys = DEFAULT_NAMED_KEYS } = {}) {
  if (!event || (event.type && event.type !== "keydown")) return null;
  const key = typeof event.key === "string" ? event.key : "";
  if (!key || event.repeat || event.isComposing || UNSUPPORTED_KEYS.has(key)) return null;
  if (MODIFIER_KEYS.has(key)) return null;
  const altGraph = hasAltGraph(event);
  if (event.metaKey || (event.ctrlKey && !altGraph) || (event.altKey && !altGraph)) return null;
  if (isPrintableKey(key)) return key;
  return namedKeys.includes(key) ? key : null;
}

export function createSemanticInputAdapter({
  target = globalThis.window,
  namedKeys = DEFAULT_NAMED_KEYS,
  onToken = () => {},
} = {}) {
  let mounted = false;
  const handle = (event) => {
    const token = normalizeSemanticKeydown(event, { namedKeys });
    if (token !== null) onToken(token, event);
  };
  return {
    mount() {
      if (mounted) return false;
      mounted = true;
      target?.addEventListener?.("keydown", handle);
      return true;
    },
    unmount() {
      if (!mounted) return false;
      mounted = false;
      target?.removeEventListener?.("keydown", handle);
      return true;
    },
    handle,
  };
}
