const qwertyLayers = [
    [
        ["Esc", "Escape"], 
        ["1", "Digit1"], 
        ["2", "Digit2"], 
        ["3", "Digit3"], 
        ["4", "Digit4"], 
        ["5", "Digit5"], 
        ["6", "Digit6"], 
        ["7", "Digit7"], 
        ["8", "Digit8"], 
        ["9", "Digit9"], 
        ["0", "Digit0"], 
        ["-", "Minus"], 
        ["=", "Equal"], 
        ["Backspace", "Backspace"],

        ["Tab", "Tab"], 
        ["q", "KeyQ"], 
        ["w", "KeyW"], 
        ["e", "KeyE"], 
        ["r", "KeyR"], 
        ["t", "KeyT"], 
        ["z", "KeyY"], 
        ["u", "KeyU"], 
        ["i", "KeyI"], 
        ["o", "KeyO"], 
        ["p", "KeyP"], 
        ["[", "BracketLeft"], 
        ["]", "BracketRight"], 
        ["\\", "Backslash"],
        ["Caps", "CapsLock"], 
        ["a", "KeyA"], 
        ["s", "KeyS"], 
        ["d", "KeyD"], 
        ["f", "KeyF"], 
        ["g", "KeyG"], 
        ["h", "KeyH"], 
        ["j", "KeyJ"], 
        ["k", "KeyK"], 
        ["l", "KeyL"], 
        [";", "Semicolon"], 
        ["'", "Quote"], 
        ["Enter", "Enter"],
        ["Shift", "ShiftLeft"], 
        ["z", "KeyZ"], 
        ["x", "KeyX"], 
        ["c", "KeyC"], 
        ["v", "KeyV"], 
        ["b", "KeyB"], 
        ["n", "KeyN"], 
        ["m", "KeyM"], 
        [",", "Comma"], 
        [".", "Period"], 
        ["/", "Slash"], 
        ["Shift", "ShiftRight"],
        ["Ctrl", "ControlLeft"], 
        ["Win", "MetaLeft"], 
        ["Alt", "AltLeft"], 
        ["Space", "Space"], 
        ["Alt", "AltRight"], 
        ["Fn", "Fn"], 
        ["Menu", "ContextMenu"], 
        ["Ctrl", "ControlRight"],
    ]
];


const getQwertyKeys = () => {
    const keysLayout = [
        { row: 0, col: 0, cls: "function"},
        { row: 0, col: 1},
        { row: 0, col: 2},
        { row: 0, col: 3},
        { row: 0, col: 4},
        { row: 0, col: 5},
        { row: 0, col: 6},
        { row: 0, col: 7},
        { row: 0, col: 8},
        { row: 0, col: 9},
        { row: 0, col: 10},
        { row: 0, col: 11},
        { row: 0, col: 12},
        { row: 0, col: 13, w: 2, cls: "action"},
        { row: 1, col: 0, w: 1.5, cls: "action"},
        { row: 1, col: 1.5},
        { row: 1, col: 2.5},
        { row: 1, col: 3.5},
        { row: 1, col: 4.5},
        { row: 1, col: 5.5},
        { row: 1, col: 6.5},
        { row: 1, col: 7.5},
        { row: 1, col: 8.5},
        { row: 1, col: 9.5},
        { row: 1, col: 10.5},
        { row: 1, col: 11.5},
        { row: 1, col: 12.5},
        { row: 1, col: 13.5, w: 1.5, cls: "action"},
        { row: 2, col: 0, w: 1.8, cls: "action"},
        { row: 2, col: 1.8},
        { row: 2, col: 2.8},
        { row: 2, col: 3.8},
        { row: 2, col: 4.8},
        { row: 2, col: 5.8},
        { row: 2, col: 6.8},
        { row: 2, col: 7.8},
        { row: 2, col: 8.8},
        { row: 2, col: 9.8},
        { row: 2, col: 10.8},
        { row: 2, col: 11.8},
        { row: 2, col: 12.8, w: 2.2, cls: "action"},
        { row: 3, col: 0, w: 2.3, cls: "action"},
        { row: 3, col: 2.3},
        { row: 3, col: 3.3},
        { row: 3, col: 4.3},
        { row: 3, col: 5.3},
        { row: 3, col: 6.3},
        { row: 3, col: 7.3},
        { row: 3, col: 8.3},
        { row: 3, col: 9.3},
        { row: 3, col: 10.3},
        { row: 3, col: 11.3},
        { row: 3, col: 12.3, w: 2.7, cls: "action"},
        { row: 4, col: 0, w: 1.5, cls: "action"},
        { row: 4, col: 1.5, w: 1.2, cls: "action"},
        { row: 4, col: 2.7, w: 1.3, cls: "action"},
        { row: 4, col: 4, w: 6, cls: "action space"},
        { row: 4, col: 10, w: 1.3, cls: "action"},
        { row: 4, col: 11.3, w: 1.1, cls: "action"},
        { row: 4, col: 12.4, w: 1.3, cls: "action"},
        { row: 4, col: 13.7, w: 1.5, cls: "action"},
    ];

    const result = [];
    keysLayout.forEach((k, key) => {
        result.push({...k, label: qwertyLayers[0][key][0], code: qwertyLayers[0][key][1]});
    });

    return result;
}

