export async function reloadActiveExternalLayout({
  key,
  getCurrentLayoutKey,
  getLayoutSource,
  loadLayoutDefinition,
  applyLayoutDefinition,
  renderBaseLayout,
  restartBle,
}) {
  if (key !== getCurrentLayoutKey() || typeof getLayoutSource(key) !== "string") {
    throw new Error("Reload is available only for the active external layout.");
  }

  const { def, error } = await loadLayoutDefinition(key, getLayoutSource(key));
  if (!def) {
    throw new Error(error ?? `Failed to reload layout "${key}".`);
  }
  if (key !== getCurrentLayoutKey()) return false;

  applyLayoutDefinition(key, def);
  renderBaseLayout(key);
  await restartBle(key);
  return true;
}
