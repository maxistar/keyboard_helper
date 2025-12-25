const layoutMenuOptions = [
  { key: "qwerty", label: "Qwerz" },
  { key: "magic", label: "Magic Keyboard" },
  { key: "mac", label: "Mac Keyboard" },
  { key: "dactyl", label: "Dacty" },
  { key: "corne", label: "Corney" },  
];

export function createMenu({ onLayoutSelect, getCurrentLayoutKey }) {
  const mount = document.getElementById("menuRoot");
  if (!mount) {
    return { updateActive: () => {} };
  }

  let menuToggle = null;
  let menuPanel = null;

  const menuKeydownHandler = (event) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  };

  const menuClickOutsideHandler = (event) => {
    if (!menuPanel || !menuToggle) return;
    if (menuPanel.contains(event.target) || menuToggle.contains(event.target)) {
      return;
    }
    closeMenu();
  };

  function closeMenu() {
    if (!menuPanel || !menuToggle) return;
    menuPanel.classList.remove("open");
    menuToggle.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", menuKeydownHandler);
    document.removeEventListener("click", menuClickOutsideHandler);
  }

  function openMenu() {
    if (!menuPanel || !menuToggle) return;
    menuPanel.classList.add("open");
    menuToggle.classList.add("open");
    menuToggle.setAttribute("aria-expanded", "true");
    document.addEventListener("keydown", menuKeydownHandler);
    document.addEventListener("click", menuClickOutsideHandler);
  }

  function toggleMenu() {
    if (!menuPanel) return;
    const isOpen = menuPanel.classList.contains("open");
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  function updateMenuActiveState() {
    if (!menuPanel) return;
    const currentKey = getCurrentLayoutKey();
    const items = menuPanel.querySelectorAll(".menu-item");
    items.forEach((btn) => {
      const isActive = btn.dataset.layoutKey === currentKey;
      btn.classList.toggle("active", isActive);
      if (isActive) {
        btn.setAttribute("aria-pressed", "true");
      } else {
        btn.removeAttribute("aria-pressed");
      }
    });
  }

  function buildMenu() {
    const menu = document.createElement("div");
    menu.className = "app-menu";

    menuToggle = document.createElement("button");
    menuToggle.type = "button";
    menuToggle.className = "menu-toggle";
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open menu");
    menuToggle.innerHTML = `
      <span class="bars">
        <span class="bar"></span>
        <span class="bar"></span>
        <span class="bar"></span>
      </span>
    `;
    menuToggle.addEventListener("click", toggleMenu);

    menuPanel = document.createElement("div");
    menuPanel.className = "menu-panel";
    menuPanel.setAttribute("role", "menu");

    const layoutSection = document.createElement("div");
    layoutSection.className = "menu-section";
    const layoutHeading = document.createElement("h4");
    layoutHeading.textContent = "Layout";
    layoutSection.appendChild(layoutHeading);

    const layoutList = document.createElement("ul");
    layoutList.className = "menu-items";

    layoutMenuOptions.forEach((entry) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-item";
      button.dataset.layoutKey = entry.key;
      button.innerHTML = `
        <span class="pill"></span>
        <span>${entry.label}</span>
      `;
      button.addEventListener("click", () => {
        onLayoutSelect(entry.key);
        closeMenu();
      });
      item.appendChild(button);
      layoutList.appendChild(item);
    });

    layoutSection.appendChild(layoutList);

    

    menuPanel.appendChild(layoutSection);
    

    menu.appendChild(menuToggle);
    menu.appendChild(menuPanel);
    mount.appendChild(menu);
  }

  buildMenu();
  updateMenuActiveState();

  return {
    updateActive: updateMenuActiveState,
    closeMenu,
  };
}
