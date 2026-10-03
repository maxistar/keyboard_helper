import { reloadActiveExternalLayout } from "./app_menu_actions.js";

export function createOverlayActions({
  window,
  getTauriHandle,
  getCurrentLayoutKey,
  setCurrentLayoutKey,
  setCurrentLayerIndex,
  getLayoutSources,
  getLayoutBleSources,
  getLayouts,
  layoutRegistry,
  syncLayoutState,
  renderKeyboard,
  startLanguageSync,
  getBleRuntime,
  getMenuStateController,
  getOverlayModeController,
  getSelfTestBridge,
  showLayoutError,
}) {
  async function refreshExternalLayout(key) {
    const source = getLayoutSources()[key];
    if (typeof source !== "string") return { ok: true, error: null };
    const { def, error } = await layoutRegistry.loadLayoutDefinition(key, source);
    if (!def) {
      return { ok: false, error: error ?? `Failed to reload layout "${key}".` };
    }
    layoutRegistry.applyLayoutDefinition(key, def);
    syncLayoutState();
    return { ok: true, error: null };
  }

  async function reloadCurrentLayout(key) {
    getSelfTestBridge()?.invalidate("layout-reloaded");
    return reloadActiveExternalLayout({
      key,
      getCurrentLayoutKey,
      getLayoutSource: (layoutKey) => getLayoutSources()[layoutKey],
      loadLayoutDefinition: (layoutKey, source) => layoutRegistry.loadLayoutDefinition(layoutKey, source),
      applyLayoutDefinition: (layoutKey, definition) => {
        layoutRegistry.applyLayoutDefinition(layoutKey, definition);
        syncLayoutState();
      },
      renderBaseLayout: (layoutKey) => {
        setCurrentLayerIndex(0);
        renderKeyboard(getLayouts()[layoutKey]);
      },
      restartBle: async (layoutKey) => {
        await startLanguageSync(layoutKey);
        const bleRuntime = getBleRuntime();
        if (bleRuntime) {
          await bleRuntime.start(layoutKey, getLayoutBleSources()[layoutKey] ?? null);
        }
        getMenuStateController()?.refresh();
      },
    });
  }

  async function reconnectCurrentBle(key) {
    return getBleRuntime()?.reconnect(key) ?? false;
  }

  async function openHelpPage(url) {
    const tauriHandle = getTauriHandle();
    if (tauriHandle) {
      if (typeof tauriHandle.opener?.openUrl !== "function") {
        throw new Error("The system browser opener is unavailable.");
      }
      await tauriHandle.opener.openUrl(url);
      return true;
    }

    if (typeof window.open !== "function") {
      throw new Error("The browser cannot open the Help page.");
    }
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  }

  async function invokeDesktop(command, message) {
    const tauriHandle = getTauriHandle();
    if (!tauriHandle?.core?.invoke) throw new Error(message);
    await tauriHandle.core.invoke(command);
    return true;
  }

  async function openTypingInvaders() {
    return invokeDesktop("open_typing_invaders", "Shift-Space Invaders requires the desktop application.");
  }

  async function openKeyboardSnake() {
    return invokeDesktop("open_keyboard_snake", "Keyboard Snake requires the desktop application.");
  }

  async function openFlappyKeyBird() {
    return invokeDesktop("open_flappy_key_bird", "Flappy Key-Bird requires the desktop application.");
  }

  async function openUnderwaterTypingFishing() {
    return invokeDesktop("open_underwater_typing_fishing", "Underwater Typing Fishing requires the desktop application.");
  }

  async function openTypingInsightsWindow() {
    return invokeDesktop("open_typing_insights", "Typing Insights requires the desktop application.");
  }

  async function openSettingsWindow() {
    return invokeDesktop("open_settings", "Settings require the desktop application.");
  }

  async function openKeyboardSelfTest() {
    const tauriHandle = getTauriHandle();
    if (!tauriHandle?.core?.invoke) {
      throw new Error("Keyboard Self-test requires the desktop application.");
    }
    await tauriHandle.core.invoke("open_keyboard_self_test", { currentLayout: getCurrentLayoutKey() });
    return true;
  }

  async function enterMiniMode() {
    const overlayModeController = getOverlayModeController();
    if (!overlayModeController) {
      throw new Error("Mini Mode is not ready yet.");
    }
    return overlayModeController.enterMini();
  }

  async function setLayout(key) {
    if (key !== getCurrentLayoutKey()) getSelfTestBridge()?.invalidate("layout-changed");
    const previousKey = getCurrentLayoutKey();
    const { ok, error } = await refreshExternalLayout(key);
    if (!ok) {
      setCurrentLayoutKey(previousKey);
      showLayoutError(error);
      getMenuStateController()?.reportError(error);
      return false;
    }
    const layout = getLayouts()[key];
    if (!layout) return false;
    setCurrentLayoutKey(key);
    setCurrentLayerIndex(0);
    renderKeyboard(layout);
    getMenuStateController()?.setActiveLayout();

    await startLanguageSync(key);
    const bleRuntime = getBleRuntime();
    if (bleRuntime) {
      await bleRuntime.start(key, getLayoutBleSources()[key] ?? null);
    }

    getMenuStateController()?.refresh();
    return true;
  }

  return {
    reloadCurrentLayout,
    reconnectCurrentBle,
    openHelpPage,
    openTypingInvaders,
    openKeyboardSnake,
    openFlappyKeyBird,
    openUnderwaterTypingFishing,
    openTypingInsightsWindow,
    openSettingsWindow,
    openKeyboardSelfTest,
    enterMiniMode,
    setLayout,
  };
}
