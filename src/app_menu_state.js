export const HELP_URL = "https://projects.maxistar.me/keyboard_helper/setup/";

function errorMessage(error, fallback) {
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

export function createAppMenuStateController({
  getCurrentLayoutKey,
  getCurrentLayoutLabel,
  getCurrentLayoutSource,
  getCurrentBleSource,
  hasNativeBridge,
  reloadLayout,
  reconnectBle,
  openTypingInvaders,
  openKeyboardSnake = async () => false,
  openFlappyKeyBird = async () => false,
  openUnderwaterTypingFishing = async () => false,
  openKeyboardSelfTest = async () => false,
  enterMiniMode = async () => false,
  openTypingInsights = async () => false,
  openSettings,
  openHelp,
  onChange = () => {},
}) {
  let bleState = "not-configured";
  let bleMessage = null;
  let reloadPending = false;
  let reconnectPending = false;
  let gamePending = false;
  let snakePending = false;
  let flappyPending = false;
  let fishingPending = false;
  let selfTestPending = false;
  let miniPending = false;
  let insightsPending = false;
  let settingsPending = false;
  let feedback = null;
  let activeRevision = 0;

  function currentKey() {
    return getCurrentLayoutKey();
  }

  function hasBleSource() {
    return Boolean(getCurrentBleSource());
  }

  function snapshot() {
    const key = currentKey();
    const bleAvailable = hasBleSource();
    return {
      currentLayoutKey: key,
      currentLayoutLabel: getCurrentLayoutLabel(key),
      bleAvailable,
      bleState: bleAvailable ? bleState : "not-configured",
      bleMessage: bleAvailable ? bleMessage : null,
      reloadAvailable: typeof getCurrentLayoutSource() === "string",
      reloadPending,
      reconnectAvailable: bleAvailable && hasNativeBridge(),
      reconnectPending,
      gameAvailable: hasNativeBridge(),
      gamePending,
      snakeAvailable: hasNativeBridge(),
      snakePending,
      flappyAvailable: hasNativeBridge(),
      flappyPending,
      fishingAvailable: hasNativeBridge(),
      fishingPending,
      selfTestAvailable: hasNativeBridge(),
      selfTestPending,
      miniAvailable: hasNativeBridge(),
      miniPending,
      insightsAvailable: hasNativeBridge(),
      insightsPending,
      settingsAvailable: hasNativeBridge(),
      settingsPending,
      feedback,
    };
  }

  function notify() {
    onChange(snapshot());
  }

  function setActiveLayout() {
    activeRevision += 1;
    reloadPending = false;
    reconnectPending = false;
    feedback = null;
    if (!hasBleSource()) {
      bleState = "not-configured";
      bleMessage = null;
    } else if (!hasNativeBridge()) {
      bleState = "error";
      bleMessage = "BLE synchronization requires the desktop application.";
    } else {
      bleState = "connecting";
      bleMessage = null;
    }
    notify();
  }

  function handleBleStatus(status) {
    if (!status || status.layoutKey !== currentKey()) return false;
    if (!hasBleSource()) return false;

    const allowedStates = new Set(["connecting", "connected", "error"]);
    bleState = allowedStates.has(status.state) ? status.state : "connecting";
    bleMessage = status.message ?? null;
    notify();
    return true;
  }

  function reportError(message) {
    feedback = {
      kind: "error",
      message: errorMessage(message, "The requested action failed."),
    };
    notify();
  }

  async function reload() {
    if (reloadPending || typeof getCurrentLayoutSource() !== "string") return false;
    const key = currentKey();
    const revision = activeRevision;
    reloadPending = true;
    feedback = null;
    notify();

    try {
      const result = await reloadLayout(key);
      if (result === false) throw new Error("Layout reload failed.");
      if (revision === activeRevision && key === currentKey()) {
        feedback = { kind: "success", message: "Layout reloaded." };
      }
      return true;
    } catch (error) {
      if (revision === activeRevision && key === currentKey()) {
        feedback = {
          kind: "error",
          message: errorMessage(error, "Failed to reload layout."),
        };
      }
      return false;
    } finally {
      if (revision === activeRevision && key === currentKey()) {
        reloadPending = false;
        notify();
      }
    }
  }

  async function reconnect() {
    if (reconnectPending || !hasBleSource() || !hasNativeBridge()) return false;
    const key = currentKey();
    const revision = activeRevision;
    reconnectPending = true;
    feedback = null;
    notify();

    try {
      const result = await reconnectBle(key);
      if (result === false) throw new Error("BLE reconnection failed.");
      return true;
    } catch (error) {
      if (revision === activeRevision && key === currentKey()) {
        feedback = {
          kind: "error",
          message: errorMessage(error, "Failed to reconnect BLE."),
        };
      }
      return false;
    } finally {
      if (revision === activeRevision && key === currentKey()) {
        reconnectPending = false;
        notify();
      }
    }
  }

  async function help() {
    feedback = null;
    notify();
    try {
      const result = await openHelp(HELP_URL);
      if (result === false) throw new Error("Help page could not be opened.");
      return true;
    } catch (error) {
      feedback = {
        kind: "error",
        message: errorMessage(error, "Failed to open the Help page."),
      };
      notify();
      return false;
    }
  }

  function createSecondaryWindowLauncher({ isPending, setPending, open, falseMessage, fallbackMessage }) {
    return async () => {
      if (isPending() || !hasNativeBridge()) return false;
      setPending(true);
      feedback = null;
      notify();
      try {
        const result = await open();
        if (result === false) throw new Error(falseMessage);
        return true;
      } catch (error) {
        feedback = { kind: "error", message: errorMessage(error, fallbackMessage) };
        return false;
      } finally {
        setPending(false);
        notify();
      }
    };
  }

  const launchGame = createSecondaryWindowLauncher({
    isPending: () => gamePending,
    setPending: (value) => { gamePending = value; },
    open: openTypingInvaders,
    falseMessage: "Shift-Space Invaders could not be opened.",
    fallbackMessage: "Failed to open Shift-Space Invaders.",
  });

  const launchSnake = createSecondaryWindowLauncher({
    isPending: () => snakePending,
    setPending: (value) => { snakePending = value; },
    open: openKeyboardSnake,
    falseMessage: "Keyboard Snake could not be opened.",
    fallbackMessage: "Failed to open Keyboard Snake.",
  });

  const launchFlappy = createSecondaryWindowLauncher({
    isPending: () => flappyPending,
    setPending: (value) => { flappyPending = value; },
    open: openFlappyKeyBird,
    falseMessage: "Flappy Key-Bird could not be opened.",
    fallbackMessage: "Failed to open Flappy Key-Bird.",
  });

  const launchFishing = createSecondaryWindowLauncher({
    isPending: () => fishingPending,
    setPending: (value) => { fishingPending = value; },
    open: openUnderwaterTypingFishing,
    falseMessage: "Underwater Typing Fishing could not be opened.",
    fallbackMessage: "Failed to open Underwater Typing Fishing.",
  });

  const selfTest = createSecondaryWindowLauncher({
    isPending: () => selfTestPending,
    setPending: (value) => { selfTestPending = value; },
    open: () => openKeyboardSelfTest(currentKey()),
    falseMessage: "Keyboard Self-test could not be opened.",
    fallbackMessage: "Failed to open Keyboard Self-test.",
  });

  async function mini() {
    if (miniPending || !hasNativeBridge()) return false;
    miniPending = true;
    feedback = null;
    notify();
    try {
      const result = await enterMiniMode();
      if (result === false) {
        if (!feedback) {
          feedback = { kind: "error", message: "Mini Mode could not be entered." };
        }
        return false;
      }
      return true;
    } catch (error) {
      feedback = {
        kind: "error",
        message: errorMessage(error, "Failed to enter Mini Mode."),
      };
      return false;
    } finally {
      miniPending = false;
      notify();
    }
  }

  const insights = createSecondaryWindowLauncher({
    isPending: () => insightsPending,
    setPending: (value) => { insightsPending = value; },
    open: openTypingInsights,
    falseMessage: "Typing Insights could not be opened.",
    fallbackMessage: "Failed to open Typing Insights.",
  });

  const settings = createSecondaryWindowLauncher({
    isPending: () => settingsPending,
    setPending: (value) => { settingsPending = value; },
    open: openSettings,
    falseMessage: "Settings could not be opened.",
    fallbackMessage: "Failed to open Settings.",
  });

  return {
    getSnapshot: snapshot,
    refresh: notify,
    setActiveLayout,
    handleBleStatus,
    reportError,
    reload,
    reconnect,
    launchGame,
    launchSnake,
    launchFlappy,
    launchFishing,
    selfTest,
    mini,
    insights,
    settings,
    help,
  };
}
