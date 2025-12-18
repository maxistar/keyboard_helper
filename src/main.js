const layouts = {
  qwerty: {
    name: "QWERTY",
    keySize: { w: 64, h: 64, gap: 10 },
    keys: [
      { label: "Esc", code: "Escape", row: 0, col: 0, cls: "function" },
      { label: "1", code: "Digit1", row: 0, col: 1 },
      { label: "2", code: "Digit2", row: 0, col: 2 },
      { label: "3", code: "Digit3", row: 0, col: 3 },
      { label: "4", code: "Digit4", row: 0, col: 4 },
      { label: "5", code: "Digit5", row: 0, col: 5 },
      { label: "6", code: "Digit6", row: 0, col: 6 },
      { label: "7", code: "Digit7", row: 0, col: 7 },
      { label: "8", code: "Digit8", row: 0, col: 8 },
      { label: "9", code: "Digit9", row: 0, col: 9 },
      { label: "0", code: "Digit0", row: 0, col: 10 },
      { label: "-", code: "Minus", row: 0, col: 11 },
      { label: "=", code: "Equal", row: 0, col: 12 },
      { label: "Backspace", code: "Backspace", row: 0, col: 13, w: 2, cls: "action" },

      { label: "Tab", code: "Tab", row: 1, col: 0, w: 1.5, cls: "action" },
      { label: "Q", code: "KeyQ", row: 1, col: 1.5 },
      { label: "W", code: "KeyW", row: 1, col: 2.5 },
      { label: "E", code: "KeyE", row: 1, col: 3.5 },
      { label: "R", code: "KeyR", row: 1, col: 4.5 },
      { label: "T", code: "KeyT", row: 1, col: 5.5 },
      { label: "Y", code: "KeyY", row: 1, col: 6.5 },
      { label: "U", code: "KeyU", row: 1, col: 7.5 },
      { label: "I", code: "KeyI", row: 1, col: 8.5 },
      { label: "O", code: "KeyO", row: 1, col: 9.5 },
      { label: "P", code: "KeyP", row: 1, col: 10.5 },
      { label: "[", code: "BracketLeft", row: 1, col: 11.5 },
      { label: "]", code: "BracketRight", row: 1, col: 12.5 },
      { label: "\\", code: "Backslash", row: 1, col: 13.5, w: 1.5, cls: "action" },

      { label: "Caps", code: "CapsLock", row: 2, col: 0, w: 1.8, cls: "action" },
      { label: "A", code: "KeyA", row: 2, col: 1.8 },
      { label: "S", code: "KeyS", row: 2, col: 2.8 },
      { label: "D", code: "KeyD", row: 2, col: 3.8 },
      { label: "F", code: "KeyF", row: 2, col: 4.8 },
      { label: "G", code: "KeyG", row: 2, col: 5.8 },
      { label: "H", code: "KeyH", row: 2, col: 6.8 },
      { label: "J", code: "KeyJ", row: 2, col: 7.8 },
      { label: "K", code: "KeyK", row: 2, col: 8.8 },
      { label: "L", code: "KeyL", row: 2, col: 9.8 },
      { label: ";", code: "Semicolon", row: 2, col: 10.8 },
      { label: "'", code: "Quote", row: 2, col: 11.8 },
      { label: "Enter", code: "Enter", row: 2, col: 12.8, w: 2.2, cls: "action" },

      { label: "Shift", code: "ShiftLeft", row: 3, col: 0, w: 2.3, cls: "action" },
      { label: "Z", code: "KeyZ", row: 3, col: 2.3 },
      { label: "X", code: "KeyX", row: 3, col: 3.3 },
      { label: "C", code: "KeyC", row: 3, col: 4.3 },
      { label: "V", code: "KeyV", row: 3, col: 5.3 },
      { label: "B", code: "KeyB", row: 3, col: 6.3 },
      { label: "N", code: "KeyN", row: 3, col: 7.3 },
      { label: "M", code: "KeyM", row: 3, col: 8.3 },
      { label: ",", code: "Comma", row: 3, col: 9.3 },
      { label: ".", code: "Period", row: 3, col: 10.3 },
      { label: "/", code: "Slash", row: 3, col: 11.3 },
      { label: "Shift", code: "ShiftRight", row: 3, col: 12.3, w: 2.7, cls: "action" },

      { label: "Ctrl", code: "ControlLeft", row: 4, col: 0, w: 1.5, cls: "action" },
      { label: "Win", code: "MetaLeft", row: 4, col: 1.5, w: 1.2, cls: "action" },
      { label: "Alt", code: "AltLeft", row: 4, col: 2.7, w: 1.3, cls: "action" },
      { label: "Space", code: "Space", row: 4, col: 4, w: 6, cls: "action space" },

      { label: "Alt", code: "AltRight", row: 4, col: 10, w: 1.3, cls: "action" },
      { label: "Fn", code: "Fn", row: 4, col: 11.3, w: 1.1, cls: "action" },
      { label: "Menu", code: "ContextMenu", row: 4, col: 12.4, w: 1.3, cls: "action" },
      { label: "Ctrl", code: "ControlRight", row: 4, col: 13.7, w: 1.5, cls: "action" },
    ],
  },
  corne: {
    name: "Corne (split)",
    keySize: { w: 54, h: 54, gap: 10 },
    keys: (() => {
      const keys = [];
      const left = [
        ["Tab", "Tab"], ["Q", "KeyQ"], ["W", "KeyW"], ["E", "KeyE"], ["R", "KeyR"], ["T", "KeyT"],
        ["Ctrl", "ControlLeft"], ["A", "KeyA"], ["S", "KeyS"], ["D", "KeyD"], ["F", "KeyF"], ["G", "KeyG"],
        ["Shift", "ShiftLeft"], ["Y", "KeyY"], ["X", "KeyX"], ["C", "KeyC"], ["V", "KeyV"], ["B", "KeyB"], ["N", "KeyN"],
      ];
      const right = [
        ["Y", "KeyY"], ["U", "KeyU"], ["I", "KeyI"], ["O", "KeyO"], ["P", "KeyP"], ["BSPC", "BSPC"],
        ["J", "KeyJ"], ["K", "KeyK"], ["L", "KeyL"], [";", "Semicolon"], ["'", "Quote"], ["/", "Slash"],
        ["M", "KeyM"], [",", "Comma"], [".", "Period"], ["/", "Slash"], ["-", "Minus"], ["ESC", "ESC"],
      ];

      for (let i = 0; i < 18; i++) {
        const row = Math.floor(i / 6);
        const col = i % 6;
        const [label, code] = left[i];
        keys.push({ label, code, row, col });
      }
      for (let i = 0; i < 18; i++) {
        const row = Math.floor(i / 6);
        const col = 9 + (i % 6);
        const [label, code] = right[i];
        keys.push({ label, code, row, col });
      }

      keys.push({ label: "GUI", code: "Space", row: 3.2, col: 4, w: 1, cls: "action" });
      keys.push({ label: "Low", code: "Space", row: 3.2, col: 5, w: 1, cls: "action" });
      keys.push({ label: "SPACE", code: "Enter", row: 3.2, col: 6, w: 1, cls: "action" });
      keys.push({ label: "ENTER", code: "Space", row: 3.2, col: 8, w: 1, cls: "action" });
      keys.push({ label: "Up", code: "Space", row: 3.2, col: 9, w: 1, cls: "action" });
      keys.push({ label: "ALT", code: "Backspace", row: 3.2, col: 10, w: 1, cls: "action" });
      return keys;
    })(),
  },
  dactyl: {
    name: "Dactyl Manuform (split)",
    keySize: { w: 56, h: 56, gap: 10 },
    keys: (() => {
      const keys = [];
      const left = [
        ["Q", "KeyQ"], ["W", "KeyW"], ["E", "KeyE"], ["R", "KeyR"], ["T", "KeyT"],
        ["A", "KeyA"], ["S", "KeyS"], ["D", "KeyD"], ["F", "KeyF"], ["G", "KeyG"],
        ["Z", "KeyZ"], ["X", "KeyX"], ["C", "KeyC"], ["V", "KeyV"], ["B", "KeyB"],
      ];
      const right = [
        ["Y", "KeyY"], ["U", "KeyU"], ["I", "KeyI"], ["O", "KeyO"], ["P", "KeyP"],
        ["H", "KeyH"], ["J", "KeyJ"], ["K", "KeyK"], ["L", "KeyL"], [";", "Semicolon"],
        ["N", "KeyN"], ["M", "KeyM"], [",", "Comma"], [".", "Period"], ["/", "Slash"],
      ];

      for (let i = 0; i < left.length; i++) {
        const row = Math.floor(i / 5);
        const col = i % 5;
        const [label, code] = left[i];
        keys.push({ label, code, row, col });
      }

      for (let i = 0; i < right.length; i++) {
        const row = Math.floor(i / 5);
        const col = 7 + (i % 5);
        const [label, code] = right[i];
        keys.push({ label, code, row, col });
      }

      keys.push({ label: "Space", code: "Space", row: 3.2, col: 1.5, w: 1.8, cls: "action" });
      keys.push({ label: "Enter", code: "Enter", row: 3.2, col: 3.2, w: 1.8, cls: "action" });
      keys.push({ label: "Alt", code: "AltLeft", row: 3.2, col: 7, w: 1.6, cls: "action" });
      keys.push({ label: "Bksp", code: "Backspace", row: 3.2, col: 8.8, w: 1.8, cls: "action" });
      return keys;
    })(),
  },
};

