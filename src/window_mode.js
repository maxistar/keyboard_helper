(function () {
    const AUTO_HIDE_MS = 30_000;

    function setupWindowModeToggle(tauri) {
        if (!tauri) return;

        let decorationsEnabled = true;
        let displayMode = "full";
        let hideTimeoutId = null;

        const clearHideTimer = () => {
            if (hideTimeoutId) {
                clearTimeout(hideTimeoutId);
                hideTimeoutId = null;
            }
        };

        const scheduleHideTimer = () => {
            clearHideTimer();
            if (displayMode !== "full") return;
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
                document.body.classList.toggle("windowed", decorationsEnabled);
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
            if (displayMode !== "full") return;
            if (decorationsEnabled) return;
            setDecorations(true);
        });

        const setDisplayMode = (nextMode, geometry = null) => {
            displayMode = nextMode === "mini" || nextMode === "entering-mini"
                || nextMode === "restoring-full"
                ? nextMode
                : "full";
            if (displayMode !== "full") {
                decorationsEnabled = false;
                document.body.classList.remove("windowed");
                clearHideTimer();
                return;
            }

            decorationsEnabled = geometry?.decorations !== false;
            document.body.classList.toggle("windowed", decorationsEnabled);
            if (decorationsEnabled) scheduleHideTimer();
            else clearHideTimer();
        };

        document.body.classList.add("windowed");
        scheduleHideTimer();
        return { setDisplayMode };
    }

    window.setupWindowModeToggle = setupWindowModeToggle;
})();
