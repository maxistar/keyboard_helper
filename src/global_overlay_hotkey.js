const MODIFIER_CODES = Object.freeze({
  shift: new Set(["ShiftLeft", "ShiftRight"]),
  meta: new Set(["MetaLeft", "MetaRight"]),
  ctrl: new Set(["ControlLeft", "ControlRight"]),
  alt: new Set(["Alt", "AltGr"]),
});

export function parseGlobalOverlayHotkey(value) {
  if (!value) return null;
  const modifiers = { shift: false, meta: false, ctrl: false, alt: false };
  let triggerKey = null;

  for (const rawPart of String(value).split("+")) {
    const part = rawPart.trim();
    switch (part.toLowerCase()) {
      case "shift": modifiers.shift = true; break;
      case "meta": case "cmd": case "command": modifiers.meta = true; break;
      case "ctrl": case "control": modifiers.ctrl = true; break;
      case "alt": case "option": modifiers.alt = true; break;
      default:
        if (part) triggerKey = part.length === 1 ? `Key${part.toUpperCase()}` : part;
    }
  }

  return triggerKey ? Object.freeze({ modifiers: Object.freeze(modifiers), triggerKey }) : null;
}

export function createGlobalOverlayHotkey({ hotkey = null, onToggle = () => {} } = {}) {
  const shortcut = parseGlobalOverlayHotkey(hotkey);
  const pressedCodes = new Set();

  function modifierHeld(name) {
    for (const code of MODIFIER_CODES[name]) {
      if (pressedCodes.has(code)) return true;
    }
    return false;
  }

  function modifiersMatch() {
    return Object.entries(shortcut.modifiers)
      .every(([name, required]) => modifierHeld(name) === required);
  }

  function handleEvent(event) {
    if (
      event?.kind !== "key"
      || event.source !== "system"
      || !["down", "up"].includes(event.action)
      || typeof event.code !== "string"
    ) return false;

    if (event.action === "up") {
      pressedCodes.delete(event.code);
      return false;
    }

    const repeated = pressedCodes.has(event.code);
    pressedCodes.add(event.code);
    if (repeated || !shortcut || event.code !== shortcut.triggerKey || !modifiersMatch()) {
      return false;
    }

    onToggle();
    return true;
  }

  function reset() {
    pressedCodes.clear();
  }

  return { handleEvent, reset };
}
