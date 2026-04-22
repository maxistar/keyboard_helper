(function () {
    const AUTO_HIDE_MS = 30_000;

    function setupWindowModeToggle(tauri) {
        if (!tauri) return;

        let decorationsEnabled = true;
        let hideTimeoutId = null;

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
            } catch (err) {
                decorationsEnabled = !nextState;
                console.error("Failed to toggle window decorations:", err);
            }
        };

        document.addEventListener("click", () => {
            if (decorationsEnabled) return;
            setDecorations(true);
        });

        scheduleHideTimer();
    }

    window.setupWindowModeToggle = setupWindowModeToggle;
})();
