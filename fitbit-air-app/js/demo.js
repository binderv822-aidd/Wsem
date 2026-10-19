// Realistische Beispieldaten, um die App ohne Fitbit-Konto auszuprobieren.
import { dateKey } from "./normalize.js";

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDemoDays(n = 45, seed = 42) {
  const r = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
  const days = {};
  const today = new Date();
  let fatigue = 0;
  let lnHrv = Math.log(48);
  for (let i = n - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const key = dateKey(date);
    const workout = r() < 0.45 ? { start: 17 * 60 + Math.round(r() * 120), dur: 35 + Math.round(r() * 50), hr: 135 + Math.round(r() * 30) } : null;

    // Nacht vor diesem Tag
    const bed = 22 * 60 + 30 + Math.round(gauss() * 35);
    const inBed = Math.round(480 + gauss() * 40 - fatigue * 10);
    const awake = Math.round(25 + r() * 25);
    const asleep = inBed - awake;
    const deep = Math.round(asleep * (0.15 + r() * 0.06));
    const rem = Math.round(asleep * (0.2 + r() * 0.06));
    const light = asleep - deep - rem;
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    start.setMinutes(bed - 1440);
    const end = new Date(start.getTime() + inBed * 60000);
    const hypnogram = [];
    let t = 0;
    const cycle = ["light", "deep", "light", "rem", "awake"];
    const share = { light: light / 10, deep: deep / 5, rem: rem / 5, awake: awake / 5 };
    for (let c = 0; c < 5 && t < inBed; c++) {
      for (const st of cycle) {
        const mins = Math.max(1, Math.round(share[st] * (0.7 + r() * 0.6)));
        hypnogram.push([t, mins, st]);
        t += mins;
      }
    }

    lnHrv = 0.6 * lnHrv + 0.4 * Math.log(48) - fatigue * 0.08 + gauss() * 0.12 + (asleep - 420) / 1500;
    const hrv = Math.round(Math.exp(lnHrv));
    const rhr = Math.round(55 + fatigue * 2 + gauss() * 1.5 - (hrv - 48) / 12);

    // Alltagsbewegung: zwei bis drei Spaziergänge bzw. Wege pro Tag
    const walks = Array.from({ length: 2 + Math.round(r()) }, () => ({ start: 8 * 60 + Math.round(r() * 11 * 60), dur: 15 + Math.round(r() * 25) }));
    const hr = [];
    for (let m = 0; m < 1440; m += 1) {
      const sleeping = m < end.getHours() * 60 + end.getMinutes() || m > bed;
      let bpm = sleeping ? rhr - 2 + gauss() * 2 : 72 + 8 * Math.sin((m / 1440) * Math.PI) + gauss() * 5;
      if (!sleeping && r() < 0.02) bpm += 25;
      if (walks.some((w) => m >= w.start && m < w.start + w.dur)) bpm = 100 + gauss() * 6;
      if (workout && m >= workout.start && m < workout.start + workout.dur) {
        const p = (m - workout.start) / workout.dur;
        bpm = workout.hr * (0.85 + 0.15 * Math.sin(p * Math.PI)) + gauss() * 4;
      }
      hr.push([m, Math.round(bpm)]);
    }

    days[key] = {
      date: key,
      hr: i === 0 ? hr.filter(([m]) => m <= today.getHours() * 60 + today.getMinutes()) : hr,
      rhr,
      hrv,
      spo2: Math.round((96.5 + gauss() * 0.8) * 10) / 10,
      respRate: Math.round((14.8 + fatigue * 0.3 + gauss() * 0.4) * 10) / 10,
      skinTemp: Math.round((gauss() * 0.25 + fatigue * 0.1) * 100) / 100,
      steps: Math.round(6500 + r() * 5000 + (workout ? 4000 : 0)),
      calories: Math.round(2100 + r() * 300 + (workout ? workout.dur * 10 : 0)),
      azm: workout ? workout.dur + Math.round(r() * 15) : Math.round(r() * 15),
      sleep: {
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        startMin: (bed + 1440) % 1440,
        endMin: end.getHours() * 60 + end.getMinutes(),
        inBedMinutes: inBed,
        asleepMinutes: asleep,
        stages: { deep, light, rem, awake },
        hypnogram,
        napMinutes: 0,
      },
    };
    fatigue = Math.max(0, fatigue * 0.6 + (workout ? workout.dur / 40 : -0.3));
  }
  return days;
}
