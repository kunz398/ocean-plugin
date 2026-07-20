import { openArray, HTTPStore } from 'zarr';
import InundationProvider from './InundationProvider';

function nearestIndex(values, target) {
  let best = 0;
  let bestDist = Math.abs(values[0] - target);
  for (let i = 1; i < values.length; i++) {
    const d = Math.abs(values[i] - target);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

function hexToRgb(hex) {
  const n = parseInt((hex || '').replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function classifyDepthToRgba(depth, categories, vmin) {
  if (!Number.isFinite(depth) || depth < vmin) return null;
  let color = null;
  for (const cat of categories) {
    if (depth >= cat.thresholdM) color = cat.color;
  }
  if (!color) return null;
  const [r, g, b] = hexToRgb(color);
  return [r, g, b, 220];
}

function renderToCanvas(flatData, latCount, lonCount, latAscending, categories, vmin) {
  const canvas = document.createElement('canvas');
  canvas.width = lonCount;
  canvas.height = latCount;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(lonCount, latCount);

  for (let row = 0; row < latCount; row++) {
    // If lat is ascending (south→north), flip row so north is at top of canvas
    const srcRow = latAscending ? (latCount - 1 - row) : row;
    for (let col = 0; col < lonCount; col++) {
      const dataIdx = srcRow * lonCount + col;
      const pixelIdx = (row * lonCount + col) * 4;
      const rgba = classifyDepthToRgba(flatData[dataIdx], categories, vmin);
      if (rgba) {
        imageData.data[pixelIdx] = rgba[0];
        imageData.data[pixelIdx + 1] = rgba[1];
        imageData.data[pixelIdx + 2] = rgba[2];
        imageData.data[pixelIdx + 3] = rgba[3];
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function buildUrl(baseUrl, dataset) {
  const base = (baseUrl || '').replace(/\/$/, '');
  return `${base}/${dataset}`;
}

export default class ZarrInundationProvider extends InundationProvider {
  id = 'zarr';
  label = 'Zarr (Direct)';
  capabilities = {
    timestepRaster: true,
    rangeMaxRaster: true,
    pointValue: true,
    timeseries: true,
  };

  constructor({ baseUrl, dataset, dataset48h }) {
    super();
    this._baseUrl = (baseUrl || '').replace(/\/$/, '');
    this._dataset = dataset || 'sfincs_hmax_forecast.zarr';
    this._dataset48h = dataset48h || null;
    this._hArr = null;
    this._latValues = null;
    this._lonValues = null;
    this._latAscending = true;
    this._manifest = null;
    this._loadPromise = null;
    this._h48Arr = null;
    this._load48Promise = null;
  }

  _storeUrl(dataset) {
    return buildUrl(this._baseUrl, dataset);
  }

  _manifestUrl() {
    return buildUrl(this._baseUrl, this._dataset.replace('.zarr', '_manifest.json'));
  }

  async _readManifest() {
    if (this._manifest) return this._manifest;
    const res = await fetch(this._manifestUrl());
    if (!res.ok) throw new Error(`Zarr manifest fetch failed: ${res.status}`);
    this._manifest = await res.json();
    return this._manifest;
  }

  async _ensureLoaded() {
    if (this._hArr) return;
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = (async () => {
      const storeUrl = this._storeUrl(this._dataset);
      const store = new HTTPStore(storeUrl);
      const [hArr, latArr, lonArr] = await Promise.all([
        openArray({ store, path: 'h', mode: 'r' }),
        openArray({ store, path: 'lat', mode: 'r' }),
        openArray({ store, path: 'lon', mode: 'r' }),
      ]);
      const [latRaw, lonRaw] = await Promise.all([latArr.get(null), lonArr.get(null)]);
      this._latValues = latRaw.data;
      this._lonValues = lonRaw.data;
      this._latAscending = this._latValues[0] < this._latValues[this._latValues.length - 1];
      this._hArr = hArr;
    })();
    return this._loadPromise;
  }

  async _ensure48Loaded() {
    if (this._h48Arr) return;
    if (!this._dataset48h) throw new Error('No 48h dataset configured');
    if (this._load48Promise) return this._load48Promise;
    this._load48Promise = (async () => {
      const store = new HTTPStore(this._storeUrl(this._dataset48h));
      // sfincs_hmax_48h.zarr's array is named 'hmax', not 'h' — it's a separate
      // pre-computed max-over-window product, not a slice of the hourly 'h' cube.
      this._h48Arr = await openArray({ store, path: 'hmax', mode: 'r' });
    })();
    return this._load48Promise;
  }

  async loadMetadata() {
    return this._readManifest();
  }

  async loadTimesteps() {
    const manifest = await this._readManifest();
    return (manifest.timesteps || []).map(t => new Date(t));
  }

  async _renderFrame(arr, selection, latCount, lonCount, thresholdCategories, vmin) {
    const frameData = await arr.get(selection);
    const flatData = frameData.data;
    const categories = Array.isArray(thresholdCategories) && thresholdCategories.length >= 2
      ? thresholdCategories
      : [{ thresholdM: vmin, color: '#2196f3' }, { thresholdM: 1.0, color: '#f44336' }];
    return renderToCanvas(flatData, latCount, lonCount, this._latAscending, categories, vmin);
  }

  async getFrameUrl({ timeIndex, rangeWindow, vmin = 0.05, thresholdCategories = null }) {
    if (rangeWindow && rangeWindow.mode !== 'single') {
      return this._getRangeMaxFrameUrl({ vmin, thresholdCategories });
    }
    await this._ensureLoaded();
    const latCount = this._latValues.length;
    const lonCount = this._lonValues.length;
    return this._renderFrame(this._hArr, [timeIndex, null, null], latCount, lonCount, thresholdCategories, vmin);
  }

  async _getRangeMaxFrameUrl({ vmin = 0.05, thresholdCategories = null }) {
    if (!this._dataset48h) {
      throw new Error('48h zarr dataset not configured — set REACT_APP_INUNDATION_ZARR_48H_DATASET');
    }
    await this._ensure48Loaded();
    await this._ensureLoaded(); // for latValues/lonValues
    const latCount = this._latValues.length;
    const lonCount = this._lonValues.length;
    // 48h zarr is a 2D (lat, lon) array with no time dimension
    return this._renderFrame(this._h48Arr, [null, null], latCount, lonCount, thresholdCategories, vmin);
  }

  async preloadFrame({ timeIndex, rangeWindow, vmin = 0.05, vmax, thresholdCategories = null }) {
    const url = await this.getFrameUrl({ timeIndex, rangeWindow, vmin, vmax, thresholdCategories });
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
    return { url, image };
  }

  async warmupFrames({ startIndex = 0, count = 1, frameCount, vmin = 0.05, vmax, thresholdCategories = null }) {
    const total = Math.max(Number(frameCount) || 0, 0);
    const preloadCount = Math.min(Math.max(Number(count) || 0, 0), total);
    if (total <= 0 || preloadCount <= 0) return [];
    const jobs = [];
    for (let i = 0; i < preloadCount; i++) {
      const idx = (startIndex + i) % total;
      jobs.push(this.preloadFrame({ timeIndex: idx, vmin, vmax, thresholdCategories }));
    }
    return Promise.all(jobs);
  }

  async getTimeseries({ lat, lng }) {
    await this._ensureLoaded();
    const manifest = await this._readManifest();
    const latIdx = nearestIndex(this._latValues, lat);
    const lonIdx = nearestIndex(this._lonValues, lng);
    const tsData = await this._hArr.get([null, latIdx, lonIdx]);
    const values = Array.from(tsData.data).map(v => (Number.isFinite(v) && v >= 0 ? v : null));
    const timestamps = (manifest.timesteps || []).map(t => new Date(t));
    return {
      timestamps,
      values,
      lat: this._latValues[latIdx],
      lon: this._lonValues[lonIdx],
    };
  }

  async getPointValue({ lat, lng, timeIndex, rangeWindow }) {
    if (rangeWindow && rangeWindow.mode !== 'single') {
      return { value: 'Range max point sampling not available (Zarr)', available: false, reason: 'not-supported' };
    }
    await this._ensureLoaded();
    const latIdx = nearestIndex(this._latValues, lat);
    const lonIdx = nearestIndex(this._lonValues, lng);
    const raw = await this._hArr.get([timeIndex, latIdx, lonIdx]);
    const v = raw.data[0] ?? raw;
    const value = typeof v === 'number' ? v : (raw.data ? raw.data[0] : NaN);
    if (!Number.isFinite(value) || value < 0) {
      return { value: 'No Data', available: true };
    }
    return { value: value.toFixed(2), raw: value, available: true };
  }
}
