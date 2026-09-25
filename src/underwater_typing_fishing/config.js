export const FISHING_CONFIG_LIMITS = Object.freeze({
  visibleFish: Object.freeze({ minimum: 1, maximum: 8 }),
  catchQuota: Object.freeze({ minimum: 1, maximum: 100 }),
  maximumTargetTokens: Object.freeze({ minimum: 1, maximum: 24 }),
  pointsPerToken: Object.freeze({ minimum: 1, maximum: 1000 }),
  catchesPerMultiplier: Object.freeze({ minimum: 1, maximum: 20 }),
  maximumMultiplier: Object.freeze({ minimum: 1, maximum: 10 }),
});

export const FISHING_TARGETS = Object.freeze([
  "anchor", "bubble", "coral", "dolphin", "eel", "fin", "goby", "harbor",
  "island", "jelly", "kelp", "lagoon", "marlin", "nautilus", "ocean", "pearl",
  "quay", "reef", "shell", "turtle", "urchin", "vessel", "whale", "yacht", "zander",
]);

function integerInRange(value, fallback, range) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(range.maximum, Math.max(range.minimum, Math.trunc(value)));
}

export function normalizeFishingConfig(config = {}) {
  const defaults = {
    visibleFish: 5,
    catchQuota: 12,
    maximumTargetTokens: 12,
    pointsPerToken: 10,
    catchesPerMultiplier: 3,
    maximumMultiplier: 4,
    renderIntervalMs: 250,
  };
  return {
    ...config,
    visibleFish: integerInRange(config.visibleFish, defaults.visibleFish, FISHING_CONFIG_LIMITS.visibleFish),
    catchQuota: integerInRange(config.catchQuota, defaults.catchQuota, FISHING_CONFIG_LIMITS.catchQuota),
    maximumTargetTokens: integerInRange(config.maximumTargetTokens, defaults.maximumTargetTokens, FISHING_CONFIG_LIMITS.maximumTargetTokens),
    pointsPerToken: integerInRange(config.pointsPerToken, defaults.pointsPerToken, FISHING_CONFIG_LIMITS.pointsPerToken),
    catchesPerMultiplier: integerInRange(config.catchesPerMultiplier, defaults.catchesPerMultiplier, FISHING_CONFIG_LIMITS.catchesPerMultiplier),
    maximumMultiplier: integerInRange(config.maximumMultiplier, defaults.maximumMultiplier, FISHING_CONFIG_LIMITS.maximumMultiplier),
    renderIntervalMs: integerInRange(config.renderIntervalMs, defaults.renderIntervalMs, { minimum: 100, maximum: 1000 }),
    targets: Array.isArray(config.targets) ? config.targets : FISHING_TARGETS,
  };
}

export const FISHING_CONFIG = Object.freeze(normalizeFishingConfig({ targets: FISHING_TARGETS }));
