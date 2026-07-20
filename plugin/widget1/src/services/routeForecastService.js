const MAX_ROUTE_POINTS = 500;
const DEFAULT_SAMPLE_SPACING_NM = 1;

export const ROUTE_HAZARD_LABELS = {
  0: 'Suitable',
  1: 'Caution',
  2: 'Avoid',
};

// `Number(null) === 0` and `Number.isFinite(0) === true`, so the old
// `Number.isFinite(Number(x)) ? Number(x) : fallback` idiom silently turned
// the backend's explicit `null` (an unavailable/out-of-domain sample or
// segment) into a real `0` ("Suitable") everywhere this ran — routes that
// left the model domain rendered as a green "safe" line on the map instead
// of the grey "unavailable" the mapLibre layer already has a fallback for.
// null/undefined must short-circuit before the Number() coercion.
function toNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// datetime-local <input> values (e.g. the live routeDepartureTime state) have
// no timezone designator, but this app always intends them as UTC wall-clock
// — confirmed by test: new Date('2026-07-14T06:00') in a UTC+12 runtime
// parses as 2026-07-13T18:00:00Z, a 12h error, not the 06:00 UTC the user
// actually selected. scenarioService.js's toComparableMs already treats
// these strings as UTC (appending Z before parsing); this was the one
// caller that didn't, so the exact same route/departure input could resolve
// to two different real-world moments depending on which function read it.
export function parseAsUtcWallClock(value) {
  if (!value) return null;
  const hasDesignator = /Z$|[+-]\d{2}:?\d{2}$/.test(value);
  return new Date(hasDesignator ? value : `${value}Z`);
}

// A plain points.slice(0, MAX_ROUTE_POINTS) can silently drop the
// destination on a long imported route (GPX tracks with dense trackpoints
// routinely exceed 500) — the resulting forecast would model a route that
// never actually reaches where the vessel is going, with nothing telling
// the reader a point got cut. Always keep the final point so truncation
// shortens the middle of the route, not its destination.
function truncateRoutePoints(points) {
  if (points.length <= MAX_ROUTE_POINTS) return points;
  console.warn(`Route has ${points.length} points; truncated to ${MAX_ROUTE_POINTS}, keeping the destination.`);
  return [...points.slice(0, MAX_ROUTE_POINTS - 1), points[points.length - 1]];
}

function normalizePoint(point) {
  if (Array.isArray(point)) {
    const lon = toNumber(point[0]);
    const lat = toNumber(point[1]);
    return lon === null || lat === null ? null : { lon, lat };
  }
  const lon = toNumber(point?.lon ?? point?.lng ?? point?.longitude);
  const lat = toNumber(point?.lat ?? point?.latitude);
  return lon === null || lat === null ? null : { lon, lat };
}

export function validateRouteForecastInput({ routePoints, departureTime, speedKt }) {
  const points = Array.isArray(routePoints)
    ? routePoints.map(normalizePoint).filter(Boolean)
    : [];

  if (points.length < 2) {
    throw new Error('Add at least two route points before running a route forecast.');
  }

  const departure = parseAsUtcWallClock(departureTime);
  if (!departure || !Number.isFinite(departure.getTime())) {
    throw new Error('Choose a valid departure time before running a route forecast.');
  }

  const speed = Number(speedKt);
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error('Enter a vessel speed greater than 0 kt.');
  }

  return {
    routePoints: truncateRoutePoints(points),
    departureTime: departure.toISOString(),
    speedKt: speed,
  };
}

export function buildRouteForecastPayload({
  routePoints,
  vessel,
  departureTime,
  speedKt,
  sampleSpacingNm = DEFAULT_SAMPLE_SPACING_NM,
}) {
  const validated = validateRouteForecastInput({ routePoints, departureTime, speedKt });
  return {
    vessel,
    departure_time: validated.departureTime,
    speed_kt: validated.speedKt,
    sample_spacing_nm: sampleSpacingNm,
    route: validated.routePoints.map((p) => [p.lon, p.lat]),
  };
}

