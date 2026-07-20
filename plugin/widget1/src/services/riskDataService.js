import {
  RISK_DATA_CONFIG,
  getRiskDetailsUrl,
  getRiskPointsUrl
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
