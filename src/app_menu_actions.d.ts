export type ReloadActiveExternalLayoutResult = { ok: boolean; error?: string | null };
export function reloadActiveExternalLayout(options: {
  key: string;
  getCurrentLayoutKey: () => string;
  getLayoutSource: (layoutKey: string) => import("./app_config.js").LayoutSource | undefined;
  loadLayoutDefinition: (layoutKey: string, source: unknown) => Promise<{ def: import("./layout_semantics.js").LayoutDefinition | null; error: string | null }>;
  applyLayoutDefinition: (layoutKey: string, definition: import("./layout_semantics.js").LayoutDefinition) => void;
  renderBaseLayout: (layoutKey: string) => void;
  restartBle: (layoutKey: string) => Promise<void>;
}): Promise<ReloadActiveExternalLayoutResult>;
