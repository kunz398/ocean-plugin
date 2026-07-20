import {
  DEPARTURE_PROBE_OFFSETS_HOURS,
  MAX_SCENARIOS,
  buildRouteAdvisoryBriefConfig,
  buildScenarioComparisonBriefConfig,
  createScenario,
  deriveRouteDecision,
  driverLabel,
  duplicateScenario,
  findBetterDeparture,
  isScenarioStale,
  isScenarioSuperseded,
  nextScenarioName,
  rankScenarios,
  runAllScenarios,
  runScenario,
  suggestBetterVessel,
} from '../scenarioService';

jest.mock('../routeForecastService', () => ({
  fetchRouteForecast: jest.fn(),
  // Real implementation — a pure date-parsing helper, not the network call
  // this mock exists to intercept; scenarioService.js imports it directly.
  parseAsUtcWallClock: jest.requireActual('../routeForecastService').parseAsUtcWallClock,
}));

// eslint-disable-next-line import/first
import { fetchRouteForecast } from '../routeForecastService';

function sample(overrides = {}) {
  return {
    sample_index: 0,
    lon: -169.9,
    lat: -19.1,
    distance_nm: 0,
    eta: '2026-07-09T12:00:00Z',
    hazard_class: 0,
    hazard_label: 'Suitable',
    wave_height_m: 0.3,
    wind_speed_kt: 5,
    available: true,
    ...overrides,
  };
}

function routeResult(overrides = {}) {
  return {
    route_id: null,
    vessel: 'small_craft',
    departure_time: '2026-07-09T12:00:00Z',
    speed_kt: 8,
    summary: {
      distance_nm: 10, duration_hours: 1.25,
      worst_hazard_class: 0, recommendation: 'Suitable',
      suitable_percent: 100, caution_percent: 0, warning_percent: 0,
    },
    samples: [sample()],
    segments: [],
    ...overrides,
  };
}

beforeEach(() => {
  fetchRouteForecast.mockReset();
});

describe('MAX_SCENARIOS', () => {
  test('caps comparison at 4 scenarios, per the plan\'s readability limit', () => {
    expect(MAX_SCENARIOS).toBe(4);
  });
});

describe('nextScenarioName', () => {
  test('picks the first unused letter, not just a running count', () => {
    expect(nextScenarioName([])).toBe('Scenario A');
    expect(nextScenarioName([{ name: 'Scenario A' }])).toBe('Scenario B');
    // "Scenario B" was removed, but "Scenario C" still exists — must not reuse C.
    expect(nextScenarioName([{ name: 'Scenario A' }, { name: 'Scenario C' }])).toBe('Scenario B');
  });
});

describe('createScenario / duplicateScenario', () => {
  test('creates a draft scenario with a fresh id and default name', () => {
    const scenario = createScenario({
      vessel: 'small_craft',
      routePoints: [{ lon: -169.9, lat: -19.1 }, { lon: -169.8, lat: -19.0 }],
      departureTime: '2026-07-09T12:00',
      speedKt: 8,
    });

    expect(scenario.status).toBe('draft');
    expect(scenario.forecastResult).toBeNull();
    expect(scenario.name).toBe('Scenario A');
    expect(scenario.routePoints).toHaveLength(2);
    expect(scenario.id).toBeTruthy();
  });

  test('duplicating resets result/status but keeps other fields, and applies overrides', () => {
    const original = createScenario({
      vessel: 'small_craft',
      routePoints: [{ lon: -169.9, lat: -19.1 }, { lon: -169.8, lat: -19.0 }],
      departureTime: '2026-07-09T12:00',
      speedKt: 8,
    });
    original.status = 'ready';
    original.forecastResult = routeResult();

    const dup = duplicateScenario(original, { vessel: 'larger_vessels' }, [original]);

    expect(dup.id).not.toBe(original.id);
    expect(dup.name).toBe('Scenario B');
    expect(dup.vessel).toBe('larger_vessels');
    expect(dup.routePoints).toEqual(original.routePoints);
    expect(dup.status).toBe('draft');
    expect(dup.forecastResult).toBeNull();
  });
});

