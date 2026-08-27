const MODIFIER_ALIASES = new Map([
  ["shift", "Shift"], ["shiftleft", "Shift"], ["shiftright", "Shift"],
  ["ctrl", "Control"], ["control", "Control"], ["controlleft", "Control"], ["controlright", "Control"],
  ["alt", "Alt"], ["altleft", "Alt"], ["altright", "Alt"],
  ["altgr", "AltGr"], ["meta", "Meta"], ["metaleft", "Meta"], ["metaright", "Meta"],
]);

const NAMED_TRIGGERS = new Set([
  "BackQuote", "BackSlash", "Backspace", "CapsLock", "Comma", "Delete", "Dot", "DownArrow",
  "End", "Enter", "Equal", "Escape", "Home", "Insert", "IntlBackslash", "LeftArrow",
  "LeftBracket", "Minus", "NumLock", "PageDown", "PageUp", "Pause", "Period", "PrintScreen",
  "Quote", "Return", "RightArrow", "RightBracket", "ScrollLock", "SemiColon", "Semicolon",
  "Slash", "Space", "Tab", "UpArrow",
]);

function isSupportedTrigger(value) {
  return NAMED_TRIGGERS.has(value)
    || /^Key[A-Z]$/.test(value)
    || /^(Digit|Num)[0-9]$/.test(value)
    || /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(value)
    || /^Kp(?:[0-9]|Delete|Divide|Minus|Multiply|Plus|Return)$/.test(value);
}

export function normalizeModifier(code) {
  return MODIFIER_ALIASES.get(String(code ?? "").toLowerCase()) ?? null;
}

export function normalizeHidDescriptor(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { supported: false, raw, trigger: null, modifiers: [] };
  const parts = raw.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1 && normalizeModifier(parts[0])) {
    return { supported: true, raw, trigger: parts[0], modifiers: [] };
  }
  const modifiers = [];
  let trigger = null;
  for (const part of parts) {
    const modifier = normalizeModifier(part);
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
    } else if (!trigger) {
      trigger = part.length === 1 ? `Key${part.toUpperCase()}` : part;
    } else {
      return { supported: false, raw, trigger: null, modifiers };
    }
  }
  const supported = Boolean(trigger && isSupportedTrigger(trigger));
  return { supported, raw, trigger: supported ? trigger : null, modifiers };
}

export function descriptorMatches(descriptor, code, activeModifiers = []) {
  if (!descriptor?.supported || descriptor.trigger !== code) return false;
  const active = new Set(activeModifiers);
  return descriptor.modifiers.every((modifier) => active.has(modifier));
}
