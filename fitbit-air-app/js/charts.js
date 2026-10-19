// Kleine SVG-Diagramme ohne externe Bibliotheken.
const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}

// Diagramme in Pixelbreite des Containers zeichnen, damit Schrift nicht skaliert wird.
const width = (container) => Math.max(280, Math.round(container.clientWidth || 640));

function title(node, text) {
  el("title", {}, node).textContent = text;
}

// Kreisring wie bei WHOOP (Recovery %, Strain, Schlaf %).
export function ring(container, { value, max, color, label, display }) {
  const size = 150;
  const r = 62;
  const c = 2 * Math.PI * r;
  const svg = el("svg", { viewBox: `0 0 ${size} ${size}`, class: "ring", role: "img", "aria-label": `${label}: ${display}` });
  el("circle", { cx: 75, cy: 75, r, class: "ring-track" }, svg);
  const frac = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  el("circle", {
    cx: 75, cy: 75, r, class: "ring-value", stroke: color,
    "stroke-dasharray": `${c * frac} ${c}`, transform: "rotate(-90 75 75)",
  }, svg);
  const t = el("text", { x: 75, y: 80, class: "ring-number" }, svg);
  t.textContent = display;
  const l = el("text", { x: 75, y: 104, class: "ring-label" }, svg);
  l.textContent = label;
  container.replaceChildren(svg);
}

// Balken- bzw. Liniendiagramm über mehrere Tage.
// series: [{ date, value, color? }]
export function trend(container, series, { type = "bar", min, max, unit = "", height = 160, band, fixedWidth } = {}) {
  const w = fixedWidth ?? width(container);
  const h = height;
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const vals = series.map((s) => s.value).filter((v) => v != null);
  const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, class: "chart", role: "img" });
  if (!vals.length) {
    const t = el("text", { x: w / 2, y: h / 2, class: "chart-empty" }, svg);
    t.textContent = "Keine Daten";
    container.replaceChildren(svg);
    return;
  }
  const lo = min ?? Math.floor(Math.min(...vals) * 0.95);
  const hi = max ?? Math.ceil(Math.max(...vals) * 1.05);
  const span = hi - lo || 1;
  const cw = (w - pad.l - pad.r) / series.length;
  const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / span);
  for (const g of [lo, lo + span / 2, hi]) {
    el("line", { x1: pad.l, x2: w - pad.r, y1: y(g), y2: y(g), class: "grid" }, svg);
    const t = el("text", { x: pad.l - 4, y: y(g) + 4, class: "axis axis-y" }, svg);
    t.textContent = Math.round(g * 10) / 10;
  }
  if (band) {
    el("rect", { x: pad.l, width: w - pad.l - pad.r, y: y(band.max), height: Math.max(0, y(band.min) - y(band.max)), class: "band" }, svg);
  }
  if (type === "bar") {
    series.forEach((s, i) => {
      if (s.value == null) return;
      const rect = el("rect", {
        x: pad.l + i * cw + cw * 0.15, width: cw * 0.7, y: y(s.value),
        height: Math.max(1, y(lo) - y(s.value)), rx: 2, fill: s.color ?? "var(--accent)",
      }, svg);
      title(rect, `${s.date}: ${s.value}${unit}`);
    });
  } else {
    const pts = series.map((s, i) => (s.value == null ? null : [pad.l + i * cw + cw / 2, y(s.value), s])).filter(Boolean);
    el("polyline", { points: pts.map((p) => `${p[0]},${p[1]}`).join(" "), class: "line" }, svg);
    for (const [px, py, s] of pts) title(el("circle", { cx: px, cy: py, r: 3.5, class: "dot" }, svg), `${s.date}: ${s.value}${unit}`);
  }
  const step = Math.ceil(series.length / Math.max(3, Math.floor(w / 70)));
  series.forEach((s, i) => {
    if (i % step) return;
    const t = el("text", { x: pad.l + i * cw + cw / 2, y: h - 6, class: "axis" }, svg);
    t.textContent = s.date.slice(8, 10) + "." + s.date.slice(5, 7) + ".";
  });
  container.replaceChildren(svg);
}

// Herzfrequenz über den Tag mit farbigen Zonen.
export function heartRateDay(container, samples, { hrMax, zoneColors }) {
  const w = width(container);
  const h = 180;
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, class: "chart", role: "img" });
  if (!samples?.length) {
    el("text", { x: w / 2, y: h / 2, class: "chart-empty" }, svg).textContent = "Keine Herzfrequenzdaten für diesen Tag";
    container.replaceChildren(svg);
    return;
  }
  const lo = 40;
  const hi = Math.max(hrMax, ...samples.map((s) => s[1]));
  const x = (m) => pad.l + ((w - pad.l - pad.r) * m) / 1440;
  const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
  [0.5, 0.6, 0.7, 0.8, 0.9].forEach((p, i) => {
    el("line", { x1: pad.l, x2: w - pad.r, y1: y(p * hrMax), y2: y(p * hrMax), class: "grid", stroke: zoneColors[i + 1] }, svg);
  });
  for (const g of [60, 100, 140, 180]) {
    if (g > hi) continue;
    el("text", { x: pad.l - 4, y: y(g) + 4, class: "axis axis-y" }, svg).textContent = g;
  }
  let path = "";
  let prev = null;
  for (const [m, bpm] of samples) {
    path += `${prev == null || m - prev > 10 ? "M" : "L"}${x(m).toFixed(1)},${y(bpm).toFixed(1)}`;
    prev = m;
  }
  el("path", { d: path, class: "line hr-line" }, svg);
  for (let hh = 0; hh <= 24; hh += 3) {
    el("text", { x: x(hh * 60), y: h - 6, class: "axis" }, svg).textContent = `${hh}h`;
  }
  container.replaceChildren(svg);
}

// Hypnogramm der Schlafphasen.
export function hypnogram(container, segments, total, colors) {
  const w = width(container);
  const h = 140;
  const rows = { awake: 0, rem: 1, light: 2, deep: 3 };
  const names = { awake: "Wach", rem: "REM", light: "Leicht", deep: "Tief" };
  const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, class: "chart", role: "img" });
  if (!segments?.length) {
    el("text", { x: w / 2, y: h / 2, class: "chart-empty" }, svg).textContent = "Keine Schlafphasen verfügbar";
    container.replaceChildren(svg);
    return;
  }
  const pl = 52;
  const rh = (h - 10) / 4;
  for (const [k, row] of Object.entries(rows)) {
    el("text", { x: pl - 6, y: 5 + row * rh + rh / 2 + 4, class: "axis axis-y" }, svg).textContent = names[k];
  }
  for (const [start, dur, stage] of segments) {
    const rect = el("rect", {
      x: pl + ((w - pl) * start) / total, width: Math.max(1, ((w - pl) * dur) / total),
      y: 5 + rows[stage] * rh + 2, height: rh - 4, rx: 2, fill: colors[stage],
    }, svg);
    title(rect, `${names[stage]}: ${dur} min`);
  }
  container.replaceChildren(svg);
}