export function normalizeRouteForecastResponse(payload, fallback = {}) {
  const samples = Array.isArray(payload?.samples)
    ? payload.samples.map((sample, index) => {
        const lon = toNumber(sample?.lon);
        const lat = toNumber(sample?.lat);
        const hazard = toNumber(sample?.hazard_class);
        return {
          ...sample,
          sample_index: toNumber(sample?.sample_index) ?? index,
          lon,
          lat,
          distance_nm: toNumber(sample?.distance_nm),
          hazard_class: hazard,
          // Compute the label from hazard_class via ROUTE_HAZARD_LABELS
          // rather than trusting the backend's own hazard_label string —
          // confirmed live against the real API that the backend's copy
          // ("Warning") doesn't match the wording used everywhere else in
          // this app (map legend, PDF exporter: "Avoid"), so preferring it
          // would silently reintroduce the exact inconsistency this was
          // meant to fix. hazard_label is null exactly when the sample is
          // unavailable (out of the model domain).
          hazard_label: hazard === null ? 'Unavailable' : (ROUTE_HAZARD_LABELS[hazard] ?? sample?.hazard_label ?? 'Unknown'),
          wave_height_m: toNumber(sample?.wave_height_m),
          wind_speed_kt: toNumber(sample?.wind_speed_kt),
        };
      }).filter((sample) => sample.lon !== null && sample.lat !== null)
    : [];

  const segments = Array.isArray(payload?.segments)
    ? payload.segments.map((segment) => {
        const hazardClass = toNumber(segment?.hazard_class);
        return {
          ...segment,
          from_sample_index: Number(segment?.from_sample_index),
          to_sample_index: Number(segment?.to_sample_index),
          hazard_class: hazardClass,
          available: segment?.available ?? (hazardClass !== null),
        };
      }).filter((segment) => (
        Number.isInteger(segment.from_sample_index)
        && Number.isInteger(segment.to_sample_index)
        && samples[segment.from_sample_index]
        && samples[segment.to_sample_index]
      ))
    : [];

  // Seeded with null (not 0) so "no available samples at all" stays
  // null/unknown instead of fabricating a "Suitable" reading — mirrors the
  // backend's own worst_hazard: Optional[int] = None that only ever becomes
  // a real int once at least one in-domain sample is scored.
  const fallbackWorst = samples.reduce((max, sample) => {
    if (!Number.isFinite(sample.hazard_class)) return max;
    return max === null ? sample.hazard_class : Math.max(max, sample.hazard_class);
  }, null);

  const worstHazardClass = toNumber(payload?.summary?.worst_hazard_class) ?? fallbackWorst;

  return {
    route_id: payload?.route_id ?? null,
    vessel: payload?.vessel ?? fallback.vessel ?? '',
    departure_time: payload?.departure_time ?? fallback.departureTime ?? null,
    speed_kt: toNumber(payload?.speed_kt) ?? fallback.speedKt ?? null,
    summary: {
      distance_nm: toNumber(payload?.summary?.distance_nm),
      duration_hours: toNumber(payload?.summary?.duration_hours),
      worst_hazard_class: worstHazardClass,
      // Same reasoning as hazard_label above — compute from the numeric
      // class instead of trusting the backend's recommendation string.
      recommendation: worstHazardClass === null ? 'Unavailable' : (ROUTE_HAZARD_LABELS[worstHazardClass] ?? payload?.summary?.recommendation ?? 'Unknown'),
      suitable_percent: toNumber(payload?.summary?.suitable_percent),
      caution_percent: toNumber(payload?.summary?.caution_percent),
      warning_percent: toNumber(payload?.summary?.warning_percent),
    },
    samples,
    segments,
  };
}

function apiErrorMessage(status, payload) {
  if (status === 404) return 'Route forecast is not available in this deployment yet.';
  if (status === 400) return payload?.detail || payload?.message || 'Route forecast request was invalid.';
  return 'Route forecast failed. Please try again.';
}

export async function fetchRouteForecast(apiBase, request) {
  const payload = buildRouteForecastPayload(request);
  const url = `${String(apiBase || '').replace(/\/$/, '')}/niue/suitability/route`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(apiErrorMessage(response.status, body));
  }

  return normalizeRouteForecastResponse(body, {
    vessel: payload.vessel,
    departureTime: payload.departure_time,
    speedKt: payload.speed_kt,
  });
}

