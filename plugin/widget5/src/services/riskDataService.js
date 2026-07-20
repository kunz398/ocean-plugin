import {
  RISK_DATA_CONFIG,
  getRiskDetailsUrl,
  getRiskPointsUrl,
  getRiskThresholdsUrl,
  getRiskThresholdUrl
} from '../config/riskDataConfig';

let riskPointsPromise = null;

const normalizeIsland = (value) => {
  if (typeof value === 'string') {
    return value.replace(/\0/g, '').trim();
  }

  if (Array.isArray(value)) {
    return value.join('').replace(/\0/g, '').trim();
  }

  if (value && typeof value === 'object' && typeof value.length === 'number') {
    try {
      return Array.from(value).join('').replace(/\0/g, '').trim();
    } catch (error) {
      return '';
    }
  }

  return '';
};

const coerceNumber = (value, fallback = null) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const parseBbox = (bbox) => {
  if (!bbox || typeof bbox !== 'string') {
    return null;
  }

  const values = bbox.split(',').map((part) => Number(part));
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const [west, south, east, north] = values;
  return { west, south, east, north };
};

const isPointInBbox = (point, bbox) => {
  if (!bbox) {
    return true;
  }

  return (
    point.lon >= bbox.west &&
    point.lon <= bbox.east &&
    point.lat >= bbox.south &&
    point.lat <= bbox.north
  );
};

const normalizePoint = (point, index) => ({
  id: Number.isFinite(Number(point?.id)) ? Number(point.id) : index,
  lon: coerceNumber(point?.lon, NaN),
  lat: coerceNumber(point?.lat, NaN),
  riskLevel: coerceNumber(point?.riskLevel, 0),
  island: normalizeIsland(point?.island),
  maxTWL: coerceNumber(point?.maxTWL, null),
  thresholds: Array.isArray(point?.thresholds)
    ? point.thresholds.map((value) => coerceNumber(value, null)).filter((value) => value !== null)
    : []
});

const selectRepresentativePoints = (points) => {
  const representatives = new Map();

  points.forEach((point) => {
    const islandKey = point.island || `point-${point.id}`;
    const current = representatives.get(islandKey);

    if (!current) {
      representatives.set(islandKey, point);
      return;
    }

    const currentRisk = Number.isFinite(current.riskLevel) ? current.riskLevel : -Infinity;
    const candidateRisk = Number.isFinite(point.riskLevel) ? point.riskLevel : -Infinity;
    const currentTwl = Number.isFinite(current.maxTWL) ? current.maxTWL : -Infinity;
    const candidateTwl = Number.isFinite(point.maxTWL) ? point.maxTWL : -Infinity;

    if (candidateRisk > currentRisk || (candidateRisk === currentRisk && candidateTwl > currentTwl)) {
      representatives.set(islandKey, point);
    }
  });

  return Array.from(representatives.values());
};

