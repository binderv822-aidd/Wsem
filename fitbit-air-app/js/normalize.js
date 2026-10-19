// Wandelt Google-Health-API-Datenpunkte in Tagesdatensätze um.
// Die Parser sind bewusst tolerant: Sie suchen Zeitstempel und Messwerte
// strukturell, damit kleinere Schemaänderungen der API nichts kaputt machen.

const META_KEYS = new Set(["name", "dataSource", "source", "metadata", "createTime", "updateTime", "dataType", "platform", "device", "dataOrigin"]);
const TIME_KEYS = new Set(["year", "month", "day", "hours", "minutes", "seconds", "nanos", "utcOffset", "offset", "timeZone"]);

const PREFERRED_VALUE_KEYS = {
  hr: ["beatsPerMinute", "bpm", "heartRate", "value"],
  rhr: ["beatsPerMinute", "restingHeartRate", "bpm", "value"],
  hrv: ["rootMeanSquareOfSuccessiveDifferencesMilliseconds", "rmssdMillis", "rmssd", "averageRmssd", "dailyRmssd", "value"],
  spo2: ["percentage", "averagePercentage", "average", "avg", "value"],
  respRate: ["breathsPerMinute", "breathingRate", "fullSleepBreathingRate", "value"],
  skinTemp: ["nightlyRelativeCelsius", "relativeCelsius", "deltaCelsius", "nightlyRelative", "celsius", "value"],
  steps: ["count", "steps", "value"],
  calories: ["kcal", "kilocalories", "calories", "energy", "value"],
  azm: ["activeZoneMinutes", "totalMinutes", "minutes", "count", "value"],
};

export const pad = (n) => String(n).padStart(2, "0");
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const minuteOfDay = (d) => d.getHours() * 60 + d.getMinutes();

export function payloadOf(point) {
  if (!point || typeof point !== "object") return null;
  for (const [k, v] of Object.entries(point)) {
    if (!META_KEYS.has(k) && v && typeof v === "object" && !Array.isArray(v)) return v;
  }
  return point;
}

function findKey(obj, keys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 5) return undefined;
  for (const k of keys) if (obj[k] !== undefined) return obj[k];
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const r = findKey(v, keys, depth + 1);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

function toDate(t) {
  if (!t) return null;
  if (typeof t === "string" || typeof t === "number") {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof t === "object") {
    if (t.physicalTime) return toDate(t.physicalTime);
    if (t.time) return toDate(t.time);
    if (t.year && t.month) {
      return new Date(t.year, t.month - 1, t.day ?? 1, t.hours ?? 0, t.minutes ?? 0, t.seconds ?? 0);
    }
  }
  return null;
}

export function timeOf(payload) {
  const interval = findKey(payload, ["interval", "civilInterval"]);
  const start = toDate(interval?.startTime ?? interval?.civilStartTime ?? findKey(payload, ["startTime"]));
  const end = toDate(interval?.endTime ?? interval?.civilEndTime ?? findKey(payload, ["endTime"]));
  const sample = toDate(findKey(payload, ["sampleTime", "physicalTime", "time"]));
  const rawDate = findKey(payload, ["date"]);
  let date = null;
  if (typeof rawDate === "string") date = rawDate.slice(0, 10);
  else if (rawDate?.year) date = `${rawDate.year}-${pad(rawDate.month)}-${pad(rawDate.day)}`;
  return { start, end, sample, date };
}

function numericLeaves(obj, out = [], depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 5) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (TIME_KEYS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    else if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && !/time|date/i.test(k)) out.push(Number(v));
    else if (v && typeof v === "object" && !Array.isArray(v) && !/time|date|interval/i.test(k)) numericLeaves(v, out, depth + 1);
  }
  return out;
}

export function valueOf(payload, metric) {
  const v = findKey(payload, PREFERRED_VALUE_KEYS[metric] ?? ["value"]);
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  if (v && typeof v === "object") return numericLeaves(v)[0] ?? null;
  return numericLeaves(payload)[0] ?? null;
}

const STAGE_PATTERNS = [
  ["deep", /deep|slow/i],
  ["rem", /rem/i],
  ["awake", /wake|awake|restless/i],
  ["light", /light|core|asleep/i],
];

function stageName(raw) {
  const s = String(raw ?? "");
  for (const [name, re] of STAGE_PATTERNS) if (re.test(s)) return name;
  return "light";
}