const corneLayers = [[
    ["Tab", "Tab"],
    ["q", "KeyQ"],
    ["w", "KeyW"],
    ["e", "KeyE"],
    ["r", "KeyR"],
    ["t", "KeyT"],
    ["z", "KeyY"],
    ["u", "KeyU"],
    ["i", "KeyI"],
    ["o", "KeyO"],
    ["p", "KeyP"],
    ["BSPC", "BSPC"],

    ["Ctrl", "ControlLeft"],
    ["a", "KeyA"],
    ["s", "KeyS"],
    ["d", "KeyD"],
    ["f", "KeyF"],
    ["g", "KeyG"],
    ["h", "KeyH"],
    ["j", "KeyJ"],
    ["k", "KeyK"],
    ["l", "KeyL"],
    ["ö", "Quote"],
    ["/", "Slash"],

    ["Shift", "ShiftLeft"],
    ["y", "KeyY"],
    ["x", "KeyX"],
    ["c", "KeyC"],
    ["v", "KeyV"],
    ["b", "KeyB"],
    ["n", "KeyN"],    
    ["m", "KeyM"],
    [",", "Comma"],
    [".", "Period"],
    ["/", "Slash"],
    

    ["ESC", "ESC"],
    ["GUI", "Space"],
    ["Low", "Space"],
    ["SPACE", "Enter"],
    ["ENTER", "Space"],
    ["Up", "Space"],
    ["ALT", "Backspace"],
],
    [
        null,
        ["Q", "KeyQ"],
        ["W", "KeyW"],
        ["E", "KeyE"],
        ["R", "KeyR"],
        ["T", "KeyT"],
        ["Z", "KeyY"],
        ["U", "KeyU"],
        ["I", "KeyI"],
        ["O", "KeyO"],
        ["P", "KeyP"],
        null,
        null,
        ["A", "KeyA"],
        ["S", "KeyS"],
        ["D", "KeyD"],
        ["F", "KeyF"],
        ["G", "KeyG"],
        ["H", "KeyH"],
        ["J", "KeyJ"],
        ["K", "KeyK"],
        ["L", "KeyL"],
        ["Ö", "KeyL"],
        null,
        null,
        ["Y", "KeyY"],
        ["X", "KeyX"],
        ["C", "KeyC"],
        ["V", "KeyV"],
        ["B", "KeyB"],
        ["N", "KeyM"],
        ["M", "KeyM"],        
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
    ]

];

