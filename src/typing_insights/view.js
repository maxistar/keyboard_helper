import { normalizeKeyEntry, normalizeLayerData } from "../layout_semantics.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const LANGUAGE_NAMES = Object.freeze({ en: "English", ru: "Russian" });
const NO_DATA = "No data yet";

function el(document, tag, { className, text, attrs } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, String(value));
  for (const child of children) if (child) node.appendChild(child);
  return node;
}

function svg(document, tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  for (const child of children) if (child) node.appendChild(child);
  return node;
}

export function keyLabel(code) {
  if (typeof code !== "string" || !code) return "?";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Num[0-9]$/.test(code)) return code.slice(3);
  return code;
}

export function formatPair(fromCode, toCode) {
  return `${keyLabel(fromCode)} → ${keyLabel(toCode)}`;
}

function formatNumber(value, suffix = "") {
  return value == null ? NO_DATA : `${value}${suffix}`;
}

function section(document, id, title, children) {
  return el(document, "section", { className: "insights-section", attrs: { id, "aria-labelledby": `${id}Title` } }, [
    el(document, "h2", { text: title, attrs: { id: `${id}Title` } }),
    ...children,
  ]);
}

function table(document, headers, rows, emptyText) {
  if (!rows.length) return el(document, "p", { className: "insights-empty-note", text: emptyText });
  return el(document, "table", { className: "insights-table" }, [
    el(document, "thead", {}, [el(document, "tr", {}, headers.map((header) => el(document, "th", { text: header, attrs: { scope: "col" } })))]),
    el(document, "tbody", {}, rows.map((cells) => el(document, "tr", {}, cells.map((cell) => el(document, "td", { text: cell }))))),
  ]);
}

export function renderEmptyState(document, { onOpenSettings } = {}) {
  const button = el(document, "button", { className: "button primary", text: "Open Settings", attrs: { type: "button" } });
  if (onOpenSettings) button.addEventListener("click", onOpenSettings);
  return el(document, "div", { className: "insights-empty", attrs: { role: "status" } }, [
    el(document, "h2", { text: "No typing statistics yet" }),
    el(document, "p", {
      text: "Enable \"Collect background timing and possible-correction statistics\" or \"Collect focused exercise statistics\" in Settings, then type or play Shift-Space Invaders. Statistics stay on this device.",
    }),
    button,
  ]);
}

function summaryCards(document, summary) {
  const cards = [
    ["Exercise WPM", formatNumber(summary.exerciseWpm), summary.exerciseSessions ? `${summary.exerciseSessions} sessions` : null],
    ["Exercise accuracy", formatNumber(summary.exerciseAccuracy, "%"), null],
    ["Possible-correction rate", formatNumber(summary.possibleCorrectionRate, "%"), "Background typing"],
    ["Slow pairs", summary.coverage.pairSamples ? String(summary.slowPairCount) : NO_DATA, "Median ≥ 1.5 × baseline, ≥ 30 samples"],
    ["Sample coverage", summary.coverage.pairSamples ? `${summary.coverage.pairSamples} transitions` : NO_DATA,
      summary.coverage.pairCount ? `${summary.coverage.classifiedPairs} pairs with enough data, ${summary.coverage.insufficientPairs} insufficient` : null],
  ];
  return el(document, "div", { className: "insights-cards" }, cards.map(([title, value, detail]) => el(document, "div", { className: "insights-card" }, [
    el(document, "span", { className: "insights-card-title", text: title }),
    el(document, "strong", { className: "insights-card-value", text: value }),
    detail ? el(document, "span", { className: "insights-card-detail", text: detail }) : null,
  ])));
}

function heatColor(ratio) {
  if (ratio == null) return "var(--heat-none)";
  if (ratio >= 1.5) return "var(--heat-slow)";
  if (ratio >= 1.15) return "var(--heat-warm)";
  return "var(--heat-ok)";
}

