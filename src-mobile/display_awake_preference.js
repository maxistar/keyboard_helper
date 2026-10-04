export const DISPLAY_AWAKE_STORAGE_KEY = "keyboard-helper.display-awake.enabled";
export const DISPLAY_AWAKE_DEFAULT = true;

function availableStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch (_error) {
    return null;
  }
}

function availableBridge() {
  try {
    return globalThis.window?.KeyboardHelperSafeInsets ?? null;
  } catch (_error) {
    return null;
  }
}

export class DisplayAwakePreference {
  constructor({ storage = availableStorage(), bridge = availableBridge(), onChange = () => {} } = {}) {
    this.storage = storage;
    this.bridge = bridge;
    this.onChange = onChange;
    this.enabled = DISPLAY_AWAKE_DEFAULT;
  }

  initialize() {
    try {
      const stored = this.storage?.getItem(DISPLAY_AWAKE_STORAGE_KEY);
      if (stored === "true") this.enabled = true;
      else if (stored === "false") this.enabled = false;
    } catch (_error) {
      this.enabled = DISPLAY_AWAKE_DEFAULT;
    }
    this.apply();
    return this.enabled;
  }

  setEnabled(enabled) {
    this.enabled = enabled === true;
    try {
      this.storage?.setItem(DISPLAY_AWAKE_STORAGE_KEY, String(this.enabled));
    } catch (_error) {
      // Keep the current session setting even if persistence is unavailable.
    }
    this.apply();
    return this.enabled;
  }

  apply() {
    try {
      this.bridge?.setKeepScreenAwake?.(this.enabled);
    } catch (_error) {
      // The preference remains usable if the native bridge is unavailable.
    }
    this.onChange(this.enabled);
  }

  snapshot() {
    return this.enabled;
  }
}

export function createDisplayAwakePreferenceView(document, options = {}) {
  const toggle = document.getElementById("display-awake-toggle");
  if (!toggle) throw new Error("Display awake settings are missing #display-awake-toggle.");
  const preference = new DisplayAwakePreference({
    ...options,
    onChange(enabled) {
      toggle.checked = enabled;
      options.onChange?.(enabled);
    },
  });
  const onChange = () => preference.setEnabled(toggle.checked);
  toggle.addEventListener("change", onChange);
  preference.initialize();
  return {
    preference,
    dispose() { toggle.removeEventListener?.("change", onChange); },
  };
}
