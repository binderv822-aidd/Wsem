import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeDays, computeStrain, computeRecovery, recoveryZone, sleepNeed, sleepConsistency, strainTarget } from "../js/scoring.js";
import { mergePoints, parseSleep, valueOf, payloadOf } from "../js/normalize.js";
import { generateDemoDays } from "../js/demo.js";

const flat = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, hrv: 50, rhr: 55, ...extra }));

test("Recovery ist bei Baseline-Werten im gelben/grünen Mittelfeld", () => {
  const days = flat(10);
  const r = computeRecovery(days, 9);
  assert.ok(r.score > 45 && r.score < 75, `score ${r.score}`);
});

test("Höhere HRV und niedrigerer Ruhepuls erhöhen die Recovery", () => {
  const days = flat(10).map((d, i) => ({ ...d, hrv: 50 + (i % 2 ? 3 : -3) }));
  const good = [...days.slice(0, 9), { date: "x", hrv: 75, rhr: 50 }];
  const bad = [...days.slice(0, 9), { date: "x", hrv: 30, rhr: 62 }];
  const g = computeRecovery(good, 9).score;
  const b = computeRecovery(bad, 9).score;
  assert.ok(g >= 67, `gut ${g}`);
  assert.ok(b <= 33, `schlecht ${b}`);
});

test("Recovery-Zonen entsprechen WHOOP-Schwellen", () => {
  assert.equal(recoveryZone(67), "green");
  assert.equal(recoveryZone(66), "yellow");
  assert.equal(recoveryZone(34), "yellow");
  assert.equal(recoveryZone(33), "red");
});

test("Strain: Ruhetag niedrig, Training deutlich höher, nie über 21", () => {
  const rest = Array.from({ length: 1440 }, (_, m) => [m, 65]);
  const workout = rest.map(([m, b]) => [m, m >= 1000 && m < 1060 ? 165 : b]);
  const extreme = rest.map(([m]) => [m, 190]);
  const opts = { rhr: 55, hrMax: 190 };
  const r = computeStrain(rest, opts).strain;
  const w = computeStrain(workout, opts).strain;
  const e = computeStrain(extreme, opts).strain;
  assert.ok(r < 2, `rest ${r}`);
  assert.ok(w > 10 && w < 18, `workout ${w}`);
  assert.ok(e <= 21 && e > 20, `extreme ${e}`);
});

test("Strain-Schätzung aus Schritten ohne Herzfrequenz", () => {
  const s = computeStrain([], { rhr: 55, hrMax: 190, steps: 10000 });
  assert.ok(s.estimated);
  assert.ok(s.strain > 5 && s.strain < 9);
});

test("Schlafbedarf steigt mit Belastung und Schlafschuld", () => {
  const base = sleepNeed({ baseMinutes: 480 });
  assert.equal(base, 480);
  assert.ok(sleepNeed({ baseMinutes: 480, prevStrain: 18 }) > base);
  assert.ok(sleepNeed({ baseMinutes: 480, debtMinutes: 60 }) > base);
  assert.ok(sleepNeed({ baseMinutes: 480, napMinutes: 30 }) < base);
});

test("Schlafkonsistenz: regelmäßige Zeiten ergeben hohe Werte, auch über Mitternacht", () => {
  const regular = [{ startMin: 1420, endMin: 400 }, { startMin: 10, endMin: 410 }, { startMin: 1430, endMin: 395 }];
  const chaotic = [{ startMin: 1260, endMin: 360 }, { startMin: 120, endMin: 600 }, { startMin: 1380, endMin: 420 }];
  assert.ok(sleepConsistency(regular) > 90);
  assert.ok(sleepConsistency(chaotic) < sleepConsistency(regular));
});

test("Ziel-Strain folgt der Recovery", () => {
  assert.ok(strainTarget(85).min >= 14);
  assert.ok(strainTarget(20).max <= 10);
});