export function renderHeatmap(document, heatmap, layoutDefinition) {
  if (!layoutDefinition?.keyPositions?.length) {
    return el(document, "p", { className: "insights-empty-note", text: "Select a layout to show the key heatmap." });
  }
  const { w, h, gap = 0 } = layoutDefinition.keySize;
  const [baseLayer = []] = normalizeLayerData(layoutDefinition.keyLayers).layers;
  const byPosition = new Map(heatmap.keys.map((key) => [key.position, key]));
  let width = 0;
  let height = 0;
  const keys = layoutDefinition.keyPositions.map((position, index) => {
    const spanW = position.w ?? 1;
    const spanH = position.h ?? 1;
    const x = position.col * (w + gap);
    const y = position.row * (h + gap);
    const kw = w * spanW + gap * (spanW - 1);
    const kh = h * spanH + gap * (spanH - 1);
    width = Math.max(width, x + kw);
    height = Math.max(height, y + kh);
    const metric = byPosition.get(index);
    const { label } = normalizeKeyEntry(baseLayer[index]);
    const text = typeof label === "object" ? (label?.text ?? "") : (label ?? "");
    const title = metric
      ? `${keyLabel(metric.code)}: ${metric.ratio == null ? "insufficient data" : `×${metric.ratio} vs baseline`} (${metric.sampleCount} samples)`
      : `${text || "Key"}: no data`;
    const transform = position.angle ? `rotate(${position.angle} ${x + kw / 2} ${y + kh / 2})` : null;
    return svg(document, "g", transform ? { transform, "data-position": index } : { "data-position": index }, [
      svg(document, "title", {}, [document.createTextNode(title)]),
      svg(document, "rect", { x, y, width: kw, height: kh, rx: 6, fill: heatColor(metric?.ratio ?? null), "data-ratio": metric?.ratio ?? "" }),
      svg(document, "text", { x: x + kw / 2, y: y + kh / 2, "text-anchor": "middle", "dominant-baseline": "central" }, [document.createTextNode(text)]),
    ]);
  });
  const chart = svg(document, "svg", {
    class: "insights-heatmap",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `Key heatmap on ${layoutDefinition.name}`,
  }, keys);
  const unmapped = heatmap.unmapped.length
    ? el(document, "div", { className: "insights-unmapped" }, [
      el(document, "h3", { text: "Unmapped keys" }),
      el(document, "ul", {}, heatmap.unmapped.map((key) => el(document, "li", {
        text: `${keyLabel(key.code)} — ${key.reason === "multiple-positions" ? "appears on several base-layer keys" : "not on the base layer of this layout"} (${key.sampleCount} samples)`,
      }))),
    ])
    : null;
  return el(document, "div", {}, [
    chart,
    el(document, "p", { className: "insights-legend", text: "Colour: incoming-transition median vs your baseline. Grey keys have fewer than 30 samples or no data." }),
    unmapped,
  ]);
}

export function renderTrend(document, trends) {
  const points = trends.filter((point) => point.wpm != null);
  if (!points.length) return el(document, "p", { className: "insights-empty-note", text: "No exercise sessions in this period." });
  const width = 600;
  const height = 180;
  const pad = 28;
  const maxWpm = Math.max(...points.map((point) => point.wpm), 10);
  const step = trends.length > 1 ? (width - pad * 2) / (trends.length - 1) : 0;
  const coordinates = (key, max) => trends
    .map((point, index) => (point[key] == null ? null : [pad + index * step, height - pad - (point[key] / max) * (height - pad * 2)]))
    .filter(Boolean);
  const series = (key, max, className) => {
    const coords = coordinates(key, max);
    return [
      svg(document, "polyline", { class: className, fill: "none", points: coords.map(([x, y]) => `${x},${y}`).join(" ") }),
      ...coords.map(([x, y]) => svg(document, "circle", { class: className, cx: x, cy: y, r: 4 })),
    ];
  };
  return el(document, "div", {}, [
    svg(document, "svg", { class: "insights-trend", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Daily exercise WPM and accuracy" }, [
      ...series("wpm", maxWpm, "trend-wpm"),
      ...series("accuracy", 100, "trend-accuracy"),
    ]),
    el(document, "p", { className: "insights-legend", text: `WPM (max ${Math.round(maxWpm)}) and accuracy (0–100%) per day, ${trends[0].day} to ${trends[trends.length - 1].day}.` }),
  ]);
}

