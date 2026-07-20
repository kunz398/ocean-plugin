// SfincsColumnOverlay.js
// Renders SFINCS flood depth as 3D extruded columns via deck.gl ColumnLayer + MapboxOverlay.
// Fetches /grid?time_index=N from the FastAPI and maps each wet cell to a coloured column
// whose height is proportional to water depth. Works best alongside MapLibre terrain.

import { MapboxOverlay } from '@deck.gl/mapbox';
import { ColumnLayer } from '@deck.gl/layers';

// SFINCS grid resolution in WGS84 degrees (5 m at Rarotonga ≈ 0.000045°)
const CELL_DEG = 0.000045;
// Stride used in /grid fetch — effective cell spacing = CELL_DEG * GRID_STRIDE
const GRID_STRIDE = 2;
// Column radius fills each strided cell so adjacent columns touch with no gap
const COLUMN_RADIUS = (CELL_DEG * GRID_STRIDE * 111320) / 2; // metres

const OVERLAY_ID = 'sfincs-column-overlay';

function depthToColor(depth, categories) {
  if (Array.isArray(categories) && categories.length > 0) {
    const sorted = [...categories].sort((a, b) => b.thresholdM - a.thresholdM);
    for (const cat of sorted) {
      if (depth >= cat.thresholdM) {
        const hex = String(cat.color ?? '#1e90ff').replace('#', '');
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return [r, g, b, 200];
      }
    }
  }
  // Default gradient: blue → green → yellow → orange → red
  if (depth < 0.1)  return [0,   80,  255, 200];
  if (depth < 0.3)  return [0,   180, 200, 200];
  if (depth < 0.5)  return [80,  220, 80,  200];
  if (depth < 1.0)  return [230, 200, 0,   200];
  if (depth < 2.0)  return [255, 120, 0,   200];
  return               [220, 0,   0,   210];
}

export class SfincsColumnOverlay {
  constructor(map, config) {
    this._map          = map;
    this._apiBase      = (config.apiBase || '').replace(/\/$/, '');
    // Prefer explicit flood3dConfig.minDepth, fall back to colorRange.min
    this._minDepth     = config.flood3dConfig?.minDepth ?? config.colorRange?.min ?? 0.05;
    this._elevScale    = config.flood3dConfig?.elevationScale ?? 6;
    this._opacity      = config.opacity ?? 0.8;
    this._categories   = config.inundationCategories ?? null;
    this._beforeLayerId = config.beforeLayerId ?? null;
    this._timeIndex    = 0;
    this._destroyed    = false;
    this._pending      = null;
    this._points       = [];

    this.onLoadingChange = null;
    this.onErrorChange   = null;

    this._overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      getTooltip: ({ object }) => object && {
        html: `<strong>${object.depth.toFixed(2)} m</strong> flood depth`,
        style: {
          background: 'rgba(15, 25, 40, 0.82)',
          color: '#f1f5f9',
          fontSize: '13px',
          padding: '5px 10px',
          borderRadius: '5px',
          pointerEvents: 'none',
        },
      },
    });
    this._map.addControl(this._overlay);
  }

  // ── private ────────────────────────────────────────────────────────────────

  // map.queryTerrainElevation() returns the DEM elevation in meters (already
  // scaled by the terrain's exaggeration factor) for the currently-loaded DEM
  // tiles, or null when terrain is off / tiles aren't loaded at that point yet.
  _withGroundElevation(points) {
    return points.map((p) => ({
      ...p,
      groundElevation: this._map.queryTerrainElevation(p.position) ?? 0,
    }));
  }

  _buildLayer() {
    const cats      = this._categories;
    const elevScale = this._elevScale;
    const opacity   = this._opacity;
    return new ColumnLayer({
      id: OVERLAY_ID,
      data: this._points,
      diskResolution: 4,   // square columns
      radius: COLUMN_RADIUS,
      extruded: true,
      beforeId: this._beforeLayerId ?? undefined,
      // Base each column on the real ground elevation (from MapLibre terrain, when
      // active) so columns sit flush on the DEM surface instead of extruding from
      // sea level and disappearing into higher inland terrain.
      getPosition: d => [d.position[0], d.position[1], d.groundElevation ?? 0],
      getElevation: d => d.depth * elevScale,
      getFillColor: d => {
        const [r, g, b, a] = depthToColor(d.depth, cats);
        return [r, g, b, Math.round(a * opacity)];
      },
      getLineColor: [0, 0, 0, 0],
      pickable: true,
      updateTriggers: {
        getFillColor: [cats, opacity],
        getElevation: [elevScale],
      },
    });
  }

  async _fetch(timeIndex) {
    if (this._pending) {
      this._pending.cancelled = true;
    }
    const token = { cancelled: false };
    this._pending = token;
    this.onLoadingChange?.(true);

    const url = `${this._apiBase}/grid?time_index=${timeIndex}&stride=${GRID_STRIDE}&min_depth=${this._minDepth}`;
    try {
      const resp = await fetch(url, { credentials: 'omit' });
      if (token.cancelled || this._destroyed) return;
      if (!resp.ok) throw new Error(`/grid ${resp.status}`);
      const json = await resp.json();
      if (token.cancelled || this._destroyed) return;

      this._points = this._withGroundElevation(json.points ?? []);
      this._overlay.setProps({ layers: [this._buildLayer()] });
    } catch (err) {
      if (!this._destroyed && !token.cancelled) {
        this.onErrorChange?.(err.message);
      }
    } finally {
      if (!this._destroyed && !token.cancelled) {
        this._pending = null;
        this.onLoadingChange?.(false);
      }
    }
  }

  // ── public ─────────────────────────────────────────────────────────────────

  setTimeIndex(timeIndex) {
    this._timeIndex = timeIndex;
    this._fetch(timeIndex);
  }

  setOpacity(opacity) {
    this._opacity = opacity;
    this._overlay.setProps({ layers: [this._buildLayer()] });
  }

  setElevationScale(scale) {
    this._elevScale = scale;
    this._overlay.setProps({ layers: [this._buildLayer()] });
  }

  // Re-query ground elevation for the current points without re-fetching /grid.
  // Call when MapLibre terrain is toggled on/off so columns re-anchor to the
  // (now available, or now absent) DEM surface immediately.
  refreshTerrainAlignment() {
    if (!this._points.length) return;
    this._points = this._withGroundElevation(this._points);
    this._overlay.setProps({ layers: [this._buildLayer()] });
  }

  updateConfig({ inundationCategories } = {}) {
    if (inundationCategories !== undefined) {
      this._categories = inundationCategories;
      this._overlay.setProps({ layers: [this._buildLayer()] });
    }
  }

  destroy() {
    this._destroyed = true;
    if (this._pending) this._pending.cancelled = true;
    try { this._map.removeControl(this._overlay); } catch (_) {}
  }
}
