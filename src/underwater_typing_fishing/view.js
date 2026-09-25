function setText(element, value) {
  const text = String(value);
  if (element && element.textContent !== text) element.textContent = text;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function describeFishingState(snapshot) {
  if (snapshot.phase === "playing") return { label: "Fishing", overlay: false, action: "" };
  if (snapshot.phase === "paused") {
    return { label: "Paused", overlay: true, title: "Dive paused", description: "Your hooked fish and typed progress are safe.", action: "Resume" };
  }
  if (snapshot.phase === "finished") {
    const early = snapshot.completionReason === "early-finished";
    return {
      label: early ? "Dive ended" : "Catch complete",
      overlay: true,
      title: early ? "Back to the surface" : "A brilliant catch!",
      description: early ? "Here is what you caught during this dive." : "You reached the Zen catch quota.",
      action: "Fish again",
      results: true,
    };
  }
  if (snapshot.initializationError) {
    return { label: "Unavailable", overlay: true, title: "The reef is quiet", description: snapshot.initializationError, action: "Try again" };
  }
  return {
    label: "Ready",
    overlay: true,
    title: "Underwater Typing Fishing",
    description: "Choose a fish by typing its first letter, then finish the word to reel it in.",
    action: "Start fishing",
  };
}

export function createFishingView(doc = globalThis.document) {
  const refs = {
    body: doc.body,
    stage: doc.getElementById("fishingStage"),
    fishLayer: doc.getElementById("fishingFishLayer"),
    status: doc.getElementById("fishingStatus"),
    targetLabel: doc.getElementById("fishingTargetLabel"),
    targetCompleted: doc.getElementById("fishingTargetCompleted"),
    targetRemaining: doc.getElementById("fishingTargetRemaining"),
    visibleTargets: doc.getElementById("fishingVisibleTargets"),
    feedback: doc.getElementById("fishingFeedback"),
    score: doc.getElementById("fishingScore"),
    caught: doc.getElementById("fishingCaught"),
    quota: doc.getElementById("fishingQuota"),
    mistakes: doc.getElementById("fishingMistakes"),
    accuracy: doc.getElementById("fishingAccuracy"),
    wpm: doc.getElementById("fishingWpm"),
    streak: doc.getElementById("fishingStreak"),
    multiplier: doc.getElementById("fishingMultiplier"),
    duration: doc.getElementById("fishingDuration"),
    pause: doc.getElementById("fishingPause"),
    end: doc.getElementById("fishingEnd"),
    overlay: doc.getElementById("fishingOverlay"),
    overlayTitle: doc.getElementById("fishingOverlayTitle"),
    overlayDescription: doc.getElementById("fishingOverlayDescription"),
    rules: doc.getElementById("fishingRules"),
    primaryAction: doc.getElementById("fishingPrimaryAction"),
    results: doc.getElementById("fishingFinalResults"),
    finalScore: doc.getElementById("fishingFinalScore"),
    finalCaught: doc.getElementById("fishingFinalCaught"),
    finalCorrect: doc.getElementById("fishingFinalCorrect"),
    finalMistakes: doc.getElementById("fishingFinalMistakes"),
    finalAccuracy: doc.getElementById("fishingFinalAccuracy"),
    finalWpm: doc.getElementById("fishingFinalWpm"),
    finalStreak: doc.getElementById("fishingFinalStreak"),
    finalDuration: doc.getElementById("fishingFinalDuration"),
  };
  let primaryActionHandler = () => {};
  let pauseHandler = () => {};
  let endSessionHandler = () => {};
  let previousPhase = null;
  refs.primaryAction.addEventListener("click", () => primaryActionHandler());
  refs.pause.addEventListener("click", () => pauseHandler());
  refs.end.addEventListener("click", () => endSessionHandler());

  function renderFish(snapshot) {
    refs.fishLayer.innerHTML = "";
    snapshot.fish.forEach((fish, index) => {
      const node = doc.createElement("div");
      const eventType = snapshot.lastEvent?.fishId === fish.id ? snapshot.lastEvent.type : "";
      node.className = `fishing-fish${fish.hooked ? " hooked" : ""}${eventType ? ` event-${eventType}` : ""}`;
      node.style.top = `${14 + fish.lane * (68 / Math.max(1, snapshot.visibleFishLimit - 1))}%`;
      node.style.left = `${14 + ((fish.id * 23 + index * 11) % 65)}%`;
      node.style.setProperty?.("--swim-delay", `${-(fish.id % 7)}s`);
      node.setAttribute("aria-hidden", "true");

      const shape = doc.createElement("span");
      shape.className = "fishing-fish-shape";
      const eye = doc.createElement("span");
      eye.className = "fishing-fish-eye";
      shape.appendChild(eye);

      const label = doc.createElement("span");
      label.className = "fishing-fish-label";
      const completed = doc.createElement("span");
      completed.className = "fishing-fish-completed";
      completed.textContent = fish.target.slice(0, fish.progress).join("");
      const remaining = doc.createElement("span");
      remaining.textContent = fish.target.slice(fish.progress).join("");
      label.append(completed, remaining);
      node.append(shape, label);
      refs.fishLayer.appendChild(node);
    });

    const labels = snapshot.fish.map((fish) => fish.target.join(""));
    const hooked = snapshot.fish.find((fish) => fish.hooked);
    setText(refs.visibleTargets, labels.length ? `Visible fish: ${labels.join(", ")}.` : "No visible fish.");
    refs.stage.setAttribute(
      "aria-label",
      hooked
        ? `Underwater fishing scene. Hooked target ${hooked.target.join("")}, ${hooked.progress} of ${hooked.target.length} complete. Visible targets: ${labels.join(", ")}.`
        : `Underwater fishing scene. Choose one of these targets: ${labels.join(", ") || "none"}.`,
    );
  }

  function render(snapshot) {
    const presentation = describeFishingState(snapshot);
    const enteredFinished = snapshot.phase === "finished" && previousPhase !== "finished";
    const hooked = snapshot.fish.find((entry) => entry.hooked);
    const target = hooked?.target ?? [];
    const progress = hooked?.progress ?? 0;

    refs.body.dataset.gamePhase = snapshot.phase;
    refs.stage.dataset.event = snapshot.lastEvent?.type ?? "";
    renderFish(snapshot);
    setText(refs.status, presentation.label);
    setText(refs.targetLabel, hooked ? "Hooked fish" : "Choose a fish");
    setText(refs.targetCompleted, target.slice(0, progress).join(""));
    setText(refs.targetRemaining, target.slice(progress).join("") || (hooked ? "" : "—"));
    setText(refs.feedback, snapshot.feedback);
    setText(refs.score, snapshot.score);
    setText(refs.caught, snapshot.caughtFish);
    setText(refs.quota, snapshot.catchQuota);
    setText(refs.mistakes, snapshot.mistakes);
    setText(refs.accuracy, `${Math.round(snapshot.accuracy * 100)}%`);
    setText(refs.wpm, Math.round(snapshot.wpm));
    setText(refs.streak, snapshot.streak);
    setText(refs.multiplier, `×${snapshot.multiplier}`);
    setText(refs.duration, formatDuration(snapshot.activeDurationMs));

    const sessionActive = ["playing", "paused"].includes(snapshot.phase);
    refs.pause.disabled = !sessionActive;
    refs.end.disabled = !sessionActive;
    setText(refs.pause, snapshot.phase === "paused" ? "Resume" : "Pause");

    refs.overlay.hidden = !presentation.overlay;
    refs.overlay.classList.toggle("visible", presentation.overlay);
    if (presentation.overlay) {
      setText(refs.overlayTitle, presentation.title);
      setText(refs.overlayDescription, presentation.description);
      setText(refs.primaryAction, snapshot.initializing ? "Finding fish…" : presentation.action);
      refs.primaryAction.disabled = Boolean(snapshot.initializing);
      refs.rules.hidden = snapshot.phase !== "ready" || Boolean(snapshot.initializationError);
      refs.results.hidden = !presentation.results;
    } else {
      refs.primaryAction.disabled = false;
    }

    if (presentation.results) {
      setText(refs.finalScore, snapshot.score);
      setText(refs.finalCaught, snapshot.caughtFish);
      setText(refs.finalCorrect, snapshot.correct);
      setText(refs.finalMistakes, snapshot.mistakes);
      setText(refs.finalAccuracy, `${Math.round(snapshot.accuracy * 100)}%`);
      setText(refs.finalWpm, Math.round(snapshot.wpm));
      setText(refs.finalStreak, snapshot.bestStreak);
      setText(refs.finalDuration, formatDuration(snapshot.activeDurationMs));
    }
    if (enteredFinished) refs.primaryAction.focus({ preventScroll: true });
    previousPhase = snapshot.phase;
  }

  return {
    render,
    setPrimaryActionHandler(handler) { primaryActionHandler = handler; },
    setPauseHandler(handler) { pauseHandler = handler; },
    setEndSessionHandler(handler) { endSessionHandler = handler; },
  };
}
