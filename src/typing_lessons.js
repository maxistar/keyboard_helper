import { KEY_LETTERS, dictionaryLanguageForSource } from "./typing_insights/readings.js";
import { normalizeLayerData } from "./layout_semantics.js";
import { filterCompatibleTargets } from "./mini_games/targets.js";

export const LESSON_TARGET_TYPES = Object.freeze([
  "word", "phrase", "symbols", "key-sequence", "layer-transition", "physical-position", "combo",
]);
export const LESSON_ANALYTICS_TAGS = Object.freeze(["domain", "focus", "difficulty"]);

const TARGET_TYPES = new Set(LESSON_TARGET_TYPES);
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const ALPHABETIC_WORD = /^[a-z]+$/;

export const BUILTIN_LESSONS = Object.freeze([
  Object.freeze({
    id: "programmer-basics", name: "Programmer basics", description: "Common code vocabulary.",
    targets: ["array", "build", "class", "code", "const", "debug", "function", "module", "query", "value"].map((value) => ({ type: "word", id: value, value, tags: { domain: "programmer" } })),
  }),
  Object.freeze({
    id: "terminal-cli", name: "Terminal and CLI", description: "Words used at the command line.",
    targets: ["alias", "branch", "commit", "config", "fetch", "merge", "rebase", "remote", "status", "switch"].map((value) => ({ type: "word", id: value, value, tags: { domain: "cli" } })),
  }),
  Object.freeze({
    id: "writer-blogger", name: "Writer and blogger", description: "Words for clear writing.",
    targets: ["article", "clarity", "draft", "editor", "headline", "outline", "reader", "revise", "story", "topic"].map((value) => ({ type: "word", id: value, value, tags: { domain: "writer" } })),
  }),
  Object.freeze({
    id: "keyboard-builder-zmk", name: "Keyboard builder and ZMK", description: "Keyboard-firmware vocabulary.",
    targets: ["battery", "board", "firmware", "keymap", "layout", "matrix", "shield", "split", "studio", "wireless"].map((value) => ({ type: "word", id: value, value, tags: { domain: "zmk" } })),
  }),
]);

function isObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function diagnostic(code, message, targetId = null) { return { code, message, targetId }; }
function normalizedTags(value) {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => LESSON_ANALYTICS_TAGS.includes(key) && typeof item === "string" && item.length <= 80));
}

export function invadersCompatibility(target) {
  if (target?.type !== "word") return diagnostic("invaders-target-type", "Shift-Space Invaders accepts alphabetic word targets only.", target?.id);
  if (!ALPHABETIC_WORD.test(target.value ?? "")) return diagnostic("invaders-word-input", "Shift-Space Invaders accepts lower-case English alphabetic words only.", target?.id);
  return null;
}

