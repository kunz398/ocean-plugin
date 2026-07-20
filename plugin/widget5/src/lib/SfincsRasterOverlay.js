// SfincsRasterOverlay.js
// MapLibre GL raster overlay for the SFINCS inundation FastAPI.
//
// Single-timestep mode: fetches /raster-png as a Blob, creates a blob URL,
//   and calls ImageSource.updateImage({ url }). MapLibre keeps the previous
//   frame visible while the new one loads — no blank flash during animation.
//
// Range-max mode: calls ImageSource.updateImage() with the /range-max/raster-png
//   URL directly. Old frame stays visible during the (slow) server fetch.
//
// Both modes share a single MapLibre `image` source — no canvas source (removed
// in MapLibre 5), no separate tile-based source.

const SOURCE_ID = 'sfincs-frame-source';
const LAYER_ID  = 'sfincs-frame-layer';

// 1×1 transparent GIF — placeholder before the first frame loads.
const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

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
    this._map       = map;
    this._apiBase   = (config.apiBase || '').replace(/\/$/, '');
    this._vmin      = config.minVisibleDepth ?? config.colorRange?.min ?? 0.05;
    this._vmax      = config.colorRange?.max ?? 3.0;
    this._opacity   = config.opacity ?? 0.75;
    this._timeIndex = 0;
    this._rangeWindow  = null;
    this._categories   = config.inundationCategories ?? null;
    this._timesteps    = [];
    this._destroyed    = false;
    this._sourceReady  = false;
    this._inRangeMax   = false;
    this._pendingLoad  = null;   // cancellation token for in-flight fetch
    this._queuedFrameIndex = null; // latest requested frame while a fetch is in flight
    this._loadedFrameIndex = null;
    this._currentBlobUrl = null; // most recent blob URL (revoked on next update)
    // bounds: { southWest: [lat, lon], northEast: [lat, lon] }
    this._bounds = config.bounds ?? null;

    this.onTimeChange    = null;
    this.onLoadingChange = null;
    this.onErrorChange   = null;
    this.onStatsChange   = null;

    this._initialize();
  }

  // ── init ─────────────────────────────────────────────────────────────────

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

      // One rAF so any prior deck.gl GL-context finalization settles before we
      // write into MapLibre's style (MapboxOverlay shares the GL context).
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

  // ── map source/layer management ───────────────────────────────────────────

  _addToMap() {
    this._removeFromMap();

    const coords = this._imageCoords();
    if (coords) {
      // Image source: starts with transparent placeholder, updated via updateImage()
      this._map.addSource(SOURCE_ID, { type: 'image', url: PLACEHOLDER, coordinates: coords });
    } else {
      // Fallback when no bounds are configured: tile source
      this._map.addSource(SOURCE_ID, {
        type: 'raster',
        tiles: [`${this._apiBase}/tiles/${this._timeIndex}/{z}/{x}/{y}.png`],
        tileSize: 256,
      });
    }

    this._map.addLayer({
      id: LAYER_ID,
      type: 'raster',
      source: SOURCE_ID,
      paint: { 'raster-opacity': this._opacity },
    });
    this._sourceReady = true;

    if (coords) this._loadFrame(this._timeIndex);
  }

  _removeFromMap() {
    this._cancelPendingLoad();
    this._revokeBlobUrl();
    try {
      if (this._map.getLayer(LAYER_ID))   this._map.removeLayer(LAYER_ID);
      if (this._map.getSource(SOURCE_ID)) this._map.removeSource(SOURCE_ID);
    } catch (_) {}
    this._sourceReady = false;
    this._inRangeMax  = false;
  }

  // ── URL builders ──────────────────────────────────────────────────────────

  _buildFrameImageUrl(timeIndex) {
    const params = new URLSearchParams({
      time_index: String(timeIndex),
      vmin: String(this._vmin),
      vmax: String(this._vmax),
    });
    const tp = serializeThresholdParams(this._categories);
    if (tp) Object.entries(tp).forEach(([k, v]) => params.set(k, v));
    return `${this._apiBase}/raster-png?${params}`;
  }

  _buildRangeMaxImageUrl(rw) {
    const params = new URLSearchParams({
      start_index: String(rw.startIndex ?? 0),
      end_index:   String(rw.endIndex   ?? 47),
      vmin: String(this._vmin),
      vmax: String(this._vmax),
    });
    const tp = serializeThresholdParams(this._categories);
    if (tp) Object.entries(tp).forEach(([k, v]) => params.set(k, v));
    return `${this._apiBase}/range-max/raster-png?${params}`;
  }

  // [lat, lon] bounds → MapLibre image coordinates [TL, TR, BR, BL]
  _imageCoords() {
    if (!this._bounds) return null;
    const [latS, lonW] = this._bounds.southWest;
    const [latN, lonE] = this._bounds.northEast;
    return [[lonW, latN], [lonE, latN], [lonE, latS], [lonW, latS]];
  }

  // ── frame loading ─────────────────────────────────────────────────────────

  _cancelPendingLoad({ clearQueue = true } = {}) {
    if (this._pendingLoad) {
      this._pendingLoad.cancelled = true;
      this._pendingLoad = null;
    }
    if (clearQueue) this._queuedFrameIndex = null;
  }

  _revokeBlobUrl() {
    if (this._currentBlobUrl) {
      URL.revokeObjectURL(this._currentBlobUrl);
      this._currentBlobUrl = null;
    }
  }

  // Fetch /raster-png as a blob → blob URL → ImageSource.updateImage()
  // The image source keeps displaying the previous frame until the new one is ready.
  _loadFrame(timeIndex) {
    const coords = this._imageCoords();
    if (!coords) { this._updateTiles(); return; }
    if (!this._sourceReady || this._inRangeMax || this._destroyed) return;

    const frameIndex = Math.max(0, Math.min(
      Number.isFinite(timeIndex) ? timeIndex : 0,
      Math.max(0, this._timesteps.length - 1)
    ));

    if (this._pendingLoad) {
      this._queuedFrameIndex = frameIndex;
      return;
    }

    const url = this._buildFrameImageUrl(frameIndex);
    const token = { cancelled: false, frameIndex };
    this._pendingLoad = token;

    fetch(url, { credentials: 'omit' })
      .then((r) => {
        if (!r.ok) throw new Error(`raster-png ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        if (token.cancelled || this._destroyed) return;
        const blobUrl = URL.createObjectURL(blob);
        const source = this._map.getSource(SOURCE_ID);
        if (source && typeof source.updateImage === 'function') {
          this._revokeBlobUrl();
          this._currentBlobUrl = blobUrl;
          source.updateImage({ url: blobUrl, coordinates: coords });
          this._loadedFrameIndex = token.frameIndex;
        } else {
          URL.revokeObjectURL(blobUrl);
        }
        this._pendingLoad = null;
        this._loadQueuedFrame();
      })
      .catch(() => {
        if (!this._destroyed && this._pendingLoad === token) {
          this._pendingLoad = null;
          this._loadQueuedFrame();
        }
      });
  }

  _loadQueuedFrame() {
    if (this._destroyed || this._inRangeMax || !this._sourceReady || this._pendingLoad) return;
    const frameIndex = this._queuedFrameIndex;
    this._queuedFrameIndex = null;
    if (frameIndex == null || frameIndex === this._loadedFrameIndex) return;
    this._loadFrame(frameIndex);
  }

  // Fallback tile update (used when no bounds are configured)
  _updateTiles() {
    if (!this._sourceReady) return;
    try {
      this._map.getSource(SOURCE_ID)
        ?.setTiles([`${this._apiBase}/tiles/${this._timeIndex}/{z}/{x}/{y}.png`]);
    } catch (_) {}
  }

  // ── range-max mode ────────────────────────────────────────────────────────

  _applyRangeMax(rw) {
    const coords = this._imageCoords();
    if (!coords) { this._updateTiles(); return; }

    this._cancelPendingLoad();
    this._revokeBlobUrl(); // range-max uses a direct URL, not a blob
    const url = this._buildRangeMaxImageUrl(rw);
    const source = this._map.getSource(SOURCE_ID);
    if (source && typeof source.updateImage === 'function') {
      source.updateImage({ url, coordinates: coords });
    }
    this._inRangeMax = true;
  }

  // ── public interface ──────────────────────────────────────────────────────

  setTimeIndex(timeIndex) {
    const max = Math.max(0, this._timesteps.length - 1);
    this._timeIndex = Math.max(0, Math.min(timeIndex, max));
    if (this._inRangeMax) return;

    const coords = this._imageCoords();
    if (coords) {
      this._loadFrame(this._timeIndex);
    } else {
      this._updateTiles();
    }
  }

  setOpacity(opacity) {
    this._opacity = opacity;
    if (!this._sourceReady) return;
    try {
      if (this._map.getLayer(LAYER_ID))
        this._map.setPaintProperty(LAYER_ID, 'raster-opacity', opacity);
    } catch (_) {}
  }

  updateConfig({ rangeWindow, inundationCategories, minVisibleDepth } = {}) {
    if (rangeWindow          !== undefined) this._rangeWindow = rangeWindow;
    if (inundationCategories !== undefined) this._categories  = inundationCategories;
    if (minVisibleDepth      !== undefined && minVisibleDepth !== null) this._vmin = minVisibleDepth;
    if (!this._sourceReady) return;

    const isRangeMax = this._rangeWindow && this._rangeWindow.mode !== 'single';
    if (isRangeMax && this._bounds) {
      this._applyRangeMax(this._rangeWindow);
    } else {
      this._inRangeMax = false;
      this._cancelPendingLoad();
      const coords = this._imageCoords();
      if (coords) {
        this._loadFrame(this._timeIndex);
      } else {
        this._updateTiles();
      }
    }
  }

  async getTimeseriesAtPoint(lng, lat) {
    const url = `${this._apiBase}/depth-timeseries?lat=${lat}&lon=${lng}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`/depth-timeseries ${resp.status}`);
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

  _setLoading(value) {
    this.onLoadingChange?.(value);
  }
}
