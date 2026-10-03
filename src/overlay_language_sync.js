import { createPlatformInputSourceAdapter } from "./input_source_sync_adapter.js";
import { createInputSourceLayerReconciler } from "./input_source_layer_reconciler.js";

/**
 * @typedef {import("./input_source_sync_config.js").InputSourceSyncConfig} InputSourceSyncConfig
 * @typedef {import("./input_source_sync_config.js").RuntimePlatform} RuntimePlatform
 * @typedef {import("./input_source_sync_adapter.js").InputSourceAdapter} InputSourceAdapter
 * @typedef {import("./input_source_sync_adapter.js").InputSourceDiagnostics} InputSourceDiagnostics
 * @typedef {{ writeLayer(layer: number, acceptableLayers?: readonly number[]): Promise<unknown> }} BleLayerWriter
 * @typedef {{ dispose(): void, resume(): void, setSource(sourceId: string | null): void, setLayer(layer: number): void, setBleStatus(state: string, writable: boolean): void, setSuspended(suspended: boolean): void }} InputSourceLayerReconciler
 * @typedef {{ id: string, label: string, inputSourceId: string, available: boolean }} LanguageOption
 * @typedef {{ languageVisible: boolean, languageAvailable: boolean, languageOptions: LanguageOption[], currentInputSourceId: string | null, languageStatus: string, languageStatusLabel: string, languageMessage: string | null, languagePendingId: string | null }} LanguageMenuState
 * @typedef {{ platform?: RuntimePlatform, tauri: unknown, window: Window, document: Document, getCurrentLayoutKey: () => string, getSyncConfig: (layoutKey: string) => InputSourceSyncConfig | null | undefined, getBleLayerSync: () => BleLayerWriter | null | undefined, onMenuUpdate?: (state: LanguageMenuState) => void, onSelfTestLeaseInvalidate?: (reason: string) => void }} OverlayLanguageSyncOptions
 */

/** @param {string} status */
function languageStatusLabel(status) {
  if (status === "synced") return "Synced";
  if (["settling", "synchronizing", "waiting-confirmation"].includes(status)) {
    return "Synchronizing";
  }
  if (["waiting", "waiting-keyboard", "deferred"].includes(status)) {
    return "Waiting for keyboard";
  }
  if (["offline", "read-only"].includes(status)) return "Offline";
  if (status === "unsupported-source") return "Unavailable source";
  if (status === "unmapped-layer") return "Layer mismatch";
  if (status === "error") return "Synchronization error";
  return "Waiting for keyboard";
}

/**
 * @param {InputSourceSyncConfig | null | undefined} config
 * @param {Set<string>} [availableIds]
 * @returns {LanguageOption[]}
 */
function configuredLanguageOptions(config, availableIds = new Set()) {
  return (config?.sources ?? []).map((source) => ({
    id: source.id,
    label: source.label,
    inputSourceId: source.inputSourceId,
    available: availableIds.has(source.inputSourceId),
  }));
}

/**
 * @param {InputSourceDiagnostics | null | undefined} diagnostics
 * @returns {string | null}
 */
function formatInputSourceDiagnostics(diagnostics) {
  if (diagnostics?.platform === "windows") {
    const installed = diagnostics.installedSourceIds?.join(", ") || "none";
    const missing = diagnostics.missingSourceIds?.join(", ");
    const context = diagnostics.contextId ? "Following the foreground window." : "Foreground context unavailable.";
    return `Windows layouts: ${installed}. ${context}${missing ? ` Missing configured layouts: ${missing}.` : ""}`;
  }
  if (!diagnostics || !Array.isArray(diagnostics.groups)) return null;
  const groups = diagnostics.groups.map((group) => {
    const identifiers = Array.isArray(group.identifiers) ? group.identifiers.join(", ") : "";
    return `${group.groupIndex}: ${group.groupName}${identifiers ? ` (${identifiers})` : ""}`;
  });
  return groups.length ? `Detected XKB groups: ${groups.join("; ")}` : null;
}

