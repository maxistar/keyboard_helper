function setText(element, value) {
  const text = String(value);
  if (element && element.textContent !== text) element.textContent = text;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function describeFlappyState(snapshot) {
  if (snapshot.phase === "playing") return { label: "Flying", overlay: false, action: "" };
  if (snapshot.phase === "paused") {
    return { label: "Paused", overlay: true, title: "Flight paused", description: "Your run is safe. Resume when ready.", action: "Resume" };
  }
  if (snapshot.phase === "game-over") {
    const missed = snapshot.failureReason === "missed-gate";
    return {
      label: "Game over",
      overlay: true,
      title: missed ? "Target missed" : "Flight ended",
      description: missed ? "The active gate passed before its target was complete." : "The bird touched an obstacle or boundary.",
      action: "Fly again",
      results: true,
    };
  }
  return {
    label: "Ready",
    overlay: true,
    title: "Flappy Key-Bird",
    description: "Type each gate target in rhythm to flap through the opening.",
    action: "Start flight",
  };
}

export function createFlappyKeyBirdView(doc = globalThis.document) {
  const refs = {
    body: doc.body,
    stage: doc.getElementById("flappyStage"),
    gates: doc.getElementById("flappyGates"),
    bird: doc.getElementById("flappyBird"),
    status: doc.getElementById("flappyStatus"),
    targetLabel: doc.getElementById("flappyTargetLabel"),
    targetCompleted: doc.getElementById("flappyTargetCompleted"),
    targetRemaining: doc.getElementById("flappyTargetRemaining"),
    feedback: doc.getElementById("flappyFeedback"),
    score: doc.getElementById("flappyScore"),
    gateCount: doc.getElementById("flappyGateCount"),
    mistakes: doc.getElementById("flappyMistakes"),
    misses: doc.getElementById("flappyMisses"),
    streak: doc.getElementById("flappyStreak"),
    multiplier: doc.getElementById("flappyMultiplier"),
    duration: doc.getElementById("flappyDuration"),
    pause: doc.getElementById("flappyPause"),
    overlay: doc.getElementById("flappyOverlay"),
    overlayTitle: doc.getElementById("flappyOverlayTitle"),
    overlayDescription: doc.getElementById("flappyOverlayDescription"),
    rules: doc.getElementById("flappyRules"),
    primaryAction: doc.getElementById("flappyPrimaryAction"),
    results: doc.getElementById("flappyFinalResults"),
    finalScore: doc.getElementById("flappyFinalScore"),
    finalGates: doc.getElementById("flappyFinalGates"),
    finalCorrect: doc.getElementById("flappyFinalCorrect"),
    finalMistakes: doc.getElementById("flappyFinalMistakes"),
    finalMisses: doc.getElementById("flappyFinalMisses"),
    finalAccuracy: doc.getElementById("flappyFinalAccuracy"),
    finalStreak: doc.getElementById("flappyFinalStreak"),
    finalDuration: doc.getElementById("flappyFinalDuration"),
  };
  let primaryActionHandler = () => {};
  let pauseHandler = () => {};
  let previousPhase = null;
  refs.primaryAction.addEventListener("click", () => primaryActionHandler());
  refs.pause.addEventListener("click", () => pauseHandler());

  function renderScene(snapshot) {
    const xPercent = snapshot.bird.x / snapshot.width * 100;
    const yPercent = snapshot.bird.y / snapshot.height * 100;
    refs.bird.style.left = `${xPercent}%`;
    refs.bird.style.top = `${yPercent}%`;
    refs.gates.innerHTML = "";
    snapshot.gates.forEach((gate) => {
      const wrapper = doc.createElement("div");
      wrapper.className = `flappy-gate${gate.cleared ? " cleared" : ""}${gate.id === snapshot.activeGateId ? " active" : ""}`;
      wrapper.style.left = `${gate.x / snapshot.width * 100}%`;
      wrapper.style.width = `${gate.width / snapshot.width * 100}%`;
      wrapper.setAttribute("aria-hidden", "true");
      const gapTop = (gate.gapCenter - gate.gap / 2) / snapshot.height * 100;
      const gapBottom = (gate.gapCenter + gate.gap / 2) / snapshot.height * 100;
      const top = doc.createElement("span");
      top.className = "flappy-pipe flappy-pipe-top";
      top.style.height = `${Math.max(0, gapTop)}%`;
      const bottom = doc.createElement("span");
      bottom.className = "flappy-pipe flappy-pipe-bottom";
      bottom.style.top = `${Math.min(100, gapBottom)}%`;
      const label = doc.createElement("span");
      label.className = "flappy-gate-target";
      label.style.top = `${gate.gapCenter / snapshot.height * 100}%`;
      label.textContent = gate.target.join("");
      wrapper.append(top, bottom, label);
      refs.gates.appendChild(wrapper);
    });
    const target = snapshot.target ?? [];
    const targetKind = snapshot.repeatingTarget ? "Repeat target" : "Active target";
    refs.stage.setAttribute(
      "aria-label",
      `Flappy field. Bird height ${Math.round(snapshot.height - snapshot.bird.y)}. ${target.length ? `${targetKind} ${target.join("")}, ${snapshot.targetProgress} of ${target.length} complete.` : "Waiting for the next gate target."}`,
    );
  }

  function render(snapshot) {
    const presentation = describeFlappyState(snapshot);
    const enteredGameOver = snapshot.phase === "game-over" && previousPhase !== "game-over";
    refs.body.dataset.gamePhase = snapshot.phase;
    renderScene(snapshot);
    setText(refs.status, presentation.label);
    setText(refs.targetLabel, snapshot.repeatingTarget ? "Repeat target" : "Active gate");
    setText(refs.targetCompleted, snapshot.target.slice(0, snapshot.targetProgress).join(""));
    setText(refs.targetRemaining, snapshot.target.slice(snapshot.targetProgress).join(""));
    setText(refs.feedback, snapshot.feedback);
    setText(refs.score, snapshot.score);
    setText(refs.gateCount, snapshot.clearedGates);
    setText(refs.mistakes, snapshot.mistakes);
    setText(refs.misses, snapshot.misses);
    setText(refs.streak, snapshot.streak);
    setText(refs.multiplier, `×${snapshot.multiplier}`);
    setText(refs.duration, formatDuration(snapshot.activeDurationMs));
    refs.pause.disabled = !["playing", "paused"].includes(snapshot.phase);
    setText(refs.pause, snapshot.phase === "paused" ? "Resume" : "Pause");

    refs.overlay.hidden = !presentation.overlay;
    refs.overlay.classList.toggle("visible", presentation.overlay);
    if (presentation.overlay) {
      setText(refs.overlayTitle, presentation.title);
      setText(refs.overlayDescription, presentation.description);
      setText(refs.primaryAction, snapshot.initializing ? "Starting…" : presentation.action);
      refs.primaryAction.disabled = Boolean(snapshot.initializing);
      refs.rules.hidden = snapshot.phase !== "ready";
      refs.results.hidden = !presentation.results;
    } else {
      refs.primaryAction.disabled = false;
    }
    if (presentation.results) {
      setText(refs.finalScore, snapshot.score);
      setText(refs.finalGates, snapshot.clearedGates);
      setText(refs.finalCorrect, snapshot.correct);
      setText(refs.finalMistakes, snapshot.mistakes);
      setText(refs.finalMisses, snapshot.misses);
      setText(refs.finalAccuracy, `${Math.round(snapshot.accuracy * 100)}%`);
      setText(refs.finalStreak, snapshot.bestStreak);
      setText(refs.finalDuration, formatDuration(snapshot.activeDurationMs));
    }
    if (enteredGameOver) refs.primaryAction.focus({ preventScroll: true });
    previousPhase = snapshot.phase;
  }

  return {
    render,
    setPrimaryActionHandler(handler) { primaryActionHandler = handler; },
    setPauseHandler(handler) { pauseHandler = handler; },
  };
}