test("analyzeDays berechnet alle Kennzahlen für Demo-Daten", () => {
  const raw = Object.values(generateDemoDays(30, 1)).sort((a, b) => a.date.localeCompare(b.date));
  const days = analyzeDays(raw, { age: 35 });
  const last = days.at(-2);
  for (const k of ["recovery", "strain", "sleepPerformance", "sleepNeed", "sleepConsistency"]) {
    assert.equal(typeof last[k], "number", k);
  }
  assert.ok(days.every((d) => d.recovery == null || (d.recovery >= 1 && d.recovery <= 99)));
  assert.ok(days.every((d) => d.strain == null || (d.strain >= 0 && d.strain <= 21)));
});

// ---------- Normalisierung der Google-Health-API-Antworten ----------

test("payloadOf und valueOf finden Messwerte in verschachtelten Datenpunkten", () => {
  const p = { name: "users/me/dataTypes/heart-rate/dataPoints/1", dataSource: { platform: "FITBIT" }, heartRate: { sampleTime: { physicalTime: "2026-10-01T08:00:00Z" }, beatsPerMinute: 61 } };
  assert.equal(valueOf(payloadOf(p), "hr"), 61);
  const hrv = { dailyHeartRateVariability: { date: { year: 2026, month: 10, day: 1 }, averageHeartRateVariabilityMilliseconds: 42.5 } };
  assert.equal(valueOf(payloadOf(hrv), "hrv"), 42.5);
});

test("mergePoints: Tageswerte, Intervall-Summen und Minutenmittel der Herzfrequenz", () => {
  const days = {};
  mergePoints(days, { metric: "rhr", kind: "daily" }, [
    { dailyRestingHeartRate: { date: { year: 2026, month: 10, day: 2 }, beatsPerMinute: 54 } },
  ]);
  mergePoints(days, { metric: "steps", kind: "interval" }, [
    { steps: { interval: { startTime: "2026-10-02T10:00:00", endTime: "2026-10-02T10:01:00" }, count: "120" } },
    { steps: { interval: { startTime: "2026-10-02T11:00:00", endTime: "2026-10-02T11:01:00" }, count: "80" } },
  ]);
  mergePoints(days, { metric: "hr", kind: "sample" }, [
    { heartRate: { sampleTime: { physicalTime: "2026-10-02T09:00:05" }, beatsPerMinute: 60 } },
    { heartRate: { sampleTime: { physicalTime: "2026-10-02T09:00:35" }, beatsPerMinute: 70 } },
  ]);
  assert.equal(days["2026-10-02"].rhr, 54);
  assert.equal(days["2026-10-02"].steps, 200);
  assert.deepEqual(days["2026-10-02"].hr, [[540, 65]]);
});

test("parseSleep wertet Schlafphasen aus", () => {
  const s = parseSleep({
    interval: { startTime: "2026-10-01T23:00:00", endTime: "2026-10-02T07:00:00" },
    type: "STAGES",
    stages: [
      { type: "LIGHT", interval: { startTime: "2026-10-01T23:00:00", endTime: "2026-10-02T01:00:00" } },
      { type: "DEEP", interval: { startTime: "2026-10-02T01:00:00", endTime: "2026-10-02T02:30:00" } },
      { type: "REM", interval: { startTime: "2026-10-02T02:30:00", endTime: "2026-10-02T04:00:00" } },
      { type: "AWAKE", interval: { startTime: "2026-10-02T04:00:00", endTime: "2026-10-02T04:30:00" } },
      { type: "LIGHT", interval: { startTime: "2026-10-02T04:30:00", endTime: "2026-10-02T07:00:00" } },
    ],
  });
  assert.equal(s.inBedMinutes, 480);
  assert.deepEqual(s.stages, { light: 270, deep: 90, rem: 90, awake: 30 });
  assert.equal(s.asleepMinutes, 450);
  assert.equal(s.isNap, false);
  assert.equal(s.hypnogram.length, 5);
});
