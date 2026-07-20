// ZarrOverlay.js — renders a regular-grid Zarr raster (SFINCS, WW3, etc.) via deck.gl + MapLibre.
// Adapted from zarr_web/src/lib/zarrOverlay.ts (TypeScript stripped, zarrita → zarr v0.6.3).
import { MapboxOverlay } from '@deck.gl/mapbox';
import { BitmapLayer } from '@deck.gl/layers';
import { getColormap } from './colormaps';
import { withRetry } from './withRetry';
import { renderToCanvas } from './canvasRaster';
import {
  LAT_NAMES, LON_NAMES, TIME_NAMES,
  fetchConsolidatedMeta, getVarAttrs, getVarMeta, discoverCoord, openZarrArray, applyScaleOffset,
} from './zarrClient';

// ── zarr helpers ─────────────────────────────────────────────────────────────
function buildZarrUrl(datasetName, baseUrl) {
  const base = ((baseUrl || '').trim() || 'https://s3.ap-southeast-2.wasabisys.com/spc-zarr-file/')
    .replace(/\/+$/, '');
  const ds = datasetName.replace(/^\/+/, '').replace(/\/+$/, '');
  return `${base}/${ds}`;
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
    // .get() returns a NestedArray for multi-dim results — .data is an array of
    // arrays, not a flat typed array. .flatten() gives the row-major flat buffer
    // that renderToCanvas's `values[r * cols + c]` indexing actually needs.
    const raw = await this.variableArr.get(selection).then(r => r.flatten());
    return applyScaleOffset(raw, this.varAttrs);
  }

  async _renderFrame(timeIndex) {
    if (!this.mounted) return;
    const requestId = ++this.renderRequestId;
    this.onLoadingChange?.(true);
    try {
      let cached = this.cachedFrames.get(timeIndex);
      if (!cached) {
        // Transient network errors during playback (e.g. a dropped chunk fetch)
        // shouldn't surface as a fatal "Layer error" banner — retry with backoff
        // first, and only bail out if this frame request has gone stale anyway.
        const values = await withRetry(
          () => this._fetchValues(timeIndex),
          {
            shouldAbort: () => !this.mounted || requestId !== this.renderRequestId,
            onRetry: (err, attempt, delay) => {
              console.warn(`[ZarrOverlay] fetch failed for frame ${timeIndex} (attempt ${attempt}), retrying in ${delay}ms`, err);
            },
          }
        );
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
      // A stale/superseded request (user scrubbed past this frame while retrying)
      // isn't a real failure — only report errors for the still-current frame.
      if (this.mounted && requestId === this.renderRequestId) {
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
