import { renderHook, waitFor } from '@testing-library/react';
import { useLandingAreaTimeseries } from '../useLandingAreaTimeseries';

const landingArea = { lon: -169.9367, lat: -19.1211, radiusKm: 0.5 };

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
  };
}

describe('useLandingAreaTimeseries', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('uses the 500 m area endpoint first', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({
      radius_m: 500,
      face_count: 4,
      used_nearest_face_fallback: false,
      steps: [{ time_index: 0, hazard_class: 1 }],
    }));

    const { result } = renderHook(() => (
      useLandingAreaTimeseries(landingArea, 'traditional_craft', 'https://api.test')
    ));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('/niue/suitability/area/timeseries?');
    expect(global.fetch.mock.calls[0][0]).toContain('radius_m=500');
    expect(result.current.data.statistics_basis).toBe('area_500m');
    expect(result.current.data.face_count).toBe(4);
    expect(result.current.data.steps[0].sample_count).toBe(4);
  });

  it('labels backend nearest-face fallback without calling the point endpoint', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({
      radius_m: 500,
      face_count: 1,
      used_nearest_face_fallback: true,
      steps: [{ time_index: 0, hazard_class: 0 }],
    }));

    const { result } = renderHook(() => (
      useLandingAreaTimeseries(landingArea, 'traditional_craft', 'https://api-nearest.test')
    ));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('/niue/suitability/area/timeseries?');
    expect(result.current.data.statistics_basis).toBe('nearest_face_area_fallback');
    expect(result.current.data.used_nearest_face_fallback).toBe(true);
    expect(result.current.data.steps[0].sample_count).toBe(1);
  });

  it('falls back to nearest pixel only when the area endpoint is missing', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({}, false, 404))
      .mockResolvedValueOnce(jsonResponse({
        steps: [{ time_index: 0, hazard_class: 0 }],
      }));

    const { result } = renderHook(() => (
      useLandingAreaTimeseries(landingArea, 'traditional_craft', 'https://api.test')
    ));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toContain('/niue/suitability/area/timeseries?');
    expect(global.fetch.mock.calls[1][0]).toContain('/niue/suitability/point/timeseries?');
    expect(result.current.data.statistics_basis).toBe('nearest_pixel_fallback');
    expect(result.current.data.fallback_reason).toMatch(/500 m area endpoint/i);
  });
});
