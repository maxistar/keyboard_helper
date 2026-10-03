import { createPlatformInputSourceAdapter } from "./input_source_sync_adapter.js";
import { createInputSourceLayerReconciler } from "./input_source_layer_reconciler.js";

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

function configuredLanguageOptions(config, availableIds = new Set()) {
  return (config?.sources ?? []).map((source) => ({
    id: source.id,
    label: source.label,
    inputSourceId: source.inputSourceId,
    available: availableIds.has(source.inputSourceId),
  }));
}

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
  let adapter = null;
  let reconciler = null;
  let diagnosticsMessage = null;
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
        languageMessage: error?.message ?? String(error),
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
      writeLayer: (layer, acceptableLayers) => getBleLayerSync().writeLayer(layer, acceptableLayers),
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
        languageMessage: error?.message ?? String(error),
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
    setLayer: (layer) => reconciler?.setLayer(layer),
    setBleStatus: (state, writable) => reconciler?.setBleStatus(state, writable),
    setSuspended: (suspended) => reconciler?.setSuspended(suspended),
    getState: () => languageMenuState,
  };
}
