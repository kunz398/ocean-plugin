// NiueInundationOverlay.js
// MapLibre GL raster-tile overlay for the Niue inundation FastAPI routes
// (`/niue/inundation/*` on the shared ocean-zarr.spc.int service). Implements
// the same public interface as ZarrOverlay/UgridOverlay/SfincsRasterOverlay so
// useZarrMap.js can treat it as a drop-in.
//
// Route shape differs from the Cook Islands SfincsRasterOverlay:
//   GET /niue/inundation/metadata
//   GET /niue/inundation/timesteps
//   GET /niue/inundation/point-value?lon=&lat=&time_index=
//   GET /niue/inundation/point-timeseries?lon=&lat=
//   GET /niue/inundation/tiles/{time_index}/{z}/{x}/{y}.png

const SOURCE_ID = 'niue-inundation-raster-source';
const LAYER_ID  = 'niue-inundation-raster-layer';

function serializeThresholdParams(categories) {
  if (!Array.isArray(categories) || categories.length < 2) return null;
  const thresholds = [];
  const colors = [];
  for (const cat of categories) {
    const t = Number(cat?.thresholdM);
    const c = String(cat?.color ?? '').replace(/^#/, '');
    if (!Number.isFinite(t) || !/^[0-9a-fA-F]{6}$/.test(c)) continue;
    thresholds.push(t);
    colors.push(c.toLowerCase());
  }
  if (thresholds.length < 2) return null;
  return {
    render_mode: 'thresholds',
    thresholds: thresholds.join(','),
    colors:     colors.join(','),
  };
}

export class NiueInundationOverlay {
  constructor(map, config) {
    this._map        = map;
    this._apiBase    = (config.apiBase || '').replace(/\/$/, '');
    this._vmin       = config.minVisibleDepth ?? (config.colorRange?.min ?? 0.05);
    this._vmax       = config.colorRange?.max ?? 3.0;
    this._opacity    = config.opacity ?? 0.75;
    this._timeIndex  = 0;
    this._categories  = config.inundationCategories ?? null;
    this._renderMode  = config.inundationRenderMode ?? 'continuous';
    this._timesteps   = [];
    this._destroyed   = false;
    this._sourceReady = false;
    // Cancels this instance's in-flight /timesteps fetch — aborted in
    // destroy(). Without this, rapid layer switching leaves abandoned
    // fetches running to completion in the background, which can pile up
    // enough of them to exhaust the browser's per-origin connection limit
    // and starve the *current* layer's own fetch with a genuine
    // "TypeError: Failed to fetch". Mirrors UgridOverlay's _abortController.
    this._abortController = new AbortController();

    // callbacks — assigned by useZarrMap after construction
    this.onTimeChange    = null;
    this.onLoadingChange = null;
    this.onErrorChange   = null;
    this.onStatsChange   = null;

    // MapLibre falls back to console.error for any 'error' event with no
    // registered listener. Every raster tile that fails mid-reload (layer
    // switch, vessel switch, or a tile simply falling out of the retained
    // set) fires one of these — a single tile failing just means a blank
    // tile, not an overlay-level failure, so this listener's only job is
    // to keep that expected noise off the console instead of alarming
    // the user via onErrorChange.
    this._handleMapError = this._handleMapError.bind(this);
    this._map.on('error', this._handleMapError);

    this._initialize();
  }

  _handleMapError(e) {
    if (e?.sourceId !== SOURCE_ID) return;
  }

  // ── init: fetch timesteps then add MapLibre source/layer ─────────────────

  async _initialize() {
    this._setLoading(true);
    try {
      const resp = await fetch(`${this._apiBase}/niue/inundation/timesteps`, { signal: this._abortController.signal });
      if (!resp.ok) throw new Error(`/niue/inundation/timesteps returned ${resp.status}`);
      const payload = await resp.json();
      const raw = Array.isArray(payload?.timesteps) ? payload.timesteps : [];
      this._timesteps = raw
        .map((v) => new Date(v))
        .filter((d) => !Number.isNaN(d.getTime()));

      if (this._destroyed) return;

      // Same rAF buffer as SfincsRasterOverlay — lets any prior deck.gl GL
      // context finalization settle before writing a raster layer into
      // MapLibre's style.
      await new Promise((resolve) => requestAnimationFrame(resolve));

      if (this._destroyed) return;

      this._addToMap();

      const maxIdx = Math.max(0, this._timesteps.length - 1);
      this.onTimeChange?.(this._timesteps[0]?.toISOString() ?? '', 0, maxIdx);
    } catch (err) {
      if (!this._destroyed && err.name !== 'AbortError') this.onErrorChange?.(err.message);
    } finally {
      if (!this._destroyed) this._setLoading(false);
    }
  }

  _addToMap() {
    this._removeFromMap();

    this._map.addSource(SOURCE_ID, {
      type: 'raster',
      tiles: [this._buildTileUrl(this._timeIndex)],
      tileSize: 256,
    });
    this._map.addLayer({
      id: LAYER_ID,
      type: 'raster',
      source: SOURCE_ID,
      paint: { 'raster-opacity': this._opacity },
    });
    this._sourceReady = true;
  }

  _removeFromMap() {
    try {
      if (this._map.getLayer(LAYER_ID))   this._map.removeLayer(LAYER_ID);
      if (this._map.getSource(SOURCE_ID)) this._map.removeSource(SOURCE_ID);
    } catch (_) { /* map may already be torn down */ }
    this._sourceReady = false;
  }

  // ── URL builders ──────────────────────────────────────────────────────────

  _buildTileUrl(timeIndex) {
    const params = new URLSearchParams({
      vmin: String(this._vmin),
      vmax: String(this._vmax),
    });
    if (this._renderMode === 'continuous') {
      params.set('render_mode', 'continuous');
    } else {
      const tp = serializeThresholdParams(this._categories);
      if (tp) Object.entries(tp).forEach(([k, v]) => params.set(k, v));
    }
    return `${this._apiBase}/niue/inundation/tiles/${timeIndex}/{z}/{x}/{y}.png?${params}`;
  }

  _updateTiles() {
    if (!this._sourceReady) return;
    try {
      this._map.getSource(SOURCE_ID)?.setTiles([this._buildTileUrl(this._timeIndex)]);
    } catch (_) { /* source removed mid-update */ }
  }

  // ── public interface (mirrors ZarrOverlay / UgridOverlay / SfincsRasterOverlay) ──

  setTimeIndex(timeIndex) {
    const max = Math.max(0, this._timesteps.length - 1);
    this._timeIndex = Math.max(0, Math.min(timeIndex, max));
    this._updateTiles();
  }

  setOpacity(opacity) {
    this._opacity = opacity;
    if (!this._sourceReady) return;
    try {
      this._map.setPaintProperty(LAYER_ID, 'raster-opacity', opacity);
    } catch (_) { /* layer removed */ }
  }

  // Called by useZarrMap when inundationCategories/minVisibleDepth change. No
  // range-window support yet — Niue's API has no range-max endpoint (unlike Cook Islands).
  updateConfig({ inundationCategories, minVisibleDepth, inundationRenderMode } = {}) {
    if (inundationCategories !== undefined) this._categories = inundationCategories;
    if (minVisibleDepth !== undefined && minVisibleDepth !== null) this._vmin = minVisibleDepth;
    if (inundationRenderMode !== undefined) this._renderMode = inundationRenderMode;
    this._updateTiles();
  }

  // Returns { lon, lat, timeLabels: string[], variables: [{name, values: number[]}] }
  async getTimeseriesAtPoint(lng, lat, minDepth) {
    const params = new URLSearchParams({ lon: String(lng), lat: String(lat) });
    if (Number.isFinite(minDepth)) params.set('min_depth', String(minDepth));
    const url = `${this._apiBase}/niue/inundation/point-timeseries?${params}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`/niue/inundation/point-timeseries ${resp.status}`);
    const payload = await resp.json();
    const rawValues = Array.isArray(payload?.values) ? payload.values : [];
    if (rawValues.length === 0) return null;

    const timeLabels = rawValues.map((v) => v.time ?? '');
    const depthValues = rawValues.map((v) => {
      const d = v.depth_m;
      return typeof d === 'number' && Number.isFinite(d) ? d : 0;
    });

    return {
      lon: payload.lon_requested ?? lng,
      lat: payload.lat_requested ?? lat,
      timeLabels,
      variables: [{ name: 'depth', values: depthValues }],
    };
  }

  getTimeLabels() {
    return this._timesteps.map((t) =>
      t.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
    );
  }

  destroy() {
    this._destroyed = true;
    this._abortController.abort();
    this._map.off('error', this._handleMapError);
    this._removeFromMap();
  }

  // ── private helpers ───────────────────────────────────────────────────────

  _setLoading(value) {
    this.onLoadingChange?.(value);
  }
}
