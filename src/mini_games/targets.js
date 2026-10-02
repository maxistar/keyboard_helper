import { DEFAULT_NAMED_KEYS } from "./input.js";

export function normalizeTarget(target) {
  let tokens = [];
  if (typeof target === "string") tokens = Array.from(target);
  else if (Array.isArray(target)) tokens = target.map(String).filter(Boolean);
  if (target?.kind === "semantic" && Array.isArray(target.tokens)) {
    tokens = target.tokens.map(String).filter(Boolean);
  }
  const metadata = target?.lessonTarget ?? target?.targetMetadata ?? null;
  if (metadata && tokens.length) {
    Object.defineProperty(tokens, "targetMetadata", {
      value: Object.freeze({ ...metadata }),
      enumerable: false,
    });
  }
  return tokens;
}

export function targetMetadata(target) {
  return target?.targetMetadata ?? target?.lessonTarget ?? null;
}

export function cloneNormalizedTarget(target) {
  return normalizeTarget(target);
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
  const metadata = targetMetadata(tokens);
  let progress = 0;
  let mistakes = 0;
  let complete = tokens.length === 0;
  return {
    get target() { return [...tokens]; },
    get progress() { return progress; },
    get mistakes() { return mistakes; },
    get complete() { return complete; },
    input(token) {
      if (complete) return { matched: false, complete: true, progress, mistakes, ignored: true, targetMetadata: metadata };
      if (tokens[progress] === token) {
        progress += 1;
        complete = progress === tokens.length;
        return { matched: true, complete, progress, mistakes, targetMetadata: metadata };
      }
      mistakes += 1;
      return { matched: false, complete: false, progress, mistakes, targetMetadata: metadata };
    },
    reset() { progress = 0; mistakes = 0; complete = tokens.length === 0; },
  };
}
