export function resolveKeyElement(root, code, wasShiftHeld, wasAltGrHeld) {
  if (!root || !code) return null;

  const isModifier = code === "AltGr" || code === "ShiftLeft" || code === "ShiftRight";
  if (isModifier) {
    return root.querySelector(`.key[data-key="${code}"]`);
  }

  if (wasAltGrHeld && wasShiftHeld) {
    return root.querySelector(`.key[data-key="AltGr+Shift+${code}"]`)
      || root.querySelector(`.key[data-key="AltGr+${code}"]`)
      || root.querySelector(`.key[data-key="${code}"]`);
  }

  if (wasAltGrHeld) {
    return root.querySelector(`.key[data-key="AltGr+${code}"]`)
      || root.querySelector(`.key[data-key="${code}"]`);
  }

  if (wasShiftHeld) {
    return root.querySelector(`.key[data-key="Shift+${code}"]`)
      || root.querySelector(`.key[data-key="${code}"]`);
  }

  return root.querySelector(`.key[data-key="${code}"]`);
}

export function createPressedKeyTracker() {
  const pressedElements = new Map();

  return {
    remember(code, element) {
      if (!code || !element) return;
      pressedElements.set(code, element);
    },

    release(code, fallbackElement = null) {
      const element = pressedElements.get(code) ?? fallbackElement ?? null;
      pressedElements.delete(code);
      return element;
    },

    clear() {
      pressedElements.clear();
    },
  };
}
