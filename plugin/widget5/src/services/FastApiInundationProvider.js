import InundationProvider from './InundationProvider';
import SfincsRasterService from './SfincsRasterService';

// Replicated from SfincsRasterService (private helpers, kept here to avoid coupling)
function buildUrl(baseUrl, path, params = {}) {
  const normalizedBase = (baseUrl || '').replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${normalizedBase}${normalizedPath}`, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function normalizeThresholdColor(color) {
  const normalized = String(color ?? '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : null;
}

function serializeThresholdConfig(categories, options = {}) {
  const { resampleColors = false } = options;
  if (!Array.isArray(categories) || categories.length < 2) return {};
  const thresholds = [];
  const colors = [];
  categories.forEach((category) => {
    const thresholdM = Number(category?.thresholdM);
    const color = normalizeThresholdColor(category?.color);
    if (!Number.isFinite(thresholdM) || !color) return;
    thresholds.push(thresholdM);
    colors.push(color);
  });
  if (thresholds.length < 2 || thresholds.length !== colors.length) return {};
  return {
    render_mode: 'thresholds',
    thresholds: thresholds.join(','),
    colors: colors.join(','),
    ...(resampleColors ? { resample_colors: true } : {}),
  };
}

function preloadImageHelper(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export default class FastApiInundationProvider extends InundationProvider {
  id = 'fastapi';
  label = 'FastAPI';
  capabilities = {
    timestepRaster: true,
    rangeMaxRaster: true,
    pointValue: true,
    timeseries: true,
  };

  constructor(baseUrl) {
    super();
    this._baseUrl = (baseUrl || '').replace(/\/$/, '');
    this._service = new SfincsRasterService(baseUrl);
  }

  loadMetadata() { return this._service.loadMetadata(); }
  loadTimesteps() { return this._service.loadTimesteps(); }

  getFrameUrl({ timeIndex, rangeWindow, vmin, vmax, thresholdCategories = null, resampleColors = false }) {
    if (!rangeWindow || rangeWindow.mode === 'single') {
      return this._service.getFrameUrl({ timeIndex, vmin, vmax, thresholdCategories, resampleColors });
    }
    return buildUrl(this._baseUrl, '/range-max/raster-png', {
      start_index: rangeWindow.startIndex ?? 0,
      end_index: rangeWindow.endIndex ?? 47,
      vmin,
      vmax,
      ...serializeThresholdConfig(thresholdCategories, { resampleColors }),
    });
  }

  async preloadFrame({ timeIndex, rangeWindow, vmin, vmax, thresholdCategories = null, resampleColors = false }) {
    const url = this.getFrameUrl({ timeIndex, rangeWindow, vmin, vmax, thresholdCategories, resampleColors });
    const image = await preloadImageHelper(url);
    return { url, image };
  }

  async warmupFrames({ startIndex = 0, count = 1, frameCount, vmin, vmax, thresholdCategories = null, resampleColors = false }) {
    // Range-max modes have only one frame — do nothing for warmup
    return this._service.warmupFrames({ startIndex, count, frameCount, vmin, vmax, thresholdCategories, resampleColors });
  }

  getTimeseries({ lat, lng }) { return this._service.getTimeseries({ lat, lng }); }

  getPointValue({ lat, lng, timeIndex, rangeWindow }) {
    if (rangeWindow && rangeWindow.mode !== 'single') {
      return Promise.resolve({
        value: 'Range max point sampling not available',
        available: false,
        reason: 'no-range-max-point-endpoint',
      });
    }
    return this._service.getPointValue({ lat, lng, timeIndex });
  }
}