describe('deriveRouteDecision', () => {
  test('returns null when there is no result yet', () => {
    expect(deriveRouteDecision(null, 'small_craft')).toBeNull();
  });

  test('finds the worst-hazard sample and derives its driver from the vessel envelope', () => {
    const result = routeResult({
      summary: {
        distance_nm: 20, duration_hours: 2.5,
        worst_hazard_class: 2, recommendation: 'Avoid',
        suitable_percent: 50, caution_percent: 0, warning_percent: 50,
      },
      samples: [
        sample({ sample_index: 0, eta: '2026-07-09T12:00:00Z', hazard_class: 0 }),
        // small_craft: avoid wind 20kt/avoid Hs 2.0m — this sample crosses wind only.
        sample({ sample_index: 1, eta: '2026-07-09T13:00:00Z', hazard_class: 2, wind_speed_kt: 25, wave_height_m: 0.2 }),
      ],
    });

    const decision = deriveRouteDecision(result, 'small_craft');
    expect(decision.worstHazardClass).toBe(2);
    expect(decision.worstTime).toBe('2026-07-09T13:00:00Z');
    expect(decision.primaryDriver).toBe('wind');
    expect(driverLabel(decision.primaryDriver)).toBe('Wind');
    expect(decision.unavailableSamples).toBe(0);
    expect(decision.confidenceLabel).toBe('high');
  });

  test('prefers a backend-provided main_driver over the derived one', () => {
    const result = routeResult({
      samples: [sample({ hazard_class: 1, main_driver: 'waves', wind_speed_kt: 30, wave_height_m: 0 })],
    });
    const decision = deriveRouteDecision(result, 'small_craft');
    // wind_speed_kt=30 alone would derive 'wind', but backend's field must win.
    expect(decision.primaryDriver).toBe('waves');
  });

  test('lowers confidence as samples become unavailable', () => {
    const mixed = routeResult({
      samples: [
        sample({ hazard_class: 0, available: true }),
        sample({ hazard_class: null, available: false }),
      ],
    });
    expect(deriveRouteDecision(mixed, 'small_craft').confidenceLabel).toBe('reduced');

    const allUnavailable = routeResult({
      samples: [
        sample({ hazard_class: null, available: false }),
        sample({ hazard_class: null, available: false }),
      ],
    });
    const decision = deriveRouteDecision(allUnavailable, 'small_craft');
    expect(decision.confidenceLabel).toBe('low');
    expect(decision.unavailableSamples).toBe(2);
    expect(decision.worstTime).toBeNull();
  });
});

