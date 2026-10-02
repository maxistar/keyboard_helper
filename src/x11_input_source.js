function errorDetail(error, fallbackReason) {
  if (error && typeof error === "object") {
    return {
      reason: typeof error.reason === "string" ? error.reason : fallbackReason,
      message: typeof error.message === "string" ? error.message : String(error),
      diagnostics: error.diagnostics ?? null,
    };
  }
  return { reason: fallbackReason, message: String(error), diagnostics: null };
}

export function createX11InputSourceController({
  tauri,
  onSourceChange,
  onAvailabilityChange = () => {},
  onDiagnosticsChange = () => {},
  onError = () => {},
}) {
  let generation = 0;
  let activeLayoutKey = null;
  let activeConfig = null;
  let currentSourceId = null;
  let availableSourceIds = new Set();
  let diagnostics = null;
  let unlisten = null;
  let status = {
    platform: "linux",
    supported: true,
    available: false,
    reason: "not-started",
    message: "X11 Input Source Sync has not started.",
  };

  const publishSnapshot = (snapshot) => {
    currentSourceId = typeof snapshot?.currentSourceId === "string"
      ? snapshot.currentSourceId
      : null;
    availableSourceIds = new Set(
      Array.isArray(snapshot?.availableSourceIds) ? snapshot.availableSourceIds : [],
    );
    diagnostics = snapshot?.diagnostics ?? null;
    status = {
      platform: "linux",
      supported: true,
      available: true,
      reason: null,
      message: null,
    };
    onAvailabilityChange(new Set(availableSourceIds));
    onDiagnosticsChange(diagnostics);
    if (currentSourceId) onSourceChange(currentSourceId, { source: "x11", diagnostics });
    return snapshot;
  };

  const clearListener = async () => {
    if (typeof unlisten === "function") await unlisten();
    unlisten = null;
  };

  const stop = async () => {
    generation += 1;
    activeLayoutKey = null;
    activeConfig = null;
    currentSourceId = null;
    availableSourceIds = new Set();
    diagnostics = null;
    await clearListener();
    if (tauri?.core?.invoke) {
      await tauri.core.invoke("stop_x11_input_source_sync").catch(onError);
    }
    status = {
      platform: "linux",
      supported: true,
      available: false,
      reason: "not-started",
      message: "X11 Input Source Sync has not started.",
    };
  };

  const start = async (layoutKey, config) => {
    await stop();
    const ownGeneration = ++generation;
    if (!config || !tauri?.core?.invoke || !tauri?.event?.listen) return false;
    activeLayoutKey = layoutKey;
    activeConfig = config;
    unlisten = await tauri.event.listen("x11_input_source_changed", (event) => {
      const payload = event.payload ?? {};
      if (ownGeneration !== generation || payload.layout !== activeLayoutKey) return;
      publishSnapshot({
        currentSourceId: payload.sourceId,
        availableSourceIds: payload.availableSourceIds,
        diagnostics: payload.diagnostics,
      });
    });
    try {
      const snapshot = await tauri.core.invoke("start_x11_input_source_sync", {
        config: {
          layoutKey,
          sourceIds: config.sources.map((source) => source.inputSourceId),
        },
      });
      if (ownGeneration !== generation) return false;
      publishSnapshot(snapshot);
      return true;
    } catch (error) {
      if (ownGeneration === generation) {
        const detail = errorDetail(error, "startup-failed");
        await clearListener();
        await tauri.core.invoke("stop_x11_input_source_sync").catch(() => {});
        activeLayoutKey = null;
        activeConfig = null;
        currentSourceId = null;
        availableSourceIds = new Set();
        diagnostics = detail.diagnostics;
        status = {
          platform: "linux",
          supported: true,
          available: false,
          reason: detail.reason,
          message: detail.message,
        };
        onDiagnosticsChange(diagnostics);
        onError(error);
      }
      return false;
    }
  };

  const refresh = async () => {
    const ownGeneration = generation;
    if (!activeConfig || !tauri?.core?.invoke) return null;
    try {
      const snapshot = await tauri.core.invoke("refresh_x11_input_source_sync");
      if (ownGeneration !== generation) return null;
      return publishSnapshot(snapshot);
    } catch (error) {
      if (ownGeneration === generation) {
        const detail = errorDetail(error, "refresh-failed");
        status = { ...status, available: false, reason: detail.reason, message: detail.message };
        onError(error);
      }
      return null;
    }
  };

  const select = async (sourceId) => {
    if (!activeConfig || !status.available || !availableSourceIds.has(sourceId)) {
      throw new Error(`XKB input source '${sourceId}' is unavailable`);
    }
    await tauri.core.invoke("select_x11_input_source", { sourceId });
    const snapshot = await refresh();
    if (snapshot?.currentSourceId !== sourceId) {
      throw new Error(`XKB did not confirm input source '${sourceId}'`);
    }
    return true;
  };

  return {
    start,
    stop,
    refresh,
    select,
    dispose: stop,
    getStatus: () => ({ ...status }),
    getDiagnostics: () => diagnostics ? structuredClone(diagnostics) : null,
    getCurrentSourceId: () => currentSourceId,
    getAvailableSourceIds: () => new Set(availableSourceIds),
    getActiveLayoutKey: () => activeLayoutKey,
  };
}
