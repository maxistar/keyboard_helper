function setText(element, value) {
  const text = String(value);
  if (element && element.textContent !== text) element.textContent = text;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function describeSnakeState(snapshot) {
  switch (snapshot.phase) {
    case "playing":
      return { label: "Playing", overlay: false, action: "" };
    case "paused":
      return { label: "Paused", overlay: true, title: "Game paused", description: "Your run is safe. Resume when ready.", action: "Resume" };
    case "game-over":
      return { label: "Game over", overlay: true, title: "Path crossed", description: "The snake ran into its own body.", action: "Play again", results: true };
    case "finished":
      return { label: "Complete", overlay: true, title: "Board cleared", description: "You filled the board.", action: "Play again", results: true };
    default:
      return { label: "Ready", overlay: true, title: "Keyboard Snake", description: "Steer with arrows and type the target to arm food.", action: "Start game" };
  }
}

export function createKeyboardSnakeView(doc = globalThis.document) {
  const refs = {
    body: doc.body,
    board: doc.getElementById("snakeBoard"),
    status: doc.getElementById("snakeStatus"),
    targetCompleted: doc.getElementById("snakeTargetCompleted"),
    targetRemaining: doc.getElementById("snakeTargetRemaining"),
    feedback: doc.getElementById("snakeFeedback"),
    score: doc.getElementById("snakeScore"),
    mistakes: doc.getElementById("snakeMistakes"),
    accuracy: doc.getElementById("snakeAccuracy"),
    foodCount: doc.getElementById("snakeFoodCount"),
    duration: doc.getElementById("snakeDuration"),
    pause: doc.getElementById("snakePause"),
    overlay: doc.getElementById("snakeOverlay"),
    overlayTitle: doc.getElementById("snakeOverlayTitle"),
    overlayDescription: doc.getElementById("snakeOverlayDescription"),
    rules: doc.getElementById("snakeRules"),
    primaryAction: doc.getElementById("snakePrimaryAction"),
    results: doc.getElementById("snakeFinalResults"),
    finalScore: doc.getElementById("snakeFinalScore"),
    finalFood: doc.getElementById("snakeFinalFood"),
    finalCorrect: doc.getElementById("snakeFinalCorrect"),
    finalMistakes: doc.getElementById("snakeFinalMistakes"),
    finalAccuracy: doc.getElementById("snakeFinalAccuracy"),
    finalDuration: doc.getElementById("snakeFinalDuration"),
  };
  let primaryActionHandler = () => {};
  let pauseHandler = () => {};
  refs.primaryAction.addEventListener("click", () => primaryActionHandler());
  refs.pause.addEventListener("click", () => pauseHandler());

  function renderBoard(snapshot) {
    refs.board.innerHTML = "";
    refs.board.style.setProperty("--snake-columns", snapshot.columns);
    refs.board.style.setProperty("--snake-rows", snapshot.rows);
    snapshot.snake.forEach((cell, index) => {
      const node = doc.createElement("span");
      node.className = `snake-cell snake-body${index === 0 ? " snake-head" : ""}`;
      node.style.gridColumn = cell.x + 1;
      node.style.gridRow = cell.y + 1;
      node.setAttribute("aria-hidden", "true");
      refs.board.appendChild(node);
    });
    if (snapshot.food) {
      const node = doc.createElement("span");
      node.className = `snake-cell ${snapshot.targetArmed ? "snake-food-armed" : "snake-food"}`;
      node.style.gridColumn = snapshot.food.x + 1;
      node.style.gridRow = snapshot.food.y + 1;
      node.setAttribute("aria-hidden", "true");
      refs.board.appendChild(node);
    }
    const head = snapshot.snake[0];
    refs.board.setAttribute("aria-label", `Wrapping Snake board. Head column ${head.x + 1}, row ${head.y + 1}. Food ${snapshot.targetArmed ? "armed" : "not armed"}.`);
  }

  function render(snapshot) {
    const presentation = describeSnakeState(snapshot);
    refs.body.dataset.gamePhase = snapshot.phase;
    renderBoard(snapshot);
    setText(refs.status, presentation.label);
    setText(refs.targetCompleted, snapshot.target.slice(0, snapshot.targetProgress).join(""));
    setText(refs.targetRemaining, snapshot.target.slice(snapshot.targetProgress).join(""));
    setText(refs.feedback, snapshot.feedback);
    setText(refs.score, snapshot.score);
    setText(refs.mistakes, snapshot.mistakes);
    setText(refs.accuracy, `${Math.round(snapshot.accuracy * 100)}%`);
    setText(refs.foodCount, snapshot.consumedFood);
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
    }
    if (!presentation.overlay) refs.primaryAction.disabled = false;
    if (presentation.results) {
      setText(refs.finalScore, snapshot.score);
      setText(refs.finalFood, snapshot.consumedFood);
      setText(refs.finalCorrect, snapshot.correct);
      setText(refs.finalMistakes, snapshot.mistakes);
      setText(refs.finalAccuracy, `${Math.round(snapshot.accuracy * 100)}%`);
      setText(refs.finalDuration, formatDuration(snapshot.activeDurationMs));
    }
  }

  return {
    render,
    setPrimaryActionHandler(handler) { primaryActionHandler = handler; },
    setPauseHandler(handler) { pauseHandler = handler; },
  };
}
