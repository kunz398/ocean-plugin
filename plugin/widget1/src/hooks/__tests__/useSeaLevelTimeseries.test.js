import { renderHook, waitFor } from '@testing-library/react';
import { useSeaLevelTimeseries } from '../useSeaLevelTimeseries';

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
  };
}

describe('useSeaLevelTimeseries', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('does nothing when disabled or missing required params', () => {
    const { result, rerender } = renderHook(
      ({ apiBase, start, end, enabled }) => useSeaLevelTimeseries(apiBase, start, end, enabled),
      { initialProps: { apiBase: 'https://disabled.test', start: '2026-07-13T00:00:00Z', end: '2026-07-20T00:00:00Z', enabled: false } }
    );
    expect(result.current).toEqual({ loading: false, error: null, data: null });

    rerender({ apiBase: '', start: '2026-07-13T00:00:00Z', end: '2026-07-20T00:00:00Z', enabled: true });
    expect(result.current).toEqual({ loading: false, error: null, data: null });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('checks availability then fetches the timeseries when the product exists', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ exists: { sea_level_nc: true } }))
      .mockResolvedValueOnce(jsonResponse({ timesteps: [{ valid_time_utc: '2026-07-13T00:00:00Z', tide_m: 0.1 }] }));

    const { result } = renderHook(() => (
      useSeaLevelTimeseries('https://api-available.test', '2026-07-13T00:00:00Z', '2026-07-20T00:00:00Z')
    ));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toBe('https://api-available.test/niue/status');
    expect(global.fetch.mock.calls[1][0]).toContain('/niue/sea-level/timeseries?');
    expect(result.current.error).toBeNull();
    expect(result.current.data.timesteps).toHaveLength(1);
  });

  it('surfaces an explicit error and skips the timeseries fetch when the product is unavailable', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ exists: { sea_level_nc: false } }));

    const { result } = renderHook(() => (
      useSeaLevelTimeseries('https://api-unavailable.test', '2026-07-13T00:00:00Z', '2026-07-20T00:00:00Z')
    ));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toMatch(/not available/i);
  });

  it('caches a positive availability check within the TTL, then re-checks after it expires', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000_000);

    global.fetch
      .mockResolvedValueOnce(jsonResponse({ exists: { sea_level_nc: true } }))
      .mockResolvedValueOnce(jsonResponse({ timesteps: [] }));

    const { result, rerender } = renderHook(
      ({ start }) => useSeaLevelTimeseries('https://api-ttl.test', start, '2026-07-20T00:00:00Z'),
      { initialProps: { start: '2026-07-13T00:00:00Z' } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(global.fetch).toHaveBeenCalledTimes(2); // status + timeseries

    // Still within the TTL — a param change re-triggers the effect, but the
    // availability check should be served from cache (no new /niue/status call).
    global.fetch.mockResolvedValueOnce(jsonResponse({ timesteps: [] }));
    rerender({ start: '2026-07-13T01:00:00Z' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(global.fetch).toHaveBeenCalledTimes(3); // +1 timeseries only, no status re-check

    // Past the TTL — this is the regression case: a stale "unavailable" must
    // not survive indefinitely once the backend recovers.
    nowSpy.mockReturnValue(1_000_000 + 61_000);
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ exists: { sea_level_nc: true } }))
      .mockResolvedValueOnce(jsonResponse({ timesteps: [] }));
    rerender({ start: '2026-07-13T02:00:00Z' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(global.fetch).toHaveBeenCalledTimes(5); // +1 status re-check, +1 timeseries

    nowSpy.mockRestore();
  });
});