const layoutRoot = document.getElementById("layoutRoot");
let currentLayoutKey = "corne";

function applyKeySizes({ w, h, gap }) {
  const root = document.documentElement;
  root.style.setProperty("--key-w", `${w}px`);
  root.style.setProperty("--key-h", `${h}px`);
  root.style.setProperty("--gap", `${gap}px`);
}

function calcBounds(keys) {
  let maxCol = 0;
  let maxRow = 0;
  keys.forEach((k) => {
    const keyWidth = k.w ?? 1;
    if (k.col + keyWidth > maxCol) maxCol = k.col + keyWidth;
    if (k.row + 1 > maxRow) maxRow = k.row + 1;
  });
  return { maxCol, maxRow };
}

function renderKeyboard(layout) {
  layoutRoot.innerHTML = "";

  applyKeySizes(layout.keySize);

  const { w, h, gap } = layout.keySize;
  const { maxCol, maxRow } = calcBounds(layout.keys);
  const widthPx = maxCol * (w + gap) + w;
  const heightPx = maxRow * (h + gap) + h;
  layoutRoot.style.width = `${widthPx + 44}px`;
  layoutRoot.style.height = `${heightPx + 44}px`;

  layout.keys.forEach((k) => {
    const el = document.createElement("div");
    el.className = `key ${k.cls || ""}`.trim();
    el.textContent = k.label;
    el.dataset.key = k.code;
    el.style.setProperty("--row", k.row);
    el.style.setProperty("--col", k.col);
    if (k.w) el.style.setProperty("--w", k.w);
    layoutRoot.appendChild(el);
  });
}

function handleKey(code, type) {
  const el = document.querySelector(`.key[data-key="${code}"]`);
  console.log(`Key ${code} ${type}`);
  if (!el) return;
  if (type === "down") {
    el.classList.add("pressed");
  } else if (type === "up") {
    el.classList.remove("pressed");
  }
}

function setLayout(key) {
  const layout = layouts[key];
  if (!layout) return;
  currentLayoutKey = key;
  renderKeyboard(layout);
}

window.addEventListener("DOMContentLoaded", () => {
  const tauri = window.__TAURI__;
  if (tauri) {
    tauri.core
      .invoke("start_keyboard_listener")
      .catch((err) => console.error("Failed to start listener:", err));

    tauri.event
      .listen("key_event", (e) => {
        const { key, event_type } = e.payload;
        handleKey(key, event_type);
      })
      .catch((err) => console.error("Failed to listen key_event:", err));

    tauri.event
      .listen("layout_selected", (e) => {
        const key = e.payload?.layout;
        if (typeof key === "string") {
          setLayout(key);
        }
      })
      .catch((err) => console.error("Failed to listen layout_selected:", err));
  } else {
    console.warn("Tauri global API (window.__TAURI__) is not available");
  }

  setLayout(currentLayoutKey);
});