/** @param {OverlayLanguageSyncOptions} options */
export function createOverlayLanguageSync({
  platform,
  tauri,
  window,
  document,
  getCurrentLayoutKey,
  getSyncConfig,
  getBleLayerSync,
  onMenuUpdate,
  onSelfTestLeaseInvalidate,
}) {
  /** @type {InputSourceAdapter | null} */
  let adapter = null;
  /** @type {InputSourceLayerReconciler | null} */
  let reconciler = null;
  /** @type {string | null} */
  let diagnosticsMessage = null;
  /** @type {LanguageMenuState} */
  let languageMenuState = {
    languageVisible: false,
    languageAvailable: false,
    languageOptions: [],
    currentInputSourceId: null,
    languageStatus: "waiting",
    languageStatusLabel: "Waiting for keyboard",
    languageMessage: null,
    languagePendingId: null,
  };

  /** @param {Partial<LanguageMenuState>} patch */
  function updateLanguageMenu(patch) {
    languageMenuState = { ...languageMenuState, ...patch };
    onMenuUpdate?.(languageMenuState);
  }

  function createAdapter() {
    adapter = createPlatformInputSourceAdapter({
      platform,
      tauri,
      onSourceChange: (sourceId) => {
        updateLanguageMenu({ currentInputSourceId: sourceId });
        reconciler?.setSource(sourceId);
      },
      onAvailabilityChange: (availableIds) => {
        const syncConfig = getSyncConfig(getCurrentLayoutKey());
        updateLanguageMenu({
          languageOptions: configuredLanguageOptions(syncConfig, availableIds),
        });
      },
      onDiagnosticsChange: (diagnostics) => {
        diagnosticsMessage = formatInputSourceDiagnostics(diagnostics);
        if (diagnosticsMessage && languageMenuState.languageStatus !== "error") {
          updateLanguageMenu({ languageMessage: diagnosticsMessage });
        }
      },
      onError: (error) => updateLanguageMenu({
        languageStatus: "error",
        languageStatusLabel: "Synchronization error",
        languageMessage: error instanceof Error ? error.message : String(error),
      }),
    });
    return adapter;
  }

  function ensureAdapter() {
    return adapter ?? createAdapter();
  }

  function installRefreshListeners() {
    const refreshLanguageSync = () => {
      adapter?.refresh().then(() => reconciler?.resume());
    };
    window.addEventListener("focus", refreshLanguageSync);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshLanguageSync();
    });
  }

  /** @param {string} layoutKey */
  async function start(layoutKey) {
    reconciler?.dispose();
    reconciler = null;
    diagnosticsMessage = null;
    const syncConfig = getSyncConfig(layoutKey) ?? null;
    const currentAdapter = ensureAdapter();
    const bleLayerSync = getBleLayerSync();
    if (!syncConfig || !currentAdapter || !bleLayerSync) {
      await currentAdapter?.stop();
      updateLanguageMenu({
        languageVisible: false,
        languageAvailable: false,
        languageOptions: [],
        currentInputSourceId: null,
        languageStatus: "waiting",
        languageStatusLabel: "Waiting for keyboard",
        languageMessage: null,
        languagePendingId: null,
      });
      return false;
    }

    if (!currentAdapter.supported) {
      await currentAdapter.stop();
      const status = currentAdapter.getStatus();
      updateLanguageMenu({
        languageVisible: true,
        languageAvailable: false,
        languageOptions: configuredLanguageOptions(syncConfig),
        currentInputSourceId: null,
        languageStatus: "error",
        languageStatusLabel: "Input Source Sync unavailable",
        languageMessage: status.message,
        languagePendingId: null,
      });
      return false;
    }

    reconciler = createInputSourceLayerReconciler({
      config: syncConfig,
      settleMs: syncConfig.settleMs,
      writeLayer: (layer, acceptableLayers) => getBleLayerSync()?.writeLayer(layer, acceptableLayers) ?? Promise.resolve(false),
      onStateChange: (syncState) => updateLanguageMenu({
        languageStatus: syncState.status,
        languageStatusLabel: languageStatusLabel(syncState.status),
        languageMessage: syncState.message ?? diagnosticsMessage,
      }),
    });
    updateLanguageMenu({
      languageVisible: true,
      languageAvailable: true,
      languageOptions: configuredLanguageOptions(syncConfig),
      currentInputSourceId: null,
      languageStatus: "waiting",
      languageStatusLabel: "Waiting for keyboard",
      languageMessage: null,
      languagePendingId: null,
    });
    const started = await currentAdapter.start(layoutKey, syncConfig);
    if (!started && getCurrentLayoutKey() === layoutKey) {
      const status = currentAdapter.getStatus();
      updateLanguageMenu({
        languageStatus: "error",
        languageStatusLabel: "Input Source Sync unavailable",
        languageAvailable: false,
        languageMessage: status.message ?? "The platform input-source adapter could not start.",
      });
    }
    return started;
  }

  /** @param {string} inputSourceId */
  async function select(inputSourceId) {
    const currentAdapter = ensureAdapter();
    if (!currentAdapter?.supported || languageMenuState.languagePendingId) return false;
    updateLanguageMenu({ languagePendingId: inputSourceId, languageMessage: null });
    onSelfTestLeaseInvalidate?.("input-source-selected");
    try {
      await currentAdapter.select(inputSourceId);
      return true;
    } catch (error) {
      updateLanguageMenu({
        languageStatus: "error",
        languageStatusLabel: "Synchronization error",
        languageMessage: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      updateLanguageMenu({ languagePendingId: null });
    }
  }

  return {
    createAdapter,
    installRefreshListeners,
    start,
    select,
    /** @param {number} layer */
    setLayer: (layer) => reconciler?.setLayer(layer),
    /**
     * @param {string} state
     * @param {boolean} writable
     */
    setBleStatus: (state, writable) => reconciler?.setBleStatus(state, writable),
    /** @param {boolean} suspended */
    setSuspended: (suspended) => reconciler?.setSuspended(suspended),
    getState: () => languageMenuState,
  };
}
