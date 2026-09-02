export function createSelfTestLayerSession({
  emit,
  startPlan,
  pauseTest,
  resumeTest,
  onState = () => {},
}) {
  let nextGeneration = 0;
  let current = null;

  const publish = (mode, message = null) => {
    if (!current) return;
    current = { ...current, mode, message };
    onState({
      generation: current.generation,
      mode,
      message,
      automatic: current.automatic,
      started: current.started,
      canRetry: ["lost", "error"].includes(mode),
      canContinueManual: ["lost", "error"].includes(mode),
    });
  };

  const beginPlan = () => {
    if (!current || current.started) return false;
    const started = startPlan(current.plan);
    current = { ...current, started: Boolean(started) };
    return Boolean(started);
  };

  const start = async (plan) => {
    if (current?.automatic) {
      await emit("self-test-layer-lease-release", { generation: current.generation });
    }
    const generation = ++nextGeneration;
    const automatic = Number.isInteger(plan?.firmwareLayerIndex) && plan.firmwareLayerIndex >= 0;
    current = {
      generation,
      plan,
      automatic,
      started: false,
      mode: automatic ? "activating" : "manual",
      message: null,
      reassertRequested: false,
    };
    if (!automatic) {
      beginPlan();
      publish("manual", "Activate the selected layer manually; its state cannot be confirmed.");
      return generation;
    }
    publish("activating", "Activating and confirming the selected keyboard layer…");
    await emit("self-test-layer-lease-request", {
      generation,
      layoutKey: plan.layoutKey,
      layerKey: plan.layerKey,
      firmwareLayerIndex: plan.firmwareLayerIndex,
    });
    return generation;
  };

  const handleLeaseStatus = (status) => {
    if (!current || status?.generation !== current.generation) return false;
    const message = status.message ?? null;
    if (status.state === "active") {
      const wasPaused = current.started && ["lost", "reactivating", "error"].includes(current.mode);
      if (!current.started) beginPlan();
      current = { ...current, reassertRequested: false };
      publish("active", "Selected keyboard layer is confirmed.");
      if (wasPaused) resumeTest();
      return true;
    }
    if (status.state === "unavailable") {
      beginPlan();
      current = { ...current, automatic: false };
      publish("manual", message ?? "Automatic layer activation is unavailable; continue with the layer activated manually.");
      return true;
    }
    if (status.state === "lost") {
      if (current.started) pauseTest(message ?? "The active keyboard layer changed.");
      current = { ...current, reassertRequested: false };
      publish("lost", message ?? "The active keyboard layer changed. Release all keys to reactivate it.");
      return true;
    }
    if (status.state === "reactivating") {
      publish("reactivating", message ?? "Reactivating the selected keyboard layer…");
      return true;
    }
    if (["error", "release-error", "invalidated"].includes(status.state)) {
      if (current.started) pauseTest(message ?? "Automatic layer control failed.");
      publish("error", message ?? "Automatic layer control failed.");
      return true;
    }
    return false;
  };

  const handleControllerSnapshot = (snapshot) => {
    if (!current?.automatic || current.mode !== "lost" || current.reassertRequested) return false;
    if ((snapshot?.pressedCodes?.length ?? 0) > 0 || (snapshot?.pressedPositions?.length ?? 0) > 0) return false;
    current = { ...current, reassertRequested: true };
    publish("reactivating", "Reactivating the selected keyboard layer…");
    void emit("self-test-layer-lease-reassert", { generation: current.generation });
    return true;
  };

  const retry = async () => {
    if (!current || !["lost", "error"].includes(current.mode)) return false;
    current = { ...current, reassertRequested: true };
    publish("reactivating", "Reactivating the selected keyboard layer…");
    await emit("self-test-layer-lease-reassert", { generation: current.generation });
    return true;
  };

  const continueManually = async () => {
    if (!current) return false;
    await emit("self-test-layer-lease-manual", { generation: current.generation });
    current = { ...current, automatic: false, reassertRequested: false };
    if (!current.started) beginPlan();
    else resumeTest();
    publish("manual", "Continuing with manual layer activation; layer state is not confirmed.");
    return true;
  };

  const release = async () => {
    if (!current) return false;
    const generation = current.generation;
    await emit("self-test-layer-lease-release", { generation });
    current = null;
    onState({ generation, mode: "idle", message: null, automatic: false, started: false });
    return true;
  };

  return {
    start,
    handleLeaseStatus,
    handleControllerSnapshot,
    retry,
    continueManually,
    release,
    getState: () => (current ? { ...current, plan: current.plan } : null),
  };
}
