// Scoring im Stil von WHOOP: Recovery (0–100 %), Strain (0–21), Schlaf.
// Die Formeln sind eigene, nachvollziehbare Näherungen und nicht die
// proprietären WHOOP-Algorithmen. Alle Funktionen sind rein (ohne DOM), damit
// sie in Node getestet werden können.

export const RECOVERY_ZONES = { green: 67, yellow: 34 };
export const STRAIN_MAX = 21;
const STRAIN_K = 100;          // TRIMP, bei dem Strain ≈ 13,3 erreicht
const STRAIN_HRR_FLOOR = 0.2;  // unterhalb 20 % HF-Reserve zählt nichts
const BASELINE_DAYS = 30;
const MIN_BASELINE_DAYS = 4;

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const isNum = (x) => typeof x === "number" && Number.isFinite(x);

export function mean(xs) {
  const v = xs.filter(isNum);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function sd(xs) {
  const v = xs.filter(isNum);
  if (v.length < 2) return null;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

export function maxHeartRate(profile = {}) {
  if (isNum(profile.hrMax) && profile.hrMax > 100) return profile.hrMax;
  const age = isNum(profile.age) ? profile.age : 35;
  return Math.round(208 - 0.7 * age); // Tanaka et al. (2001)
}

export function recoveryZone(score) {
  if (!isNum(score)) return null;
  if (score >= RECOVERY_ZONES.green) return "green";
  if (score >= RECOVERY_ZONES.yellow) return "yellow";
  return "red";
}

// Mittelwert/Standardabweichung der Vortage (ohne den Tag selbst).
export function baseline(days, index, key, transform = (x) => x) {
  const from = Math.max(0, index - BASELINE_DAYS);
  const values = days.slice(from, index).map((d) => d[key]).filter(isNum).map(transform);
  if (values.length < MIN_BASELINE_DAYS) return null;
  return { mean: mean(values), sd: Math.max(sd(values) ?? 0, 1e-6), n: values.length };
}

// Populationswerte, solange noch keine persönliche Baseline existiert.
const POPULATION = {
  lnHrv: { mean: Math.log(40), sd: 0.35 },
  rhr: { mean: 62, sd: 5 },
  respRate: { mean: 15, sd: 1 },
};

const z = (value, base, fallback) => {
  const b = base ?? fallback;
  return (value - b.mean) / Math.max(b.sd, fallback.sd * 0.25);
};

// Recovery aus HRV (dominant), Ruhepuls, Atemfrequenz und Schlafleistung.
export function computeRecovery(days, index) {
  const d = days[index];
  if (!d || (!isNum(d.hrv) && !isNum(d.rhr))) return null;
  const parts = [];
  if (isNum(d.hrv) && d.hrv > 0) {
    const b = baseline(days, index, "hrv", Math.log);
    parts.push({ key: "hrv", w: 0.55, z: z(Math.log(d.hrv), b, POPULATION.lnHrv) });
  }
  if (isNum(d.rhr)) {
    const b = baseline(days, index, "rhr");
    parts.push({ key: "rhr", w: 0.2, z: -z(d.rhr, b, POPULATION.rhr) });
  }
  if (isNum(d.respRate)) {
    const b = baseline(days, index, "respRate");
    parts.push({ key: "respRate", w: 0.05, z: -z(d.respRate, b, POPULATION.respRate) });
  }
  if (isNum(d.sleepPerformance)) {
    parts.push({ key: "sleep", w: 0.2, z: (d.sleepPerformance / 100 - 0.85) / 0.1 });
  }
  const wSum = parts.reduce((a, p) => a + p.w, 0);
  const composite = parts.reduce((a, p) => a + p.w * clamp(p.z, -3, 3), 0) / wSum;
  const score = Math.round(clamp(100 / (1 + Math.exp(-(1.4 * composite + 0.4))), 1, 99));
  return { score, zone: recoveryZone(score), parts, personalBaseline: index >= MIN_BASELINE_DAYS };
}

// Banister-TRIMP über Herzfrequenz-Minutenwerte, logarithmisch auf 0–21 skaliert.
// samples: [[minuteOfDay, bpm], ...] (sortiert)
export function computeStrain(samples, { rhr, hrMax, sex = "m", steps } = {}) {
  const restHr = isNum(rhr) ? rhr : 60;
  const zones = [0, 0, 0, 0, 0, 0]; // Minuten in Zone 0 (<50 %) … 5 (90–100 % HFmax)
  let trimp = 0;
  const [a, b] = sex === "f" ? [0.86, 1.67] : [0.64, 1.92];
  if (Array.isArray(samples) && samples.length) {
    for (let i = 0; i < samples.length; i++) {
      const [t, bpm] = samples[i];
      const next = samples[i + 1];
      const dt = next ? clamp(next[0] - t, 0, 5) : 1; // Lücken > 5 min nicht hochrechnen
      const pct = bpm / hrMax;
      zones[pct < 0.5 ? 0 : Math.min(5, Math.floor((pct - 0.4) * 10))] += dt;
      const hrr = clamp((bpm - restHr) / (hrMax - restHr), 0, 1.1);
      if (hrr >= STRAIN_HRR_FLOOR) trimp += dt * hrr * a * Math.exp(b * hrr);
    }
  } else if (isNum(steps)) {
    trimp = steps / 250; // grobe Schätzung ohne Herzfrequenz
  } else {
    return null;
  }
  const strain = STRAIN_MAX * (1 - Math.exp(-trimp / STRAIN_K));
  return { strain: Math.round(strain * 10) / 10, trimp: Math.round(trimp), zones, estimated: !samples?.length };
}

// Ziel-Strain abhängig von der Recovery.
export function strainTarget(recovery) {
  if (!isNum(recovery)) return { min: 8, max: 14, label: "Moderat" };
  if (recovery >= RECOVERY_ZONES.green) return { min: 14, max: 18, label: "Hohe Belastung möglich" };
  if (recovery >= RECOVERY_ZONES.yellow) return { min: 10, max: 14, label: "Moderat belasten" };
  return { min: 0, max: 10, label: "Aktive Erholung" };
}

// Schlafbedarf in Minuten: Basis + Belastung des Vortags + Schlafschuld (je max. 45 min).
export function sleepNeed({ baseMinutes = 480, prevStrain, debtMinutes = 0, napMinutes = 0 }) {
  const strainAdd = isNum(prevStrain) ? Math.min(45, Math.max(0, prevStrain - 10) * 5) : 0;
  const debtAdd = Math.min(45, 0.4 * Math.max(0, debtMinutes));
  return Math.round(baseMinutes + strainAdd + debtAdd - napMinutes);
}

// Konsistenz: Abweichung der Einschlaf-/Aufwachzeiten über die letzten 4 Nächte.
export function sleepConsistency(sleeps) {
  const valid = sleeps.filter((s) => s && isNum(s.startMin) && isNum(s.endMin));
  if (valid.length < 2) return null;
  const circular = (arr) => {
    const m = mean(arr);
    return mean(arr.map((x) => Math.abs(x - m)));
  };
  // Einschlafzeiten relativ zu 12:00 mittags, damit Mitternacht nicht springt.
  const starts = valid.map((s) => (s.startMin + 720) % 1440);
  const ends = valid.map((s) => s.endMin);
  const dev = (circular(starts) + circular(ends)) / 2;
  return Math.round(clamp(100 - dev * 0.8, 0, 100));
}

// Berechnet alle abgeleiteten Werte für eine nach Datum sortierte Tagesliste.
export function analyzeDays(rawDays, profile = {}) {
  const hrMax = maxHeartRate(profile);
  const baseSleep = isNum(profile.sleepBaseMinutes) ? profile.sleepBaseMinutes : 480;
  const days = rawDays.map((d) => ({ ...d }));
  let debt = 0;
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const prev = days[i - 1];
    const need = sleepNeed({
      baseMinutes: baseSleep,
      prevStrain: prev?.strain,
      debtMinutes: debt,
      napMinutes: d.sleep?.napMinutes ?? 0,
    });
    d.sleepNeed = need;
    if (d.sleep && isNum(d.sleep.asleepMinutes)) {
      d.sleepPerformance = Math.round(clamp((d.sleep.asleepMinutes / need) * 100, 0, 100));
      // Schuld gegenüber dem Basisbedarf, damit sie sich nicht selbst aufschaukelt.
      debt = clamp(debt * 0.6 + (baseSleep - d.sleep.asleepMinutes) * 0.5, 0, 120);
      d.sleepEfficiency = isNum(d.sleep.inBedMinutes) && d.sleep.inBedMinutes > 0
        ? Math.round((d.sleep.asleepMinutes / d.sleep.inBedMinutes) * 100)
        : null;
    }
    d.sleepDebt = Math.round(debt);
    d.sleepConsistency = sleepConsistency(days.slice(Math.max(0, i - 3), i + 1).map((x) => x.sleep));
    const strain = computeStrain(d.hr, { rhr: d.rhr, hrMax, sex: profile.sex, steps: d.steps });
    d.strain = strain?.strain ?? null;
    d.strainDetail = strain;
    const rec = computeRecovery(days, i);
    d.recovery = rec?.score ?? null;
    d.recoveryDetail = rec;
    d.strainTarget = strainTarget(d.recovery);
  }
  return days;
}

// Empfohlene Schlafenszeit für heute Nacht (Minuten seit Mitternacht).
export function recommendedBedtime(days, index, profile = {}) {
  const recent = days.slice(Math.max(0, index - 6), index + 1).map((d) => d.sleep?.endMin).filter(isNum);
  const wake = recent.length ? Math.round(mean(recent)) : 7 * 60;
  const d = days[index];
  const need = sleepNeed({
    baseMinutes: isNum(profile.sleepBaseMinutes) ? profile.sleepBaseMinutes : 480,
    prevStrain: d?.strain,
    debtMinutes: d?.sleepDebt ?? 0,
  });
  const inBed = need / 0.92 + 10; // Schlafeffizienz und Einschlafzeit einplanen
  return { bedtimeMin: Math.round((wake - inBed + 1440 * 2) % 1440), wakeMin: wake, needMinutes: need };
}
