(function () {
    const AUTO_HIDE_MS = 30_000;

    function setupWindowModeToggle(tauri) {
        const toggleButton = document.getElementById("windowless");
        if (!toggleButton || !tauri) return;

        let decorationsEnabled = true;
        let hideTimeoutId = null;

        const updateLabel = () => {
            toggleButton.dataset.state = decorationsEnabled ? "windowed" : "windowless";
            toggleButton.title = decorationsEnabled
                ? "Windowed (click to hide chrome)"
                : "Windowless (click to show chrome)";
            toggleButton.textContent = "";
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

        const toggleDecorations = () => {
            setDecorations(!decorationsEnabled);
        };

        toggleButton.addEventListener("click", (event) => {
            event.preventDefault();
            toggleDecorations();
        });

        updateLabel();
        scheduleHideTimer();
    }

    window.setupWindowModeToggle = setupWindowModeToggle;
})();
