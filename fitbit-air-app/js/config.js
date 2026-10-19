// Google Health API (Nachfolger der Fitbit Web API, die im Herbst 2026 abgeschaltet wird).
// Die Fitbit Air synchronisiert über die Google-Health-App in dieses Konto.
// Datentyp-IDs und Scopes sind in den Einstellungen überschreibbar, falls Google sie ändert.

export const API_BASE = "https://health.googleapis.com/v4";

const SCOPE_PREFIX = "https://www.googleapis.com/auth/googlehealth.";
export const DEFAULT_SCOPES = [
  `${SCOPE_PREFIX}activity_and_fitness.readonly`,
  `${SCOPE_PREFIX}health_metrics_and_measurements.readonly`,
  `${SCOPE_PREFIX}sleep.readonly`,
];

// kind: Art des Zeitstempels → bestimmt Filter und Auswertung
//   sample   = Einzelmessung mit Zeitpunkt
//   interval = Zeitraum (Start/Ende)
//   daily    = Tageswert (Datum)
// metric: Feld im normalisierten Tagesdatensatz
export const DATA_TYPES = [
  { id: "heart-rate", kind: "sample", metric: "hr", label: "Herzfrequenz", detailedDays: 7 },
  { id: "daily-resting-heart-rate", kind: "daily", metric: "rhr", label: "Ruhepuls" },
  { id: "daily-heart-rate-variability", kind: "daily", metric: "hrv", label: "HRV (RMSSD)" },
  { id: "sleep", kind: "interval", metric: "sleep", label: "Schlaf" },
  { id: "steps", kind: "interval", metric: "steps", label: "Schritte" },
  { id: "daily-oxygen-saturation", kind: "daily", metric: "spo2", label: "SpO₂" },
  { id: "daily-respiratory-rate", kind: "daily", metric: "respRate", label: "Atemfrequenz" },
  { id: "daily-skin-temperature", kind: "daily", metric: "skinTemp", label: "Hauttemperatur (Abw.)" },
  { id: "total-calories", kind: "interval", metric: "calories", label: "Kalorien" },
  { id: "active-zone-minutes", kind: "interval", metric: "azm", label: "Aktivzonenminuten" },
];

export const DEFAULT_SETTINGS = {
  clientId: "",
  scopes: DEFAULT_SCOPES.join(" "),
  syncDays: 30,
  age: 35,
  sex: "m",
  hrMax: null,
  sleepBaseMinutes: 480,
  dataTypeOverrides: {}, // { "daily-respiratory-rate": "respiratory-rate", ... }
};
