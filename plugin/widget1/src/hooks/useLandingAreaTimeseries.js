import { useEffect, useState } from 'react';
import {
  fetchSuitabilityAreaTimeseries,
  fetchSuitabilityTimeseries,
  isSuitabilityAreaTimeseriesUnavailable,
} from '../lib/NiueSuitabilityOverlay';

// Fetches suitability-over-time at a selected landing-area point whenever the
// point or vessel class changes. Mirrors the loading/error/data shape used
// elsewhere in the app (see NiueSuitabilityOverlay's own onLoadingChange/
// onErrorChange callbacks) so consumers can render loading/error states the
// same way.
export function useLandingAreaTimeseries(landingArea, vessel, apiBase) {
  const [state, setState] = useState({ loading: false, error: null, data: null });

  useEffect(() => {
    if (!landingArea || !apiBase) {
      setState({ loading: false, error: null, data: null });
      return undefined;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    const radiusKm = landingArea.radiusKm ?? landingArea.radius_km ?? 0.5;
    (async () => {
      try {
        if (isSuitabilityAreaTimeseriesUnavailable(apiBase)) {
          const fallback = await fetchSuitabilityTimeseries(apiBase, landingArea.lon, landingArea.lat, vessel);
          if (!cancelled) {
            setState({
              loading: false,
              error: null,
              data: {
                ...fallback,
                statistics_basis: fallback?.statistics_basis ?? 'nearest_pixel_fallback',
                fallback_reason: '500 m area endpoint is not available in this deployment.',
                radius_km: radiusKm,
              },
            });
          }
          return;
        }
        const data = await fetchSuitabilityAreaTimeseries(apiBase, landingArea.lon, landingArea.lat, vessel, radiusKm);
        if (!cancelled) setState({ loading: false, error: null, data });
      } catch (areaErr) {
        if (areaErr.status !== 404) throw areaErr;
        const fallback = await fetchSuitabilityTimeseries(apiBase, landingArea.lon, landingArea.lat, vessel);
        if (!cancelled) {
          setState({
            loading: false,
            error: null,
            data: {
              ...fallback,
              statistics_basis: fallback?.statistics_basis ?? 'nearest_pixel_fallback',
              fallback_reason: '500 m area endpoint is not available in this deployment.',
              radius_km: radiusKm,
            },
          });
        }
      }
    })().catch((err) => {
      console.error('[useLandingAreaTimeseries] Failed to load landing area timeseries:', err);
      if (!cancelled) setState({ loading: false, error: err.message, data: null });
    });

    return () => { cancelled = true; };
  }, [landingArea, vessel, apiBase]);

  return state;
}
