import {
  NiueSuitabilityOverlay,
  classifySuitability,
  deriveSuitabilityDriver,
  fetchSuitabilityTimeseries,
  seaLevelHeightM,
  nearestSeaLevelStep,
  nearestSeaLevelStepWithTrend,
} from '../NiueSuitabilityOverlay';

describe('NiueSuitabilityOverlay tile URL handling', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('builds suitability tile URLs with the configured vessel and time index', () => {
    const overlay = Object.create(NiueSuitabilityOverlay.prototype);
    overlay._apiBase = 'https://ocean-zarr.spc.int';
    overlay._vessel = 'small_craft';

    expect(overlay._buildTileUrl(12)).toBe(
      'https://ocean-zarr.spc.int/niue/suitability/tiles/small_craft/12/{z}/{x}/{y}.png'
    );
  });

  test('trims a trailing API base slash before generating tile URLs', () => {
    const initializeSpy = jest
      .spyOn(NiueSuitabilityOverlay.prototype, '_initialize')
      .mockImplementation(() => {});

    const overlay = new NiueSuitabilityOverlay(
      {},
      {
        apiBase: 'https://example.test/',
        vessel: 'larger_vessels',
        opacity: 0.4,
      }
    );

    expect(overlay._apiBase).toBe('https://example.test');
    expect(overlay._buildTileUrl(3)).toBe(
      'https://example.test/niue/suitability/tiles/larger_vessels/3/{z}/{x}/{y}.png'
    );

    initializeSpy.mockRestore();
  });
});

describe('classifySuitability', () => {
  // small_craft: cautionWindKt=15/maxWindKt=20, cautionWaveHeightM=1.5/maxWaveHeightM=2.0
  test('classifies the wind axis at its own thresholds, wave held at 0', () => {
    expect(classifySuitability('small_craft', 14.9, 0)).toBe(0);
    expect(classifySuitability('small_craft', 15, 0)).toBe(1);
    expect(classifySuitability('small_craft', 19.9, 0)).toBe(1);
    expect(classifySuitability('small_craft', 20, 0)).toBe(2);
  });

  test('classifies the wave axis at its own thresholds, wind held at 0', () => {
    expect(classifySuitability('small_craft', 0, 1.49)).toBe(0);
    expect(classifySuitability('small_craft', 0, 1.5)).toBe(1);
    expect(classifySuitability('small_craft', 0, 1.99)).toBe(1);
    expect(classifySuitability('small_craft', 0, 2.0)).toBe(2);
  });

  test('takes the worse of the two axes when both are elevated', () => {
    // wind alone -> caution (1), wave alone -> avoid (2) -> overall avoid.
    expect(classifySuitability('small_craft', 16, 2.5)).toBe(2);
  });

  test('returns null for an unknown vessel code', () => {
    expect(classifySuitability('not_a_vessel', 30, 3)).toBeNull();
  });
});

describe('deriveSuitabilityDriver (refactored onto classifySuitability)', () => {
  test('still attributes the hazard to whichever axis crosses its threshold further', () => {
    expect(deriveSuitabilityDriver('small_craft', 25, 0)).toBe('wind');
    expect(deriveSuitabilityDriver('small_craft', 0, 2.5)).toBe('waves');
    expect(deriveSuitabilityDriver('small_craft', 25, 2.5)).toBe('wind_and_waves');
    expect(deriveSuitabilityDriver('small_craft', 5, 0.5)).toBe('none');
    expect(deriveSuitabilityDriver('not_a_vessel', 30, 3)).toBeNull();
  });
});

describe('fetchSuitabilityTimeseries', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test('fetches landing-area suitability timeseries from the configured API base', async () => {
    const payload = {
      vessel: 'small_craft',
      timeseries: [{ time_index: 0, hazard_class: 1 }],
    };
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(payload),
    });

    await expect(
      fetchSuitabilityTimeseries('https://api.test/', -169.9, -19.1, 'small_craft')
    ).resolves.toBe(payload);

    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('https://api.test/niue/suitability/point/timeseries?');
    expect(url).toContain('lon=-169.9');
    expect(url).toContain('lat=-19.1');
    expect(url).toContain('vessel=small_craft');
  });

  test('reports unavailable landing-area suitability when the timeseries endpoint returns 404', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 404,
    });

    await expect(
      fetchSuitabilityTimeseries('https://api.test', -169.9, -19.1, 'traditional_craft')
    ).rejects.toThrow(
      'Landing-area suitability is not available in this deployment yet'
    );
  });
});

