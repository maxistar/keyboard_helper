export type MenuControls = { update(state: unknown): void };
export function createMenu(options: {
  onLayoutSelect: (key: string) => unknown;
  onReloadLayout: () => unknown;
  onKeyboardSelfTest: () => unknown;
  onReconnectBle: () => unknown;
  onMiniMode: () => unknown;
  onStartGame: () => unknown;
  onStartSnake: () => unknown;
  onStartFlappy: () => unknown;
  onStartFishing: () => unknown;
  onInsights: () => unknown;
  onSettings: () => unknown;
  onHelp: () => unknown;
  onLanguageSelect: (inputSourceId: string) => unknown;
  layoutOptions: Array<{ key: string; label: string }>;
}): MenuControls;
