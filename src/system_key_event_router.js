export function routeSystemKeyEvent(
  event,
  { hotkeyController = null, inputSourceController = null } = {},
) {
  const shortcutMatched = Boolean(hotkeyController?.handleEvent(event));
  const highlighted = Boolean(inputSourceController?.handleEvent(event));
  return { shortcutMatched, highlighted };
}
