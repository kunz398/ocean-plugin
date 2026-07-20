// NiueSuitabilityOverlay.js
// MapLibre GL raster-tile overlay for the Niue vessel suitability routes.
// Colours are supplied as a discrete 3-class hazard palette (0=suitable/blue,
// 1=caution/orange, 2=warning/red), so this overlay only needs to swap tile
// URLs when the vessel class or time index changes — no client-side color
// mapping.
//
// Implements the same public interface as the other overlay classes so
// useZarrMap.js can treat it as a drop-in.

const SOURCE_ID = 'niue-suitability-raster-source';
const LAYER_ID  = 'niue-suitability-raster-layer';

export const VESSEL_CLASSES = [
  { value: 'traditional_craft', label: 'Traditional Craft' },
  { value: 'very_small_motorised_craft', label: 'Very Small Motorised Craft' },
  { value: 'small_craft', label: 'Small Craft' },
  { value: 'larger_vessels', label: 'Larger Vessels' },
];

export const SUITABILITY_HAZARD_COLORS = {
  // Green (not blue) reads as "safe" at a glance, and matches the PDF
  // exporter's own HAZARD.suitable ('#2A9D8F' in SuitabilityPDFExporter.js)
  // and the operational-map backend it's tied to — this used to be blue
  // ('#1E88E5') here while the PDF/backend already used teal-green, so map
  // tiles and live badges disagreed with what every exported PDF showed.
  0: '#2A9D8F', // map tile colour: suitable
  1: '#FB8C00', // map tile colour: caution
  2: '#E53935', // map tile colour: warning
};

export const SUITABILITY_HAZARD_LABELS = {
  0: 'Suitable',
  1: 'Caution',
  2: 'Avoid',
};

export const SUITABILITY_MAP_HAZARD_LABELS = {
  0: 'Suitable',
  1: 'Caution',
  2: 'Avoid',
};

// Single client-side source of truth for per-vessel wind/wave operating
// thresholds, plus the qualitative advisory flags (daylight/offshore/exposed
// landing) used to generate explainability text. This used to be duplicated
// as VESSEL_THRESHOLDS inside SuitabilityPDFExporter.js — kept only there,
// it would have drifted from anything the scenario-comparison feature
// computed client-side. SuitabilityPDFExporter.js now imports this instead
// of defining its own copy. The backend's hazard_class remains authoritative
// everywhere these are used for explanation, never to override it.
//
// Numeric cutoffs are unchanged from the original PDF methodology table;
// daylightOnly/offshoreCautionNm/exposedLandingCaution are new and are
// explicitly unverified — see VESSEL_OPERATING_ENVELOPE_STATUS.
export const VESSEL_OPERATING_ENVELOPE = {
  traditional_craft: {
    label: 'Traditional Craft',
    examples: 'Canoes, vaka, outrigger canoes',
    cautionWindKt: 10, maxWindKt: 12,
    cautionWaveHeightM: 0.5, maxWaveHeightM: 1.0,
    waveText: '0.5-1.0 m or steep chop',
    advisoryLevel: 'Small Boat Caution',
    daylightOnly: true,
    offshoreCautionNm: 2,
    exposedLandingCaution: true,
  },
  very_small_motorised_craft: {
    label: 'Very Small Motorised Craft',
    examples: 'Dinghies, open skiffs under 6 m',
    cautionWindKt: 12, maxWindKt: 15,
    cautionWaveHeightM: 1.0, maxWaveHeightM: 1.5,
    waveText: '1.0-1.5 m',
    advisoryLevel: 'Small Boat Advisory',
    daylightOnly: true,
    offshoreCautionNm: 5,
    exposedLandingCaution: true,
  },
  small_craft: {
    label: 'Small Craft',
    examples: 'Fibreglass boats 6-10 m, inter-island skiffs',
    cautionWindKt: 15, maxWindKt: 20,
    cautionWaveHeightM: 1.5, maxWaveHeightM: 2.0,
    waveText: '1.5-2.0 m',
    advisoryLevel: 'Small Craft Advisory',
    daylightOnly: false,
    offshoreCautionNm: 10,
    exposedLandingCaution: false,
  },
  larger_vessels: {
    label: 'Larger Vessels',
    examples: 'Decked vessels over 10-12 m',
    cautionWindKt: 20, maxWindKt: 25,
    cautionWaveHeightM: 2.5, maxWaveHeightM: 3.0,
    waveText: '2.5-3.0 m',
    advisoryLevel: 'Gale Watch / Strong Wind Warning',
    daylightOnly: false,
    offshoreCautionNm: null,
    exposedLandingCaution: false,
  },
};