describe('seaLevelHeightM', () => {
  test('reads tide_m specifically, not the sibling total_sea_level_m', () => {
    expect(seaLevelHeightM({ tide_m: 0.42, total_sea_level_m: 0.9 })).toBe(0.42);
  });

  test('returns null when tide_m is missing or non-finite, rather than fabricating 0', () => {
    expect(seaLevelHeightM({ total_sea_level_m: 0.9 })).toBeNull();
    expect(seaLevelHeightM({ tide_m: null })).toBeNull();
    expect(seaLevelHeightM({ tide_m: 'not-a-number' })).toBeNull();
    expect(seaLevelHeightM(null)).toBeNull();
    expect(seaLevelHeightM(undefined)).toBeNull();
  });

  test('does not fall back to a decoy field name when tide_m is absent', () => {
    // Regression: an earlier version checked a list of guessed field names
    // (sea_level_m, water_level_m, ...) around tide_m — Number(null) is 0
    // and finite, so an explicit null on one of those would have masked a
    // real tide_m elsewhere in the list. tide_m is the only field read now.
    expect(seaLevelHeightM({ sea_level_m: null, water_level_m: 1.2, tide_m: 0.3 })).toBe(0.3);
  });
});

describe('nearestSeaLevelStep', () => {
  const timesteps = [
    { valid_time_utc: '2026-07-13T00:00:00Z', tide_m: 0.1 },
    { valid_time_utc: '2026-07-13T03:00:00Z', tide_m: 0.4 },
    { valid_time_utc: '2026-07-13T06:00:00Z', tide_m: -0.2 },
  ];

  test('returns the timestep closest to the target time', () => {
    expect(nearestSeaLevelStep(timesteps, '2026-07-13T02:40:00Z')).toBe(timesteps[1]);
  });

  test('returns null when the closest timestep exceeds the match tolerance', () => {
    // Default tolerance is 3h; the nearest step here is 8h+ away.
    expect(nearestSeaLevelStep(timesteps, '2026-07-13T14:30:00Z')).toBeNull();
  });

  test('accepts a custom tolerance', () => {
    // Nearest step to 08:00 is 06:00, 2h away — inside a 4h tolerance, outside a 1h one.
    expect(nearestSeaLevelStep(timesteps, '2026-07-13T08:00:00Z', 1 * 60 * 60 * 1000)).toBeNull();
    expect(nearestSeaLevelStep(timesteps, '2026-07-13T08:00:00Z', 4 * 60 * 60 * 1000)).toBe(timesteps[2]);
  });

  test('returns null for empty/invalid input', () => {
    expect(nearestSeaLevelStep([], '2026-07-13T00:00:00Z')).toBeNull();
    expect(nearestSeaLevelStep(null, '2026-07-13T00:00:00Z')).toBeNull();
    expect(nearestSeaLevelStep(timesteps, null)).toBeNull();
    expect(nearestSeaLevelStep(timesteps, 'not-a-date')).toBeNull();
  });
});

describe('nearestSeaLevelStepWithTrend', () => {
  const risingSeries = [
    { valid_time_utc: '2026-07-13T00:00:00Z', tide_m: 0.1 },
    { valid_time_utc: '2026-07-13T01:00:00Z', tide_m: 0.4 },
    { valid_time_utc: '2026-07-13T02:00:00Z', tide_m: 0.2 },
  ];

  test('labels rising when the tide increased from the earlier neighbor', () => {
    const result = nearestSeaLevelStepWithTrend(risingSeries, '2026-07-13T01:00:00Z');
    expect(result.tide_m).toBe(0.4);
    expect(result.trend).toBe('rising');
  });

  test('labels falling when the tide decreased from the earlier neighbor', () => {
    const result = nearestSeaLevelStepWithTrend(risingSeries, '2026-07-13T02:00:00Z');
    expect(result.trend).toBe('falling');
  });

  test('labels steady when the change is within the noise epsilon', () => {
    const flat = [
      { valid_time_utc: '2026-07-13T00:00:00Z', tide_m: 0.30 },
      { valid_time_utc: '2026-07-13T01:00:00Z', tide_m: 0.305 },
    ];
    expect(nearestSeaLevelStepWithTrend(flat, '2026-07-13T01:00:00Z').trend).toBe('steady');
  });

  test('returns null when no step matches within tolerance', () => {
    expect(nearestSeaLevelStepWithTrend(risingSeries, '2026-07-14T00:00:00Z')).toBeNull();
  });
});