const getCorneKeys = () => {
    const keysLayout = [
        { row: 0, col: 1},
        { row: 0, col: 2},
        { row: 0, col: 3},
        { row: 0, col: 4},
        { row: 0, col: 5},
        { row: 0, col: 6},
        { row: 0, col: 10},
        { row: 0, col: 11},
        { row: 0, col: 12},
        { row: 0, col: 13},
        { row: 0, col: 14},
        { row: 0, col: 15},

        { row: 1, col: 1},
        { row: 1, col: 2},
        { row: 1, col: 3},
        { row: 1, col: 4},
        { row: 1, col: 5},
        { row: 1, col: 6},
        { row: 1, col: 10},
        { row: 1, col: 11},
        { row: 1, col: 12},
        { row: 1, col: 13},
        { row: 1, col: 14},
        { row: 1, col: 15},

        { row: 2, col: 1},
        { row: 2, col: 2},
        { row: 2, col: 3},
        { row: 2, col: 4},
        { row: 2, col: 5},
        { row: 2, col: 6},
        { row: 2, col: 10},
        { row: 2, col: 11},
        { row: 2, col: 12},
        { row: 2, col: 13},
        { row: 2, col: 14},
        { row: 2, col: 15},

        { row: 3.2, col: 5, cls: "action"},
        { row: 3.2, col: 6, cls: "action"},
        { row: 3.2, col: 7, cls: "action"},
        { row: 3.2, col: 9, cls: "action"},
        { row: 3.2, col: 10, cls: "action"},
        { row: 3.2, col: 11, cls: "action"},
    ];

    const result = [];
    keysLayout.forEach((k, key) => {
        result.push({...k, label: corneLayers[0][key][0], code: corneLayers[0][key][1]});
    });

    return result;

}

const dactylLayers = [[
    ["ESC", "KeyQ"],
    ["1", "KeyQ"],
    ["2", "KeyW"],
    ["3", "KeyE"],
    ["4", "KeyR"],
    ["5", "KeyT"],
    ["6", "KeyY"],
    ["7", "KeyU"],
    ["8", "KeyI"],
    ["9", "KeyO"],
    ["0", "KeyP"],
    ["^", "KeyA"],

    ["TAB", "KeyQ"],
    ["q", "KeyQ"],
    ["w", "KeyW"],
    ["e", "KeyE"],
    ["r", "KeyR"],
    ["t", "KeyT"],
    ["y", "KeyY"],
    ["u", "KeyU"],
    ["i", "KeyI"],
    ["o", "KeyO"],
    ["p", "KeyP"],
    ["ß", "KeyA"],

    ["lang", "KeyA"],
    ["a", "KeyA"],
    ["s", "KeyS"],
    ["d", "KeyD"],
    ["f", "KeyF"],
    ["g", "KeyG"],
    ["h", "KeyH"],
    ["j", "KeyJ"],
    ["k", "KeyK"],
    ["l", "KeyL"],
    ["ö", "Semicolon"],
    ["ä", "Semicolon"],

    ["Shift", "KeyZ"],
    ["z", "KeyZ"],
    ["x", "KeyX"],
    ["c", "KeyC"],
    ["v", "KeyV"],
    ["b", "KeyB"],
    ["n", "KeyN"],
    ["m", "KeyM"],
    [",", "Comma"],
    [".", "Period"],
    ["/", "Slash"],
    ["Shift", "Slash"],

    ["Space", "Space"],
    ["Enter", "Enter"],
    ["Space", "Space"],
    ["Enter", "Enter"],

    ["Space", "Space"],
    ["Enter", "Enter"],
    ["Alt", "AltLeft"],
    ["Bksp", "Backspace"],
    ["Space", "Space"],
    ["Enter", "Enter"],
    ["Alt", "AltLeft"],
    ["Bksp", "Backspace"],
    ["Bksp", "Backspace"],
    ["Bksp", "Backspace"],
]];

