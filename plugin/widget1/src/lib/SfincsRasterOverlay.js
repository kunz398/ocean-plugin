// SfincsRasterOverlay.js
// MapLibre GL raster-tile overlay for the SFINCS inundation FastAPI.
// Implements the same interface as ZarrOverlay/UgridOverlay so that
// useZarrMap.js can treat it as a drop-in for sfincs-raster layers.
//
// Tile endpoints consumed:
//   GET /tiles/{time_index}/{z}/{x}/{y}.png   — single timestep
//   GET /range-max/tile/{z}/{x}/{y}.png       — range-max window

const SOURCE_ID = 'sfincs-raster-source';
const LAYER_ID  = 'sfincs-raster-layer';

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

export class SfincsRasterOverlay {
  constructor(map, config) {
    this._map        = map;
    this._apiBase    = (config.apiBase || '').replace(/\/$/, '');
    this._vmin       = config.minVisibleDepth ?? (config.colorRange?.min ?? 0.05);
    this._vmax       = config.colorRange?.max ?? 3.0;
    this._opacity    = config.opacity ?? 0.75;
    this._timeIndex  = 0;
    this._rangeWindow  = null;
    this._categories   = config.inundationCategories ?? null;
    this._timesteps    = [];
    this._destroyed    = false;
    this._sourceReady  = false;

    // callbacks — assigned by useZarrMap after construction
    this.onTimeChange    = null;
    this.onLoadingChange = null;
    this.onErrorChange   = null;
    this.onStatsChange   = null;

    this._initialize();
  }

  // ── init: fetch timesteps then add MapLibre source/layer ─────────────────

  async _initialize() {
    this._setLoading(true);
    try {
      const resp = await fetch(`${this._apiBase}/timesteps`);
      if (!resp.ok) throw new Error(`/timesteps returned ${resp.status}`);
      const payload = await resp.json();
      const raw = Array.isArray(payload?.timesteps) ? payload.timesteps : [];
      this._timesteps = raw
        .map((v) => new Date(v))
        .filter((d) => !Number.isNaN(d.getTime()));

      if (this._destroyed) return;

      // One rAF buffer so any prior deck.gl GL-context finalization settles
      // before we write the raster layer into MapLibre's style. Without this,
      // MapLibre's raster WebGL program can be undefined on the very first frame
      // after switching from a deck.gl overlay (MapboxOverlay shares the GL context).
      await new Promise((resolve) => requestAnimationFrame(resolve));

      if (this._destroyed) return;

      this._addToMap();

      const maxIdx = Math.max(0, this._timesteps.length - 1);
      this.onTimeChange?.(this._timesteps[0]?.toISOString() ?? '', 0, maxIdx);
    } catch (err) {
      if (!this._destroyed) this.onErrorChange?.(err.message);
    } finally {
      if (!this._destroyed) this._setLoading(false);
    }
  }

  _addToMap() {
    // Remove any stale source/layer from a previous layer switch
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
    const tp = serializeThresholdParams(this._categories);
    if (tp) Object.entries(tp).forEach(([k, v]) => params.set(k, v));
    return `${this._apiBase}/tiles/${timeIndex}/{z}/{x}/{y}.png?${params}`;
  }

  _buildRangeMaxTileUrl(rw) {
    const params = new URLSearchParams({
      start_index: String(rw.startIndex ?? 0),
      end_index:   String(rw.endIndex   ?? 47),
      vmin: String(this._vmin),
      vmax: String(this._vmax),
    });
    const tp = serializeThresholdParams(this._categories);
    if (tp) Object.entries(tp).forEach(([k, v]) => params.set(k, v));
    return `${this._apiBase}/range-max/tile/{z}/{x}/{y}.png?${params}`;
  }

  _currentTileUrl() {
    if (this._rangeWindow && this._rangeWindow.mode !== 'single') {
      return this._buildRangeMaxTileUrl(this._rangeWindow);
    }
    return this._buildTileUrl(this._timeIndex);
  }

  _updateTiles() {
    if (!this._sourceReady) return;
    try {
      this._map.getSource(SOURCE_ID)?.setTiles([this._currentTileUrl()]);
    } catch (_) { /* source removed mid-update */ }
  }

  // ── public interface (mirrors ZarrOverlay / UgridOverlay) ─────────────────

  setTimeIndex(timeIndex) {
    const max = Math.max(0, this._timesteps.length - 1);
    this._timeIndex = Math.max(0, Math.min(timeIndex, max));
    if (!this._rangeWindow || this._rangeWindow.mode === 'single') {
      this._updateTiles();
    }
  }

  setOpacity(opacity) {
    this._opacity = opacity;
    if (!this._sourceReady) return;
    try {
      this._map.setPaintProperty(LAYER_ID, 'raster-opacity', opacity);
    } catch (_) { /* layer removed */ }
  }

  // Called by useZarrMap when rangeWindow, inundationCategories, or minVisibleDepth change
  updateConfig({ rangeWindow, inundationCategories, minVisibleDepth } = {}) {
    if (rangeWindow        !== undefined) this._rangeWindow  = rangeWindow;
    if (inundationCategories !== undefined) this._categories = inundationCategories;
    if (minVisibleDepth !== undefined && minVisibleDepth !== null) this._vmin = minVisibleDepth;
    this._updateTiles();
  }

  // Returns { lon, lat, timeLabels: string[], variables: [{name, values: number[]}] }
  async getTimeseriesAtPoint(lng, lat) {
    const url = `${this._apiBase}/depth-timeseries?lat=${lat}&lon=${lng}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`/depth-timeseries ${resp.status}`);
    const payload = await resp.json();

    const rawValues = Array.isArray(payload?.values) ? payload.values : [];
    if (rawValues.length === 0) return null;

    const timeLabels = rawValues.map((v) => v.time ?? '');
    // null/non-finite → 0: inside the domain but dry. Empty rawValues is the true
    // "outside domain" signal (handled above). Dry land is still valid forecast data.
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
    this._removeFromMap();
  }

  // ── private helpers ───────────────────────────────────────────────────────

  _setLoading(value) {
    this.onLoadingChange?.(value);
  }
}
