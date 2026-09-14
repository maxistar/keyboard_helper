import { createMiniGameRuntime, createMiniGameSession, createResultAccumulator } from "../mini_games/runtime.js";
import { createTargetMatcher, filterCompatibleTargets } from "../mini_games/targets.js";
import { SNAKE_CONFIG } from "./config.js";

export const SNAKE_DIRECTIONS = Object.freeze({
  ArrowUp: Object.freeze({ x: 0, y: -1 }),
  ArrowDown: Object.freeze({ x: 0, y: 1 }),
  ArrowLeft: Object.freeze({ x: -1, y: 0 }),
  ArrowRight: Object.freeze({ x: 1, y: 0 }),
});

export async function createSnakeGameFromSources({
  targetProvider = null,
  bundledTargets = SNAKE_CONFIG.targets,
  config = SNAKE_CONFIG,
  ...options
} = {}) {
  return createSnakeGame({
    ...options,
    targetProvider,
    bundledTargets,
    config: { ...config, targets: bundledTargets },
  });
}

function sameCell(left, right) {
  return Boolean(left && right && left.x === right.x && left.y === right.y);
}

export function createSnakeGame({
  config = SNAKE_CONFIG,
  random = Math.random,
  now,
  targetProvider = null,
  bundledTargets = config.targets,
} = {}) {
  let targets = filterCompatibleTargets(bundledTargets);
  const session = createMiniGameSession({ now });
  const results = createResultAccumulator({ session });
  const pointsPerFood = config.pointsPerFood ?? 10;
  let snake;
  let direction;
  let queuedDirection;
  let turnQueued;
  let food;
  let matcher;
  let targetIndex;
  let targetArmed;
  let feedback;

  function freeCells(body = snake) {
    const occupied = new Set(body.map(({ x, y }) => `${x},${y}`));
    const cells = [];
    for (let y = 0; y < config.rows; y += 1) {
      for (let x = 0; x < config.columns; x += 1) {
        if (!occupied.has(`${x},${y}`)) cells.push({ x, y });
      }
    }
    return cells;
  }

  function chooseFood() {
    const cells = freeCells();
    if (!cells.length) { food = null; return false; }
    const index = Math.min(cells.length - 1, Math.floor(Math.max(0, random()) * cells.length));
    food = cells[index];
    return true;
  }

  function initialSnake() {
    if (Array.isArray(config.initialSnake) && config.initialSnake.length) {
      return config.initialSnake.map(({ x, y }) => ({ x, y }));
    }
    return [{ x: Math.floor(config.columns / 2), y: Math.floor(config.rows / 2) }];
  }

  function resetGameState(nextTargets = targets) {
    targets = nextTargets;
    snake = initialSnake();
    direction = SNAKE_DIRECTIONS[config.initialDirection] ?? SNAKE_DIRECTIONS.ArrowRight;
    queuedDirection = direction;
    turnQueued = false;
    targetIndex = 0;
    targetArmed = false;
    matcher = createTargetMatcher(targets[targetIndex] ?? []);
    feedback = "Type the target to arm the food.";
    chooseFood();
  }

  const runtime = createMiniGameRuntime({
    session,
    results,
    targetProvider,
    bundledTargets,
    filterTargets: filterCompatibleTargets,
    prepareSession: (nextTargets) => nextTargets,
    commitSession: resetGameState,
  });

  function reset() {
    runtime.invalidatePending();
    results.reset();
    session.reset();
    resetGameState(filterCompatibleTargets(bundledTargets));
    return snapshot();
  }

  function snapshot() {
    const initialization = runtime.getInitializationState();
    return {
      ...session.getSnapshot(),
      ...initialization,
      columns: config.columns,
      rows: config.rows,
      tickMs: config.tickMs,
      snake: snake.map((cell) => ({ ...cell })),
      direction: { ...direction },
      queuedDirection: { ...queuedDirection },
      food: food && { ...food },
      target: matcher.target,
      targetProgress: matcher.progress,
      targetArmed,
      feedback: initialization.initializationError ?? feedback,
      ...results.snapshot(),
    };
  }

  function setDirection(key) {
    const next = SNAKE_DIRECTIONS[key];
    if (!next || turnQueued) return false;
    if (next.x === direction.x && next.y === direction.y) return false;
    const reverses = next.x === -direction.x && next.y === -direction.y;
    if (reverses && snake.length > 1) return false;
    queuedDirection = next;
    turnQueued = true;
    return true;
  }

  function input(token) {
    const phase = session.getSnapshot().phase;
    if (token === "Escape") {
      if (phase === "playing") session.pause();
      else if (phase === "paused") session.resume();
      return { control: true };
    }
    if (SNAKE_DIRECTIONS[token]) {
      if (phase !== "playing" && phase !== "paused") return { control: true, ignored: true };
      return { control: true, accepted: setDirection(token) };
    }
    if (phase !== "playing" || targetArmed) return { matched: false, ignored: true };
    const outcome = matcher.input(token);
    if (outcome.matched) {
      results.recordCorrect();
      feedback = outcome.complete ? "Food armed. Reach it to score." : "Correct. Keep typing.";
    } else {
      results.recordMistake();
      feedback = "Not quite. Your target progress is preserved.";
    }
    if (outcome.complete) targetArmed = true;
    return outcome;
  }

  function tick() {
    if (session.getSnapshot().phase !== "playing") return false;
    direction = queuedDirection;
    turnQueued = false;
    const head = {
      x: (snake[0].x + direction.x + config.columns) % config.columns,
      y: (snake[0].y + direction.y + config.rows) % config.rows,
    };
    const willEat = targetArmed && sameCell(head, food);
    const collisionBody = willEat ? snake : snake.slice(0, -1);
    if (collisionBody.some((cell) => sameCell(cell, head))) {
      feedback = "The snake crossed its own path. Run complete.";
      session.gameOver();
      return false;
    }
    snake.unshift(head);
    if (willEat) {
      results.recordFood({ score: pointsPerFood });
      targetIndex = (targetIndex + 1) % targets.length;
      matcher = createTargetMatcher(targets[targetIndex]);
      targetArmed = false;
      feedback = "Food collected. Type the new target.";
      if (!chooseFood()) {
        feedback = "Board cleared. Run complete.";
        session.finish();
      }
    } else {
      snake.pop();
    }
    return true;
  }

  function start() {
    if (session.getSnapshot().phase !== "ready") return Promise.resolve({ ok: false, ignored: true });
    return runtime.startNewSession();
  }

  function replay() {
    if (!["game-over", "finished"].includes(session.getSnapshot().phase)) {
      return Promise.resolve({ ok: false, ignored: true });
    }
    return runtime.startNewSession();
  }

  resetGameState(targets);
  return {
    reset,
    start,
    replay,
    pause: () => session.pause(),
    resume: () => session.resume(),
    input,
    tick,
    setDirection,
    getSnapshot: snapshot,
    cancelPendingSession: runtime.invalidatePending,
  };
}
