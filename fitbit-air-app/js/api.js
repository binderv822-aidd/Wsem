import { API_BASE, DATA_TYPES } from "./config.js";
import { mergePoints, dateKey } from "./normalize.js";

const PAGE_SIZE = 1000;
const MAX_PAGES = 200;
const MAX_PAGES_UNFILTERED = 20;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function filterFor(type, apiId, since) {
  const field = apiId.replace(/-/g, "_");
  if (type.kind === "daily") return `${field}.date >= "${dateKey(since)}"`;
  if (type.kind === "sample") return `${field}.sample_time.physical_time >= "${since.toISOString()}"`;
  return `${field}.interval.start_time >= "${since.toISOString()}"`;
}

async function getJson(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error?.message ?? msg;
    } catch { /* kein JSON */ }
    throw new ApiError(res.status, msg);
  }
  return res.json();
}

// Lädt alle Datenpunkte eines Typs seit `since` (mit Paginierung).
export async function listDataPoints(type, apiId, since, token, onPage) {
  const base = `${API_BASE}/users/me/dataTypes/${encodeURIComponent(apiId)}/dataPoints`;
  const run = async (useFilter) => {
    const points = [];
    let pageToken = "";
    const limit = useFilter ? MAX_PAGES : MAX_PAGES_UNFILTERED;
    for (let page = 0; page < limit; page++) {
      const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
      if (useFilter) params.set("filter", filterFor(type, apiId, since));
      if (pageToken) params.set("pageToken", pageToken);
      const json = await getJson(`${base}?${params}`, token);
      points.push(...(json.dataPoints ?? json.points ?? []));
      onPage?.(points.length);
      pageToken = json.nextPageToken;
      if (!pageToken) break;
    }
    return points;
  };
  try {
    return await run(true);
  } catch (e) {
    // Falls die Filtersyntax abgelehnt wird: ohne Filter laden, lokal begrenzen.
    if (e instanceof ApiError && e.status === 400) return run(false);
    throw e;
  }
}

// Synchronisiert alle Datentypen und liefert { days, status }.
export async function syncAll({ token, settings, existingDays = {}, lastSync, onProgress }) {
  const days = structuredClone(existingDays);
  const status = {};
  const now = new Date();
  const fullStart = new Date(now);
  fullStart.setDate(fullStart.getDate() - settings.syncDays);
  fullStart.setHours(0, 0, 0, 0);
  // Inkrementell: ab dem Vortag der letzten Synchronisation.
  // Immer ab Mitternacht, damit Tagessummen (Schritte, Kalorien) vollständig sind.
  const incStart = lastSync ? new Date(Math.max(fullStart, new Date(lastSync) - 36 * 3600e3)) : fullStart;
  incStart.setHours(0, 0, 0, 0);

  for (const type of DATA_TYPES) {
    const apiId = settings.dataTypeOverrides?.[type.id] || type.id;
    let since = incStart;
    if (type.detailedDays && !lastSync) {
      since = new Date(now);
      since.setDate(since.getDate() - type.detailedDays);
      since.setHours(0, 0, 0, 0);
    }
    onProgress?.(`${type.label} …`);
    try {
      const points = await listDataPoints(type, apiId, since, token, (n) => onProgress?.(`${type.label}: ${n} Datenpunkte`));
      const sinceKey = dateKey(since);
      const fresh = {};
      mergePoints(fresh, type, points);
      for (const [key, d] of Object.entries(fresh)) {
        if (key < sinceKey) continue;
        days[key] = { ...(days[key] ?? { date: key }), [type.metric]: d[type.metric] };
      }
      status[type.id] = { ok: true, count: points.length, apiId };
    } catch (e) {
      status[type.id] = { ok: false, error: e.message, code: e.status ?? null, apiId };
      if (e.status === 401) throw e;
    }
  }
  return { days, status, syncedAt: now.toISOString() };
}