export function validateLesson(value, { layoutDefinition = null } = {}) {
  const diagnostics = [];
  const availabilityDiagnostics = [];
  if (!isObject(value)) return { valid: false, lesson: null, diagnostics: [diagnostic("lesson-object", "Lesson must be a JSON object.")] };
  if (!ID.test(value.id ?? "")) diagnostics.push(diagnostic("lesson-id", "Lesson ID must use lower-case letters, digits, and hyphens."));
  if (typeof value.name !== "string" || !value.name.trim()) diagnostics.push(diagnostic("lesson-name", "Lesson needs a name."));
  if (!Array.isArray(value.targets) || value.targets.length === 0) diagnostics.push(diagnostic("lesson-targets", "Lesson needs at least one target."));
  const ids = new Set();
  const layers = new Set(normalizeLayerData(layoutDefinition?.keyLayers).layerKeys);
  const positions = Array.isArray(layoutDefinition?.keyPositions) ? layoutDefinition.keyPositions.length : 0;
  const combos = new Set((Array.isArray(layoutDefinition?.combos) ? layoutDefinition.combos : [])
    .map((combo) => String(combo?.id)));
  const targets = (Array.isArray(value.targets) ? value.targets : []).map((raw) => {
    const target = isObject(raw) ? { ...raw, tags: normalizedTags(raw.tags) } : raw;
    if (!isObject(target)) { diagnostics.push(diagnostic("target-object", "Every target must be an object.")); return null; }
    if (!ID.test(target.id ?? "")) diagnostics.push(diagnostic("target-id", "Target ID must use lower-case letters, digits, and hyphens.", target.id));
    else if (ids.has(target.id)) diagnostics.push(diagnostic("target-duplicate", "Target IDs must be unique.", target.id));
    else ids.add(target.id);
    if (!TARGET_TYPES.has(target.type)) diagnostics.push(diagnostic("target-type", "Target type is unsupported.", target.id));
    if (typeof target.value !== "string" || !target.value) diagnostics.push(diagnostic("target-value", "Target needs a non-empty value.", target.id));
    if (target.tokens != null && (!Array.isArray(target.tokens) || target.tokens.length === 0
      || target.tokens.some((token) => typeof token !== "string" || !token))) {
      diagnostics.push(diagnostic("target-tokens", "Target tokens must be a non-empty array of strings.", target.id));
    }
    if (target.weight != null && (!Number.isFinite(target.weight) || target.weight <= 0)) diagnostics.push(diagnostic("target-weight", "Target weight must be a positive number.", target.id));
    if (target.type === "layer-transition" && (typeof target.layer !== "string" || !target.layer)) diagnostics.push(diagnostic("target-layer", "Layer-transition targets need a layer ID.", target.id));
    if (target.type === "physical-position" && (!Number.isInteger(target.position) || target.position < 0)) diagnostics.push(diagnostic("target-position", "Physical-position targets need a non-negative integer position.", target.id));
    if (target.type === "combo" && !((typeof target.comboId === "string" && target.comboId.length > 0)
      || Number.isInteger(target.comboId))) diagnostics.push(diagnostic("target-combo", "Combo targets need a combo ID.", target.id));
    if (layoutDefinition && target.type === "layer-transition" && typeof target.layer === "string" && !layers.has(target.layer)) availabilityDiagnostics.push(diagnostic("layout-layer", "Target layer is not in the selected layout.", target.id));
    if (layoutDefinition && target.type === "physical-position" && Number.isInteger(target.position) && target.position >= positions) availabilityDiagnostics.push(diagnostic("layout-position", "Target position is not in the selected layout.", target.id));
    if (layoutDefinition && target.type === "combo" && target.comboId != null && !combos.has(String(target.comboId))) availabilityDiagnostics.push(diagnostic("layout-combo", "Target combo is not in the selected layout.", target.id));
    return target;
  }).filter(Boolean);
  const unavailableIds = new Set(availabilityDiagnostics.map(({ targetId }) => targetId));
  const lesson = diagnostics.length ? null : {
    id: value.id,
    name: value.name.trim(),
    description: typeof value.description === "string" ? value.description : "",
    targets,
  };
  return { valid: diagnostics.length === 0, lesson, diagnostics: [...diagnostics, ...availabilityDiagnostics], unavailableTargetIds: [...unavailableIds] };
}

export function parseLessonJson(raw, options) {
  try { return validateLesson(typeof raw === "string" ? JSON.parse(raw) : raw, options); }
  catch { return { valid: false, lesson: null, diagnostics: [diagnostic("lesson-json", "The selected lesson file is not valid JSON.")] }; }
}

export function createLessonCatalog({ imported = [], layoutDefinition = null } = {}) {
  const entries = [...BUILTIN_LESSONS, ...imported].map((lesson) => validateLesson(lesson, { layoutDefinition }));
  return {
    lessons: entries.filter((entry) => entry.valid).map((entry) => {
      const unavailableIds = new Set(entry.unavailableTargetIds);
      return { ...entry.lesson, targets: entry.lesson.targets.map((target) => (
        unavailableIds.has(target.id) ? { ...target, unavailable: true } : target
      )) };
    }),
    diagnostics: entries.flatMap((entry) => entry.diagnostics),
  };
}