const getDactylKeys = () => {
    const keysLayout = [
        { row: 0.2, col: 0, w: 1.5, cls: "action"},
        { row: 0.2, col: 1.5},
        { row: 0, col: 2.5},
        { row: 0, col: 3.5},
        { row: 0, col: 4.5},
        { row: 0, col: 5.5},
        { row: 0, col: 10.5},
        { row: 0, col: 11.5},
        { row: 0, col: 12.5},
        { row: 0, col: 13.5},
        { row: 0.2, col: 14.5},
        { row: 0.2, col: 15.5, w: 1.5, cls: "action"},

        { row: 1.2, col: 0, w: 1.5, cls: "action"},
        { row: 1.2, col: 1.5},
        { row: 1, col: 2.5},
        { row: 1, col: 3.5},
        { row: 1, col: 4.5},
        { row: 1, col: 5.5},
        { row: 1, col: 10.5},
        { row: 1, col: 11.5},
        { row: 1, col: 12.5},
        { row: 1, col: 13.5},
        { row: 1.2, col: 14.5},
        { row: 1.2, col: 15.5, w: 1.5, cls: "action"},

        { row: 2.2, col: 0, w: 1.5, cls: "action"},
        { row: 2.2, col: 1.5},
        { row: 2, col: 2.5},
        { row: 2, col: 3.5},
        { row: 2, col: 4.5},
        { row: 2, col: 5.5},
        { row: 2, col: 10.5},
        { row: 2, col: 11.5},
        { row: 2, col: 12.5},
        { row: 2, col: 13.5},
        { row: 2.2, col: 14.5},
        { row: 2.2, col: 15.5, w: 1.5, cls: "action"},

        { row: 3.2, col: 0, w: 1.5, cls: "action"},
        { row: 3.2, col: 1.5},
        { row: 3, col: 2.5},
        { row: 3, col: 3.5},
        { row: 3, col: 4.5},
        { row: 3, col: 5.5},
        { row: 3, col: 10.5},
        { row: 3, col: 11.5},
        { row: 3, col: 12.5},
        { row: 3, col: 13.5},
        { row: 3.2, col: 14.5},
        { row: 3.2, col: 15.5, w: 1.5, cls: "action"},


        { row: 4, col: 2.5},
        { row: 4, col: 3.5},

        { row: 4, col: 12.5},
        { row: 4, col: 13.5},


        { row: 4.5, col: 5, cls: "action"},
        { row: 4.5, col: 6, cls: "action"},
        { row: 4.5, col: 7, cls: "action"},

        { row: 4.5, col: 9, cls: "action"},
        { row: 4.5, col: 10, cls: "action"},
        { row: 4.5, col: 11, cls: "action"},

        { row: 5.5, col: 6, cls: "action"},
        { row: 5.5, col: 7, cls: "action"},

        { row: 5.5, col: 9, cls: "action"},
        { row: 5.5, col: 10, cls: "action"},

    ];

    const result = [];
    keysLayout.forEach((k, key) => {
        result.push({...k, label: dactylLayers[0][key][0], code: dactylLayers[0][key][1]});
    });

    return result;
}


const layouts = {
    qwerty: {
        name: "QWERTY",
        keySize: {w: 60, h: 63, gap: 5},
        keys: getQwertyKeys(),
    },
    corne: {
        name: "Corne (split)",
        keySize: {w: 57, h: 45, gap: 10},
        keys: getCorneKeys(),
    },
    dactyl: {
        name: "Dactyl Manuform (split)",
        keySize: {w: 57, h: 45, gap: 10},
        keys: getDactylKeys(),
    },
};

const layoutRoot = document.getElementById("layoutRoot");
//let currentLayoutKey = "corne";
//let currentLayoutKey = "dactyl";
let currentLayoutKey = "qwerty";

function applyKeySizes({w, h, gap}) {
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
    return {maxCol, maxRow};
}