describe('suggestBetterVessel', () => {
  test('suggests nothing when the current vessel is already Suitable', () => {
    const result = routeResult(); // worst_hazard_class: 0
    expect(suggestBetterVessel(result, 'small_craft')).toBeNull();
  });

  test('suggests the nearest more-capable vessel that would clear, not the most-capable', () => {
    // wind=13kt against traditional_craft (caution 10/avoid 12) -> hazard 2.
    // Nearest upgrade, very_small_motorised_craft (caution 12/avoid 15), rates
    // this caution(1) — already better than current. small_craft (caution
    // 15/avoid 20) would rate it suitable(0), an even bigger improvement, but
    // the function must stop at the first (nearest) vessel that clears rather
    // than searching further for the best possible one.
    const result = routeResult({
      summary: { distance_nm: 10, duration_hours: 1, worst_hazard_class: 2, recommendation: 'Avoid', suitable_percent: 0, caution_percent: 0, warning_percent: 100 },
      samples: [sample({ hazard_class: 2, wind_speed_kt: 13, wave_height_m: 0 })],
    });
    const suggestion = suggestBetterVessel(result, 'traditional_craft');
    expect(suggestion.vessel).toBe('very_small_motorised_craft');
    expect(suggestion.estimatedWorstHazardClass).toBe(1);
    expect(suggestion.currentWorstHazardClass).toBe(2);
    expect(suggestion.isEstimate).toBe(true);
  });

  test('returns null when already at the most-capable vessel', () => {
    const result = routeResult({
      summary: { distance_nm: 10, duration_hours: 1, worst_hazard_class: 2, recommendation: 'Avoid', suitable_percent: 0, caution_percent: 0, warning_percent: 100 },
      samples: [sample({ hazard_class: 2, wind_speed_kt: 40, wave_height_m: 5 })],
    });
    expect(suggestBetterVessel(result, 'larger_vessels')).toBeNull();
  });

  test('returns null when no other vessel would actually clear', () => {
    // Extreme wind/wave that every vessel class rates Avoid.
    const result = routeResult({
      summary: { distance_nm: 10, duration_hours: 1, worst_hazard_class: 2, recommendation: 'Avoid', suitable_percent: 0, caution_percent: 0, warning_percent: 100 },
      samples: [sample({ hazard_class: 2, wind_speed_kt: 50, wave_height_m: 6 })],
    });
    expect(suggestBetterVessel(result, 'traditional_craft')).toBeNull();
  });

  test('skips samples with missing wind/wave data rather than crashing', () => {
    const result = routeResult({
      summary: { distance_nm: 10, duration_hours: 1, worst_hazard_class: 2, recommendation: 'Avoid', suitable_percent: 0, caution_percent: 0, warning_percent: 100 },
      samples: [
        sample({ hazard_class: 2, wind_speed_kt: 22, wave_height_m: 0 }),
        sample({ hazard_class: null, wind_speed_kt: null, wave_height_m: null, available: false }),
      ],
    });
    const suggestion = suggestBetterVessel(result, 'small_craft');
    expect(suggestion.samplesConsidered).toBe(1);
    expect(suggestion.samplesSkipped).toBe(1);
  });

  test('returns null for an unknown current vessel code', () => {
    const result = routeResult({ summary: { worst_hazard_class: 2 } });
    expect(suggestBetterVessel(result, 'not_a_vessel')).toBeNull();
  });
});

describe('rankScenarios', () => {
  function readyScenario(id, summaryOverrides) {
    return {
      id,
      name: id,
      vessel: 'small_craft',
      status: 'ready',
      forecastResult: routeResult({ summary: { distance_nm: 10, duration_hours: 1, ...summaryOverrides } }),
    };
  }

  test('ranks lowest worst hazard first', () => {
    const good = readyScenario('good', { worst_hazard_class: 0, suitable_percent: 100, caution_percent: 0, warning_percent: 0 });
    const bad = readyScenario('bad', { worst_hazard_class: 2, suitable_percent: 0, caution_percent: 0, warning_percent: 100 });
    const { recommendedId } = rankScenarios([bad, good]);
    expect(recommendedId).toBe('good');
  });

  test('breaks ties by exposure, then unavailable samples, then duration', () => {
    const lowExposure = readyScenario('lowExposure', { worst_hazard_class: 1, caution_percent: 10, warning_percent: 0, duration_hours: 5 });
    const highExposure = readyScenario('highExposure', { worst_hazard_class: 1, caution_percent: 60, warning_percent: 0, duration_hours: 1 });
    expect(rankScenarios([highExposure, lowExposure]).recommendedId).toBe('lowExposure');

    const fewerUnavailable = {
      id: 'fewerUnavailable', name: 'fewerUnavailable', vessel: 'small_craft', status: 'ready',
      forecastResult: routeResult({
        summary: { worst_hazard_class: 1, caution_percent: 10, warning_percent: 0, duration_hours: 5, distance_nm: 10 },
        samples: [sample({ hazard_class: 1 })],
      }),
    };
    const moreUnavailable = {
      id: 'moreUnavailable', name: 'moreUnavailable', vessel: 'small_craft', status: 'ready',
      forecastResult: routeResult({
        summary: { worst_hazard_class: 1, caution_percent: 10, warning_percent: 0, duration_hours: 1, distance_nm: 10 },
        samples: [sample({ hazard_class: 1 }), sample({ hazard_class: null, available: false })],
      }),
    };
    expect(rankScenarios([moreUnavailable, fewerUnavailable]).recommendedId).toBe('fewerUnavailable');
  });

  test('never recommends a scenario without a ready result', () => {
    const draft = { id: 'draft', name: 'draft', status: 'draft', forecastResult: null };
    const errored = { id: 'errored', name: 'errored', status: 'error', forecastResult: null };
    const { recommendedId } = rankScenarios([draft, errored]);
    expect(recommendedId).toBeNull();
  });
});