export function compatibleTargets(lesson, mode = "invaders") {
  const compatible = [];
  const diagnostics = [];
  for (const target of lesson?.targets ?? []) {
    let issue = target.unavailable
      ? diagnostic("layout-unavailable", "Target is unavailable for the selected layout.", target.id)
      : null;
    if (!issue && mode === "invaders") issue = invadersCompatibility(target);
    if (!issue && mode !== "invaders" && ["physical-position", "layer-transition", "combo"].includes(target.type)) {
      issue = diagnostic("semantic-evidence", "This semantic mode cannot verify physical or firmware evidence.", target.id);
    }
    if (!issue && mode !== "invaders") {
      const adapted = adaptLessonTarget(lesson, target);
      if (!filterCompatibleTargets([adapted], modeOptions(mode)).length) {
        issue = diagnostic("semantic-controls", "Target conflicts with this mode's controls or token limit.", target.id);
      }
    }
    if (issue) diagnostics.push(issue);
    else compatible.push(target);
  }
  return { compatible, diagnostics };
}

function modeOptions(mode) {
  if (mode === "flappy") return { reserved: ["Escape"], maximumTokens: 6 };
  if (mode === "fishing") return { maximumTokens: 12 };
  return {};
}

export function adaptLessonTarget(lesson, target) {
  const analyticsTags = normalizedTags(target.tags);
  const tokens = Array.isArray(target.tokens) ? [...target.tokens] : Array.from(target.value);
  return {
    kind: "semantic",
    tokens,
    word: target.value,
    lessonId: lesson.id,
    targetId: target.id,
    targetType: target.type,
    analyticsTags,
    label: target.value,
    difficulty: target.difficulty ?? target.tags?.difficulty ?? null,
    lessonTarget: {
      lessonId: lesson.id,
      targetId: target.id,
      targetType: target.type,
      analyticsTags,
    },
  };
}

export function createLessonTargetProvider(lesson, { mode = "invaders", random = Math.random } = {}) {
  const { compatible, diagnostics } = compatibleTargets(lesson, mode);
  return {
    diagnostics,
    async getTargets() { return compatible.map((target) => adaptLessonTarget(lesson, target)); },
    next({ activeTargets = [] } = {}) {
      const usedInitials = new Set(activeTargets.map((target) => target.word?.[0]));
      const candidates = compatible.filter((target) => !usedInitials.has(target.value[0]));
      if (!candidates.length) return null;
      const target = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
      return adaptLessonTarget(lesson, target);
    },
  };
}

export function weakSpotReadings(pair) {
  const known = dictionaryLanguageForSource(pair?.language);
  return (known ? [known] : ["en", "ru"]).map((language) => {
    const letters = `${KEY_LETTERS[language][pair?.fromCode] ?? ""}${KEY_LETTERS[language][pair?.toCode] ?? ""}`;
    return letters.length === 2 ? { language, letters } : null;
  }).filter(Boolean);
}

export function createWeakSpotLesson(pairs = [], { language = null } = {}) {
  const targets = [];
  const pending = [];
  for (const pair of pairs) {
    const readings = weakSpotReadings(pair);
    const selected = language ? readings.find((reading) => reading.language === language) : readings.length === 1 ? readings[0] : null;
    if (!selected) { if (readings.length) pending.push({ pair, readings }); continue; }
    if (selected.letters) targets.push({ id: `pair-${pair.fromCode.toLowerCase()}-${pair.toCode.toLowerCase()}-${selected.language}`, type: "word", value: selected.letters, tags: { focus: "weak-spot" } });
  }
  return { lesson: targets.length ? { id: "personal-weak-spots", name: "Personal weak spots", description: "Derived from local aggregate transitions.", targets } : null, pending };
}

export function lessonAnalyticsMetadata(target) {
  if (!target?.lessonId || !target?.targetId) return null;
  return { lessonId: target.lessonId, targetId: target.targetId, targetType: target.targetType, tags: normalizedTags(target.analyticsTags) };
}
