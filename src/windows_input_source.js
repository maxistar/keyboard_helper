export function createWindowsInputSourceController({
  tauri, onSourceChange, onAvailabilityChange = () => {},
  onDiagnosticsChange = () => {}, onError = () => {},
}) {
  let generation = 0;
  let activeLayoutKey = null;
  let session = null;
  let revision = -1;
  let contextId = null;
  let currentSourceId = null;
  let availableSourceIds = new Set();
  let diagnostics = null;
  let unlisten = null;
  let selecting = false;
  let lifecycle = Promise.resolve();
  let status = { platform: "windows", supported: true, available: false, reason: "not-started", message: null };

  const invalidate = (message = null) => {
    currentSourceId = null;
    onSourceChange(null, { source: "windows" });
    status = { ...status, available: false, reason: "unconfirmed-source", message };
  };
  const publish = (snapshot) => {
    if (!snapshot || snapshot.session !== session || snapshot.layout !== activeLayoutKey
      || snapshot.revision <= revision) return null;
    revision = snapshot.revision;
    const nextContext = snapshot.diagnostics?.contextId ?? null;
    const nextSource = snapshot.currentSourceId ?? null;
    if (nextContext !== contextId || !nextSource) invalidate(snapshot.message);
    contextId = nextContext;
    diagnostics = snapshot.diagnostics ?? null;
    availableSourceIds = new Set(snapshot.availableSourceIds ?? []);
    onAvailabilityChange(new Set(availableSourceIds));
    onDiagnosticsChange(diagnostics);
    status = { ...status, available: Boolean(nextSource), reason: nextSource ? null : "unconfirmed-source", message: snapshot.message ?? null };
    if (nextSource && nextSource !== currentSourceId) {
      currentSourceId = nextSource;
      onSourceChange(nextSource, { source: "windows", diagnostics });
    }
    if (snapshot.message) onError(new Error(snapshot.message));
    return snapshot;
  };

  // Serialize native start/stop so a delayed old stop cannot stop a new session.
  const enqueue = (work) => {
    lifecycle = lifecycle.catch(() => {}).then(work);
    return lifecycle;
  };
  const stop = () => {
    ++generation;
    activeLayoutKey = null;
    session = null;
    selecting = false;
    invalidate();
    availableSourceIds = new Set();
    diagnostics = null;
    onAvailabilityChange(new Set());
    onDiagnosticsChange(null);
    return enqueue(async () => {
      if (unlisten) await unlisten();
      unlisten = null;
      await tauri.core.invoke("stop_windows_input_source_sync");
    });
  };
  const start = (layoutKey, config) => {
    const own = ++generation;
    session = null;
    selecting = false;
    availableSourceIds = new Set();
    invalidate();
    return enqueue(async () => {
      if (own !== generation) return false;
      if (unlisten) await unlisten();
      unlisten = null;
      await tauri.core.invoke("stop_windows_input_source_sync");
      if (own !== generation) return false;
      session = `${Date.now()}-${own}`;
      activeLayoutKey = layoutKey;
      revision = -1;
      contextId = null;
      try {
        unlisten = await tauri.event.listen("windows_input_source_changed", ({ payload }) => {
          if (own === generation && !selecting) publish(payload);
        });
        if (own !== generation) return false;
        const snapshot = await tauri.core.invoke("start_windows_input_source_sync", {
          config: { layoutKey, session, sourceIds: config.sources.map((s) => s.inputSourceId) },
        });
        if (own !== generation) return false;
        publish(snapshot);
        // Keep observing even if no readable foreground exists at startup.
        return true;
      } catch (error) {
        if (own === generation) { invalidate(String(error)); onError(error); }
        return false;
      }
    });
  };
  const refresh = async () => {
    const own = generation;
    if (!session || selecting) return null;
    try {
      const snapshot = await tauri.core.invoke("refresh_windows_input_source_sync", { session });
      return own === generation && !selecting ? publish(snapshot) : null;
    } catch (error) {
      if (own === generation) { invalidate(String(error)); onError(error); }
      return null;
    }
  };
  const select = async (sourceId) => {
    if (!session || selecting || !availableSourceIds.has(sourceId)) throw new Error("Windows input source is unavailable");
    const own = generation;
    selecting = true;
    invalidate();
    try {
      const snapshot = await tauri.core.invoke("select_windows_input_source", { sourceId, session });
      if (own !== generation) throw new Error("Windows selection session changed");
      if (snapshot.currentSourceId !== sourceId || snapshot.message) {
        // Consume this revision but never publish an unconfirmed selection.
        revision = Math.max(revision, snapshot.revision);
        throw new Error(snapshot.message ?? "Windows did not confirm the selected layout");
      }
      return Boolean(publish(snapshot));
    } catch (error) {
      if (own === generation) { invalidate(String(error)); onError(error); }
      throw error;
    } finally {
      if (own === generation) selecting = false;
    }
  };
  return {
    start, stop, refresh, select, dispose: stop,
    getStatus: () => ({ ...status }), getCurrentSourceId: () => currentSourceId,
    getAvailableSourceIds: () => new Set(availableSourceIds),
    getDiagnostics: () => diagnostics, getActiveLayoutKey: () => activeLayoutKey,
  };
}
