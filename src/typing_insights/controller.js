import { localDayKey } from "../typing_analytics.js";
import { EN_WORDS } from "./dictionaries/en.js";
import { RU_WORDS } from "./dictionaries/ru.js";
import { buildInsights } from "./model.js";
import { renderInsights } from "./view.js";

export const DEFAULT_RANGE_DAYS = 30;
const DICTIONARIES = Object.freeze({ en: EN_WORDS, ru: RU_WORDS });

export function defaultRange(today = new Date()) {
  const start = new Date(today);
  start.setDate(start.getDate() - (DEFAULT_RANGE_DAYS - 1));
  return { from: localDayKey(start), to: localDayKey(today) };
}

function setOptions(document, select, options, selected) {
  select.replaceChildren(...options.map(([value, text]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    if (value === selected) option.selected = true;
    return option;
  }));
  select.value = selected;
}

/**
 * @param {{
 *   document: Document,
 *   elements: Record<string, any>,
 *   readRows: (from: string, to: string) => Promise<any[]>,
 *   readSettings?: () => Promise<{ exercise: boolean, background: boolean }>,
 *   catalog?: { definitions: Record<string, any>, defaultLayout?: string | null },
 *   openSettings?: () => void,
 *   today?: Date,
 * }} options
 */
export function createInsightsController({
  document,
  elements,
  readRows,
  readSettings = async () => ({ exercise: false, background: false }),
  catalog = { definitions: {}, defaultLayout: null },
  openSettings,
  today = new Date(),
}) {
  const range = defaultRange(today);
  let rows = [];
  let settings = { exercise: false, background: false };
  let loadedRange = null;
  elements.from.value = range.from;
  elements.to.value = range.to;

  function filters() {
    return {
      from: elements.from.value || null,
      to: elements.to.value || null,
      layout: elements.layout.value || undefined,
      language: elements.language.value || undefined,
      collectionType: elements.source.value || undefined,
      minSamples: Number(elements.minSamples.value) || 0,
    };
  }

  function layoutDefinition(layoutKey) {
    const key = layoutKey || catalog.defaultLayout;
    return catalog.definitions?.[key] ?? Object.values(catalog.definitions ?? {})[0] ?? null;
  }

  function refreshFilterOptions() {
    const layouts = [...new Set(rows.map((row) => row.layout).filter(Boolean))].sort();
    const languages = [...new Set(rows.map((row) => row.language).filter(Boolean))].sort();
    setOptions(document, elements.layout, [["", "All layouts"], ...layouts.map((key) => [key, catalog.definitions?.[key]?.name ?? key])],
      layouts.includes(elements.layout.value) ? elements.layout.value : "");
    setOptions(document, elements.language, [["", "All languages"], ...languages.map((id) => [id, id === "unknown" ? "Unknown language" : id])],
      languages.includes(elements.language.value) ? elements.language.value : "");
  }

  function render() {
    const current = filters();
    const insights = buildInsights({ rows, settings, filters: current, layoutDefinition: layoutDefinition(current.layout), dictionaries: DICTIONARIES });
    renderInsights(document, elements.content, insights, { layoutDefinition: layoutDefinition(current.layout), onOpenSettings: openSettings });
    elements.status.textContent = insights.empty
      ? "No statistics in this period."
      : `${rows.length} daily aggregates from ${current.from ?? "the start"} to ${current.to ?? "today"}.`;
    return insights;
  }

  async function load() {
    const current = filters();
    elements.status.textContent = "Loading statistics…";
    try {
      [rows, settings] = await Promise.all([readRows(current.from, current.to), readSettings()]);
      loadedRange = `${current.from}|${current.to}`;
      refreshFilterOptions();
      return render();
    } catch (error) {
      rows = [];
      elements.content.replaceChildren();
      elements.status.textContent = `Could not read local statistics: ${error?.message ?? error}`;
      return null;
    }
  }

  function onFilterChange() {
    const current = filters();
    return loadedRange === `${current.from}|${current.to}` ? render() : load();
  }

  for (const name of ["from", "to", "layout", "language", "source", "minSamples"]) {
    elements[name].addEventListener("change", onFilterChange);
  }
  elements.refresh?.addEventListener("click", load);

  return { load, render, onFilterChange, filters };
}
