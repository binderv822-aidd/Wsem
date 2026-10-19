import { DATA_TYPES } from "./config.js";
import { analyzeDays, maxHeartRate, mean, recommendedBedtime } from "./scoring.js";
import { syncAll } from "./api.js";
import { signIn, getToken, clearToken } from "./auth.js";
import { generateDemoDays } from "./demo.js";
import { dateKey } from "./normalize.js";
import * as store from "./store.js";
import * as charts from "./charts.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const ZONE_COLOR = { green: "var(--green)", yellow: "var(--yellow)", red: "var(--red)" };
const ZONE_TEXT = { green: "Gut erholt", yellow: "Ausreichend erholt", red: "Erholung nötig" };
const STAGE_COLORS = () => ({ deep: css("--deep"), rem: css("--rem"), light: css("--light"), awake: css("--awake") });
const HR_ZONE_COLORS = ["#3a3f47", "#6aa7e0", "#16b8a0", "#ffde00", "#ff8c00", "#ff0026"];

let settings = store.loadSettings();
let meta = store.loadMeta();
let rawDays = store.loadDays();
let days = [];
let idx = -1;
let view = "today";
let trendRange = 30;

// ---------- Formatierung ----------
const fmt = (v, digits = 0, unit = "") => (v == null || Number.isNaN(v) ? "–" : `${Number(v).toLocaleString("de-DE", { maximumFractionDigits: digits, minimumFractionDigits: digits })}${unit}`);
const fmtDur = (min) => (min == null ? "–" : `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, "0")} h`);
const fmtClock = (min) => (min == null ? "–" : `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`);

