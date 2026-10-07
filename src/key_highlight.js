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
  const pressedValues = new Map();

  return {
    remember(code, value) {
      if (!code || value === null || value === undefined) return;
      pressedValues.set(code, value);
    },

    release(code, fallbackValue = null) {
      const value = pressedValues.get(code) ?? fallbackValue ?? null;
      pressedValues.delete(code);
      return value;
    },

    clear() {
      pressedValues.clear();
    },
  };
}
