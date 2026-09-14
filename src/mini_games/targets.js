import { DEFAULT_NAMED_KEYS } from "./input.js";

export function normalizeTarget(target) {
  if (typeof target === "string") return Array.from(target);
  if (Array.isArray(target)) return target.map(String).filter(Boolean);
  if (target?.kind === "semantic" && Array.isArray(target.tokens)) {
    return target.tokens.map(String).filter(Boolean);
  }
  return [];
}

export function isCompatibleToken(token, { namedKeys = DEFAULT_NAMED_KEYS } = {}) {
  return token === " " || Array.from(token).length === 1 || namedKeys.includes(token);
}

export function filterCompatibleTargets(targets, {
  reserved = ["Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
  namedKeys = DEFAULT_NAMED_KEYS,
  maximumTokens = 12,
} = {}) {
  const reservedSet = new Set(reserved);
  return (Array.isArray(targets) ? targets : [])
    .map(normalizeTarget)
    .filter((tokens) => tokens.length > 0
      && tokens.length <= maximumTokens
      && tokens.every((token) => !reservedSet.has(token) && isCompatibleToken(token, { namedKeys })));
}

export function createTargetMatcher(target) {
  const tokens = normalizeTarget(target);
  let progress = 0;
  let mistakes = 0;
  let complete = tokens.length === 0;
  return {
    get target() { return [...tokens]; },
    get progress() { return progress; },
    get mistakes() { return mistakes; },
    get complete() { return complete; },
    input(token) {
      if (complete) return { matched: false, complete: true, progress, mistakes, ignored: true };
      if (tokens[progress] === token) {
        progress += 1;
        complete = progress === tokens.length;
        return { matched: true, complete, progress, mistakes };
      }
      mistakes += 1;
      return { matched: false, complete: false, progress, mistakes };
    },
    reset() { progress = 0; mistakes = 0; complete = tokens.length === 0; },
  };
}