function renderSuggestion(document, suggestion) {
  const heading = suggestion.kind === "exercise-error"
    ? `Practise “${suggestion.target}”`
    : `Practise ${formatPair(suggestion.fromCode, suggestion.toCode)}`;
  const readings = suggestion.kind === "exercise-error"
    ? []
    : suggestion.readings.length
      ? suggestion.readings.map((reading) => el(document, "div", { className: "insights-reading", attrs: { lang: reading.language } }, [
        el(document, "strong", { text: `${LANGUAGE_NAMES[reading.language]}: ${reading.letters}` }),
        el(document, "span", { text: reading.words.length ? reading.words.join(", ") : "No dictionary words contain this letter pair." }),
      ]))
      : [el(document, "p", { className: "insights-empty-note", text: "No English or Russian letter reading for this key pair, so no dictionary words are listed." })];
  return el(document, "li", { className: `insights-suggestion ${suggestion.kind}` }, [
    el(document, "h3", { text: heading }),
    el(document, "p", { className: "insights-signal", text: `${suggestion.label}: ${suggestion.signal}.` }),
    el(document, "div", { className: "insights-readings" }, readings),
  ]);
}

/**
 * Renders every insights view into the container.
 * @param {Document} document
 * @param {HTMLElement} container
 * @param {ReturnType<import("./model.js").buildInsights>} insights
 */
export function renderInsights(document, container, insights, { layoutDefinition = null, onOpenSettings } = {}) {
  container.replaceChildren();
  if (insights.empty) {
    container.appendChild(renderEmptyState(document, { onOpenSettings }));
    return;
  }
  const hasUnknownLanguage = insights.contexts.languages.includes("unknown");
  container.appendChild(summaryCards(document, insights.summary));
  container.appendChild(section(document, "slowPairs", "Slow transitions", [
    table(document, ["Pair", "Median", "p90", "Baseline", "Ratio", "Possible corrections", "Samples"],
      insights.slowPairs.map((pair) => [
        formatPair(pair.fromCode, pair.toCode), `${pair.medianMs} ms`, `${pair.p90Ms} ms`, `${pair.baselineMs} ms`,
        `×${pair.ratio}`, String(pair.correctionCount), String(pair.sampleCount),
      ]),
      "No pair has at least 30 samples and a median at least 1.5 times your baseline yet."),
  ]));
  container.appendChild(section(document, "hotspots", "Corrections and errors", [
    el(document, "h3", { text: "Possible corrections (background typing)" }),
    table(document, ["Pair", "Possible corrections", "Transitions", "Rate"],
      insights.correctionHotspots.map((hotspot) => [
        formatPair(hotspot.fromCode, hotspot.toCode), String(hotspot.correctionCount), String(hotspot.sampleCount), `${Math.round(hotspot.rate * 1000) / 10}%`,
      ]),
      "No possible corrections recorded."),
    el(document, "p", { className: "insights-legend", text: "Backspace shortly after a transition. These are friction signals, not confirmed errors." }),
    el(document, "h3", { text: "Exercise errors" }),
    table(document, ["Target", "Errors", "Attempts", "Completed"],
      insights.exerciseErrors.map((error) => [error.target, String(error.mistakes), String(error.attempts), String(error.completed)]),
      "No exercise errors recorded."),
  ]));
  container.appendChild(section(document, "heatmap", "Key heatmap", [renderHeatmap(document, insights.heatmap, layoutDefinition)]));
  container.appendChild(section(document, "trends", "Exercise trend", [renderTrend(document, insights.trends)]));
  container.appendChild(section(document, "suggestions", "Practice suggestions", [
    insights.suggestions.length
      ? el(document, "ul", { className: "insights-suggestions" }, insights.suggestions.map((suggestion) => renderSuggestion(document, suggestion)))
      : el(document, "p", { className: "insights-empty-note", text: "No suggestions yet: they appear once a pair is slow or correction-prone with enough samples." }),
  ]));
  container.appendChild(section(document, "limitations", "About this data", [
    el(document, "ul", {}, [
      hasUnknownLanguage
        ? el(document, "li", { text: "The input language is unknown for some statistics, so English and Russian typing may share one baseline and suggestions show both readings." })
        : null,
      ...insights.limitations.map((text) => el(document, "li", { text })),
      el(document, "li", { text: `Not collected: ${insights.omittedData.join(", ")}.` }),
    ]),
  ]));
}
