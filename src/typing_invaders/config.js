export const WORD_TIERS = Object.freeze([
  Object.freeze([
    "ace", "bad", "cat", "dog", "elm", "fun", "gap", "hit", "ink", "jet",
    "key", "log", "map", "net", "orb", "pod", "run", "sun", "van", "web",
  ]),
  Object.freeze([
    "atom", "beam", "code", "drift", "echo", "flux", "game", "hover", "icon", "jump",
    "laser", "moon", "nova", "orbit", "pixel", "quest", "rocket", "star", "type", "warp",
  ]),
  Object.freeze([
    "alien", "blast", "comet", "dodge", "energy", "fleet", "galaxy", "hyper", "impact", "launch",
    "meteor", "nebula", "plasma", "quasar", "radar", "shield", "thruster", "vector", "weapon", "zenith",
  ]),
  Object.freeze([
    "asteroid", "battery", "cosmos", "defender", "eclipse", "fighter", "gravity", "horizon", "invasion", "keyboard",
    "mission", "navigate", "overdrive", "quantum", "reactor", "satellite", "terminal", "velocity", "warship", "xenon",
  ]),
]);

export const WAVE_PRESETS = Object.freeze([
  Object.freeze({ tier: 0, speed: 0.035, spawnIntervalMs: 1800, maxTargets: 2, requiredKills: 5 }),
  Object.freeze({ tier: 0, speed: 0.045, spawnIntervalMs: 1600, maxTargets: 3, requiredKills: 7 }),
  Object.freeze({ tier: 1, speed: 0.052, spawnIntervalMs: 1450, maxTargets: 3, requiredKills: 8 }),
  Object.freeze({ tier: 1, speed: 0.06, spawnIntervalMs: 1300, maxTargets: 4, requiredKills: 9 }),
  Object.freeze({ tier: 2, speed: 0.068, spawnIntervalMs: 1180, maxTargets: 4, requiredKills: 10 }),
  Object.freeze({ tier: 2, speed: 0.076, spawnIntervalMs: 1050, maxTargets: 5, requiredKills: 11 }),
  Object.freeze({ tier: 3, speed: 0.084, spawnIntervalMs: 930, maxTargets: 5, requiredKills: 12 }),
  Object.freeze({ tier: 3, speed: 0.092, spawnIntervalMs: 820, maxTargets: 6, requiredKills: 14 }),
]);

export const GAME_RULES = Object.freeze({
  initialLives: 3,
  defenseLine: 0.86,
  maxTickMs: 100,
  waveTransitionMs: 1500,
  minSpawnX: 0.1,
  maxSpawnX: 0.9,
});

export const SCORING = Object.freeze({
  characterPoints: 10,
  wordLengthBonus: 25,
  wordsPerMultiplierStep: 3,
  maxMultiplier: 5,
});

export function getWaveConfig(waveNumber) {
  const safeWave = Math.max(1, Math.floor(Number(waveNumber) || 1));
  return WAVE_PRESETS[Math.min(safeWave - 1, WAVE_PRESETS.length - 1)];
}

export function validateGameConfig({ wordTiers = WORD_TIERS, wavePresets = WAVE_PRESETS } = {}) {
  if (!Array.isArray(wordTiers) || wordTiers.length === 0) return false;
  if (!wordTiers.every((tier) => Array.isArray(tier) && tier.length > 0)) return false;
  if (!wordTiers.flat().every((word) => /^[a-z]+$/.test(word))) return false;
  if (!Array.isArray(wavePresets) || wavePresets.length === 0) return false;
  return wavePresets.every((wave) => (
    Number.isInteger(wave.tier)
    && wave.tier >= 0
    && wave.tier < wordTiers.length
    && wave.speed > 0
    && wave.spawnIntervalMs > 0
    && Number.isInteger(wave.maxTargets)
    && wave.maxTargets > 0
    && Number.isInteger(wave.requiredKills)
    && wave.requiredKills > 0
  ));
}
