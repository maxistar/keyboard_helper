export function createMacosInputSourceController({
  tauri,
  onSourceChange,
  onAvailabilityChange = () => {},
  onError = () => {},
}) {
  let generation = 0;
  let activeLayoutKey = null;
  let activeConfig = null;
  let currentSourceId = null;
  let availableSourceIds = new Set();
  let unlisten = null;

  const publishSnapshot = (snapshot) => {
    currentSourceId = typeof snapshot?.currentSourceId === "string"
      ? snapshot.currentSourceId
      : null;
    availableSourceIds = new Set(
      Array.isArray(snapshot?.availableSourceIds) ? snapshot.availableSourceIds : [],
    );
    onAvailabilityChange(new Set(availableSourceIds));
    if (currentSourceId) onSourceChange(currentSourceId, { source: "macos" });
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
    await clearListener();
    if (tauri?.core?.invoke) {
      await tauri.core.invoke("stop_macos_input_source_sync").catch(onError);
    }
  };

  const start = async (layoutKey, config) => {
    await stop();
    const ownGeneration = ++generation;
    if (!config || !tauri?.core?.invoke || !tauri?.event?.listen) return false;
    activeLayoutKey = layoutKey;
    activeConfig = config;
    unlisten = await tauri.event.listen("macos_input_source_changed", (event) => {
      const payload = event.payload ?? {};
      if (ownGeneration !== generation || payload.layout !== activeLayoutKey) return;
      if (typeof payload.sourceId !== "string") return;
      currentSourceId = payload.sourceId;
      onSourceChange(payload.sourceId, { source: "macos" });
    });
    try {
      const snapshot = await tauri.core.invoke("start_macos_input_source_sync", {
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
        onError(error);
        await stop();
      }
      return false;
    }
  };

  const refresh = async () => {
    const ownGeneration = generation;
    if (!activeConfig || !tauri?.core?.invoke) return null;
    try {
      const snapshot = await tauri.core.invoke("refresh_macos_input_source_sync");
      if (ownGeneration !== generation) return null;
      return publishSnapshot(snapshot);
    } catch (error) {
      if (ownGeneration === generation) onError(error);
      return null;
    }
  };

  const select = async (sourceId) => {
    if (!activeConfig || !availableSourceIds.has(sourceId)) {
      throw new Error(`macOS input source '${sourceId}' is unavailable`);
    }
    await tauri.core.invoke("select_macos_input_source", { sourceId });
    const snapshot = await refresh();
    if (snapshot?.currentSourceId !== sourceId) {
      throw new Error(`macOS did not confirm input source '${sourceId}'`);
    }
    return true;
  };

  return {
    start,
    stop,
    refresh,
    select,
    dispose: stop,
    getCurrentSourceId: () => currentSourceId,
    getAvailableSourceIds: () => new Set(availableSourceIds),
    getActiveLayoutKey: () => activeLayoutKey,
  };
}
