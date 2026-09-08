// crocoPointData.js — point queries (depth profile / time series) against a
// regular-grid Zarr dataset, independent of whichever raster ZarrOverlay
// instance happens to be displayed. Needed because the T-S diagram always
// reads temperature + salinity regardless of which currents layer is
// selected on the map. Mirrors niu_current's zarrLoader.ts point readers,
// ported to this app's 'zarr' package — including the same `.flatten()` fix
// ZarrOverlay needed (a NestedArray's `.data` is nested per-row arrays for
// any multi-axis selection, not a flat buffer).
import { openArray, HTTPStore } from 'zarr';

function buildZarrUrl(datasetName, baseUrl) {
  const base = ((baseUrl || '').trim()).replace(/\/+$/, '');
  const ds = datasetName.replace(/^\/+/, '').replace(/\/+$/, '');
  return `${base}/${ds}`;
}

const arrayCache = new Map();

function getArray(datasetName, variable, baseUrl) {
  const storeUrl = buildZarrUrl(datasetName, baseUrl);
  const key = `${storeUrl}/${variable}`;
  let promise = arrayCache.get(key);
  if (!promise) {
    // no-cache: Wasabi sends no Cache-Control on this bucket, so without
    // forcing revalidation a fresh forecast run overwriting the same S3 keys
    // can sit invisible behind a stale browser-cached response (wrong time
    // range) until the user hard-refreshes.
    const store = new HTTPStore(storeUrl, { fetchOptions: { credentials: 'omit', cache: 'no-cache' } });
    // zarr.js sends HEAD requests for containsItem() checks; the zarr-api only supports GET.
    store.containsItem = async (item) => {
      try {
        const resp = await fetch(`${storeUrl}/${item}`, { method: 'GET', credentials: 'omit', cache: 'no-cache' });
        return resp.status === 200;
      } catch { return false; }
    };
    promise = openArray({ store, path: variable, mode: 'r' });
    arrayCache.set(key, promise);
  }
  return promise;
}

const coordCache = new Map();
function cached(key, load) {
  let promise = coordCache.get(key);
  if (!promise) {
    promise = load().catch((e) => { coordCache.delete(key); throw e; });
    coordCache.set(key, promise);
  }
  return promise;
}

// Same decode as ZarrOverlay.applyScaleOffset — a no-op for this dataset
// (plain float32 with a NaN fill value, no scale_factor/add_offset) but kept
// for parity in case a future dataset needs it.
function decode(raw, attrs) {
  const scale = Number(attrs?.scale_factor ?? 1);
  const offset = Number(attrs?.add_offset ?? 0);
  const fillValue = attrs?._FillValue !== undefined ? Number(attrs._FillValue) : null;
  if (scale === 1 && offset === 0 && fillValue === null) return Array.from(raw, Number);
  return Array.from(raw, (v) => (fillValue !== null && v === fillValue ? NaN : v * scale + offset));
}

export function findNearestIndex(values, target) {
  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < values.length; i++) {
    const dist = Math.abs(values[i] - target);
    if (dist < bestDist) { bestDist = dist; bestIndex = i; }
  }
  return bestIndex;
}

export async function loadDepthLevels(datasetName, baseUrl) {
  return cached(`${datasetName}:${baseUrl}:depth`, async () => {
    const arr = await getArray(datasetName, 'depth', baseUrl);
    const raw = await arr.get(null);
    return Array.from(raw.data, Number);
  });
}

// Parses a CF `units` attribute ("hours since YYYY-MM-DD HH:MM:SS") into a
// {factor, epochMs} pair. CF reference dates are UTC but a space-separated
// "YYYY-MM-DD HH:MM:SS" string (no "Z"/offset) parses as *local* time in JS —
// force UTC by rewriting it into a proper ISO-8601 UTC string first.
function parseTimeUnits(units) {
  const match = /^(seconds|minutes|hours|days)\s+since\s+(.+)$/i.exec(units || '');
  if (!match) return null;
  const FACTORS = { seconds: 1e3, minutes: 60e3, hours: 3600e3, days: 86400e3 };
  const epochMs = new Date(`${match[2].trim().replace(' ', 'T')}Z`).getTime();
  return { factor: FACTORS[match[1].toLowerCase()], epochMs };
}

// ISO-8601 timestamp per time step, decoded from the CF `units` attribute.
export async function loadTimeSteps(datasetName, baseUrl) {
  return cached(`${datasetName}:${baseUrl}:time`, async () => {
    const arr = await getArray(datasetName, 'time', baseUrl);
    const attrs = await arr.attrs.asObject();
    const raw = await arr.get(null).then((r) => Array.from(r.data, Number));
    const parsed = parseTimeUnits(attrs?.units);
    if (!parsed) return raw.map((_, i) => `Timestep ${i + 1}`);
    return raw.map((v) => new Date(parsed.epochMs + v * parsed.factor).toISOString());
  });
}

// Folds 0-360 longitude (Niue's CROCO grid is ~188-194°E) down to -180..180
// to match map coordinates — same rule as ZarrOverlay: only when the whole
// axis is past 180° so a domain straddling the antimeridian isn't corrupted.
export async function loadLatLon(datasetName, baseUrl) {
  return cached(`${datasetName}:${baseUrl}:latlon`, async () => {
    const [latArr, lonArr] = await Promise.all([
      getArray(datasetName, 'lat', baseUrl),
      getArray(datasetName, 'lon', baseUrl),
    ]);
    const [latRaw, lonRaw] = await Promise.all([latArr.get(null), lonArr.get(null)]);
    const lat = Array.from(latRaw.data, Number);
    let lon = Array.from(lonRaw.data, Number);
    if (lon.every((v) => v > 180)) lon = lon.map((v) => v - 360);
    return { lat, lon };
  });
}

// One value per depth level, at a fixed time, for the grid cell nearest (lon, lat).
export async function loadProfileAtPoint(datasetName, variable, { timeIndex, lon, lat }, baseUrl) {
  const [arr, { lat: latValues, lon: lonValues }] = await Promise.all([
    getArray(datasetName, variable, baseUrl),
    loadLatLon(datasetName, baseUrl),
  ]);
  const latIdx = findNearestIndex(latValues, lat);
  const lonIdx = findNearestIndex(lonValues, lon);
  const attrs = await arr.attrs.asObject();
  const raw = await arr.get([timeIndex, null, latIdx, lonIdx]).then((r) => r.flatten());
  return decode(raw, attrs);
}

// One value per time step, at a fixed depth, for the grid cell nearest (lon, lat).
export async function loadTimeSeriesAtPoint(datasetName, variable, { depthIndex, lon, lat }, baseUrl) {
  const [arr, { lat: latValues, lon: lonValues }] = await Promise.all([
    getArray(datasetName, variable, baseUrl),
    loadLatLon(datasetName, baseUrl),
  ]);
  const latIdx = findNearestIndex(latValues, lat);
  const lonIdx = findNearestIndex(lonValues, lon);
  const ndim = arr.shape.length;
  const selection = ndim === 4 ? [null, depthIndex, latIdx, lonIdx] : [null, latIdx, lonIdx];
  const attrs = await arr.attrs.asObject();
  const raw = await arr.get(selection).then((r) => r.flatten());
  return decode(raw, attrs);
}