const fetchRiskJson = async (url) => {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      console.error('Risk data fetch failed:', response.status, response.statusText);
      throw new Error(`Failed to fetch risk data from THREDDS: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching risk data:', error);
    throw error;
  }
};

const loadRiskPointsCatalog = async () => {
  const payload = await fetchRiskJson(getRiskPointsUrl());
  const rawPoints = Array.isArray(payload?.points) ? payload.points : [];

  return {
    metadata: payload?.metadata || {},
    points: rawPoints.map((point, index) => normalizePoint(point, index))
  };
};

export const fetchRiskPoints = async ({ zoom = 8, bbox = null } = {}) => {
  if (!riskPointsPromise) {
    riskPointsPromise = loadRiskPointsCatalog().catch((error) => {
      console.error('Failed to load risk points catalog:', error);
      riskPointsPromise = null;
      throw error;
    });
  }

  const catalog = await riskPointsPromise;
  const bboxBounds = parseBbox(bbox);
  const filteredPoints = catalog.points.filter((point) => {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
      return false;
    }

    return isPointInBbox(point, bboxBounds);
  });

  const useRepresentatives = zoom <= RISK_DATA_CONFIG.representativeZoomThreshold;
  const points = (useRepresentatives ? selectRepresentativePoints(filteredPoints) : filteredPoints)
    .map((point) => ({
      ...point,
      type: useRepresentatives ? 'representative' : 'detailed'
    }));

  return {
    metadata: catalog.metadata,
    strategy: useRepresentatives ? 'representative' : 'detailed',
    points
  };
};

const RISK_THRESHOLD_STORAGE_PREFIX = 'risk-thresholds-';

// Per-point Minor/Moderate threshold overrides, keyed by String(pointId) (JSON
// object keys from the server are always strings). Populated by
// ensureRiskThresholdOverridesLoaded() and kept in sync by saveRiskThresholdOverride().
let riskThresholdOverridesCache = {};
let riskThresholdOverridesPromise = null;

const loadRiskThresholdOverridesFromServer = async () => {
  const payload = await fetchRiskJson(getRiskThresholdsUrl());
  const entries = payload && typeof payload === 'object' ? payload : {};
  const next = {};
  for (const [id, value] of Object.entries(entries)) {
    const minor = coerceNumber(value?.minor, null);
    const moderate = coerceNumber(value?.moderate, null);
    if (minor != null && moderate != null) next[id] = { minor, moderate };
  }
  riskThresholdOverridesCache = next;
  return next;
};

// Kicks off (once) the bulk fetch of server-saved threshold overrides. Call this
// early (e.g. on map mount) and refresh markers when it resolves — getRiskThresholdOverride
// stays synchronous throughout, reading whatever's in the cache at call time.
export const ensureRiskThresholdOverridesLoaded = () => {
  if (!riskThresholdOverridesPromise) {
    riskThresholdOverridesPromise = loadRiskThresholdOverridesFromServer().catch((error) => {
      console.error('Failed to load risk threshold overrides from server:', error);
      riskThresholdOverridesPromise = null; // allow a retry on the next call
      return riskThresholdOverridesCache;
    });
  }
  return riskThresholdOverridesPromise;
};

// Server-saved override takes precedence (shared across users/devices); falls back
// to this browser's localStorage draft when the server has nothing for this point
// yet (e.g. offline, or the save endpoint failed and only the local copy landed).
export const getRiskThresholdOverride = (pointId) => {
  if (pointId == null) return null;
  const fromServer = riskThresholdOverridesCache[String(pointId)];
  if (fromServer) return fromServer;
  try {
    const saved = JSON.parse(localStorage.getItem(`${RISK_THRESHOLD_STORAGE_PREFIX}${pointId}`));
    const minor = coerceNumber(saved?.minor, null);
    const moderate = coerceNumber(saved?.moderate, null);
    if (minor != null && moderate != null) return { minor, moderate };
  } catch {
    // corrupted entry — ignore, fall back to server-computed riskLevel
  }
  return null;
};

// Persists a point's Minor/Moderate thresholds to zarr-api. Throws on failure —
// callers should keep their existing localStorage write as an offline fallback.
export const saveRiskThresholdOverride = async (pointId, minor, moderate) => {
  const response = await fetch(getRiskThresholdUrl(pointId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minor, moderate })
  });
  if (!response.ok) {
    throw new Error(`Failed to save risk thresholds: ${response.status} ${response.statusText}`);
  }
  riskThresholdOverridesCache = {
    ...riskThresholdOverridesCache,
    [String(pointId)]: { minor, moderate }
  };
};

export const getEffectiveRiskLevel = (point) => {
  const fallback = coerceNumber(point?.riskLevel, 0);
  const override = getRiskThresholdOverride(point?.id);
  const maxTWL = coerceNumber(point?.maxTWL, null);
  if (!override || maxTWL == null || override.minor >= override.moderate) {
    return fallback;
  }
  if (maxTWL >= override.moderate) return 2;
  if (maxTWL >= override.minor) return 1;
  return 0;
};

export const fetchRiskDetails = async (pointId) => {
  const payload = await fetchRiskJson(getRiskDetailsUrl(pointId));

  return {
    ...payload,
    pointId: Number.isFinite(Number(payload?.pointId)) ? Number(payload.pointId) : pointId,
    riskLevel: coerceNumber(payload?.riskLevel, 0),
    thresholds: Array.isArray(payload?.thresholds)
      ? payload.thresholds.map((value) => coerceNumber(value, null)).filter((value) => value !== null)
      : [],
    time_10min: Array.isArray(payload?.time_10min) ? payload.time_10min : [],
    twl_10min: Array.isArray(payload?.twl_10min) ? payload.twl_10min.map((value) => coerceNumber(value, null)) : [],
    sla_10min: Array.isArray(payload?.sla_10min) ? payload.sla_10min.map((value) => coerceNumber(value, null)) : [],
    tide_10min: Array.isArray(payload?.tide_10min) ? payload.tide_10min.map((value) => coerceNumber(value, null)) : []
  };
};