function readGeoJsonCoordinates(geojson) {
  if (!geojson) return [];
  if (geojson.type === 'LineString') return geojson.coordinates;
  if (geojson.type === 'MultiLineString') return geojson.coordinates?.[0] ?? [];
  if (geojson.type === 'Feature') return readGeoJsonCoordinates(geojson.geometry);
  if (geojson.type === 'FeatureCollection') {
    const feature = geojson.features?.find((f) => {
      const type = f?.geometry?.type;
      return type === 'LineString' || type === 'MultiLineString';
    });
    return readGeoJsonCoordinates(feature);
  }
  return [];
}

function parseGeoJsonRoute(text) {
  const parsed = JSON.parse(text);
  return readGeoJsonCoordinates(parsed).map(normalizePoint).filter(Boolean);
}

function parseGpxRoute(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('Imported GPX could not be parsed.');

  const nodes = doc.querySelectorAll('trkseg trkpt');
  const fallbackNodes = nodes.length ? nodes : doc.querySelectorAll('rtept');
  return Array.from(fallbackNodes).map((node) => normalizePoint({
    lon: node.getAttribute('lon'),
    lat: node.getAttribute('lat'),
  })).filter(Boolean);
}

export function parseRouteFileText(text, filename = '') {
  const trimmed = String(text || '').trim();
  const lowerName = filename.toLowerCase();
  const points = lowerName.endsWith('.gpx') || trimmed.startsWith('<')
    ? parseGpxRoute(trimmed)
    : parseGeoJsonRoute(trimmed);

  if (points.length < 2) {
    throw new Error('Imported route must contain at least two valid coordinates.');
  }

  return truncateRoutePoints(points);
}

export async function parseRouteFile(file) {
  const text = await file.text();
  return parseRouteFileText(text, file.name);
}

export function routeSamplesToSegmentFeatures(result) {
  const samples = result?.samples ?? [];
  // Mirrors the backend's own segment computation (both_available = a.available
  // && b.available; hazard_class = max(...) only if both_available, else None)
  // — used only when the backend didn't send segments at all. A segment
  // touching an unavailable endpoint must stay unavailable/null, not fall
  // back to 0 ("Suitable"), the same masking bug fixed in normalizeRouteForecastResponse.
  const segments = result?.segments?.length
    ? result.segments
    : samples.slice(0, -1).map((_, index) => {
        const a = samples[index];
        const b = samples[index + 1];
        const bothAvailable = a?.available !== false && b?.available !== false
          && a?.hazard_class !== null && a?.hazard_class !== undefined
          && b?.hazard_class !== null && b?.hazard_class !== undefined;
        return {
          from_sample_index: index,
          to_sample_index: index + 1,
          hazard_class: bothAvailable ? Math.max(a.hazard_class, b.hazard_class) : null,
          available: bothAvailable,
        };
      });

  return segments.map((segment) => {
    const from = samples[segment.from_sample_index];
    const to = samples[segment.to_sample_index];
    if (!from || !to) return null;
    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[from.lon, from.lat], [to.lon, to.lat]],
      },
      properties: {
        // Left as null (not defaulted to 0) when unavailable — the mapLibre
        // route-segment layer's `match` expression already falls back to
        // grey for any value outside {0,1,2}, including null.
        hazardClass: segment.hazard_class,
        available: segment.available !== false,
        hazardLabel: segment.hazard_class === null || segment.hazard_class === undefined
          ? 'Unavailable'
          : (ROUTE_HAZARD_LABELS[segment.hazard_class] ?? 'Unknown'),
        // Sourced from the segment's leading sample so a map hover can show
        // the same wave/wind/ETA readers already see in the results table,
        // without the map needing its own copy of the samples array.
        eta: from.eta ?? null,
        distanceNm: Number.isFinite(from.distance_nm) ? from.distance_nm : null,
        waveHeightM: Number.isFinite(from.wave_height_m) ? from.wave_height_m : null,
        windSpeedKt: Number.isFinite(from.wind_speed_kt) ? from.wind_speed_kt : null,
      },
    };
  }).filter(Boolean);
}