export function parseSleep(payload) {
  const { start, end } = timeOf(payload);
  if (!start || !end || end <= start) return null;
  const inBed = Math.round((end - start) / 60000);
  const stagesRaw = findKey(payload, ["stages", "segments", "levels"]);
  const stages = { deep: 0, light: 0, rem: 0, awake: 0 };
  const hypnogram = [];
  if (Array.isArray(stagesRaw) && stagesRaw.length) {
    for (const s of stagesRaw) {
      const t = timeOf(s);
      const sStart = t.start ?? null;
      const sEnd = t.end ?? null;
      let mins = sStart && sEnd ? (sEnd - sStart) / 60000 : Number(findKey(s, ["minutes", "durationMinutes"])) || 0;
      if (!mins && s.seconds) mins = s.seconds / 60;
      const name = stageName(s.type ?? s.stage ?? s.level ?? s.sleepStageType);
      stages[name] += mins;
      if (sStart) hypnogram.push([Math.round((sStart - start) / 60000), Math.round(mins), name]);
    }
  }
  const staged = stages.deep + stages.light + stages.rem;
  const summaryAsleep = Number(findKey(payload, ["minutesAsleep", "asleepMinutes"]));
  const asleep = staged > 0 ? staged : Number.isFinite(summaryAsleep) && summaryAsleep > 0 ? summaryAsleep : inBed - stages.awake;
  const typeStr = String(findKey(payload, ["type", "sleepType"]) ?? "");
  const mainFlag = findKey(payload, ["isMainSleep", "mainSleep"]);
  const isNap = mainFlag === false || /nap/i.test(typeStr) || (inBed < 180 && start.getHours() >= 9 && start.getHours() < 20);
  for (const k of Object.keys(stages)) stages[k] = Math.round(stages[k]);
  return {
    start, end, isNap, inBedMinutes: inBed, asleepMinutes: Math.round(asleep), stages,
    hypnogram: hypnogram.sort((a, b) => a[0] - b[0]),
  };
}

function ensureDay(days, key) {
  if (!days[key]) days[key] = { date: key };
  return days[key];
}

// Fügt die Datenpunkte eines Datentyps in die Tagesstruktur ein.
export function mergePoints(days, type, points) {
  const metric = type.metric;
  if (metric === "hr") {
    const buckets = {};
    for (const p of points) {
      const pl = payloadOf(p);
      const t = timeOf(pl);
      const when = t.sample ?? t.start;
      const bpm = valueOf(pl, "hr");
      if (!when || !Number.isFinite(bpm) || bpm < 25 || bpm > 240) continue;
      const key = dateKey(when);
      const m = minuteOfDay(when);
      const b = (buckets[key] ??= new Map());
      const cur = b.get(m) ?? [0, 0];
      b.set(m, [cur[0] + bpm, cur[1] + 1]);
    }
    for (const [key, map] of Object.entries(buckets)) {
      ensureDay(days, key).hr = [...map.entries()].sort((a, b) => a[0] - b[0]).map(([m, [s, n]]) => [m, Math.round(s / n)]);
    }
    return;
  }
  if (metric === "sleep") {
    const perDay = {};
    for (const p of points) {
      const s = parseSleep(payloadOf(p));
      if (s) (perDay[dateKey(s.end)] ??= []).push(s);
    }
    for (const [key, list] of Object.entries(perDay)) {
      const main = list.filter((s) => !s.isNap).sort((a, b) => b.inBedMinutes - a.inBedMinutes)[0]
        ?? list.sort((a, b) => b.inBedMinutes - a.inBedMinutes)[0];
      const naps = list.filter((s) => s !== main);
      ensureDay(days, key).sleep = {
        startIso: main.start.toISOString(),
        endIso: main.end.toISOString(),
        startMin: minuteOfDay(main.start),
        endMin: minuteOfDay(main.end),
        inBedMinutes: main.inBedMinutes,
        asleepMinutes: main.asleepMinutes,
        stages: main.stages,
        hypnogram: main.hypnogram,
        napMinutes: naps.reduce((a, s) => a + s.asleepMinutes, 0),
      };
    }
    return;
  }
  const sums = {};
  const counts = {};
  for (const p of points) {
    const pl = payloadOf(p);
    const t = timeOf(pl);
    const key = t.date ?? (t.start ? dateKey(t.start) : t.sample ? dateKey(t.sample) : null);
    const v = valueOf(pl, metric);
    if (!key || !Number.isFinite(v)) continue;
    sums[key] = (sums[key] ?? 0) + v;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const additive = type.kind === "interval";
  for (const key of Object.keys(sums)) {
    const v = additive ? sums[key] : sums[key] / counts[key];
    ensureDay(days, key)[metric] = Math.round(v * 10) / 10;
  }
}
