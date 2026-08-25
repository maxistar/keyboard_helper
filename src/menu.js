const BLE_LABELS = {
  "not-configured": "BLE not configured",
  connecting: "BLE connecting…",
  connected: "BLE connected",
  error: "BLE error",
};

export function createMenu({
  onLayoutSelect,
  onReloadLayout,
  onReconnectBle,
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
    feedback: null,
  };
  let menuToggle;
  let menuPanel;
  let currentLayoutName;
  let bleStatus;
  let bleStatusDetail;
  let reloadButton;
  let reconnectButton;
  let feedbackEl;
  const layoutButtons = new Map();

  const menuKeydownHandler = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
    }
  };

  const menuClickOutsideHandler = (event) => {
    if (menuPanel.contains(event.target) || menuToggle.contains(event.target)) return;
    closeMenu();
  };

  function closeMenu({ restoreFocus = false } = {}) {
    menuPanel.classList.remove("open");
    menuToggle.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open application menu");
    document.removeEventListener("keydown", menuKeydownHandler);
    document.removeEventListener("click", menuClickOutsideHandler);
    if (restoreFocus) menuToggle.focus();
  }

  function openMenu() {
    menuPanel.classList.add("open");
    menuToggle.classList.add("open");
    menuToggle.setAttribute("aria-expanded", "true");
    menuToggle.setAttribute("aria-label", "Close application menu");
    document.addEventListener("keydown", menuKeydownHandler);
    document.addEventListener("click", menuClickOutsideHandler);

    const selected = layoutButtons.get(state.currentLayoutKey);
    const firstEnabled = menuPanel.querySelector("button:not([disabled])");
    (selected ?? firstEnabled)?.focus();
  }

  function toggleMenu() {
    if (menuPanel.classList.contains("open")) closeMenu();
    else openMenu();
  }

  function moveRadioFocus(event, index) {
    if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...layoutButtons.values()];
    if (buttons.length < 2) return;
    const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + direction + buttons.length) % buttons.length;
    const next = buttons[nextIndex];
    next.focus();
    next.scrollIntoView?.({ block: "nearest" });
  }

  function createSectionHeading(text, id) {
    const heading = document.createElement("h4");
    heading.id = id;
    heading.textContent = text;
    return heading;
  }

  function createActionButton(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `menu-action ${className}`;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function buildMenu() {
    const menu = document.createElement("div");
    menu.className = "app-menu";

    menuToggle = document.createElement("button");
    menuToggle.type = "button";
    menuToggle.className = "menu-toggle";
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-haspopup", "dialog");
    menuToggle.setAttribute("aria-controls", "appMenuPanel");
    menuToggle.setAttribute("aria-label", "Open application menu");
    menuToggle.innerHTML = `
      <span class="bars" aria-hidden="true">
        <span class="bar"></span>
        <span class="bar"></span>
        <span class="bar"></span>
      </span>
    `;
    menuToggle.addEventListener("click", toggleMenu);

    menuPanel = document.createElement("div");
    menuPanel.id = "appMenuPanel";
    menuPanel.className = "menu-panel";
    menuPanel.setAttribute("role", "dialog");
    menuPanel.setAttribute("aria-modal", "false");
    menuPanel.setAttribute("aria-labelledby", "appMenuTitle");

    const header = document.createElement("header");
    header.className = "menu-header";
    const currentCaption = document.createElement("span");
    currentCaption.className = "menu-eyebrow";
    currentCaption.textContent = "Current keyboard";
    currentLayoutName = document.createElement("h3");
    currentLayoutName.id = "appMenuTitle";
    currentLayoutName.className = "menu-current-layout";
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
    header.append(currentCaption, currentLayoutName, bleStatus, bleStatusDetail);

    const layoutSection = document.createElement("section");
    layoutSection.className = "menu-section menu-layout-section";
    layoutSection.appendChild(createSectionHeading("Layout", "layoutMenuHeading"));
    const layoutList = document.createElement("ul");
    layoutList.className = "menu-items";
    layoutList.setAttribute("role", "radiogroup");
    layoutList.setAttribute("aria-labelledby", "layoutMenuHeading");

    layoutOptions.forEach((entry, index) => {
      const item = document.createElement("li");
      item.setAttribute("role", "none");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-item";
      button.dataset.layoutKey = entry.key;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", "false");
      button.title = entry.label;
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "menu-item-label";
      label.textContent = entry.label;
      button.append(pill, label);
      button.addEventListener("keydown", (event) => moveRadioFocus(event, index));
      button.addEventListener("click", async () => {
        const changed = await onLayoutSelect(entry.key);
        if (changed !== false) closeMenu();
      });
      item.appendChild(button);
      layoutList.appendChild(item);
      layoutButtons.set(entry.key, button);
    });
    layoutSection.appendChild(layoutList);

    const actionSection = document.createElement("section");
    actionSection.className = "menu-section menu-actions";
    actionSection.appendChild(createSectionHeading("Actions", "menuActionsHeading"));
    reloadButton = createActionButton("Reload layout", "menu-action-reload", onReloadLayout);
    reconnectButton = createActionButton("Reconnect BLE", "menu-action-reconnect", onReconnectBle);
    const helpButton = createActionButton("Help", "menu-action-help", async () => {
      const opened = await onHelp();
      if (opened !== false) closeMenu();
    });
    actionSection.append(reloadButton, reconnectButton, helpButton);

    feedbackEl = document.createElement("div");
    feedbackEl.className = "menu-feedback";
    feedbackEl.setAttribute("role", "status");
    feedbackEl.setAttribute("aria-live", "polite");
    feedbackEl.setAttribute("aria-atomic", "true");

    menuPanel.append(header, layoutSection, actionSection, feedbackEl);
    menu.append(menuToggle, menuPanel);
    mount.appendChild(menu);
  }

  function update(nextState) {
    state = { ...state, ...nextState };
    currentLayoutName.textContent = state.currentLayoutLabel || state.currentLayoutKey || "Keyboard";

    const normalizedBleState = BLE_LABELS[state.bleState] ? state.bleState : "not-configured";
    bleStatus.dataset.state = normalizedBleState;
    bleStatus.querySelector(".menu-status-label").textContent = BLE_LABELS[normalizedBleState];
    bleStatusDetail.textContent = state.bleMessage ?? "";
    bleStatusDetail.classList.toggle("visible", Boolean(state.bleMessage));

    layoutButtons.forEach((button, key) => {
      const active = key === state.currentLayoutKey;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
      button.tabIndex = active ? 0 : -1;
    });

    reloadButton.disabled = !state.reloadAvailable || state.reloadPending;
    reloadButton.textContent = state.reloadPending ? "Reloading…" : "Reload layout";
    reloadButton.title = state.reloadAvailable ? "Reload the active external layout" : "Available for external layouts";

    reconnectButton.disabled = !state.reconnectAvailable || state.reconnectPending;
    reconnectButton.textContent = state.reconnectPending ? "Reconnecting…" : "Reconnect BLE";
    reconnectButton.title = state.reconnectAvailable ? "Restart BLE synchronization" : "BLE synchronization is unavailable";

    feedbackEl.textContent = state.feedback?.message ?? "";
    feedbackEl.dataset.kind = state.feedback?.kind ?? "";
    feedbackEl.classList.toggle("visible", Boolean(state.feedback?.message));
  }

  buildMenu();
  update(state);

  return { update, closeMenu };
}
