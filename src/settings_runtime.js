export function reloadOverlayAfterSettingsSave(location) {
  if (typeof location?.reload !== "function") {
    throw new Error("The overlay cannot reload its settings.");
  }
  location.reload();
}
