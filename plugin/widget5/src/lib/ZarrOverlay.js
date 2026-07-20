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
  return `${base}/${ds}`;
}

async function fetchConsolidatedMeta(storeUrl) {
  const resp = await fetch(`${storeUrl}/.zmetadata`);
  if (!resp.ok) throw new Error(`.zmetadata not found at ${storeUrl}`);
  return resp.json();
}

function getVarAttrs(consolidated, varName) {
  return consolidated?.metadata?.[`${varName}/.zattrs`] ?? {};
}

function getVarMeta(consolidated, varName) {
  return consolidated?.metadata?.[`${varName}/.zarray`] ?? null;
}

async function openZarrArray(storeUrl, varPath) {
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

// ── coordinate discovery ──────────────────────────────────────────────────────
// Try common name variants for lat, lon, time coords.
const LAT_NAMES = ['lat', 'latitude', 'y', 'nav_lat'];
const LON_NAMES = ['lon', 'longitude', 'x', 'nav_lon'];
const TIME_NAMES = ['time', 'timemax', 'Time'];

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

// ── canvas rendering ──────────────────────────────────────────────────────────
function renderToCanvas(values, rows, cols, colormap, vmin, vmax, opacity, thresholds) {
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(cols, rows);
  const px = imgData.data;
  const span = vmax - vmin || 1;
  const alpha = Math.round(opacity * 255);
  const hasThresholds = thresholds?.length > 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = values[r * cols + c];
      const pxIdx = (r * cols + c) * 4;
      if (!Number.isFinite(v) || v <= 0) { px[pxIdx + 3] = 0; continue; }
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
  const visibleCount = Array.from({ length: rows * cols }, (_, i) => imgData.data[i * 4 + 3] > 0).filter(Boolean).length;
  console.log(`[ZarrOverlay] canvas ${cols}×${rows}: ${visibleCount}/${rows * cols} visible pixels`);
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
    this.mounted = true;
    this.playInterval = null;
    this.renderRequestId = 0;
    this.prefetchAbort = null;
    this.cachedFrames = new Map(); // timeIndex → {canvas, values}
    this._sliderTimer = null;
    this.didAutoFit = false;

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
      console.error('[ZarrOverlay] init error:', err);
      this.onErrorChange?.(String(err));
    } finally {
      this.onLoadingChange?.(false);
    }
  }

  async _loadMetadata() {
    if (this.dataset) return;
    const storeUrl = buildZarrUrl(this.config.datasetName, this.config.zarrBaseUrl);

    const consolidated = await fetchConsolidatedMeta(storeUrl);

    const latName = discoverCoord(consolidated, LAT_NAMES);
    const lonName = discoverCoord(consolidated, LON_NAMES);
    const timeName = discoverCoord(consolidated, TIME_NAMES);

    if (!latName || !lonName) throw new Error('Could not find lat/lon coordinate arrays in Zarr store');

    const varName = this.config.heightVariable || this.config.variable;
    const varMeta = getVarMeta(consolidated, varName);
    if (!varMeta) throw new Error(`Variable "${varName}" not found in Zarr store`);

    this.variableArr = await openZarrArray(storeUrl, varName);
    const latArrRef = await openZarrArray(storeUrl, latName);
    const lonArrRef = await openZarrArray(storeUrl, lonName);

    const [latData, lonData] = await Promise.all([
      latArrRef.get(null).then(r => Array.from(r.data, Number)),
      lonArrRef.get(null).then(r => Array.from(r.data, Number)),
    ]);

    let timeCount = 1;
    let timeLabels = ['Timestep 1'];
    if (timeName) {
      const timeArrRef = await openZarrArray(storeUrl, timeName);
      const timeData = await timeArrRef.get(null).then(r => Array.from(r.data, Number));
      const timeAttrs = getVarAttrs(consolidated, timeName);
      const units = timeAttrs?.units ?? '';
      timeCount = timeData.length;

      if (units.includes('seconds since') || units.includes('hours since') || units.includes('days since')) {
        const refMatch = units.match(/since\s+(.+)/);
        const refDate = refMatch ? new Date(refMatch[1].trim()) : new Date(0);
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

    this.dataset = {
      storeUrl, varName, rows, cols, timeCount, timeLabels,
      bounds: [[minLon, minLat], [maxLon, maxLat]],
      deckBounds: [minLon, minLat, maxLon, maxLat],
      latData, lonData,
    };

    if (!this.didAutoFit) {
      this.didAutoFit = true;
      this.map.fitBounds(this.dataset.bounds, { padding: 30, animate: false });
    }
    this.onTimeChange?.(timeLabels[0] ?? '', 0, timeCount - 1);
  }

  async _fetchValues(timeIndex) {
    await this._loadMetadata();
    const selection = this.variableArr.shape.length === 3
      ? [timeIndex, null, null]
      : this.variableArr.shape.length === 2
        ? [null, null]
        : [timeIndex];
    const raw = await this.variableArr.get(selection).then(r => r.data);
    return applyScaleOffset(raw, this.varAttrs);
  }

  async _renderFrame(timeIndex) {
    if (!this.mounted) return;
    const requestId = ++this.renderRequestId;
    this.onLoadingChange?.(true);
    try {
      let cached = this.cachedFrames.get(timeIndex);
      if (!cached) {
        const values = await this._fetchValues(timeIndex);
        if (!this.mounted || requestId !== this.renderRequestId) return;
        const { rows, cols } = this.dataset;
        const vmin = this.config.colorRange?.min ?? 0;
        const vmax = this.config.colorRange?.max ?? 2;
        const colormap = getColormap(this.config.colormap, this.config.numColorBands ?? null);
        const opacity = this.config.opacity ?? 0.75;
        const thresholds = this.config.thresholds ?? null;
        const canvas = renderToCanvas(values, rows, cols, colormap, vmin, vmax, opacity, thresholds);
        cached = { canvas, values };
        this.cachedFrames.set(timeIndex, cached);
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
      });
      this.overlay.setProps({ layers: [layer] });
      this.onTimeChange?.(this.dataset.timeLabels[timeIndex] ?? '', timeIndex, this.dataset.timeCount - 1);
      this.onStatsChange?.(this.config.colorRange?.min ?? 0, this.config.colorRange?.max ?? 2, 'm');
    } catch (err) {
      console.error('[ZarrOverlay] render error:', err);
      this.onErrorChange?.(String(err));
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

    const raw = await this.variableArr.get(
      this.variableArr.shape.length === 3 ? [null, latIdx, lonIdx] : [latIdx, lonIdx]
    ).then(r => r.data);
    const values = applyScaleOffset(raw, this.varAttrs);
    const heightValues = Array.from(values, (v) => (Number.isFinite(v) ? v : NaN));
    return {
      lat: latData[latIdx], lon: lonData[lonIdx],
      timeLabels,
      variables: [{ name: this.dataset.varName, units: 'm', values: heightValues }],
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
    this.stopPlayback();
    if (this._sliderTimer) { clearTimeout(this._sliderTimer); this._sliderTimer = null; }
    this.overlay.setProps({ layers: [] });
    try { this.map.removeControl(this.overlay); } catch {}
    this.cachedFrames.clear();
  }
}