function renderKeyboard(layout) {
    layoutRoot.innerHTML = "";

    applyKeySizes(layout.keySize);

    const {w, h, gap} = layout.keySize;
    const {maxCol, maxRow} = calcBounds(layout.keys);
    const widthPx = maxCol * (w + gap) + w;
    const heightPx = maxRow * (h + gap) + h;
    layoutRoot.style.width = `${widthPx + 44}px`;
    layoutRoot.style.height = `${heightPx + 44}px`;

    layout.keys.forEach((k, key) => {
        const el = document.createElement("div");
        el.className = `key ${k.cls || ""}`.trim();
        el.textContent = k.label;
        el.dataset.key = k.code;
        el.dataset.index = key;
        el.style.setProperty("--row", k.row);
        el.style.setProperty("--col", k.col);
        if (k.w) el.style.setProperty("--w", k.w);
        layoutRoot.appendChild(el);
    });
}

function shiftCorne() {
    const layout = layouts.corne;
    const layers = corneLayers;
    
    layout.keys.forEach((k, index) => {
        if (layers[1][index] === null ) return; 
        const el = document.querySelector(`.key[data-index="${index}"]`);
        const newKey = layers[1][index];
        el.textContent = newKey[0];
    })
}

function normalCorne() {
    const layout = layouts.corne;
    const layers = corneLayers;

    layout.keys.forEach((k, index) => {

        const el = document.querySelector(`.key[data-index="${index}"]`);
        const newKey = layers[0][index];
        el.textContent = newKey[0];
    })    
}

function handleKey(code, type) {
    const el = document.querySelector(`.key[data-key="${code}"]`);
    console.log(`Key ${code} ${type}`);
    if (!el) return;
    if (type === "down") {
        
        if (currentLayoutKey === "corne" && code === 'ShiftLeft') {
            // rerender labels and keycodes!!!
            shiftCorne();
        }
        
        el.classList.add("pressed");
    } else if (type === "up") {
        el.classList.remove("pressed");

        if (currentLayoutKey === "corne" && code === 'ShiftLeft') {
            // rerender labels and keycodes!!!
            normalCorne();
        }
    }
}

function setLayout(key) {
    const layout = layouts[key];
    if (!layout) return;
    currentLayoutKey = key;
    renderKeyboard(layout);
}

function setupWindowModeToggle(tauri) {
    const toggleButton = document.getElementById("windowless");
    if (!toggleButton || !tauri) return;

    let decorationsEnabled = true;
    let hideTimeoutId = null;
    const AUTO_HIDE_MS = 30_000;

    const updateLabel = () => {
        toggleButton.textContent = decorationsEnabled ? "windowless" : "windowed";
    };

    const clearHideTimer = () => {
        if (hideTimeoutId) {
            clearTimeout(hideTimeoutId);
            hideTimeoutId = null;
        }
    };

    const scheduleHideTimer = () => {
        clearHideTimer();
        hideTimeoutId = setTimeout(() => {
            if (!decorationsEnabled) return;
            setDecorations(false);
        }, AUTO_HIDE_MS);
    };

    const setDecorations = async (nextState) => {
        if (nextState === decorationsEnabled) {
            if (nextState) scheduleHideTimer();
            else clearHideTimer();
            return;
        }
        decorationsEnabled = nextState;
        try {
            await tauri.core.invoke("set_window_decorations", {
                decorations: decorationsEnabled,
            });
            if (decorationsEnabled) {
                scheduleHideTimer();
            } else {
                clearHideTimer();
            }
            updateLabel();
        } catch (err) {
            decorationsEnabled = !nextState;
            console.error("Failed to toggle window decorations:", err);
        }
    };

    const toggleDecorations = async () => {
        setDecorations(!decorationsEnabled);
    };

    toggleButton.addEventListener("click", (event) => {
        event.preventDefault();
        toggleDecorations();
    });

    updateLabel();
    scheduleHideTimer();
}

window.addEventListener("DOMContentLoaded", () => {
    const tauri = window.__TAURI__;
    if (tauri) {
        tauri.core
            .invoke("start_keyboard_listener")
            .catch((err) => console.error("Failed to start listener:", err));

        tauri.event
            .listen("key_event", (e) => {
                const {key, event_type} = e.payload;
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

        setupWindowModeToggle(tauri);
    } else {
        console.warn("Tauri global API (window.__TAURI__) is not available");
    }

    setLayout(currentLayoutKey);
});
