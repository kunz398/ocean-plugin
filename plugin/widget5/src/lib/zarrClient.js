// zarrClient.js — shared Zarr v2 store helpers (metadata discovery, array
// opening, scale/offset decoding). Extracted from ZarrOverlay.js so
// SfincsRasterOverlay can consume raw Zarr data (client-side rendering)
// without duplicating this boilerplate.
import { openArray, HTTPStore } from 'zarr';

export const LAT_NAMES = ['lat', 'latitude', 'y', 'nav_lat'];
export const LON_NAMES = ['lon', 'longitude', 'x', 'nav_lon'];
export const TIME_NAMES = ['time', 'timemax', 'Time'];

export async function fetchConsolidatedMeta(storeUrl) {
  const resp = await fetch(`${storeUrl}/.zmetadata`);
  if (!resp.ok) throw new Error(`.zmetadata not found at ${storeUrl}`);
  return resp.json();
}

export function getVarAttrs(consolidated, varName) {
  return consolidated?.metadata?.[`${varName}/.zattrs`] ?? {};
}

export function getVarMeta(consolidated, varName) {
  return consolidated?.metadata?.[`${varName}/.zarray`] ?? null;
}

// Try common name variants for lat, lon, time coords.
export function discoverCoord(consolidated, variants) {
  for (const name of variants) {
    if (consolidated?.metadata?.[`${name}/.zarray`]) return name;
  }
  return null;
}

export async function openZarrArray(storeUrl, varPath) {
  const store = new HTTPStore(storeUrl, { fetchOptions: { credentials: 'omit' } });
  // zarr.js sends HEAD requests for containsItem() checks; the zarr-api only supports GET.
  // Override containsItem to use GET instead of HEAD to avoid 405 errors.
  store.containsItem = async (key) => {
    try {
      const url = `${storeUrl}/${key}`;
      const resp = await fetch(url, { method: 'GET', credentials: 'omit' });
      return resp.status === 200;
    } catch { return false; }
  };
  return openArray({ store, path: varPath, mode: 'r' });
}

export function applyScaleOffset(raw, attrs) {
  const scale = Number(attrs?.scale_factor ?? 1);
  const offset = Number(attrs?.add_offset ?? 0);
  const fillValue = attrs?._FillValue !== undefined ? Number(attrs._FillValue) : null;
  if (scale === 1 && offset === 0 && fillValue === null) return raw;
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    out[i] = (fillValue !== null && v === fillValue) ? NaN : v * scale + offset;
  }
  return out;
}
