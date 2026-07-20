import FastApiInundationProvider from './FastApiInundationProvider';
import ZarrInundationProvider from './ZarrInundationProvider';

const DEFAULT_PROVIDER = 'fastapi';

// Runtime override set by the provider selector UI. null means "use env var".
let _runtimeProviderId = null;

/**
 * Switch the active provider at runtime.
 * @param {string|null} id  'fastapi' | 'zarr' | null (revert to env var)
 */
export function setRuntimeProvider(id) {
  _runtimeProviderId = id || null;
}

/**
 * Returns the currently active provider id (runtime override → env var → default).
 * @returns {'fastapi' | 'zarr'}
 */
export function getRuntimeProviderId() {
  return _runtimeProviderId
    || process.env.REACT_APP_INUNDATION_PROVIDER
    || DEFAULT_PROVIDER;
}

/**
 * Creates an inundation provider based on env config (or runtime override).
 *
 * Env vars:
 *   REACT_APP_INUNDATION_PROVIDER         — 'fastapi' (default) or 'zarr'
 *   REACT_APP_INUNDATION_ZARR_BASE_URL    — HTTP base URL for the Zarr store
 *                                            (defaults to apiBase + '/zarr', i.e.
 *                                            zarr-api's own static route — not Wasabi)
 *   REACT_APP_INUNDATION_ZARR_DATASET     — Zarr dataset path (default 'sfincs_hmax_forecast.zarr')
 *   REACT_APP_INUNDATION_ZARR_48H_DATASET — 48h max Zarr dataset path (default 'sfincs_hmax_48h.zarr')
 *
 * NOTE: 'sfincs_h_forecast.zarr' (the old default here) is a stale directory that
 * stopped being updated in June — the pipeline has written to 'sfincs_hmax_forecast.zarr'
 * since. Don't reintroduce the old name.
 *
 * @param {string} [apiBase] FastAPI base URL (used for both providers)
 * @param {string} [overrideId] Force a specific provider ('fastapi' or 'zarr')
 * @returns {import('./InundationProvider').default}
 */
export function createInundationProvider(apiBase, overrideId) {
  const id = overrideId || getRuntimeProviderId();

  if (id === 'zarr') {
    const baseUrl = process.env.REACT_APP_INUNDATION_ZARR_BASE_URL
      || (apiBase ? `${apiBase.replace(/\/+$/, '')}/zarr` : '');
    const dataset = process.env.REACT_APP_INUNDATION_ZARR_DATASET || 'sfincs_hmax_forecast.zarr';
    const dataset48h = process.env.REACT_APP_INUNDATION_ZARR_48H_DATASET || 'sfincs_hmax_48h.zarr';
    return new ZarrInundationProvider({ baseUrl, dataset, dataset48h });
  }

  return new FastApiInundationProvider(apiBase);
}

/** @deprecated use getRuntimeProviderId */
export function getDefaultProviderId() {
  return getRuntimeProviderId();
}
