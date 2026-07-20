jest.mock('zarr', () => ({
  openArray: jest.fn(),
  HTTPStore: jest.fn().mockImplementation((url) => ({ url })),
}));

import { openArray, HTTPStore } from 'zarr';
import ZarrInundationProvider from '../ZarrInundationProvider';

describe('ZarrInundationProvider', () => {
  beforeEach(() => {
    openArray.mockReset();
    HTTPStore.mockClear();
  });

  test('defaults the dataset name to the live store, not the stale sfincs_h_forecast.zarr', () => {
    const provider = new ZarrInundationProvider({ baseUrl: 'https://ocean-zarr.spc.int/zarr' });
    expect(provider._dataset).toBe('sfincs_hmax_forecast.zarr');
  });

  test('an explicit dataset name is respected', () => {
    const provider = new ZarrInundationProvider({
      baseUrl: 'https://ocean-zarr.spc.int/zarr',
      dataset: 'custom.zarr',
    });
    expect(provider._dataset).toBe('custom.zarr');
  });

  test('_ensure48Loaded reads the "hmax" array — the 48h store has no "h" array', async () => {
    openArray.mockResolvedValue({ get: jest.fn() });
    const provider = new ZarrInundationProvider({
      baseUrl: 'https://ocean-zarr.spc.int/zarr',
      dataset: 'sfincs_hmax_forecast.zarr',
      dataset48h: 'sfincs_hmax_48h.zarr',
    });

    await provider._ensure48Loaded();

    expect(openArray).toHaveBeenCalledTimes(1);
    expect(openArray).toHaveBeenCalledWith(expect.objectContaining({ path: 'hmax', mode: 'r' }));
    expect(openArray).not.toHaveBeenCalledWith(expect.objectContaining({ path: 'h' }));
    expect(HTTPStore).toHaveBeenCalledWith('https://ocean-zarr.spc.int/zarr/sfincs_hmax_48h.zarr');
  });

  test('_ensure48Loaded only opens the array once across concurrent calls', async () => {
    let resolveOpen;
    openArray.mockReturnValue(new Promise((resolve) => { resolveOpen = resolve; }));
    const provider = new ZarrInundationProvider({
      baseUrl: 'https://ocean-zarr.spc.int/zarr',
      dataset48h: 'sfincs_hmax_48h.zarr',
    });

    const first = provider._ensure48Loaded();
    const second = provider._ensure48Loaded();
    resolveOpen({ get: jest.fn() });
    await Promise.all([first, second]);

    expect(openArray).toHaveBeenCalledTimes(1);
  });

  test('_ensure48Loaded throws when no 48h dataset is configured', async () => {
    const provider = new ZarrInundationProvider({ baseUrl: 'https://ocean-zarr.spc.int/zarr' });
    await expect(provider._ensure48Loaded()).rejects.toThrow('No 48h dataset configured');
  });

  test('_ensureLoaded reads the hourly "h" array (unaffected by the 48h fix)', async () => {
    const arr = { get: jest.fn() };
    const latArr = { get: jest.fn().mockResolvedValue({ data: [1, 2, 3] }) };
    const lonArr = { get: jest.fn().mockResolvedValue({ data: [4, 5, 6] }) };
    openArray.mockImplementation(({ path }) => {
      if (path === 'h') return Promise.resolve(arr);
      if (path === 'lat') return Promise.resolve(latArr);
      if (path === 'lon') return Promise.resolve(lonArr);
      throw new Error(`unexpected path ${path}`);
    });

    const provider = new ZarrInundationProvider({
      baseUrl: 'https://ocean-zarr.spc.int/zarr',
      dataset: 'sfincs_hmax_forecast.zarr',
    });
    await provider._ensureLoaded();

    expect(openArray).toHaveBeenCalledWith(expect.objectContaining({ path: 'h', mode: 'r' }));
    expect(HTTPStore).toHaveBeenCalledWith('https://ocean-zarr.spc.int/zarr/sfincs_hmax_forecast.zarr');
  });
});
