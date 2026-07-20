// The wave Zarr used to be fetched straight from Wasabi (spc-zarr-file/rarotonga_ugrid.zarr).
// That upload step is now disabled — the data only reaches zarr-api's /zarr static route,
// so these defaults must point there and use the real store name (SWAN_UGRID.zarr).
describe('mapLayersConfig wave layer wiring', () => {
  const ENV_KEYS = ['REACT_APP_SFINCS_API_BASE', 'REACT_APP_WAVE_ZARR_BASE_URL'];

  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    ENV_KEYS.forEach((key) => { delete process.env[key]; });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function loadSwanLayer() {
    const { MAP_LAYERS } = require('../mapLayersConfig');
    const layer = MAP_LAYERS.find((l) => l.id === 'swan-rarotonga');
    if (!layer) throw new Error('swan-rarotonga layer not found in MAP_LAYERS');
    return layer;
  }

  test('wave layer reads SWAN_UGRID.zarr, not the dead rarotonga_ugrid.zarr symlink name', () => {
    const layer = loadSwanLayer();
    expect(layer.datasetName).toBe('SWAN_UGRID.zarr');
    expect(layer.datasetName).not.toBe('rarotonga_ugrid.zarr');
  });

  test('wave zarr base URL defaults to the FastAPI /zarr route, not Wasabi', () => {
    const layer = loadSwanLayer();
    expect(layer.zarrBaseUrl).toBe('https://ocean-zarr.spc.int/zarr');
    expect(layer.zarrBaseUrl).not.toMatch(/wasabisys/);
  });

  test('wave zarr base URL derives from a custom REACT_APP_SFINCS_API_BASE', () => {
    process.env.REACT_APP_SFINCS_API_BASE = 'https://custom-host.example';
    const layer = loadSwanLayer();
    expect(layer.zarrBaseUrl).toBe('https://custom-host.example/zarr');
  });

  test('an explicit REACT_APP_WAVE_ZARR_BASE_URL overrides the derived default', () => {
    process.env.REACT_APP_WAVE_ZARR_BASE_URL = 'https://other-host.example/zarr';
    const layer = loadSwanLayer();
    expect(layer.zarrBaseUrl).toBe('https://other-host.example/zarr');
  });
});
