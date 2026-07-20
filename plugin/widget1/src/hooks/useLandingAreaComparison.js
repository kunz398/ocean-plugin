import { useEffect, useState } from 'react';
import {
  fetchSuitabilityAreaTimeseries,
  fetchSuitabilityTimeseries,
  isSuitabilityAreaTimeseriesUnavailable,
} from '../lib/NiueSuitabilityOverlay';
import { mapWithConcurrency } from '../utils/SuitabilityPDFExporter';
import { LANDING_AREA_PRESETS } from '../config/landingAreaPresets';

// Same concurrency-cap + delay discipline as the PDF exporter's landing-area
// report (see SuitabilityPDFExporter.js's LANDING_FETCH_CONCURRENCY/
// LANDING_FETCH_DELAY_MS) — firing all preset requests at once tripped a
// volume-based block on this backend before; mapWithConcurrency is reused
// from there (already an established cross-import — scenarioService.js does
// the same for `sleep`) rather than re-implementing the same rate limiting.
const FETCH_CONCURRENCY = 3;
const FETCH_DELAY_MS = 120;

// Fetches suitability-over-time for every preset landing area at once (not
// just the one currently selected), for the "compare all sites" heatmap.
// `enabled` gates the fetch so it only runs once a user actually opens the
// comparison view, not every time the landing-area panel is shown — this
// hits the backend 4-5x more than the single-point hook, so it shouldn't
// fire automatically in the background.
export function useLandingAreaComparison(vessel, apiBase, enabled, customPoint = null) {
  const [state, setState] = useState({ loading: false, error: null, rows: [] });

  const customLon = customPoint?.source === 'click' ? customPoint.lon : null;
  const customLat = customPoint?.source === 'click' ? customPoint.lat : null;
  const customLabel = customPoint?.source === 'click' ? customPoint.label : null;

  useEffect(() => {
    if (!enabled || !apiBase || !vessel) return undefined;

    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    const points = LANDING_AREA_PRESETS.map((p) => ({ ...p, source: 'preset' }));
    if (Number.isFinite(customLon) && Number.isFinite(customLat)) {
      points.push({
        id: 'custom', name: customLabel ?? 'Selected point', label: customLabel ?? 'Selected point',
        lon: customLon, lat: customLat, source: 'click',
      });
    }

    (async () => {
      const rows = await mapWithConcurrency(points, FETCH_CONCURRENCY, async (point) => {
        const radiusKm = point.radiusKm ?? point.radius_km ?? 0.5;
        try {
          if (isSuitabilityAreaTimeseriesUnavailable(apiBase)) {
            const fallback = await fetchSuitabilityTimeseries(apiBase, point.lon, point.lat, vessel);
            return {
              ...point,
              radiusKm,
              statistics_basis: 'nearest_pixel_fallback',
              fallback_reason: '500 m area endpoint is not available in this deployment.',
              steps: fallback?.steps ?? [],
            };
          }
          const series = await fetchSuitabilityAreaTimeseries(apiBase, point.lon, point.lat, vessel, radiusKm);
          return {
            ...point,
            radiusKm: series?.radius_km ?? radiusKm,
            statistics_basis: series?.statistics_basis ?? 'area_500m',
            face_count: series?.face_count,
            used_nearest_face_fallback: series?.used_nearest_face_fallback,
            available: series?.available,
            unavailable_reason: series?.unavailable_reason,
            steps: series?.steps ?? [],
          };
        } catch (err) {
          if (err.status === 404) {
            try {
              const fallback = await fetchSuitabilityTimeseries(apiBase, point.lon, point.lat, vessel);
              return {
                ...point,
                radiusKm,
                statistics_basis: 'nearest_pixel_fallback',
                fallback_reason: '500 m area endpoint is not available in this deployment.',
                steps: fallback?.steps ?? [],
              };
            } catch (fallbackErr) {
              console.warn(`Landing-area comparison: fallback timeseries unavailable for ${point.label}:`, fallbackErr.message);
            }
          }
          // One site's failure (e.g. out of model domain) shouldn't blank
          // the whole comparison — report it as an empty row, not a thrown
          // error that aborts every other site's fetch.
          console.warn(`Landing-area comparison: timeseries unavailable for ${point.label}:`, err.message);
          return { ...point, steps: [] };
        }
      }, FETCH_DELAY_MS);

      if (cancelled) return;
      const withData = rows.filter((row) => row.steps.length);
      setState({
        loading: false,
        error: withData.length ? null : 'No suitability timeseries returned for any landing area.',
        rows: withData,
      });
    })();

    return () => { cancelled = true; };
  }, [vessel, apiBase, enabled, customLon, customLat, customLabel]);

  return state;
}