describe('isScenarioStale', () => {
  const base = {
    status: 'ready',
    vessel: 'small_craft',
    speedKt: 8,
    departureTime: '2026-07-09T12:00',
    routePoints: [{ lon: -169.9, lat: -19.1 }, { lon: -169.8, lat: -19.0 }],
  };

  test('is not stale when inputs match', () => {
    expect(isScenarioStale(base, { vessel: 'small_craft', speedKt: 8, departureTime: '2026-07-09T12:00', routePoints: base.routePoints })).toBe(false);
  });

  test('is stale when vessel, speed, departure, or route points change', () => {
    expect(isScenarioStale(base, { ...base, vessel: 'larger_vessels' })).toBe(true);
    expect(isScenarioStale(base, { ...base, speedKt: 10 })).toBe(true);
    expect(isScenarioStale(base, { ...base, departureTime: '2026-07-09T14:00' })).toBe(true);
    expect(isScenarioStale(base, { ...base, routePoints: [{ lon: -170, lat: -19 }] })).toBe(true);
  });

  test('a draft scenario (no result yet) is never stale', () => {
    expect(isScenarioStale({ ...base, status: 'draft' }, { ...base, vessel: 'larger_vessels' })).toBe(false);
  });

  // Regression test: found live against the real backend, running in a
  // non-UTC timezone (Pacific/Fiji, UTC+12) — a scenario created via
  // handleConfirmVesselSuggestion stores departureTime from the backend's
  // Z-suffixed UTC string (e.g. "2026-07-09T12:00:00Z"), while
  // currentInputs.departureTime comes straight from the datetime-local
  // <input> with no designator (e.g. "2026-07-09T12:00") — both intending
  // the same UTC wall-clock moment. Comparing them as raw strings, or even
  // naively via `new Date(...).getTime()`, flagged a just-created scenario
  // as stale immediately (the undesignated string parsed as local time,
  // 12 hours off), before the user touched anything.
  test('is not stale when departureTime differs only in string format but is the same UTC moment', () => {
    const scenario = { ...base, departureTime: '2026-07-09T12:00:00Z' };
    expect(isScenarioStale(scenario, { ...base, departureTime: '2026-07-09T12:00' })).toBe(false);
  });

  test('is still stale when departureTime is genuinely a different moment, regardless of format', () => {
    const scenario = { ...base, departureTime: '2026-07-09T12:00:00Z' };
    expect(isScenarioStale(scenario, { ...base, departureTime: '2026-07-09T15:00' })).toBe(true);
  });
});

describe('isScenarioSuperseded', () => {
  test('true only when the current model run is newer than the one the scenario ran against', () => {
    const scenario = { status: 'ready', modelRunStartAtRun: '2026-07-09T00:00:00Z' };
    expect(isScenarioSuperseded(scenario, '2026-07-09T06:00:00Z')).toBe(true);
    expect(isScenarioSuperseded(scenario, '2026-07-09T00:00:00Z')).toBe(false);
    expect(isScenarioSuperseded(scenario, '2026-07-08T00:00:00Z')).toBe(false);
  });

  test('false when either timestamp is missing', () => {
    expect(isScenarioSuperseded({ status: 'ready', modelRunStartAtRun: null }, '2026-07-09T06:00:00Z')).toBe(false);
    expect(isScenarioSuperseded({ status: 'ready', modelRunStartAtRun: '2026-07-09T00:00:00Z' }, null)).toBe(false);
  });
});

