export const SNAKE_TARGETS = Object.freeze(["a", "s", "d", "f", "j", "k", "l", ";"]);
export const SNAKE_CONFIG = Object.freeze({
  columns: 18,
  rows: 12,
  tickMs: 900,
  pointsPerFood: 10,
  difficulty: "beginner",
  targets: SNAKE_TARGETS,
});
