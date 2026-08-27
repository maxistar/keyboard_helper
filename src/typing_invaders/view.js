function paddedNumber(value, width) {
  return String(Math.max(0, Math.floor(value))).padStart(width, "0");
}

export function describeOverlay(snapshot) {
  switch (snapshot.phase) {
    case "playing":
      return { visible: false, action: null, results: false };
    case "paused":
      return {
        visible: true,
        kicker: "Systems on hold",
        title: "Paused",
        description: "The fleet is frozen until you are ready.",
        action: "Resume mission",
        hint: "Press Esc or use the button to continue.",
        results: false,
      };
    case "wave-transition":
      return {
        visible: true,
        kicker: "Sector secured",
        title: `Wave ${snapshot.wave} cleared`,
        description: "Next formation incoming…",
        action: null,
        hint: "Keep your hands on the home row.",
        results: false,
      };
    case "game-over":
      return {
        visible: true,
        kicker: "Defense grid breached",
        title: "Mission over",
        description: "The fleet got through. Your run is recorded below.",
        action: "Play again",
        hint: "Every replay starts fresh at wave one.",
        results: true,
      };
    default:
      return {
        visible: true,
        kicker: "Incoming transmission",
        title: "Shift-Space Invaders",
        description: "Type the words. Stop the descent.",
        action: "Start mission",
        hint: "Type any visible word. Esc pauses.",
        results: false,
      };
  }
}

export function splitWord(word, progress) {
  return {
    completed: word.slice(0, progress),
    remaining: word.slice(progress),
  };
}

export function createTypingInvadersView(doc = document) {
  const refs = {
    body: doc.body,
    score: doc.getElementById("scoreValue"),
    wave: doc.getElementById("waveValue"),
    lives: doc.getElementById("livesValue"),
    streak: doc.getElementById("streakValue"),
    accuracy: doc.getElementById("accuracyValue"),
    wpm: doc.getElementById("wpmValue"),
    targets: doc.getElementById("targetLayer"),
    effects: doc.getElementById("effectLayer"),
    overlay: doc.getElementById("stateOverlay"),
    kicker: doc.getElementById("stateKicker"),
    title: doc.getElementById("stateTitle"),
    description: doc.getElementById("stateDescription"),
    action: doc.getElementById("stateAction"),
    hint: doc.getElementById("stateHint"),
    results: doc.getElementById("resultGrid"),
    resultScore: doc.getElementById("resultScore"),
    resultWave: doc.getElementById("resultWave"),
    resultTargets: doc.getElementById("resultTargets"),
    resultAccuracy: doc.getElementById("resultAccuracy"),
    resultWpm: doc.getElementById("resultWpm"),
    announcement: doc.getElementById("gameAnnouncement"),
  };
  const targetElements = new Map();
  let actionHandler = () => {};

  refs.action.addEventListener("click", () => actionHandler());

  function createTargetElement(target) {
    const element = doc.createElement("article");
    element.className = "alien-target";
    element.dataset.targetId = String(target.id);
    element.setAttribute("aria-label", `Target word ${target.word}`);
    const alien = doc.createElement("div");
    alien.className = "alien-shape";
    alien.setAttribute("aria-hidden", "true");
    alien.innerHTML = '<span class="alien-eye"></span><span class="alien-eye"></span><span class="alien-leg"></span><span class="alien-leg"></span>';
    const word = doc.createElement("div");
    word.className = "target-word";
    const completed = doc.createElement("span");
    completed.className = "word-completed";
    const remaining = doc.createElement("span");
    remaining.className = "word-remaining";
    word.append(completed, remaining);
    element.append(alien, word);
    refs.targets.appendChild(element);
    targetElements.set(target.id, element);
    return element;
  }

  function renderTargets(snapshot) {
    const liveIds = new Set(snapshot.targets.map((target) => target.id));
    targetElements.forEach((element, id) => {
      if (!liveIds.has(id)) {
        element.remove();
        targetElements.delete(id);
      }
    });

    snapshot.targets.forEach((target) => {
      const element = targetElements.get(target.id) ?? createTargetElement(target);
      const segments = splitWord(target.word, target.progress);
      element.querySelector(".word-completed").textContent = segments.completed;
      element.querySelector(".word-remaining").textContent = segments.remaining;
      element.style.setProperty("--target-x", `${target.x * 100}%`);
      element.style.setProperty("--target-y", `${target.y * 100}%`);
      element.classList.toggle("locked", target.id === snapshot.lockedTargetId);
    });
  }

  function addEffect(event) {
    const effect = doc.createElement("span");
    effect.className = `game-effect effect-${event.type}`;
    const target = targetElements.get(event.targetId);
    if (target) {
      effect.style.left = target.style.getPropertyValue("--target-x");
      effect.style.top = target.style.getPropertyValue("--target-y");
    } else if (typeof event.x === "number" && typeof event.y === "number") {
      effect.style.left = `${event.x * 100}%`;
      effect.style.top = `${event.y * 100}%`;
    }
    refs.effects.appendChild(effect);
    effect.addEventListener("animationend", () => effect.remove(), { once: true });
  }

  function renderEvents(events) {
    for (const event of events) {
      if (["hit", "mistake", "target-destroyed", "target-impact"].includes(event.type)) {
        addEffect(event);
      }
      if (event.type === "target-destroyed") refs.announcement.textContent = `${event.word} destroyed`;
      if (event.type === "target-impact") refs.announcement.textContent = "Defense grid hit";
      if (event.type === "wave-started") refs.announcement.textContent = `Wave ${event.wave}`;
    }
  }

  function renderOverlay(snapshot) {
    const overlay = describeOverlay(snapshot);
    refs.overlay.hidden = !overlay.visible;
    refs.overlay.classList.toggle("visible", overlay.visible);
    if (!overlay.visible) return;
    refs.kicker.textContent = overlay.kicker;
    refs.title.textContent = overlay.title;
    refs.description.textContent = overlay.description;
    refs.hint.textContent = overlay.hint;
    refs.action.hidden = !overlay.action;
    refs.action.textContent = overlay.action ?? "";
    refs.results.hidden = !overlay.results;
    if (overlay.results) {
      refs.resultScore.textContent = paddedNumber(snapshot.score, 6);
      refs.resultWave.textContent = String(snapshot.highestWave);
      refs.resultTargets.textContent = String(snapshot.destroyedTargets);
      refs.resultAccuracy.textContent = `${Math.round(snapshot.accuracy)}%`;
      refs.resultWpm.textContent = String(Math.round(snapshot.wpm));
    }
  }

  function render(snapshot, events = []) {
    refs.body.dataset.gamePhase = snapshot.phase;
    refs.score.textContent = paddedNumber(snapshot.score, 6);
    refs.wave.textContent = paddedNumber(snapshot.wave, 2);
    refs.lives.textContent = Array.from({ length: snapshot.lives }, () => "◆").join(" ") || "—";
    refs.lives.setAttribute("aria-label", `${snapshot.lives} lives`);
    refs.streak.textContent = `x${snapshot.multiplier}`;
    refs.accuracy.textContent = `Accuracy ${Math.round(snapshot.accuracy)}%`;
    refs.wpm.textContent = `${Math.round(snapshot.wpm)} WPM`;
    renderTargets(snapshot);
    renderEvents(events);
    renderOverlay(snapshot);
  }

  return {
    render,
    setActionHandler(handler) {
      actionHandler = handler;
    },
  };
}