export const VESSEL_OPERATING_ENVELOPE_STATUS = '';

// Real 0/1/2 hazard classification for a vessel against wind/wave values —
// the single source of truth deriveSuitabilityDriver and suggestBetterVessel
// (scenarioService.js) both build on, so a threshold change here can't drift
// between "why did this hazard happen" and "which vessel would clear it."
// This is a client-side estimate against VESSEL_OPERATING_ENVELOPE, never an
// authoritative reclassification — the backend's own hazard_class always wins
// wherever both are available.
export function classifySuitability(vesselCode, windKt, waveM) {
  const rule = VESSEL_OPERATING_ENVELOPE[vesselCode];
  if (!rule) return null;
  const windHazard = windKt >= rule.maxWindKt ? 2 : windKt >= rule.cautionWindKt ? 1 : 0;
  const waveHazard = waveM  >= rule.maxWaveHeightM ? 2 : waveM  >= rule.cautionWaveHeightM ? 1 : 0;
  return Math.max(windHazard, waveHazard);
}

// Explains which parameter(s) drove a hazard reading from wind/wave values
// against a vessel's envelope — used for explainability text when the
// backend doesn't return a driver field itself. Prefer a backend-provided
// driver over this wherever the API supplies one; this is a client-side
// estimate, not an authoritative reclassification.
//
// Every vessel's caution thresholds are > 0, so classifying with the other
// axis zeroed out reproduces the original per-axis windHazard/waveHazard
// exactly — this is a pure refactor onto classifySuitability, not a
// behavior change.
export function deriveSuitabilityDriver(vesselCode, maxWindKt, maxWaveM) {
  const windHazard = classifySuitability(vesselCode, maxWindKt, 0);
  if (windHazard === null) return null;
  const waveHazard = classifySuitability(vesselCode, 0, maxWaveM);
  if (windHazard === 0 && waveHazard === 0) return 'none';
  if (windHazard > waveHazard) return 'wind';
  if (waveHazard > windHazard) return 'waves';
  return 'wind_and_waves';
}

// Standalone (not tied to a live overlay instance) — used by the landing-area
// panel to fetch suitability at an arbitrary point across ALL timesteps, via
// GET /niue/suitability/point/timeseries.
const AREA_TIMESERIES_UNAVAILABLE_BASES = new Set();

function apiBaseKey(apiBase) {
  return String(apiBase || '').replace(/\/$/, '');
}