describe('runScenario', () => {
  test('sets status ready and snapshots modelRunStartAtRun on success', async () => {
    fetchRouteForecast.mockResolvedValue(routeResult());
    const scenario = createScenario({ vessel: 'small_craft', routePoints: [{ lon: 1, lat: 1 }, { lon: 2, lat: 2 }], departureTime: 't', speedKt: 8 });

    const updated = await runScenario('https://api', scenario, { modelRunStart: '2026-07-09T00:00:00Z' });

    expect(updated.status).toBe('ready');
    expect(updated.forecastResult).toBeTruthy();
    expect(updated.modelRunStartAtRun).toBe('2026-07-09T00:00:00Z');
    expect(updated.error).toBeNull();
  });

  test('sets status error and keeps the message on failure, without mutating the input', async () => {
    fetchRouteForecast.mockRejectedValue(new Error('backend down'));
    const scenario = createScenario({ vessel: 'small_craft', routePoints: [{ lon: 1, lat: 1 }, { lon: 2, lat: 2 }], departureTime: 't', speedKt: 8 });

    const updated = await runScenario('https://api', scenario);

    expect(updated.status).toBe('error');
    expect(updated.error).toBe('backend down');
    expect(scenario.status).toBe('draft'); // original untouched
  });
});

describe('runAllScenarios', () => {
  test('runs every scenario and reports each as it settles', async () => {
    fetchRouteForecast.mockResolvedValue(routeResult());
    const scenarios = [
      createScenario({ vessel: 'small_craft', routePoints: [{ lon: 1, lat: 1 }, { lon: 2, lat: 2 }], departureTime: 't', speedKt: 8 }),
      createScenario({ vessel: 'larger_vessels', routePoints: [{ lon: 1, lat: 1 }, { lon: 2, lat: 2 }], departureTime: 't', speedKt: 10 }),
    ];
    const settled = [];

    const results = await runAllScenarios('https://api', scenarios, { onScenarioSettled: (s) => settled.push(s.id) });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'ready')).toBe(true);
    expect(settled.sort()).toEqual(scenarios.map((s) => s.id).sort());
  });
});

