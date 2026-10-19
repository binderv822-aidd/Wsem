// Lokale Speicherung im Browser. Gesundheitsdaten verlassen das Gerät nicht.
import { DEFAULT_SETTINGS } from "./config.js";

const KEYS = { settings: "fa.settings", days: "fa.days", meta: "fa.meta" };
const KEEP_DAYS = 180;

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // Speicher voll oder deaktiviert
  }
}

export const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) });
export const saveSettings = (s) => write(KEYS.settings, s);
export const loadMeta = () => read(KEYS.meta, { lastSync: null, status: {}, demo: false });
export const saveMeta = (m) => write(KEYS.meta, m);
export const loadDays = () => read(KEYS.days, {});

export function saveDays(days) {
  const keys = Object.keys(days).sort();
  const pruned = Object.fromEntries(keys.slice(-KEEP_DAYS).map((k) => [k, days[k]]));
  if (write(KEYS.days, pruned)) return true;
  // Zu groß: ältere Minuten-Herzfrequenzen verwerfen (Tageswerte bleiben erhalten).
  for (const k of keys.slice(0, -14)) if (pruned[k]) delete pruned[k].hr;
  return write(KEYS.days, pruned);
}

export function clearAll() {
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
}