function dayLabel(key) {
  const today = dateKey(new Date());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (key === today) return "Heute";
  if (key === dateKey(y)) return "Gestern";
  const d = new Date(`${key}T12:00:00`);
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

function stat(k, v, d = "", cls = "") {
  return `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="d ${cls}">${d}</div></div>`;
}

function avgOf(key, before = idx, n = 30) {
  return mean(days.slice(Math.max(0, before - n), before).map((d) => d[key]));
}

function deltaText(value, key, { unit = "", digits = 0, higherIsBetter = true } = {}) {
  const avg = avgOf(key);
  if (value == null || avg == null) return ["", ""];
  const diff = value - avg;
  const cls = Math.abs(diff) < 1e-9 ? "" : (diff > 0) === higherIsBetter ? "up" : "down";
  return [`Ø 30 T: ${fmt(avg, digits, unit)}`, cls];
}

function setStatus(text, error = false) {
  const s = $("#status");
  s.hidden = !text;
  s.textContent = text ?? "";
  s.classList.toggle("error", error);
}

// ---------- Daten ----------
function recompute() {
  const keys = Object.keys(rawDays).sort();
  if (!keys.length) {
    days = [];
    idx = -1;
    return;
  }
  const list = [];
  const end = dateKey(new Date()) > keys.at(-1) ? dateKey(new Date()) : keys.at(-1);
  for (let d = new Date(`${keys[0]}T12:00:00`); dateKey(d) <= end; d.setDate(d.getDate() + 1)) {
    const k = dateKey(d);
    list.push(rawDays[k] ?? { date: k });
  }
  days = analyzeDays(list, settings);
  if (idx < 0 || idx >= days.length) idx = days.length - 1;
}

// ---------- Ansichten ----------
function renderToday() {
  const d = days[idx];
  charts.ring($("#ring-recovery"), {
    value: d.recovery, max: 100, color: ZONE_COLOR[d.recoveryDetail?.zone] ?? "var(--muted)",
    label: "Recovery", display: d.recovery == null ? "–" : `${d.recovery}%`,
  });
  charts.ring($("#ring-strain"), { value: d.strain, max: 21, color: "var(--strain)", label: "Strain", display: fmt(d.strain, 1) });
  charts.ring($("#ring-sleep"), {
    value: d.sleepPerformance, max: 100, color: "var(--sleep)", label: "Schlaf",
    display: d.sleepPerformance == null ? "–" : `${d.sleepPerformance}%`,
  });

  const t = d.strainTarget;
  const bed = recommendedBedtime(days, idx, settings);
  const warnings = healthWarnings(d);
  const advice = {
    green: "Dein Körper ist bereit für eine hohe Belastung. Ein guter Tag für intensives Training.",
    yellow: "Du bist ausreichend erholt. Moderates Training ist sinnvoll, achte auf die Signale deines Körpers.",
    red: "Dein Körper braucht Erholung. Setze auf lockere Bewegung, Mobility und frühen Schlaf.",
  }[d.recoveryDetail?.zone] ?? "Noch keine Recovery-Daten für diesen Tag (HRV/Ruhepuls fehlen).";
  const pos = (v) => `${(Math.min(21, v ?? 0) / 21) * 100}%`;
  $("#coach").innerHTML = `
    <h3>Coach</h3>
    <p>${advice}</p>
    <div class="target">
      <span class="muted">Ziel-Strain ${t.min}–${t.max}</span>
      <div class="bar"><i style="left:${pos(t.min)};width:calc(${pos(t.max)} - ${pos(t.min)})"></i><b style="left:${pos(d.strain)}"></b></div>
      <strong>${fmt(d.strain, 1)}</strong>
    </div>
    <p class="muted">Empfohlene Schlafenszeit heute: <strong>${fmtClock(bed.bedtimeMin)}</strong>
      (Bedarf ${fmtDur(bed.needMinutes)}, Aufstehen ≈ ${fmtClock(bed.wakeMin)})</p>
    ${warnings.map((w) => `<p class="down">⚠ ${w}</p>`).join("")}`;

  const [hrvD, hrvC] = deltaText(d.hrv, "hrv", { unit: " ms" });
  const [rhrD, rhrC] = deltaText(d.rhr, "rhr", { higherIsBetter: false });
  $("#today-stats").innerHTML = [
    stat("HRV", fmt(d.hrv, 0, " ms"), hrvD, hrvC),
    stat("Ruhepuls", fmt(d.rhr, 0, " bpm"), rhrD, rhrC),
    stat("Schlaf", fmtDur(d.sleep?.asleepMinutes), `Bedarf ${fmtDur(d.sleepNeed)}`),
    stat("Schritte", fmt(d.steps)),
    stat("SpO₂", fmt(d.spo2, 1, " %")),
    stat("Atemfrequenz", fmt(d.respRate, 1, " /min")),
    stat("Hauttemp.", d.skinTemp == null ? "–" : `${d.skinTemp > 0 ? "+" : ""}${fmt(d.skinTemp, 1, " °C")}`),
    stat("Kalorien", fmt(d.calories, 0, " kcal")),
  ].join("");
}

// Frühwarnung ähnlich dem WHOOP Health Monitor.
function healthWarnings(d) {
  const out = [];
  const resp = avgOf("respRate");
  const rhr = avgOf("rhr");
  if (d.skinTemp != null && d.skinTemp >= 0.6) out.push(`Hauttemperatur deutlich erhöht (+${fmt(d.skinTemp, 1)} °C).`);
  if (d.respRate != null && resp != null && d.respRate - resp >= 1) out.push(`Atemfrequenz über deinem Normalwert (${fmt(d.respRate, 1)} vs. ${fmt(resp, 1)}).`);
  if (d.rhr != null && rhr != null && d.rhr - rhr >= 5) out.push(`Ruhepuls ${fmt(d.rhr - rhr)} bpm über deinem Schnitt.`);
  if (d.spo2 != null && d.spo2 < 93) out.push(`Niedrige Sauerstoffsättigung (${fmt(d.spo2, 1)} %).`);
  if (out.length >= 2) out.push("Mehrere Werte weichen ab, das kann auf Krankheit, Stress oder Alkohol hindeuten.");
  return out;
}

function lastN(n) {
  return days.slice(Math.max(0, idx - n + 1), idx + 1);
}

function renderRecovery() {
  const d = days[idx];
  const rd = d.recoveryDetail;
  $("#recovery-hero").innerHTML = rd
    ? `<div class="big" style="color:${ZONE_COLOR[rd.zone]}">${rd.score}%</div>
       <div><strong>${ZONE_TEXT[rd.zone]}</strong>
       <div class="sub">${rd.personalBaseline ? "Basierend auf deiner persönlichen 30-Tage-Baseline" : "Baseline wird noch aufgebaut (mind. 4 Tage), vorerst Durchschnittswerte"}</div></div>`
    : `<div class="sub">Für diesen Tag fehlen HRV und Ruhepuls.</div>`;
  const names = { hrv: "HRV", rhr: "Ruhepuls", respRate: "Atemfrequenz", sleep: "Schlafleistung" };
  $("#recovery-stats").innerHTML = (rd?.parts ?? []).map((p) => {
    const effect = p.z > 0.3 ? ["positiv", "up"] : p.z < -0.3 ? ["negativ", "down"] : ["neutral", ""];
    return stat(`${names[p.key]} (${Math.round(p.w * 100)} %)`, `${p.z > 0 ? "+" : ""}${fmt(p.z, 1)} σ`, `Einfluss ${effect[0]}`, effect[1]);
  }).join("");
  const range = lastN(30);
  charts.trend($("#chart-recovery"), range.map((x) => ({ date: x.date, value: x.recovery, color: ZONE_COLOR[x.recoveryDetail?.zone] })), { min: 0, max: 100, unit: " %" });
  const hrvAvg = avgOf("hrv");
  charts.trend($("#chart-hrv"), range.map((x) => ({ date: x.date, value: x.hrv })), { type: "line", unit: " ms", band: hrvAvg ? { min: hrvAvg * 0.9, max: hrvAvg * 1.1 } : null });
  charts.trend($("#chart-rhr"), range.map((x) => ({ date: x.date, value: x.rhr })), { type: "line", unit: " bpm" });
}

function renderStrain() {
  const d = days[idx];
  const sd = d.strainDetail;
  const t = d.strainTarget;
  $("#strain-hero").innerHTML = `
    <div class="big" style="color:var(--strain)">${fmt(d.strain, 1)}</div>
    <div><strong>Ziel heute: ${t.min}–${t.max}</strong> <span class="muted">(${t.label})</span>
    <div class="sub">${sd?.estimated ? "Geschätzt aus Schritten (keine Herzfrequenzdaten)" : `Belastungsscore TRIMP ${fmt(sd?.trimp)}`}</div></div>`;
  const hrMax = maxHeartRate(settings);
  charts.heartRateDay($("#chart-hrday"), d.hr, { hrMax, zoneColors: HR_ZONE_COLORS });
  const zoneNames = ["< 50 %", "Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"];
  const zones = sd?.zones ?? [0, 0, 0, 0, 0, 0];
  const maxZ = Math.max(1, ...zones.slice(1));
  $("#zones").innerHTML = `<div class="zones">${zones.map((m, i) => i === 0 ? "" : `
    <div class="zone"><span>${zoneNames[i]} <span class="muted">${50 + (i - 1) * 10}–${60 + (i - 1) * 10} %</span></span>
    <div class="bar"><i style="left:0;width:${(m / maxZ) * 100}%;background:${HR_ZONE_COLORS[i]}"></i></div>
    <span>${fmtDur(m)}</span></div>`).join("")}</div>`;
  const hrs = (d.hr ?? []).map((s) => s[1]);
  $("#strain-stats").innerHTML = [
    stat("Ø Herzfrequenz", fmt(mean(hrs), 0, " bpm")),
    stat("Max. Herzfrequenz", hrs.length ? fmt(Math.max(...hrs), 0, " bpm") : "–", `HFmax ${hrMax}`),
    stat("Schritte", fmt(d.steps)),
    stat("Kalorien", fmt(d.calories, 0, " kcal")),
    stat("Aktivzonenminuten", fmt(d.azm, 0, " min")),
  ].join("");
  charts.trend($("#chart-strain"), lastN(30).map((x) => ({ date: x.date, value: x.strain, color: "var(--strain)" })), { min: 0, max: 21 });
}

function renderSleep() {
  const d = days[idx];
  const s = d.sleep;
  $("#sleep-hero").innerHTML = s
    ? `<div class="big" style="color:var(--sleep)">${d.sleepPerformance}%</div>
       <div><strong>${fmtDur(s.asleepMinutes)} von ${fmtDur(d.sleepNeed)} Bedarf</strong>
       <div class="sub">${fmtClock(s.startMin)} – ${fmtClock(s.endMin)}${s.napMinutes ? ` · Nickerchen ${fmtDur(s.napMinutes)}` : ""}</div></div>`
    : `<div class="sub">Keine Schlafdaten für diese Nacht.</div>`;
  const colors = STAGE_COLORS();
  charts.hypnogram($("#chart-hypno"), s?.hypnogram, s?.inBedMinutes ?? 1, colors);
  const names = { awake: "Wach", rem: "REM", light: "Leicht", deep: "Tief" };
  $("#stage-legend").innerHTML = Object.entries(names).map(([k, n]) => `<span style="--c:${colors[k]}">${n} ${fmtDur(s?.stages?.[k])}</span>`).join("");
  const bed = recommendedBedtime(days, idx, settings);
  const pct = (k) => (s?.asleepMinutes ? `${Math.round((s.stages[k] / s.asleepMinutes) * 100)} % des Schlafs` : "");
  $("#sleep-stats").innerHTML = [
    stat("Im Bett", fmtDur(s?.inBedMinutes)),
    stat("Effizienz", fmt(d.sleepEfficiency, 0, " %")),
    stat("Konsistenz", fmt(d.sleepConsistency, 0, " %"), "Regelmäßigkeit der letzten 4 Nächte"),
    stat("Schlafschuld", fmtDur(d.sleepDebt)),
    stat("Tiefschlaf", fmtDur(s?.stages?.deep), pct("deep")),
    stat("REM", fmtDur(s?.stages?.rem), pct("rem")),
    stat("Atemfrequenz", fmt(d.respRate, 1, " /min")),
    stat("Heute ins Bett", fmtClock(bed.bedtimeMin), `für ${fmtDur(bed.needMinutes)} Schlaf`),
  ].join("");
  charts.trend($("#chart-sleep"), lastN(30).map((x) => ({
    date: x.date, value: x.sleep ? Math.round((x.sleep.asleepMinutes / 60) * 10) / 10 : null,
    color: x.sleepPerformance >= 85 ? "var(--sleep)" : x.sleepPerformance >= 70 ? "var(--yellow)" : "var(--red)",
  })), { min: 0, unit: " h" });
}

function renderTrends() {
  const range = lastN(trendRange);
  $$("#trend-range button").forEach((b) => b.classList.toggle("active", Number(b.dataset.range) === trendRange));
  const m = (k) => mean(range.map((x) => x[k]));
  const sleepH = mean(range.map((x) => x.sleep?.asleepMinutes));
  const greens = range.filter((x) => x.recoveryDetail?.zone === "green").length;
  const withRec = range.filter((x) => x.recovery != null).length;
  $("#trend-stats").innerHTML = [
    stat("Ø Recovery", fmt(m("recovery"), 0, " %"), withRec ? `${Math.round((greens / withRec) * 100)} % grüne Tage` : ""),
    stat("Ø Strain", fmt(m("strain"), 1)),
    stat("Ø Schlaf", fmtDur(sleepH)),
    stat("Ø HRV", fmt(m("hrv"), 0, " ms")),
    stat("Ø Ruhepuls", fmt(m("rhr"), 0, " bpm")),
    stat("Ø Schritte", fmt(m("steps"))),
  ].join("");
  // Recovery (Balken) und Strain auf 0–100 skaliert (Linie) in einem Diagramm.
  charts.trend($("#chart-trend-rs"), range.map((x) => ({ date: x.date, value: x.recovery, color: ZONE_COLOR[x.recoveryDetail?.zone] })), { min: 0, max: 100, unit: " %" });
  const svg = $("#chart-trend-rs svg");
  if (svg) {
    const strainLine = document.createElement("div");
    charts.trend(strainLine, range.map((x) => ({ date: x.date, value: x.strain == null ? null : Math.round((x.strain / 21) * 1000) / 10 })), { type: "line", min: 0, max: 100, fixedWidth: svg.viewBox.baseVal.width });
    const line = strainLine.querySelector("polyline");
    if (line) {
      line.style.stroke = "var(--strain)";
      svg.appendChild(line);
    }
  }
  charts.trend($("#chart-spo2"), range.map((x) => ({ date: x.date, value: x.spo2 })), { type: "line", unit: " %", max: 100 });
  charts.trend($("#chart-resp"), range.map((x) => ({ date: x.date, value: x.respRate })), { type: "line", unit: " /min" });
  charts.trend($("#chart-skin"), range.map((x) => ({ date: x.date, value: x.skinTemp })), { type: "line", unit: " °C", min: -1.5, max: 1.5 });
  charts.trend($("#chart-steps"), range.map((x) => ({ date: x.date, value: x.steps })), { min: 0 });
}

const TABLE_COLS = [
  ["date", "Datum", (d) => d.date],
  ["recovery", "Recovery %", (d) => d.recovery],
  ["strain", "Strain", (d) => d.strain],
  ["sleepPerformance", "Schlaf %", (d) => d.sleepPerformance],
  ["asleep", "Schlaf (min)", (d) => d.sleep?.asleepMinutes],
  ["deep", "Tief (min)", (d) => d.sleep?.stages?.deep],
  ["rem", "REM (min)", (d) => d.sleep?.stages?.rem],
  ["hrv", "HRV ms", (d) => d.hrv],
  ["rhr", "Ruhepuls", (d) => d.rhr],
  ["spo2", "SpO₂ %", (d) => d.spo2],
  ["respRate", "Atemfr.", (d) => d.respRate],
  ["skinTemp", "Hauttemp. Δ", (d) => d.skinTemp],
  ["steps", "Schritte", (d) => d.steps],
  ["calories", "kcal", (d) => d.calories],
  ["azm", "AZM", (d) => d.azm],
];

function renderData() {
  const status = meta.status ?? {};
  $("#source-status").innerHTML = meta.demo
    ? `<p class="muted">Demo-Modus: synthetische Beispieldaten.</p>`
    : DATA_TYPES.map((t) => {
      const st = status[t.id];
      const right = !st ? `<span class="muted">noch nicht geladen</span>`
        : st.ok ? `<span class="ok">✓ ${st.count} Punkte</span>`
          : `<span class="err">✗ ${st.code ?? ""} ${st.error ?? ""}</span>`;
      return `<div class="src"><span>${t.label} <span class="muted">${st?.apiId ?? t.id}</span></span>${right}</div>`;
    }).join("");
  $("#last-sync").textContent = meta.lastSync ? `Letzte Synchronisation: ${new Date(meta.lastSync).toLocaleString("de-DE")}` : "";
  const rows = [...days].reverse().map((d) => `<tr>${TABLE_COLS.map(([, , f]) => `<td>${f(d) ?? "–"}</td>`).join("")}</tr>`).join("");
  $("#data-table").innerHTML = `<table><thead><tr>${TABLE_COLS.map(([, h]) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
}

function render() {
  const hasData = days.length > 0;
  $("#welcome").hidden = hasData;
  $("#app").hidden = !hasData;
  $("#tabbar").hidden = !hasData;
  if (!hasData) return;
  $("#day-label").textContent = dayLabel(days[idx].date);
  $("#day-prev").disabled = idx <= 0;
  $("#day-next").disabled = idx >= days.length - 1;
  $$(".view").forEach((v) => (v.hidden = v.dataset.view !== view));
  $$("#tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === view));
  ({ today: renderToday, recovery: renderRecovery, strain: renderStrain, sleep: renderSleep, trends: renderTrends, data: renderData })[view]();
}

// ---------- Aktionen ----------
async function sync() {
  if (!settings.clientId) {
    openSettings();
    setStatus("Trage zuerst deine OAuth-Client-ID ein (siehe README).", true);
    return;
  }
  const btn = $("#btn-sync");
  btn.classList.add("spinning");
  try {
    let token = getToken() ?? (await signIn(settings));
    if (meta.demo) {
      rawDays = {};
      meta = { lastSync: null, status: {}, demo: false };
    }
    let result;
    try {
      result = await syncAll({ token, settings, existingDays: rawDays, lastSync: meta.lastSync, onProgress: setStatus });
    } catch (e) {
      if (e.status !== 401) throw e;
      clearToken();
      token = await signIn(settings);
      result = await syncAll({ token, settings, existingDays: rawDays, lastSync: meta.lastSync, onProgress: setStatus });
    }
    rawDays = result.days;
    const okCount = Object.values(result.status).filter((s) => s.ok).length;
    meta = { lastSync: okCount ? result.syncedAt : meta.lastSync, status: result.status, demo: false };
    store.saveDays(rawDays);
    store.saveMeta(meta);
    idx = -1;
    recompute();
    const failed = DATA_TYPES.length - okCount;
    setStatus(failed ? `Synchronisiert, ${failed} Datentyp(en) nicht verfügbar (Details unter „Daten“).` : "Synchronisiert.", okCount === 0);
    if (!failed) setTimeout(() => setStatus(null), 3000);
  } catch (e) {
    setStatus(`Fehler: ${e.message}`, true);
  } finally {
    btn.classList.remove("spinning");
    render();
  }
}

function loadDemo() {
  rawDays = generateDemoDays();
  meta = { lastSync: null, status: {}, demo: true };
  store.saveDays(rawDays);
  store.saveMeta(meta);
  idx = -1;
  recompute();
  setStatus("Demo-Modus aktiv. Über ⟳ verbindest du deine echte Fitbit Air.");
  render();
}

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportCsv() {
  const esc = (v) => (v == null ? "" : String(v));
  const lines = [TABLE_COLS.map(([k]) => k).join(",")];
  for (const d of days) lines.push(TABLE_COLS.map(([, , f]) => esc(f(d))).join(","));
  download(`fitbit-air-${dateKey(new Date())}.csv`, lines.join("\n"), "text/csv");
}

async function importJson(file) {
  try {
    const json = JSON.parse(await file.text());
    const incoming = json.days ?? json;
    if (typeof incoming !== "object" || Array.isArray(incoming)) throw new Error("Unbekanntes Format");
    rawDays = { ...rawDays, ...incoming };
    store.saveDays(rawDays);
    recompute();
    setStatus(`${Object.keys(incoming).length} Tage importiert.`);
    render();
  } catch (e) {
    setStatus(`Import fehlgeschlagen: ${e.message}`, true);
  }
}

function openSettings() {
  const f = $("#settings-form");
  f.clientId.value = settings.clientId ?? "";
  f.scopes.value = settings.scopes;
  f.syncDays.value = settings.syncDays;
  f.dataTypeOverrides.value = Object.keys(settings.dataTypeOverrides ?? {}).length ? JSON.stringify(settings.dataTypeOverrides) : "";
  f.age.value = settings.age ?? "";
  f.sex.value = settings.sex;
  f.hrMax.value = settings.hrMax ?? "";
  f.sleepBaseHours.value = (settings.sleepBaseMinutes ?? 480) / 60;
  $("#settings").showModal();
}

function saveSettingsFromForm() {
  const f = $("#settings-form");
  let overrides = {};
  try {
    overrides = f.dataTypeOverrides.value.trim() ? JSON.parse(f.dataTypeOverrides.value) : {};
  } catch {
    setStatus("Datentyp-Überschreibungen sind kein gültiges JSON und wurden ignoriert.", true);
    overrides = settings.dataTypeOverrides ?? {};
  }
  const num = (v) => (v === "" ? null : Number(v));
  settings = {
    ...settings,
    clientId: f.clientId.value.trim(),
    scopes: f.scopes.value.trim().replace(/\s+/g, " "),
    syncDays: Math.min(180, Math.max(7, num(f.syncDays.value) ?? 30)),
    dataTypeOverrides: overrides,
    age: num(f.age.value),
    sex: f.sex.value,
    hrMax: num(f.hrMax.value),
    sleepBaseMinutes: Math.round((num(f.sleepBaseHours.value) ?? 8) * 60),
  };
  store.saveSettings(settings);
  recompute();
  render();
}

// ---------- Ereignisse ----------
$("#btn-sync").addEventListener("click", sync);
$("#btn-connect").addEventListener("click", sync);
$("#btn-demo").addEventListener("click", loadDemo);
$("#btn-settings").addEventListener("click", openSettings);
$("#settings").addEventListener("close", () => {
  if ($("#settings").returnValue === "save") saveSettingsFromForm();
});
$("#btn-signout").addEventListener("click", () => {
  clearToken();
  setStatus("Abgemeldet.");
});
$("#btn-reset").addEventListener("click", () => {
  if (!confirm("Alle lokal gespeicherten Gesundheitsdaten und Einstellungen löschen?")) return;
  clearToken();
  store.clearAll();
  settings = store.loadSettings();
  meta = store.loadMeta();
  rawDays = {};
  recompute();
  $("#settings").close();
  setStatus(null);
  render();
});
$("#day-prev").addEventListener("click", () => { idx = Math.max(0, idx - 1); render(); });
$("#day-next").addEventListener("click", () => { idx = Math.min(days.length - 1, idx + 1); render(); });
$$("#tabbar button").forEach((b) => b.addEventListener("click", () => { view = b.dataset.tab; render(); window.scrollTo(0, 0); }));
$$("[data-goto]").forEach((b) => b.addEventListener("click", () => { view = b.dataset.goto; render(); }));
$$("#trend-range button").forEach((b) => b.addEventListener("click", () => { trendRange = Number(b.dataset.range); render(); }));
$("#btn-export-json").addEventListener("click", () => download(`fitbit-air-${dateKey(new Date())}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), days: rawDays }), "application/json"));
$("#btn-export-csv").addEventListener("click", exportCsv);
$("#import-file").addEventListener("change", (e) => e.target.files[0] && importJson(e.target.files[0]));

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 200);
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

recompute();
render();
