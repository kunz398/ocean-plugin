import {
  createInundationProvider,
  getRuntimeProviderId,
  setRuntimeProvider,
} from '../inundationProviderFactory';
import FastApiInundationProvider from '../FastApiInundationProvider';
import ZarrInundationProvider from '../ZarrInundationProvider';

const ZARR_ENV_KEYS = [
  'REACT_APP_INUNDATION_PROVIDER',
  'REACT_APP_INUNDATION_ZARR_BASE_URL',
  'REACT_APP_INUNDATION_ZARR_DATASET',
  'REACT_APP_INUNDATION_ZARR_48H_DATASET',
];

describe('inundationProviderFactory', () => {
  afterEach(() => {
    setRuntimeProvider(null);
    ZARR_ENV_KEYS.forEach((key) => { delete process.env[key]; });
  });

  test('defaults to the fastapi provider', () => {
    expect(getRuntimeProviderId()).toBe('fastapi');
    const provider = createInundationProvider('https://ocean-zarr.spc.int');
    expect(provider).toBeInstanceOf(FastApiInundationProvider);
  });

  test('runtime override takes precedence over env var and default', () => {
    process.env.REACT_APP_INUNDATION_PROVIDER = 'zarr';
    setRuntimeProvider('fastapi');

    expect(getRuntimeProviderId()).toBe('fastapi');
    expect(createInundationProvider()).toBeInstanceOf(FastApiInundationProvider);
  });

  test('zarr provider base URL falls back to apiBase + /zarr, not Wasabi', () => {
    const provider = createInundationProvider('https://ocean-zarr.spc.int', 'zarr');

    expect(provider).toBeInstanceOf(ZarrInundationProvider);
    expect(provider._baseUrl).toBe('https://ocean-zarr.spc.int/zarr');
    expect(provider._baseUrl).not.toMatch(/wasabisys/);
  });

  test('zarr provider base URL trims a trailing slash on apiBase before appending /zarr', () => {
    const provider = createInundationProvider('https://ocean-zarr.spc.int/', 'zarr');
    expect(provider._baseUrl).toBe('https://ocean-zarr.spc.int/zarr');
  });

  test('explicit REACT_APP_INUNDATION_ZARR_BASE_URL overrides the apiBase-derived default', () => {
    process.env.REACT_APP_INUNDATION_ZARR_BASE_URL = 'https://other-host.example/zarr';
    const provider = createInundationProvider('https://ocean-zarr.spc.int', 'zarr');
    expect(provider._baseUrl).toBe('https://other-host.example/zarr');
  });

  test('zarr provider dataset names default to the live store, not the stale one', () => {
    const provider = createInundationProvider('https://ocean-zarr.spc.int', 'zarr');

    expect(provider._dataset).toBe('sfincs_hmax_forecast.zarr');
    expect(provider._dataset).not.toBe('sfincs_h_forecast.zarr');
    expect(provider._dataset48h).toBe('sfincs_hmax_48h.zarr');
  });

  test('explicit dataset env vars override the defaults', () => {
    process.env.REACT_APP_INUNDATION_ZARR_DATASET = 'custom_forecast.zarr';
    process.env.REACT_APP_INUNDATION_ZARR_48H_DATASET = 'custom_48h.zarr';
    const provider = createInundationProvider('https://ocean-zarr.spc.int', 'zarr');

    expect(provider._dataset).toBe('custom_forecast.zarr');
    expect(provider._dataset48h).toBe('custom_48h.zarr');
  });
});
