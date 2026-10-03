export type AppMenuStateController = {
  refresh(): void;
  reload(): unknown;
  selfTest(): unknown;
  reconnect(): unknown;
  mini(): unknown;
  launchGame(): unknown;
  launchSnake(): unknown;
  launchFlappy(): unknown;
  launchFishing(): unknown;
  insights(): unknown;
  settings(): unknown;
  help(): unknown;
  reportError(error: string | null): void;
  setActiveLayout(): void;
  handleBleStatus(status: unknown): void;
};
export function createAppMenuStateController(options: Record<string, unknown>): AppMenuStateController;
