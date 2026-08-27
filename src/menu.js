const BLE_LABELS = {
  "not-configured": "BLE not configured",
  connecting: "BLE connecting…",
  connected: "BLE connected",
  error: "BLE error",
};

const HOVER_INTENT_DELAY = 120;
const FLYOUT_GAP = 8;
const VIEWPORT_MARGIN = 8;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function createMenu({
  onLayoutSelect,
  onReloadLayout,
  onReconnectBle,
  onMiniMode,
  onStartGame,
  onSettings,
  onHelp,
  layoutOptions = [],
}) {
  const mount = document.getElementById("menuRoot");
  if (!mount) {
    return { update: () => {}, closeMenu: () => {} };
  }

  let state = {
    currentLayoutKey: layoutOptions[0]?.key ?? null,
    currentLayoutLabel: layoutOptions[0]?.label ?? "Keyboard",
    bleAvailable: false,
    bleState: "not-configured",
    bleMessage: null,
    reloadAvailable: false,
    reloadPending: false,
    reconnectAvailable: false,
    reconnectPending: false,
    gameAvailable: false,
    gamePending: false,
    miniAvailable: false,
    miniPending: false,
    settingsAvailable: false,
    settingsPending: false,
    feedback: null,
  };
  let activeSubmenu = null;
  let feedbackContext = null;
  let hoverOpenTimer = null;
  let hoverCloseTimer = null;

  let appMenu;
  let menuToggle;
  let rootMenu;
  let keyboardButton;
  let connectionButton;
  let keyboardSummary;
  let connectionSummary;
  let keyboardFlyout;
  let connectionFlyout;
  let currentLayoutName;
  let bleStatus;
  let bleStatusDetail;
  let reloadButton;
  let reconnectButton;
  let gameButton;
  let miniButton;
  let settingsButton;
  let rootFeedback;
  let keyboardFeedback;
  let connectionFeedback;

  const layoutButtons = new Map();
  const rootItems = [];
  const flyoutItems = { keyboard: [], connection: [] };
  const submenuButtons = {};
  const submenus = {};

  function clearHoverTimers() {
    if (hoverOpenTimer !== null) clearTimeout(hoverOpenTimer);
    if (hoverCloseTimer !== null) clearTimeout(hoverCloseTimer);
    hoverOpenTimer = null;
    hoverCloseTimer = null;
  }

  function enabledItems(items) {
    return items.filter((item) => !item.disabled);
  }

  function focusItem(item) {
    item?.focus();
    item?.scrollIntoView?.({ block: "nearest" });
  }

  function setRovingItem(items, item) {
    items.forEach((entry) => {
      entry.tabIndex = entry === item && !entry.disabled ? 0 : -1;
    });
  }

  function firstFlyoutItem(name) {
    if (name === "keyboard") {
      const selected = layoutButtons.get(state.currentLayoutKey);
      if (selected && !selected.disabled) return selected;
    }
    return enabledItems(flyoutItems[name])[0] ?? null;
  }

  function viewportSize() {
    return {
      width: globalThis.window?.innerWidth ?? document.documentElement?.clientWidth ?? 1024,
      height: globalThis.window?.innerHeight ?? document.documentElement?.clientHeight ?? 768,
    };
  }

  function positionFlyout(name) {
    const button = submenuButtons[name];
    const flyout = submenus[name];
    if (!button?.getBoundingClientRect || !flyout?.getBoundingClientRect) return;

    const parentRect = button.getBoundingClientRect();
    const flyoutRect = flyout.getBoundingClientRect();
    const viewport = viewportSize();
    const width = flyoutRect.width || flyout.offsetWidth || 260;
    const height = flyoutRect.height || flyout.offsetHeight || 240;
    const preferredLeft = parentRect.left - FLYOUT_GAP - width;
    const fallbackLeft = parentRect.right + FLYOUT_GAP;
    let side = "left";
    let left = preferredLeft;

    if (preferredLeft < VIEWPORT_MARGIN) {
      if (fallbackLeft + width <= viewport.width - VIEWPORT_MARGIN) {
        side = "right";
        left = fallbackLeft;
      } else {
        side = "overlap";
        left = clamp(preferredLeft, VIEWPORT_MARGIN, viewport.width - VIEWPORT_MARGIN - width);
      }
    }

    const top = clamp(
      parentRect.top,
      VIEWPORT_MARGIN,
      viewport.height - VIEWPORT_MARGIN - height,
    );
    flyout.dataset.side = side;
    flyout.style.left = `${Math.round(left)}px`;
    flyout.style.top = `${Math.round(top)}px`;
  }

  function closeSubmenu({ restoreFocus = false } = {}) {
    clearHoverTimers();
    if (!activeSubmenu) return;
    const name = activeSubmenu;
    activeSubmenu = null;
    submenus[name].classList.remove("open");
    submenus[name].setAttribute("aria-hidden", "true");
    submenuButtons[name].classList.remove("open");
    submenuButtons[name].setAttribute("aria-expanded", "false");
    if (restoreFocus) focusItem(submenuButtons[name]);
  }

  function openSubmenu(name, { focusFirst = false } = {}) {
    clearHoverTimers();
    if (activeSubmenu && activeSubmenu !== name) closeSubmenu();
    activeSubmenu = name;
    const button = submenuButtons[name];
    const flyout = submenus[name];
    button.classList.add("open");
    button.setAttribute("aria-expanded", "true");
    flyout.classList.add("open");
    flyout.setAttribute("aria-hidden", "false");
    positionFlyout(name);
    if (focusFirst) {
      const item = firstFlyoutItem(name);
      setRovingItem(flyoutItems[name], item);
      focusItem(item);
    }
  }

  function toggleSubmenu(name) {
    if (activeSubmenu === name) closeSubmenu({ restoreFocus: true });
    else openSubmenu(name);
  }

  function scheduleSubmenuOpen(name) {
    clearHoverTimers();
    hoverOpenTimer = setTimeout(() => {
      hoverOpenTimer = null;
      openSubmenu(name);
    }, HOVER_INTENT_DELAY);
  }

  function scheduleSubmenuClose(name) {
    if (hoverCloseTimer !== null) clearTimeout(hoverCloseTimer);
    if (hoverOpenTimer !== null) clearTimeout(hoverOpenTimer);
    hoverOpenTimer = null;
    hoverCloseTimer = setTimeout(() => {
      hoverCloseTimer = null;
      if (activeSubmenu === name) closeSubmenu();
    }, HOVER_INTENT_DELAY);
  }

  function cancelSubmenuClose() {
    if (hoverCloseTimer !== null) clearTimeout(hoverCloseTimer);
    hoverCloseTimer = null;
  }

  function menuKeydownHandler(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
      return;
    }
    if (event.key === "Tab") closeMenu();
  }

  function menuClickOutsideHandler(event) {
    if (appMenu.contains(event.target)) return;
    closeMenu();
  }

  function viewportChangeHandler() {
    if (activeSubmenu) positionFlyout(activeSubmenu);
  }

  function closeMenu({ restoreFocus = false } = {}) {
    clearHoverTimers();
    closeSubmenu();
    rootMenu.classList.remove("open");
    rootMenu.setAttribute("aria-hidden", "true");
    menuToggle.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open application menu");
    document.removeEventListener("keydown", menuKeydownHandler);
    document.removeEventListener("click", menuClickOutsideHandler);
    globalThis.window?.removeEventListener?.("resize", viewportChangeHandler);
    if (restoreFocus) menuToggle.focus();
  }

  function openMenu() {
    rootMenu.classList.add("open");
    rootMenu.setAttribute("aria-hidden", "false");
    menuToggle.classList.add("open");
    menuToggle.setAttribute("aria-expanded", "true");
    menuToggle.setAttribute("aria-label", "Close application menu");
    document.addEventListener("keydown", menuKeydownHandler);
    document.addEventListener("click", menuClickOutsideHandler);
    globalThis.window?.addEventListener?.("resize", viewportChangeHandler);

    const first = enabledItems(rootItems)[0] ?? null;
    setRovingItem(rootItems, first);
    focusItem(first);
  }

  function toggleMenu() {
    if (rootMenu.classList.contains("open")) closeMenu();
    else openMenu();
  }

  function moveFocus(event, items) {
    const available = enabledItems(items);
    if (!available.length) return false;
    const currentIndex = Math.max(0, available.indexOf(event.currentTarget));
    let nextIndex;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = available.length - 1;
    else if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % available.length;
    else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + available.length) % available.length;
    else return false;

    event.preventDefault();
    const next = available[nextIndex];
    setRovingItem(items, next);
    focusItem(next);
    return true;
  }

  function attachItemKeyboard(button, items, { submenuName = null, inFlyout = false } = {}) {
    button.addEventListener("keydown", (event) => {
      if (moveFocus(event, items)) return;
      if (submenuName && ["ArrowRight", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openSubmenu(submenuName, { focusFirst: true });
        return;
      }
      if (inFlyout && event.key === "ArrowLeft") {
        event.preventDefault();
        closeSubmenu({ restoreFocus: true });
      }
    });
  }

  function createRootItem(label, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `menu-root-item ${className}`;
    button.setAttribute("role", "menuitem");
    button.tabIndex = -1;
    const labelEl = document.createElement("span");
    labelEl.className = "menu-root-label";
    labelEl.textContent = label;
    button.appendChild(labelEl);
    rootItems.push(button);
    return button;
  }

  function createSubmenuParent(name, label, submenuId) {
    const button = createRootItem(label, `menu-parent menu-parent-${name}`);
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", submenuId);
    const summary = document.createElement("span");
    summary.className = "menu-root-summary";
    const arrow = document.createElement("span");
    arrow.className = "menu-flyout-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "‹";
    button.append(summary, arrow);
    button.addEventListener("click", () => toggleSubmenu(name));
    button.addEventListener("pointerenter", () => scheduleSubmenuOpen(name));
    button.addEventListener("pointerleave", () => scheduleSubmenuClose(name));
    attachItemKeyboard(button, rootItems, { submenuName: name });
    submenuButtons[name] = button;
    return { button, summary };
  }

  function createFlyout(name, id, labelledBy) {
    const flyout = document.createElement("div");
    flyout.id = id;
    flyout.className = `menu-flyout menu-flyout-${name}`;
    flyout.setAttribute("role", "menu");
    flyout.setAttribute("aria-labelledby", labelledBy);
    flyout.setAttribute("aria-hidden", "true");
    flyout.addEventListener("pointerenter", cancelSubmenuClose);
    flyout.addEventListener("pointerleave", () => scheduleSubmenuClose(name));
    submenus[name] = flyout;
    return flyout;
  }

  function createFlyoutAction(label, className, name, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `menu-flyout-action ${className}`;
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.tabIndex = -1;
    button.addEventListener("click", handler);
    flyoutItems[name].push(button);
    attachItemKeyboard(button, flyoutItems[name], { inFlyout: true });
    return button;
  }

  function createFeedback(className) {
    const feedback = document.createElement("div");
    feedback.className = `menu-feedback ${className}`;
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    feedback.setAttribute("aria-atomic", "true");
    return feedback;
  }

  function buildMenu() {
    appMenu = document.createElement("div");
    appMenu.className = "app-menu";

    menuToggle = document.createElement("button");
    menuToggle.type = "button";
    menuToggle.className = "menu-toggle";
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-haspopup", "menu");
    menuToggle.setAttribute("aria-controls", "appMenuRoot");
    menuToggle.setAttribute("aria-label", "Open application menu");
    menuToggle.innerHTML = `
      <span class="bars" aria-hidden="true">
        <span class="bar"></span>
        <span class="bar"></span>
        <span class="bar"></span>
      </span>
    `;
    menuToggle.addEventListener("click", toggleMenu);

    rootMenu = document.createElement("div");
    rootMenu.id = "appMenuRoot";
    rootMenu.className = "menu-panel menu-root";
    rootMenu.setAttribute("role", "menu");
    rootMenu.setAttribute("aria-label", "Application menu");
    rootMenu.setAttribute("aria-hidden", "true");

    ({ button: keyboardButton, summary: keyboardSummary } = createSubmenuParent(
      "keyboard",
      "Keyboard",
      "keyboardMenuFlyout",
    ));
    keyboardButton.id = "keyboardMenuParent";
    ({ button: connectionButton, summary: connectionSummary } = createSubmenuParent(
      "connection",
      "Connection",
      "connectionMenuFlyout",
    ));
    connectionButton.id = "connectionMenuParent";

    miniButton = createRootItem("Mini Mode", "menu-action-mini");
    miniButton.addEventListener("click", async () => {
      feedbackContext = "root";
      const entered = await onMiniMode();
      if (entered !== false) closeMenu();
    });
    attachItemKeyboard(miniButton, rootItems);

    gameButton = createRootItem("Shift-Space Invaders", "menu-action-game");
    gameButton.addEventListener("click", async () => {
      feedbackContext = "root";
      const opened = await onStartGame();
      if (opened !== false) closeMenu();
    });
    attachItemKeyboard(gameButton, rootItems);

    settingsButton = createRootItem("Settings", "menu-action-settings");
    settingsButton.addEventListener("click", async () => {
      feedbackContext = "root";
      const opened = await onSettings();
      if (opened !== false) closeMenu();
    });
    attachItemKeyboard(settingsButton, rootItems);

    const helpButton = createRootItem("Help", "menu-action-help");
    helpButton.addEventListener("click", async () => {
      feedbackContext = "root";
      const opened = await onHelp();
      if (opened !== false) closeMenu();
    });
    attachItemKeyboard(helpButton, rootItems);

    rootFeedback = createFeedback("menu-feedback-root");
    rootMenu.append(
      keyboardButton,
      connectionButton,
      miniButton,
      gameButton,
      settingsButton,
      helpButton,
      rootFeedback,
    );

    keyboardFlyout = createFlyout("keyboard", "keyboardMenuFlyout", "keyboardMenuParent");
    const keyboardHeader = document.createElement("header");
    keyboardHeader.className = "menu-flyout-header";
    const keyboardEyebrow = document.createElement("span");
    keyboardEyebrow.className = "menu-eyebrow";
    keyboardEyebrow.textContent = "Current keyboard";
    currentLayoutName = document.createElement("strong");
    currentLayoutName.className = "menu-current-layout";
    keyboardHeader.append(keyboardEyebrow, currentLayoutName);

    const layoutList = document.createElement("div");
    layoutList.className = "menu-items";
    layoutOptions.forEach((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-item";
      button.dataset.layoutKey = entry.key;
      button.setAttribute("role", "menuitemradio");
      button.setAttribute("aria-checked", "false");
      button.title = entry.label;
      button.tabIndex = -1;
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "menu-item-label";
      label.textContent = entry.label;
      button.append(pill, label);
      button.addEventListener("click", async () => {
        feedbackContext = "keyboard";
        const changed = await onLayoutSelect(entry.key);
        if (changed !== false) closeMenu();
      });
      flyoutItems.keyboard.push(button);
      attachItemKeyboard(button, flyoutItems.keyboard, { inFlyout: true });
      layoutList.appendChild(button);
      layoutButtons.set(entry.key, button);
    });

    reloadButton = createFlyoutAction(
      "Reload layout",
      "menu-action-reload",
      "keyboard",
      async () => {
        feedbackContext = "keyboard";
        await onReloadLayout();
      },
    );
    keyboardFeedback = createFeedback("menu-feedback-keyboard");
    keyboardFlyout.append(keyboardHeader, layoutList, reloadButton, keyboardFeedback);

    connectionFlyout = createFlyout("connection", "connectionMenuFlyout", "connectionMenuParent");
    const connectionHeader = document.createElement("header");
    connectionHeader.className = "menu-flyout-header";
    const connectionEyebrow = document.createElement("span");
    connectionEyebrow.className = "menu-eyebrow";
    connectionEyebrow.textContent = "BLE synchronization";
    bleStatus = document.createElement("div");
    bleStatus.className = "menu-ble-status";
    bleStatus.setAttribute("role", "status");
    const bleDot = document.createElement("span");
    bleDot.className = "menu-status-dot";
    bleDot.setAttribute("aria-hidden", "true");
    const bleLabel = document.createElement("span");
    bleLabel.className = "menu-status-label";
    bleStatus.append(bleDot, bleLabel);
    bleStatusDetail = document.createElement("p");
    bleStatusDetail.className = "menu-status-detail";
    connectionHeader.append(connectionEyebrow, bleStatus, bleStatusDetail);

    reconnectButton = createFlyoutAction(
      "Reconnect BLE",
      "menu-action-reconnect",
      "connection",
      async () => {
        feedbackContext = "connection";
        await onReconnectBle();
      },
    );
    connectionFeedback = createFeedback("menu-feedback-connection");
    connectionFlyout.append(connectionHeader, reconnectButton, connectionFeedback);

    appMenu.append(menuToggle, rootMenu, keyboardFlyout, connectionFlyout);
    mount.appendChild(appMenu);
  }

  function renderFeedback() {
    if (state.reloadPending) feedbackContext = "keyboard";
    else if (state.reconnectPending) feedbackContext = "connection";
    else if (state.miniPending || state.gamePending || state.settingsPending) feedbackContext = "root";

    const targets = {
      root: rootFeedback,
      keyboard: keyboardFeedback,
      connection: connectionFeedback,
    };
    Object.values(targets).forEach((element) => {
      element.textContent = "";
      element.dataset.kind = "";
      element.classList.remove("visible");
    });
    if (!state.feedback?.message) return;
    const target = targets[feedbackContext] ?? rootFeedback;
    target.textContent = state.feedback.message;
    target.dataset.kind = state.feedback.kind ?? "";
    target.classList.add("visible");
  }

  function update(nextState) {
    state = { ...state, ...nextState };
    const layoutLabel = state.currentLayoutLabel || state.currentLayoutKey || "Keyboard";
    currentLayoutName.textContent = layoutLabel;
    keyboardSummary.textContent = layoutLabel;

    const normalizedBleState = BLE_LABELS[state.bleState] ? state.bleState : "not-configured";
    connectionSummary.textContent = BLE_LABELS[normalizedBleState];
    connectionButton.dataset.state = normalizedBleState;
    bleStatus.dataset.state = normalizedBleState;
    bleStatus.querySelector(".menu-status-label").textContent = BLE_LABELS[normalizedBleState];
    bleStatusDetail.textContent = state.bleMessage ?? "";
    bleStatusDetail.classList.toggle("visible", Boolean(state.bleMessage));

    layoutButtons.forEach((button, key) => {
      const active = key === state.currentLayoutKey;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
    });

    reloadButton.disabled = !state.reloadAvailable || state.reloadPending;
    reloadButton.textContent = state.reloadPending ? "Reloading…" : "Reload layout";
    reloadButton.title = state.reloadAvailable
      ? "Reload the active external layout"
      : "Available for external layouts";

    reconnectButton.disabled = !state.reconnectAvailable || state.reconnectPending;
    reconnectButton.textContent = state.reconnectPending ? "Reconnecting…" : "Reconnect BLE";
    reconnectButton.title = state.reconnectAvailable
      ? "Restart BLE synchronization"
      : "BLE synchronization is unavailable";

    miniButton.disabled = !state.miniAvailable || state.miniPending;
    miniButton.textContent = state.miniPending ? "Entering Mini Mode…" : "Mini Mode";
    miniButton.title = state.miniAvailable
      ? "Shrink the keyboard overlay until the application restarts"
      : "Available in the desktop application";

    gameButton.disabled = !state.gameAvailable || state.gamePending;
    gameButton.textContent = state.gamePending ? "Launching…" : "Shift-Space Invaders";
    gameButton.title = state.gameAvailable
      ? "Open the typing arcade in a separate window"
      : "Available in the desktop application";

    settingsButton.disabled = !state.settingsAvailable || state.settingsPending;
    settingsButton.textContent = state.settingsPending ? "Opening Settings…" : "Settings";
    settingsButton.title = state.settingsAvailable
      ? "Open application settings in a separate window"
      : "Available in the desktop application";

    const selected = layoutButtons.get(state.currentLayoutKey);
    setRovingItem(flyoutItems.keyboard, selected ?? enabledItems(flyoutItems.keyboard)[0]);
    setRovingItem(flyoutItems.connection, enabledItems(flyoutItems.connection)[0]);
    if (!rootItems.includes(document.activeElement)) {
      setRovingItem(rootItems, enabledItems(rootItems)[0]);
    }
    renderFeedback();
    if (activeSubmenu) positionFlyout(activeSubmenu);
  }

  buildMenu();
  update(state);

  return { update, closeMenu };
}
