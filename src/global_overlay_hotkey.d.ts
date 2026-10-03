export type GlobalOverlayHotkey = { handleEvent(event: import("./input_events.js").NormalizedInputEvent): void };
export function createGlobalOverlayHotkey(options: { hotkey?: string | null; onToggle: () => unknown }): GlobalOverlayHotkey;
