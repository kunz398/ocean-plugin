// ZarrOverlay.js — renders a regular-grid Zarr raster (SFINCS, WW3, etc.) via deck.gl + MapLibre.
// Adapted from zarr_web/src/lib/zarrOverlay.ts (TypeScript stripped, zarrita → zarr v0.6.3).
import { MapboxOverlay } from '@deck.gl/mapbox';
import { BitmapLayer } from '@deck.gl/layers';
import { openArray, HTTPStore } from 'zarr';
import { getColormap } from './colormaps';

// ── zarr helpers ─────────────────────────────────────────────────────────────
function buildZarrUrl(datasetName, baseUrl) {
  const base = ((baseUrl || '').trim() || 'https://s3.ap-southeast-2.wasabisys.com/spc-zarr-file/')
    .replace(/\/+$/, '');
  const ds = datasetName.replace(/^\/+/, '').replace(/\/+$/, '');
  const url = `${base}/${ds}`;
  if (/^https?:\/\//i.test(url)) return url;
  const origin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : '';
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

async function fetchConsolidatedMeta(storeUrl, signal) {
  const metadataUrl = `${storeUrl}/.zmetadata`;
  // Wasabi doesn't send Cache-Control on this bucket, so the browser applies
  // its own heuristic freshness lifetime — without forcing revalidation, a
  // fresh forecast run that overwrites the same S3 keys can sit invisible
  // behind a stale cached .zmetadata (wrong time range, old data) until the
  // user hard-refreshes. "no-cache" still lets S3 answer with a cheap 304
  // for genuinely unchanged content.
  const resp = await fetch(metadataUrl, { signal, cache: 'no-cache' });
  const text = await resp.text();

  if (!resp.ok) {
    throw new Error(`.zmetadata not found: ${resp.status} ${resp.statusText} at ${metadataUrl}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    const preview = text.slice(0, 80).replace(/\s+/g, ' ');
    throw new Error(`Expected Zarr JSON at ${metadataUrl}, got "${preview}"`);
  }
}

function getVarAttrs(consolidated, varName) {
  return consolidated?.metadata?.[`${varName}/.zattrs`] ?? {};
}

function getVarMeta(consolidated, varName) {
  return consolidated?.metadata?.[`${varName}/.zarray`] ?? null;
}

async function openZarrArray(storeUrl, varPath, signal) {
  const store = new HTTPStore(storeUrl, { fetchOptions: { credentials: 'omit', signal, cache: 'no-cache' } });
  // zarr.js sends HEAD requests for containsItem() checks; the zarr-api only supports GET.
  // Override containsItem to use GET instead of HEAD to avoid 405 errors.
  store.containsItem = async (key) => {
    try {
      const url = `${storeUrl}/${key}`;
      const resp = await fetch(url, { method: 'GET', credentials: 'omit', signal, cache: 'no-cache' });
      return resp.status === 200;
    } catch { return false; }
  };
  return openArray({ store, path: varPath, mode: 'r' });
}

// ── coordinate discovery ──────────────────────────────────────────────────────
// Try common name variants for lat, lon, time coords.
const LAT_NAMES = ['lat', 'latitude', 'y', 'nav_lat'];
const LON_NAMES = ['lon', 'longitude', 'x', 'nav_lon'];
const TIME_NAMES = ['time', 'timemax', 'Time'];
const DEPTH_NAMES = ['depth', 'z', 'lev', 'level'];

function findNearestIndex(values, target) {
  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < values.length; i++) {
    const dist = Math.abs(values[i] - target);
    if (dist < bestDist) { bestDist = dist; bestIndex = i; }
  }
  return bestIndex;
}

function discoverCoord(consolidated, variants) {
  for (const name of variants) {
    if (consolidated?.metadata?.[`${name}/.zarray`]) return name;
  }
  return null;
}

// ── data decoding ─────────────────────────────────────────────────────────────
function applyScaleOffset(raw, attrs) {
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

// Robust min/max for a frame's colour scale, clipped to the 1st/99th
// percentile — ported from niu_current's zarrMapPanel.tsx. A literal min/max
// would let a single sentinel/outlier cell (this dataset uses a literal 0 for
// land instead of NaN) wreck the whole scale, so build a coarse histogram and
// clip instead of sorting the full (~450k-value) frame every time it changes.
// Used for layers whose useful range varies a lot by depth/time (temperature,
// velocity) — a fixed surface-only range either clips most of a deep, cold
// slice to one end or washes it out. Layers with a naturally tight range
// (salinity, sea surface height) keep their fixed config.colorRange instead.
function computeDynamicRange(values) {
  let dataMin = Infinity;
  let dataMax = -Infinity;
  let finiteCount = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v) && v !== 0) {
      finiteCount++;
      if (v < dataMin) dataMin = v;
      if (v > dataMax) dataMax = v;
    }
  }
  if (finiteCount === 0 || dataMin > dataMax) return null;

  const BIN_COUNT = 512;
  const span = dataMax - dataMin || 1;
  const bins = new Uint32Array(BIN_COUNT);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v) || v === 0) continue;
    const binIdx = Math.min(BIN_COUNT - 1, Math.floor(((v - dataMin) / span) * BIN_COUNT));
    bins[binIdx]++;
  }
  const lowTarget = finiteCount * 0.01;
  const highTarget = finiteCount * 0.99;
  let cumulative = 0;
  let lowBin = 0;
  let highBin = BIN_COUNT - 1;
  for (let b = 0; b < BIN_COUNT; b++) {
    cumulative += bins[b];
    if (cumulative >= lowTarget) { lowBin = b; break; }
  }
  cumulative = 0;
  for (let b = 0; b < BIN_COUNT; b++) {
    cumulative += bins[b];
    if (cumulative >= highTarget) { highBin = b; break; }
  }
  return {
    min: dataMin + (lowBin / BIN_COUNT) * span,
    max: dataMin + ((highBin + 1) / BIN_COUNT) * span,
  };
}

// ── canvas rendering ──────────────────────────────────────────────────────────
const DEG_TO_RAD = Math.PI / 180;
function mercatorY(latDeg) { return Math.log(Math.tan(Math.PI / 4 + (latDeg * DEG_TO_RAD) / 2)); }
function invMercatorY(y) { return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / DEG_TO_RAD; }

// Ported from niu_current's zarrMapPanel.tsx. The data grid is evenly spaced
// in *latitude*, but deck.gl's BitmapLayer paints its `bounds` evenly in
// *Web-Mercator Y* — over this dataset's multi-degree domain that mismatch
// slides the land mask several km off the true coastline (and off wherever
// CurrentsParticleOverlay's lat/lon-based land check thinks the coast is).
// Fix it by resampling every output row to a uniform Mercator step, picking
// whichever source row's latitude actually falls there. Longitude needs no
// such correction — it's linear in Mercator X — so columns map straight
// through (only reversed if the source array runs descending).
function renderToCanvas(values, latData, lonData, colormap, vmin, vmax, opacity, thresholds) {
  const rows = latData.length;
  const cols = lonData.length;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(cols, rows);
  const px = imgData.data;
  const span = vmax - vmin || 1;
  const alpha = Math.round(opacity * 255);
  const hasThresholds = thresholds?.length > 0;

  const latStep = rows > 1 ? (latData[rows - 1] - latData[0]) / (rows - 1) : 1; // signed
  const lonStep = cols > 1 ? (lonData[cols - 1] - lonData[0]) / (cols - 1) : 1; // signed
  const lonAscending = lonStep > 0;

  const latEdgeMin = Math.min(latData[0], latData[rows - 1]) - Math.abs(latStep) / 2;
  const latEdgeMax = Math.max(latData[0], latData[rows - 1]) + Math.abs(latStep) / 2;
  const mercTop = mercatorY(latEdgeMax); // output row 0 = north
  const mercBot = mercatorY(latEdgeMin);

  for (let row = 0; row < rows; row++) {
    const lat = invMercatorY(mercTop + ((row + 0.5) / rows) * (mercBot - mercTop));
    const srcRow = Math.round((lat - latData[0]) / latStep);
    const rowOff = row * cols * 4;

    if (srcRow < 0 || srcRow >= rows) {
      for (let c = 0; c < cols; c++) px[rowOff + c * 4 + 3] = 0;
      continue;
    }

    const srcRowOff = srcRow * cols;
    for (let c = 0; c < cols; c++) {
      const srcCol = lonAscending ? c : cols - 1 - c;
      const v = values[srcRowOff + srcCol];
      const pxIdx = rowOff + c * 4;
      // Land cells are a literal 0 sentinel (no _FillValue — see
      // mapLayersConfig.js), not NaN.
      if (!Number.isFinite(v) || v === 0) { px[pxIdx + 3] = 0; continue; }
      let color;
      if (hasThresholds) {
        // find which threshold band this value falls in
        color = null;
        for (let t = thresholds.length - 1; t >= 0; t--) {
          if (v >= thresholds[t].value) { color = thresholds[t].color; break; }
        }
        if (!color) { px[pxIdx + 3] = 0; continue; }
      } else {
        const t = Math.max(0, Math.min(1, (v - vmin) / span));
        color = colormap(t);
      }
      px[pxIdx] = color[0];
      px[pxIdx + 1] = color[1];
      px[pxIdx + 2] = color[2];
      px[pxIdx + 3] = alpha;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

// ── main class ────────────────────────────────────────────────────────────────
export class ZarrOverlay {
  constructor(map, config) {
    this.map = map;
    this.config = config;
    this.overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    this.map.addControl(this.overlay);

    this.dataset = null;       // metadata: bounds, shape, timeCount, timeLabels
    this.variableArr = null;
    this.latArr = null;
    this.lonArr = null;
    this.timeIndex = 0;
    // Depth is tracked in meters (matching config.depth), not a raw array
    // index — the actual index is resolved against the dataset's own loaded
    // depth coordinate once metadata arrives, same as lat/lon point lookups
    // below. Only meaningful for 4-D (time, depth, lat, lon) variables; a 3-D
    // variable (e.g. sea surface height) ignores it entirely.
    this.depth = config.depth ?? null;
    this.mounted = true;
    this.playInterval = null;
    this.renderRequestId = 0;
    this.prefetchAbort = null;
    this.cachedFrames = new Map(); // "timeIndex:depthIndex" → {canvas, values}
    this._sliderTimer = null;
    this.didAutoFit = false;
    // Cancels every zarr metadata/chunk fetch this instance has in flight —
    // aborted in destroy(). Without this, switching layers left abandoned
    // fetches running to completion in the background; rapid switching could
    // pile up enough of them to exhaust the browser's per-origin connection
    // limit, starving the *current* layer's own fetch and surfacing as a
    // genuine "TypeError: Failed to fetch" even though nothing was really
    // broken. Mirrors UgridOverlay's _abortController.
    this._abortController = new AbortController();

    // UI callbacks — assign before initialize fires
    this.onTimeChange   = null;
    this.onStatsChange  = null;
    this.onLoadingChange = null;
    this.onErrorChange  = null;

    queueMicrotask(() => { if (this.mounted) this._initialize(); });
  }

  async _initialize() {
    this.onLoadingChange?.(true);
    try {
      console.log('[ZarrOverlay] initializing', this.config.datasetName, this.config.zarrBaseUrl);
      await this._loadMetadata();
      console.log('[ZarrOverlay] metadata loaded, dataset:', this.dataset);
      await this._renderFrame(this.timeIndex);
    } catch (err) {
      // AbortError means destroy() cancelled this instance's own in-flight
      // fetches (see _abortController) — expected on a fast layer switch,
      // not a real failure, so it must never reach onErrorChange.
      if (this.mounted && err.name !== 'AbortError') {
        console.error('[ZarrOverlay] init error:', err);
        this.onErrorChange?.(String(err));
      }
    } finally {
      if (this.mounted) this.onLoadingChange?.(false);
    }
  }

  async _loadMetadata() {
    if (this.dataset) return;
    const storeUrl = buildZarrUrl(this.config.datasetName, this.config.zarrBaseUrl);
    const signal = this._abortController.signal;

    const consolidated = await fetchConsolidatedMeta(storeUrl, signal);

    const latName = discoverCoord(consolidated, LAT_NAMES);
    const lonName = discoverCoord(consolidated, LON_NAMES);
    const timeName = discoverCoord(consolidated, TIME_NAMES);
    const depthName = discoverCoord(consolidated, DEPTH_NAMES);

    if (!latName || !lonName) throw new Error('Could not find lat/lon coordinate arrays in Zarr store');

    const varName = this.config.heightVariable || this.config.variable;
    const varMeta = getVarMeta(consolidated, varName);
    if (!varMeta) throw new Error(`Variable "${varName}" not found in Zarr store`);

    this.variableArr = await openZarrArray(storeUrl, varName, signal);
    const latArrRef = await openZarrArray(storeUrl, latName, signal);
    const lonArrRef = await openZarrArray(storeUrl, lonName, signal);

    let [latData, lonData] = await Promise.all([
      latArrRef.get(null).then(r => Array.from(r.data, Number)),
      lonArrRef.get(null).then(r => Array.from(r.data, Number)),
    ]);
    // Some stores (e.g. Niue's CROCO current grid) encode longitude 0-360,
    // entirely past the antimeridian (~188-194° for Niue). Fold the whole
    // axis down to -180..180 to match the basemap; only when every value is
    // past 180° so a domain that straddles the antimeridian isn't corrupted.
    if (lonData.every((v) => v > 180)) {
      lonData = lonData.map((v) => v - 360);
    }

    // depth is only present (and only meaningful) for 4-D variables — a 3-D
    // variable like sea surface height has no vertical axis to select from.
    let depthLevels = null;
    if (depthName && this.variableArr.shape.length === 4) {
      const depthArrRef = await openZarrArray(storeUrl, depthName, signal);
      depthLevels = await depthArrRef.get(null).then(r => Array.from(r.data, Number));
    }
    this.depthLevels = depthLevels;
    this.depthIndex = depthLevels ? findNearestIndex(depthLevels, this.depth ?? depthLevels[0]) : 0;
    this.onDepthLevelsChange?.(depthLevels);

    let timeCount = 1;
    let timeLabels = ['Timestep 1'];
    if (timeName) {
      const timeArrRef = await openZarrArray(storeUrl, timeName, signal);
      const timeData = await timeArrRef.get(null).then(r => Array.from(r.data, Number));
      const timeAttrs = getVarAttrs(consolidated, timeName);
      const units = timeAttrs?.units ?? '';
      timeCount = timeData.length;

      if (units.includes('seconds since') || units.includes('hours since') || units.includes('days since')) {
        const refMatch = units.match(/since\s+(.+)/);
        // CF reference dates are UTC, but a space-separated "YYYY-MM-DD
        // HH:MM:SS" string (no "Z"/offset) is parsed by JS Date as *local*
        // time, not UTC — on a machine whose local zone isn't UTC, every
        // decoded timestep would be off by that zone's offset (verified: a
        // browser in Pacific/Fiji, UTC+12, parsed the CROCO store's "hours
        // since 2026-08-30 00:00:00" as 2026-08-29T12:00Z, 12h early — this
        // is what put "29 Aug" instead of the real "30 Aug" model init in
        // the UI). Force UTC by rewriting to a proper ISO-8601 UTC string
        // first, same fix crocoPointData.js's parseTimeUnits already uses.
        const refDate = refMatch ? new Date(`${refMatch[1].trim().replace(' ', 'T')}Z`) : new Date(0);
        const factor = units.startsWith('hours') ? 3600e3 : units.startsWith('days') ? 86400e3 : 1e3;
        timeLabels = timeData.map((v) => {
          const d = new Date(refDate.getTime() + v * factor);
          return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
        });
      } else {
        timeLabels = timeData.map((_, i) => `Timestep ${i + 1}`);
      }
    }

    const varAttrs = getVarAttrs(consolidated, varName);
    this.varAttrs = varAttrs;

    const rows = latData.length;
    const cols = lonData.length;
    const minLon = Math.min(lonData[0], lonData[lonData.length - 1]);
    const maxLon = Math.max(lonData[0], lonData[lonData.length - 1]);
    const minLat = Math.min(latData[0], latData[latData.length - 1]);
    const maxLat = Math.max(latData[0], latData[latData.length - 1]);

    // deckBounds (fed to BitmapLayer) must be the outer *edges* of the grid,
    // not the cell *centres* lat/lonData hold — ported from niu_current's
    // zarrMapPanel.tsx, whose comment explains why: without extending by half
    // a cell, the raster sits shifted inward by half a grid cell relative to
    // the real coastline. `bounds` (used for fitBounds camera framing only)
    // keeps the plain cell-centre extent.
    const latStep = rows > 1 ? Math.abs(latData[rows - 1] - latData[0]) / (rows - 1) : 0;
    const lonStep = cols > 1 ? Math.abs(lonData[cols - 1] - lonData[0]) / (cols - 1) : 0;

    this.dataset = {
      storeUrl, varName, rows, cols, timeCount, timeLabels,
      bounds: [[minLon, minLat], [maxLon, maxLat]],
      deckBounds: [minLon - lonStep / 2, minLat - latStep / 2, maxLon + lonStep / 2, maxLat + latStep / 2],
      latData, lonData,
    };

    if (!this.didAutoFit) {
      this.didAutoFit = true;
      this.map.fitBounds(this.dataset.bounds, { padding: 30, animate: false });
    }
    this.onTimeChange?.(timeLabels[0] ?? '', 0, timeCount - 1);
  }

  async _fetchValues(timeIndex, depthIndex) {
    await this._loadMetadata();
    const ndim = this.variableArr.shape.length;
    const selection = ndim === 4
      ? [timeIndex, depthIndex ?? 0, null, null]
      : ndim === 3
        ? [timeIndex, null, null]
        : ndim === 2
          ? [null, null]
          : [timeIndex];
    // A multi-axis selection (anything beyond a plain 1-D slice) comes back
    // as a NestedArray whose `.data` is nested per-row arrays, not a flat
    // buffer — `.flatten()` is what actually produces the row-major
    // Float/typed array `renderToCanvas`'s `values[r*cols+c]` indexing needs.
    // Reading `.data` directly here silently produced a fully-transparent
    // (all-NaN-looking) raster instead of throwing, since JS lets you index
    // arbitrarily off the end of a nested array without erroring.
    const raw = await this.variableArr.get(selection).then(r => r.flatten());
    return applyScaleOffset(raw, this.varAttrs);
  }

  async _renderFrame(timeIndex) {
    if (!this.mounted) return;
    const requestId = ++this.renderRequestId;
    const depthIndex = this.depthIndex ?? 0;
    const cacheKey = `${timeIndex}:${depthIndex}`;
    this.onLoadingChange?.(true);
    try {
      let cached = this.cachedFrames.get(cacheKey);
      if (!cached) {
        const values = await this._fetchValues(timeIndex, depthIndex);
        if (!this.mounted || requestId !== this.renderRequestId) return;
        const { latData, lonData } = this.dataset;
        let vmin = this.config.colorRange?.min ?? 0;
        let vmax = this.config.colorRange?.max ?? 2;
        // Layers flagged dynamicRange (temperature, velocity) use this
        // frame's own 1st/99th-percentile range instead of the fixed
        // surface-tuned default — see computeDynamicRange.
        if (this.config.dynamicRange) {
          const dyn = computeDynamicRange(values);
          if (dyn) { vmin = dyn.min; vmax = dyn.max; }
        }
        const colormap = getColormap(this.config.colormap, this.config.numColorBands ?? null);
        const opacity = this.config.opacity ?? 0.75;
        const thresholds = this.config.thresholds ?? null;
        const canvas = renderToCanvas(values, latData, lonData, colormap, vmin, vmax, opacity, thresholds);
        cached = { canvas, values, vmin, vmax };
        this.cachedFrames.set(cacheKey, cached);
        if (this.cachedFrames.size > 10) {
          const firstKey = this.cachedFrames.keys().next().value;
          this.cachedFrames.delete(firstKey);
        }
      }
      if (!this.mounted || requestId !== this.renderRequestId) return;

      const { deckBounds } = this.dataset;
      const layer = new BitmapLayer({
        id: `zarr-frame-${requestId}`,
        image: cached.canvas,
        bounds: deckBounds,
        pickable: false,
        opacity: 1,
        parameters: { depthTest: false },
        // Nearest-neighbour sampling (ported from niu_current's
        // zarrMapPanel.tsx): without this WebGL's default linear filtering
        // blurs the texture once the camera zooms in far enough that one
        // model cell covers many screen pixels.
        textureParameters: {
          minFilter: 'nearest',
          magFilter: 'nearest',
          mipmapFilter: 'none',
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge',
        },
      });
      this.overlay.setProps({ layers: [layer] });
      this.onTimeChange?.(this.dataset.timeLabels[timeIndex] ?? '', timeIndex, this.dataset.timeCount - 1);
      this.onStatsChange?.(
        this.config.colorRange?.min ?? 0,
        this.config.colorRange?.max ?? 2,
        this.config.units ?? 'm',
        { colorMin: cached.vmin, colorMax: cached.vmax, variable: this.config.variable }
      );
    } catch (err) {
      if (this.mounted && err.name !== 'AbortError') {
        console.error('[ZarrOverlay] render error:', err);
        this.onErrorChange?.(String(err));
      }
    } finally {
      if (requestId === this.renderRequestId) this.onLoadingChange?.(false);
    }
  }

  async getTimeseriesAtPoint(lng, lat) {
    await this._loadMetadata();
    if (!this.variableArr || !this.dataset) return null;
    const { latData, lonData, timeLabels } = this.dataset;
    const [[minLon, minLat], [maxLon, maxLat]] = this.dataset.bounds;
    const margin = 0.05;
    if (lng < minLon - margin || lng > maxLon + margin || lat < minLat - margin || lat > maxLat + margin) return null;

    const latIdx = latData.reduce((bi, v, i) => Math.abs(v - lat) < Math.abs(latData[bi] - lat) ? i : bi, 0);
    const lonIdx = lonData.reduce((bi, v, i) => Math.abs(v - lng) < Math.abs(lonData[bi] - lng) ? i : bi, 0);

    const ndim = this.variableArr.shape.length;
    const selection = ndim === 4
      ? [null, this.depthIndex ?? 0, latIdx, lonIdx]
      : ndim === 3
        ? [null, latIdx, lonIdx]
        : [latIdx, lonIdx];
    const raw = await this.variableArr.get(selection).then(r => r.flatten());
    const values = applyScaleOffset(raw, this.varAttrs);
    const heightValues = Array.from(values, (v) => (Number.isFinite(v) ? v : NaN));
    return {
      lat: latData[latIdx], lon: lonData[lonIdx],
      timeLabels,
      variables: [{ name: this.dataset.varName, units: this.config.units ?? 'm', values: heightValues }],
    };
  }

  setTimeIndex(index) {
    this.timeIndex = Math.max(0, Math.min(index, (this.dataset?.timeCount ?? 1) - 1));
    if (this._sliderTimer) clearTimeout(this._sliderTimer);
    this._sliderTimer = setTimeout(() => {
      this._sliderTimer = null;
      this._renderFrame(this.timeIndex);
    }, 150);
  }

  setThresholds(thresholds) {
    this.config = { ...this.config, thresholds };
    this.cachedFrames.clear();
    this._renderFrame(this.timeIndex);
  }

  // depthMeters is a value from the dataset's own depth coordinate (e.g. -30),
  // not a raw array index — resolved to the nearest real index the same way
  // setDepth is resolved on load, so a caller never needs to know the
  // dataset's exact depth levels. No-op for variables with no depth axis.
  setDepth(depthMeters) {
    this.depth = depthMeters;
    if (!this.depthLevels) return;
    const nextIndex = findNearestIndex(this.depthLevels, depthMeters);
    if (nextIndex === this.depthIndex) return;
    this.depthIndex = nextIndex;
    this._renderFrame(this.timeIndex);
  }

  getDepthLevels() { return this.depthLevels ?? null; }

  // Reads the value under (lng, lat) from whichever frame is already
  // rendered — no network round trip, so a click gets an instant popup
  // instead of waiting on a fresh fetch.
  getValueAtLngLat(lng, lat) {
    if (!this.dataset) return null;
    const { latData, lonData, cols, bounds } = this.dataset;
    const [[minLon, minLat], [maxLon, maxLat]] = bounds;
    if (lng < minLon || lng > maxLon || lat < minLat || lat > maxLat) return null;

    const cacheKey = `${this.timeIndex}:${this.depthIndex ?? 0}`;
    const cached = this.cachedFrames.get(cacheKey);
    if (!cached) return null;

    const latIdx = findNearestIndex(latData, lat);
    const lonIdx = findNearestIndex(lonData, lng);
    const v = cached.values[latIdx * cols + lonIdx];
    return Number.isFinite(v) ? v : null;
  }

  setOpacity(opacity) {
    this.config = { ...this.config, opacity };
    this.cachedFrames.clear();
    this._renderFrame(this.timeIndex);
  }

  getTimeCount() { return this.dataset?.timeCount ?? 1; }
  getTimeLabels() { return this.dataset?.timeLabels ?? []; }

  startPlayback(intervalMs = 700) {
    if (this.playInterval) clearInterval(this.playInterval);
    this.playInterval = setInterval(() => {
      const next = (this.timeIndex + 1) % this.getTimeCount();
      this.setTimeIndex(next);
    }, intervalMs);
  }
  stopPlayback() {
    if (this.playInterval) { clearInterval(this.playInterval); this.playInterval = null; }
  }

  destroy() {
    this.mounted = false;
    this._abortController.abort();
    this.stopPlayback();
    if (this._sliderTimer) { clearTimeout(this._sliderTimer); this._sliderTimer = null; }
    this.overlay.setProps({ layers: [] });
    try { this.map.removeControl(this.overlay); } catch {}
    this.cachedFrames.clear();
  }
}
