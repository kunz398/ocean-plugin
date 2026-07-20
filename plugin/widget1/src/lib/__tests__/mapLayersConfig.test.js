import { findLayerById } from '../mapLayersConfig';

describe('mapLayersConfig Niue suitability layer', () => {
  test('configures suitability as a Niue raster API layer with the default vessel', () => {
    const layer = findLayerById('niue-suitability');
    const expectedApiBase = (
      process.env.REACT_APP_SFINCS_API_BASE || 'https://ocean-zarr.spc.int'
    ).replace(/\/+$/, '');

    expect(layer).toMatchObject({
      id: 'niue-suitability',
      value: 'suitability',
      type: 'niue-suitability-raster',
      sourceType: 'niue-suitability-raster',
      variable: 'suitability',
      defaultVessel: 'traditional_craft',
      units: '',
    });
    expect(layer.apiBase).toBe(expectedApiBase);
    expect(layer.bounds).toEqual({
      southWest: [expect.any(Number), expect.any(Number)],
      northEast: [expect.any(Number), expect.any(Number)],
    });
  });

  test('finds the suitability layer by its value alias', () => {
    const layer = findLayerById('niue-suitability');

    expect(findLayerById('suitability')).toBe(layer);
  });
});

// The wave layer's zarrBaseUrl used to default to '/widget1/zarr', an nginx alias to a
// bind-mounted /data/niue/zarr directory that was never actually populated in production —
// requests fell through to the SPA's index.html (200 OK, wrong content) instead of erroring,
// so the wave layer silently failed to render. zarr-api now serves this directly at
// /niue/zarr/{file}, mirroring the Cook Islands /zarr/{file} route.
describe('mapLayersConfig Niue wave layer', () => {
  const ENV_KEYS = ['REACT_APP_SFINCS_API_BASE', 'REACT_APP_NIUE_WAVE_ZARR_BASE_URL'];

  beforeEach(() => {
    jest.resetModules();
    ENV_KEYS.forEach((key) => { delete process.env[key]; });
  });

  function loadWaveLayer() {
    const { findLayerById } = require('../mapLayersConfig');
    const layer = findLayerById('niue-wave-height');
    if (!layer) throw new Error('niue-wave-height layer not found');
    return layer;
  }

  test('wave layer reads ForecastNiue_latest.zarr via the FastAPI /niue/zarr route, not the dead /widget1/zarr proxy', () => {
    const layer = loadWaveLayer();
    expect(layer.datasetName).toBe('ForecastNiue_latest.zarr');
    expect(layer.zarrBaseUrl).toBe('https://ocean-zarr.spc.int/niue/zarr');
    expect(layer.zarrBaseUrl).not.toBe('/widget1/zarr');
  });

  test('wave zarr base URL derives from a custom REACT_APP_SFINCS_API_BASE', () => {
    process.env.REACT_APP_SFINCS_API_BASE = 'https://custom-host.example';
    const layer = loadWaveLayer();
    expect(layer.zarrBaseUrl).toBe('https://custom-host.example/niue/zarr');
  });

  test('an explicit REACT_APP_NIUE_WAVE_ZARR_BASE_URL overrides the derived default', () => {
    process.env.REACT_APP_NIUE_WAVE_ZARR_BASE_URL = 'https://other-host.example/niue/zarr';
    const layer = loadWaveLayer();
    expect(layer.zarrBaseUrl).toBe('https://other-host.example/niue/zarr');
  });
});
