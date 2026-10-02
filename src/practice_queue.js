const DEFAULT_LIMIT = 10;

function compatible(target, mode) {
  if (!target?.word || typeof target.word !== "string") return false;
  if (mode === "invaders") return /^[a-z]+$/.test(target.word);
  return Array.isArray(target.tokens) && target.tokens.length > 0;
}

function identity(target, index) {
  if (target.lessonId && target.targetId) return `${target.lessonId}:${target.targetId}`;
  return `target:${target.word}:${index}`;
}

export function createPracticeQueue({ sources = [], mode = "invaders", limit = DEFAULT_LIMIT } = {}) {
  const cap = Math.max(0, Number(limit) || DEFAULT_LIMIT);
  const items = [];
  const byIdentity = new Map();
  const diagnostics = [];
  sources.forEach((source, sourceIndex) => {
    const reason = source.reason ?? source.label ?? "Practice suggestion";
    (source.targets ?? []).forEach((target, targetIndex) => {
      if (!compatible(target, mode)) {
        diagnostics.push({ code: "incompatible-target", targetId: target.targetId ?? null, reason });
        return;
      }
      const key = identity(target, `${sourceIndex}-${targetIndex}`);
      const existing = byIdentity.get(key);
      if (existing) {
        if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
        return;
      }
      const item = { ...target, queueId: key, reasons: [reason] };
      byIdentity.set(key, item);
      items.push(item);
    });
  });
  const capped = items.slice(0, cap);
  if (items.length > cap) diagnostics.push({ code: "queue-cap", omitted: items.length - cap });
  return { items: capped, diagnostics, limit: cap };
}

export function createPracticeQueueProvider(items = []) {
  let index = 0;
  return {
    get remaining() { return Math.max(0, items.length - index); },
    next({ activeTargets = [] } = {}) {
      const used = new Set(activeTargets.map((target) => target.word));
      while (index < items.length) {
        const item = items[index++];
        if (used.has(item.word)) continue;
        return item;
      }
      return null;
    },
  };
}
