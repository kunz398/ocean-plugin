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
    this._timesteps   = [];
    this._destroyed   = false;
    this._sourceReady = false;

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
      const resp = await fetch(`${this._apiBase}/niue/inundation/timesteps`);
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
      if (!this._destroyed) this.onErrorChange?.(err.message);
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
    const tp = serializeThresholdParams(this._categories);
    if (tp) Object.entries(tp).forEach(([k, v]) => params.set(k, v));
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
  updateConfig({ inundationCategories, minVisibleDepth } = {}) {
    if (inundationCategories !== undefined) this._categories = inundationCategories;
    if (minVisibleDepth !== undefined && minVisibleDepth !== null) this._vmin = minVisibleDepth;
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
    this._removeFromMap();
  }

  // ── private helpers ───────────────────────────────────────────────────────

  _setLoading(value) {
    this.onLoadingChange?.(value);
  }
}
