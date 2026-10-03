export type InputSourceDiagnostics = {
  platform?: string;
  installedSourceIds?: string[];
  missingSourceIds?: string[];
  contextId?: string | null;
  groups?: Array<{ groupIndex: number | string; groupName: string; identifiers?: string[] }>;
};
export type InputSourceAdapter = {
  supported: boolean;
  start(layoutKey: string, config: import("./input_source_sync_config.js").InputSourceSyncConfig): Promise<boolean>;
  stop(): Promise<void>;
  refresh(): Promise<void>;
  select(inputSourceId: string): Promise<void>;
  getStatus(): { message?: string | null };
};
export function createPlatformInputSourceAdapter(options: {
  platform: import("./input_source_sync_config.js").RuntimePlatform | undefined;
  tauri: unknown;
  onSourceChange: (sourceId: string | null) => void;
  onAvailabilityChange: (availableIds: Set<string>) => void;
  onDiagnosticsChange: (diagnostics: InputSourceDiagnostics | null) => void;
  onError: (error: unknown) => void;
}): InputSourceAdapter;