describe('findBetterDeparture', () => {
  const baseInputs = { routePoints: [{ lon: 1, lat: 1 }, { lon: 2, lat: 2 }], vessel: 'small_craft', departureTime: '2026-07-09T12:00:00Z', speedKt: 8 };

  test('stops at the first candidate that clears to Suitable, without checking the rest', async () => {
    fetchRouteForecast.mockResolvedValueOnce(routeResult({ summary: { worst_hazard_class: 0, distance_nm: 10, duration_hours: 1 } }));

    const result = await findBetterDeparture('https://api', baseInputs);

    expect(fetchRouteForecast).toHaveBeenCalledTimes(1);
    expect(result.offsetHours).toBe(DEPARTURE_PROBE_OFFSETS_HOURS[0]);
    expect(result.allClear).toBe(true);
    expect(result.isEstimate).toBe(false);
    // +3h from 12:00:00Z
    expect(result.departureTime).toBe('2026-07-09T15:00:00.000Z');
  });

  test('falls back to the best-of-seen candidate when none reach Suitable', async () => {
    fetchRouteForecast
      .mockResolvedValueOnce(routeResult({ summary: { worst_hazard_class: 2, distance_nm: 10, duration_hours: 1 } }))
      .mockResolvedValueOnce(routeResult({ summary: { worst_hazard_class: 1, distance_nm: 10, duration_hours: 1 } }))
      .mockResolvedValueOnce(routeResult({ summary: { worst_hazard_class: 2, distance_nm: 10, duration_hours: 1 } }))
      .mockResolvedValueOnce(routeResult({ summary: { worst_hazard_class: 2, distance_nm: 10, duration_hours: 1 } }));

    const result = await findBetterDeparture('https://api', baseInputs);

    expect(fetchRouteForecast).toHaveBeenCalledTimes(4);
    expect(result.worstHazardClass).toBe(1);
    expect(result.offsetHours).toBe(DEPARTURE_PROBE_OFFSETS_HOURS[1]);
    expect(result.allClear).toBe(false);
  }, 10000);

  test('a single candidate failing does not abort the rest of the probe, and is disclosed via failedOffsets', async () => {
    fetchRouteForecast
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce(routeResult({ summary: { worst_hazard_class: 0, distance_nm: 10, duration_hours: 1 } }));

    const result = await findBetterDeparture('https://api', baseInputs);

    expect(fetchRouteForecast).toHaveBeenCalledTimes(2);
    expect(result.allClear).toBe(true);
    expect(result.offsetHours).toBe(DEPARTURE_PROBE_OFFSETS_HOURS[1]);
    // Regression: the result used to say "best of the offsets checked" with
    // no way to tell a probe that outright failed apart from one that just
    // scored worse — failedOffsets lets callers disclose the difference.
    expect(result.failedOffsets).toEqual([DEPARTURE_PROBE_OFFSETS_HOURS[0]]);
  });

  test('failedOffsets is empty when every probe succeeds', async () => {
    fetchRouteForecast.mockResolvedValueOnce(routeResult({ summary: { worst_hazard_class: 0, distance_nm: 10, duration_hours: 1 } }));

    const result = await findBetterDeparture('https://api', baseInputs);

    expect(result.failedOffsets).toEqual([]);
  });

  test('reports progress with the correct offset/index/total for each candidate checked', async () => {
    fetchRouteForecast.mockResolvedValueOnce(routeResult({ summary: { worst_hazard_class: 0, distance_nm: 10, duration_hours: 1 } }));
    const progress = [];

    await findBetterDeparture('https://api', baseInputs, { onProgress: (p) => progress.push(p) });

    expect(progress).toEqual([{ offsetHours: DEPARTURE_PROBE_OFFSETS_HOURS[0], index: 0, total: DEPARTURE_PROBE_OFFSETS_HOURS.length }]);
  });

  test('rejects an invalid departure time before making any request', async () => {
    await expect(findBetterDeparture('https://api', { ...baseInputs, departureTime: 'not-a-date' }))
      .rejects.toThrow('valid departure time');
    expect(fetchRouteForecast).not.toHaveBeenCalled();
  });
});

describe('advisory brief config builders', () => {
  test('buildRouteAdvisoryBriefConfig produces the route_forecast area shape exportRouteForecastPDF expects', () => {
    const config = buildRouteAdvisoryBriefConfig({
      vesselType: 'small_craft', vesselLabel: 'Small Craft',
      routePoints: [{ lon: 1, lat: 1 }], speedKt: 8, departureTime: 't',
      result: routeResult(), decision: null, provenance: { generatedAt: 'now' },
    });
    expect(config.area.type).toBe('route_forecast');
    expect(config.routeForecast.result).toBeTruthy();
  });

  test('buildScenarioComparisonBriefConfig attaches a derived decision per ready scenario', () => {
    const ready = { id: 'a', name: 'A', vessel: 'small_craft', status: 'ready', forecastResult: routeResult() };
    const draft = { id: 'b', name: 'B', vessel: 'small_craft', status: 'draft', forecastResult: null };

    const config = buildScenarioComparisonBriefConfig({
      scenarios: [ready, draft], recommendedId: 'a', vesselLabelFor: (v) => `Label(${v})`,
    });

    expect(config.area.type).toBe('scenario_comparison');
    expect(config.scenarioComparison.scenarios[0].decision).toBeTruthy();
    expect(config.scenarioComparison.scenarios[0].vesselLabel).toBe('Label(small_craft)');
    expect(config.scenarioComparison.scenarios[1].decision).toBeNull();
    expect(config.scenarioComparison.recommendedId).toBe('a');
  });
});