export async function fetchSuitabilityTimeseries(apiBase, lng, lat, vessel) {
  const params = new URLSearchParams({
    lon: String(lng),
    lat: String(lat),
    vessel,
  });
  const url = `${apiBase.replace(/\/$/, '')}/niue/suitability/point/timeseries?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    if (resp.status === 404) {
      throw new Error(
        'Landing-area suitability is not available in this deployment yet.'
      );
    }
    throw new Error(`/niue/suitability/point/timeseries ${resp.status}`);
  }
  return resp.json();
}

export function isSuitabilityAreaTimeseriesUnavailable(apiBase) {
  return AREA_TIMESERIES_UNAVAILABLE_BASES.has(apiBaseKey(apiBase));
}

function radiusKmToMeters(radiusKm) {
  const km = Number(radiusKm);
  return Number.isFinite(km) && km > 0 ? Math.round(km * 1000) : 500;
}

export function normalizeSuitabilityAreaTimeseries(payload, radiusKm = 0.5) {
  const radiusM = Number(payload?.radius_m);
  const faceCount = Number(payload?.face_count);
  const hasFaceCount = Number.isFinite(faceCount);
  const usedNearestFaceFallback = Boolean(payload?.used_nearest_face_fallback);
  const statisticsBasis = payload?.statistics_basis
    ?? (usedNearestFaceFallback ? 'nearest_face_area_fallback' : 'area_500m');

  const steps = Array.isArray(payload?.steps) ? payload.steps.map((step) => ({
    ...step,
    sample_count: step.sample_count ?? step.total_points ?? step.area_sample_count ?? (hasFaceCount ? faceCount : undefined),
    face_count: step.face_count ?? (hasFaceCount ? faceCount : undefined),
    used_nearest_face_fallback: step.used_nearest_face_fallback ?? usedNearestFaceFallback,
  })) : [];

  return {
    ...payload,
    radius_km: Number.isFinite(radiusM) ? radiusM / 1000 : radiusKm,
    face_count: hasFaceCount ? faceCount : payload?.face_count,
    used_nearest_face_fallback: usedNearestFaceFallback,
    statistics_basis: statisticsBasis,
    steps,
  };
}

export async function fetchSuitabilityAreaTimeseries(apiBase, lng, lat, vessel, radiusKm = 0.5) {
  const params = new URLSearchParams({
    lon: String(lng),
    lat: String(lat),
    vessel,
    radius_m: String(radiusKmToMeters(radiusKm)),
  });
  const url = `${apiBase.replace(/\/$/, '')}/niue/suitability/area/timeseries?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    if (resp.status === 404) AREA_TIMESERIES_UNAVAILABLE_BASES.add(apiBaseKey(apiBase));
    const err = new Error(`/niue/suitability/area/timeseries ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  const payload = await resp.json();
  return normalizeSuitabilityAreaTimeseries(payload, radiusKm);
}

export async function fetchSeaLevelTimeseries(apiBase, startTime, endTime) {
  if (!apiBase) throw new Error('Sea-level API base is not configured.');
  const params = new URLSearchParams();
  if (startTime) params.set('start_time', startTime);
  if (endTime) params.set('end_time', endTime);
  const query = params.toString();
  const url = `${apiBase.replace(/\/$/, '')}/niue/sea-level/timeseries${query ? `?${query}` : ''}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Sea-level timeseries is not available (${resp.status}).`);
  }
  return resp.json();
}

function seaLevelTimeMs(step) {
  const value = step?.valid_time_utc ?? step?.valid_time ?? step?.time ?? step?.time_utc;
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : NaN;
}

// Reads the astronomical tide specifically — tide_m is the documented field
// on /niue/sea-level/timeseries steps (see the sibling total_sea_level_m,
// inverse_barometer_m, sla_m fields on the same payload). This used to check
// a list of guessed field names (sea_level_m, water_level_m, eta_m, ...)
// around tide_m, none of which exist on the real API response and were pure
// dead weight.
//
// null/undefined must short-circuit before Number() — Number(null) is 0,
// which is finite, so `Number.isFinite(Number(step?.tide_m))` alone would
// turn an explicit "this timestep has no tide value" into a fabricated 0 m
// reading (the same masking bug this function exists to avoid).
export function seaLevelHeightM(step) {
  const raw = step?.tide_m;
  if (raw === null || raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// Real cadence observed from the API is hourly — 3h gives comfortable margin
// above that before treating a match as "too far to trust," while still
// rejecting a target genuinely outside the fetched window (e.g. a route ETA
// that runs past the forecast horizon) instead of silently inheriting
// whichever edge timestep happens to be closest.
const SEA_LEVEL_MATCH_TOLERANCE_MS = 3 * 60 * 60 * 1000;

export function nearestSeaLevelStep(timesteps, targetDate, maxDiffMs = SEA_LEVEL_MATCH_TOLERANCE_MS) {
  if (!Array.isArray(timesteps) || !timesteps.length || !targetDate) return null;
  const targetMs = new Date(targetDate).getTime();
  if (!Number.isFinite(targetMs)) return null;
  const best = timesteps.reduce((current, step) => {
    const ms = seaLevelTimeMs(step);
    if (!Number.isFinite(ms)) return current;
    if (!current) return step;
    const currentMs = seaLevelTimeMs(current);
    return Math.abs(ms - targetMs) < Math.abs(currentMs - targetMs) ? step : current;
  }, null);
  if (!best) return null;
  const bestMs = seaLevelTimeMs(best);
  return Math.abs(bestMs - targetMs) <= maxDiffMs ? best : null;
}

export function nearestSeaLevelStepWithTrend(timesteps, targetDate) {
  const step = nearestSeaLevelStep(timesteps, targetDate);
  if (!step) return null;
  const sorted = Array.isArray(timesteps)
    ? timesteps
        .filter((item) => Number.isFinite(seaLevelTimeMs(item)))
        .slice()
        .sort((a, b) => seaLevelTimeMs(a) - seaLevelTimeMs(b))
    : [];
  const index = sorted.indexOf(step);
  const neighbor = index > 0 ? sorted[index - 1] : sorted[index + 1];
  const currentHeight = seaLevelHeightM(step);
  const neighborHeight = seaLevelHeightM(neighbor);
  let trend = 'steady';
  if (Number.isFinite(currentHeight) && Number.isFinite(neighborHeight)) {
    const delta = currentHeight - neighborHeight;
    if (delta > 0.01) trend = index > 0 ? 'rising' : 'falling';
    else if (delta < -0.01) trend = index > 0 ? 'falling' : 'rising';
  }
  // step already carries the real tide_m field from the API — no need for a
  // synthetic sea_level_m alias (that name is also misleading: this is tide,
  // not total sea level, which is a separate field on the same payload).
  return { ...step, trend };
}

export class NiueSuitabilityOverlay {
  constructor(map, config) {
    this._map      = map;
    this._apiBase  = (config.apiBase || '').replace(/\/$/, '');
    this._vessel   = config.vessel || 'traditional_craft';
    this._opacity  = config.opacity ?? 0.75;
    this._timeIndex = 0;
    this._timesteps = [];
    this._destroyed   = false;
    this._sourceReady = false;

    // callbacks — assigned by useZarrMap after construction
    this.onTimeChange    = null;
    this.onLoadingChange = null;
    this.onErrorChange   = null;
    this.onStatsChange   = null;

    this._initialize();
  }

  async _initialize() {
    this._setLoading(true);
    try {
      const resp = await fetch(`${this._apiBase}/niue/suitability/timesteps`);
      if (!resp.ok) throw new Error(`/niue/suitability/timesteps returned ${resp.status}`);
      const payload = await resp.json();
      const raw = Array.isArray(payload?.timesteps) ? payload.timesteps : [];
      this._timesteps = raw
        .map((v) => new Date(v))
        .filter((d) => !Number.isNaN(d.getTime()));

      if (this._destroyed) return;

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

  _buildTileUrl(timeIndex) {
    return `${this._apiBase}/niue/suitability/tiles/${this._vessel}/${timeIndex}/{z}/{x}/{y}.png`;
  }

  _updateTiles() {
    if (!this._sourceReady) return;
    try {
      this._map.getSource(SOURCE_ID)?.setTiles([this._buildTileUrl(this._timeIndex)]);
    } catch (_) { /* source removed mid-update */ }
  }

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

  setVessel(vessel) {
    if (!vessel || vessel === this._vessel) return;
    this._vessel = vessel;
    this._updateTiles();
  }

  // Single-point hazard reading at the current time index. Returns a shape
  // distinct from the numeric-timeseries overlays — useZarrMap's onMapClick
  // handles 'mode: suitability' data separately (see isSuitabilityLayer).
  async getSuitabilityAtPoint(lng, lat) {
    const params = new URLSearchParams({
      lon: String(lng),
      lat: String(lat),
      time_index: String(this._timeIndex),
      vessel: this._vessel,
    });
    const url = `${this._apiBase}/niue/suitability/point?${params}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`/niue/suitability/point ${resp.status}`);
    return resp.json();
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
