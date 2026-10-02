export const SAFE_AREA_CHANGE_EVENT = "keyboardhelper:insetschange";

const EMPTY_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

function nonNegativePixel(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

export function normalizeSafeInsets(candidate) {
  return Object.freeze({
    top: nonNegativePixel(candidate?.top),
    right: nonNegativePixel(candidate?.right),
    bottom: nonNegativePixel(candidate?.bottom),
    left: nonNegativePixel(candidate?.left),
  });
}

export function readNativeSafeInsets(hostWindow = globalThis.window) {
  const bridge = hostWindow?.KeyboardHelperSafeInsets;
  let candidate = hostWindow?.__keyboardHelperSafeInsets;
  if (!candidate && typeof bridge?.snapshot === "function") {
    try {
      candidate = JSON.parse(bridge.snapshot());
    } catch (_error) {
      candidate = EMPTY_INSETS;
    }
  }
  return normalizeSafeInsets(candidate);
}

export function applySafeInsets(document, insets) {
  const root = document?.documentElement;
  if (!root?.style?.setProperty) return EMPTY_INSETS;
  const normalized = normalizeSafeInsets(insets);
  root.style.setProperty("--android-safe-top", `${normalized.top}px`);
  root.style.setProperty("--android-safe-right", `${normalized.right}px`);
  root.style.setProperty("--android-safe-bottom", `${normalized.bottom}px`);
  root.style.setProperty("--android-safe-left", `${normalized.left}px`);
  return normalized;
}

export function installSafeAreaFallback(document, hostWindow = globalThis.window) {
  const apply = (insets = readNativeSafeInsets(hostWindow)) => applySafeInsets(document, insets);
  const onChange = (event) => apply(event?.detail);
  apply();
  hostWindow?.addEventListener?.(SAFE_AREA_CHANGE_EVENT, onChange);
  return {
    refresh: () => apply(),
    dispose: () => hostWindow?.removeEventListener?.(SAFE_AREA_CHANGE_EVENT, onChange),
  };
}
