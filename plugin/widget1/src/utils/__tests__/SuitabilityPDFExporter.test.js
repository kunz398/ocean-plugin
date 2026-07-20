import {
  assertBoundedStatisticsResponse,
  canonicalSuitabilityBounds,
  computeExceedance,
  deriveDriverForVessel,
  describeDailyTimeline,
  describeForecastShape,
  findMatchingStep,
  findWorstRun,
  formatNumber,
  hasVesselData,
  pointHeatmapCell,
  routeOperationalRecommendation,
  selectDailyTimelineSteps,
  selectHeatmapSteps,
  selectRouteTableRows,
  vesselHeatmapCell,
} from '../SuitabilityPDFExporter';

describe('bounded advisory contract', () => {
  const bounds = { west: -170, south: -19.2, east: -169.7, north: -18.9 };

  test('accepts a finite, ordered current-map bbox', () => {
    expect(canonicalSuitabilityBounds(bounds)).toEqual(bounds);
    expect(canonicalSuitabilityBounds({ ...bounds, east: -171 })).toBeNull();
    expect(canonicalSuitabilityBounds({ ...bounds, north: undefined })).toBeNull();
  });

  test('rejects a backend response that silently ignored current-map bounds', () => {
    expect(() => assertBoundedStatisticsResponse(
      { statistics_basis: 'full_domain', requested_bounds: null, applied_bounds: null },
      bounds,
      'Test endpoint',
    )).toThrow(/did not apply current-map bounds/i);
  });

  test('accepts the bounded backend metadata contract', () => {
    expect(() => assertBoundedStatisticsResponse({
      statistics_basis: 'centroid_filtered_faces',
      requested_bounds: bounds,
      applied_bounds: bounds,
    }, bounds, 'Test endpoint')).not.toThrow();
  });
});

function hourlySteps(count) {
  const start = Date.UTC(2026, 6, 7, 0, 0, 0);
  return Array.from({ length: count }, (_, index) => ({
    time_index: index,
    time: new Date(start + index * 3_600_000).toISOString(),
  }));
}

describe('selectHeatmapSteps', () => {
  test('samples a 72-hour window at roughly 6-hour intervals and keeps endpoints', () => {
    const steps = hourlySteps(73);
    const selected = selectHeatmapSteps(steps, 72);

    expect(selected[0].sourceIndex).toBe(0);
    expect(selected[selected.length - 1].sourceIndex).toBe(72);
    expect(selected.map(s => s.sourceIndex)).toEqual([0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72]);
  });

  test('samples a 7-day window at roughly 12-hour intervals and keeps endpoints', () => {
    const steps = hourlySteps(169);
    const selected = selectHeatmapSteps(steps, 168);

    expect(selected[0].sourceIndex).toBe(0);
    expect(selected[selected.length - 1].sourceIndex).toBe(168);
    expect(selected.map(s => s.sourceIndex)).toEqual([0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132, 144, 156, 168]);
  });

  test('degrades to available sparse timesteps', () => {
    const steps = hourlySteps(3);
    const selected = selectHeatmapSteps(steps, 72);

    expect(selected.map(s => s.sourceIndex)).toEqual([0, 2]);
  });
});

describe('heatmap cells', () => {
  test('maps full-domain vessel cells from warning and caution percentages', () => {
    expect(vesselHeatmapCell({ warning_percent: 25, caution_percent: 0 })).toMatchObject({
      hazard: 2,
      text: '25%',
    });
    expect(vesselHeatmapCell({ warning_percent: 0, caution_percent: 40 })).toMatchObject({
      hazard: 1,
      text: '',
    });
    expect(vesselHeatmapCell({ warning_percent: 0, caution_percent: 0 })).toMatchObject({
      hazard: 0,
      text: '',
    });
  });

  test('maps point cells directly from hazard_class', () => {
    expect(pointHeatmapCell({ hazard_class: 0 })).toMatchObject({ hazard: 0, text: 'OK' });
    expect(pointHeatmapCell({ hazard_class: 1 })).toMatchObject({ hazard: 1, text: 'CAU' });
    expect(pointHeatmapCell({ hazard_class: 2 })).toMatchObject({ hazard: 2, text: 'AVD' });
  });

  test('reports genuinely missing vessel data as unavailable (hazard: null), not a fabricated Suitable', () => {
    // Regression: this used to default a missing cell to hazard 0, painting
    // it the same solid green as a real 0%-Avoid reading — indistinguishable
    // from actual data on the matrix. See NO_DATA_GREY handling in
    // drawHazardHeatmapMatrix, which now checks for hazard === null.
    expect(vesselHeatmapCell({})).toMatchObject({ hazard: null, text: '' });
    expect(vesselHeatmapCell(undefined)).toMatchObject({ hazard: null, text: '' });
    expect(vesselHeatmapCell({ warning_percent: 0, caution_percent: 0 })).toMatchObject({ hazard: 0, text: '' });
  });

  test('reports a missing point step as unavailable (hazard: null), not a fabricated OK', () => {
    expect(pointHeatmapCell({})).toMatchObject({ hazard: null, text: '' });
    expect(pointHeatmapCell(undefined)).toMatchObject({ hazard: null, text: '' });
  });
});

describe('findMatchingStep', () => {
  // Regression test: the landing-area heatmap used to index each row's own
  // step array by the reference row's array position (sourceIndex). Rows are
  // fetched independently per landing point and can have gaps, so a missing
  // step earlier in one row's array used to shift every later reading by one
  // column relative to the heatmap's time labels.
  test('matches by time_index even when a row has a gap earlier in its array', () => {
    const rowWithGap = [
      { time_index: 0, valid_time: '2026-07-07T00:00:00Z', hazard_class: 0 },
      // time_index 1 missing — this row's fetch skipped/failed that step.
      { time_index: 2, valid_time: '2026-07-07T02:00:00Z', hazard_class: 2 },
    ];
    // Heatmap column for time_index 2 lives at array position 1 in this row
    // (because of the gap), not position 2.
    const column = { time_index: 2, time: '2026-07-07T02:00:00Z', sourceIndex: 2 };

    const match = findMatchingStep(rowWithGap, column);
    expect(match.hazard_class).toBe(2);
  });

  test('falls back to nearest valid_time when time_index is absent from the row', () => {
    const rowSteps = [
      { time_index: 5, valid_time: '2026-07-07T05:00:00Z', hazard_class: 1 },
      { time_index: 6, valid_time: '2026-07-07T06:00:00Z', hazard_class: 2 },
    ];
    const column = { time_index: 99, time: '2026-07-07T06:05:00Z' };

    const match = findMatchingStep(rowSteps, column);
    expect(match.hazard_class).toBe(2);
  });

  test('returns null for an empty or missing row', () => {
    expect(findMatchingStep([], { time_index: 0, time: '2026-07-07T00:00:00Z' })).toBeNull();
    expect(findMatchingStep(undefined, { time_index: 0, time: '2026-07-07T00:00:00Z' })).toBeNull();
  });
});

describe('hasVesselData', () => {
  test('distinguishes a genuinely missing vessel from one confirmed at 0%', () => {
    const vessels = { small_craft: { warning_percent: 0, caution_percent: 0 } };
    expect(hasVesselData(vessels, 'small_craft')).toBe(true);
    expect(hasVesselData(vessels, 'larger_vessels')).toBe(false);
    expect(hasVesselData(null, 'small_craft')).toBe(false);
    expect(hasVesselData(undefined, 'small_craft')).toBe(false);
  });

  test('does not coerce explicit null percentages into a real 0% reading', () => {
    const vessels = {
      small_craft: { suitable_percent: null, caution_percent: null, warning_percent: null },
    };
    expect(hasVesselData(vessels, 'small_craft')).toBe(false);
  });
});

describe('deriveDriverForVessel', () => {
  test('returns null for an unknown vessel code', () => {
    expect(deriveDriverForVessel('not_a_vessel', 30, 3)).toBeNull();
  });

  test('attributes the hazard to whichever parameter crosses its threshold further', () => {
    // small_craft: caution wind 15kt/avoid 20kt, caution Hs 1.5m/avoid 2.0m
    expect(deriveDriverForVessel('small_craft', 25, 0)).toBe('wind');
    expect(deriveDriverForVessel('small_craft', 0, 2.5)).toBe('waves');
    expect(deriveDriverForVessel('small_craft', 25, 2.5)).toBe('wind_and_waves');
    expect(deriveDriverForVessel('small_craft', 5, 0.5)).toBe('none');
  });
});

describe('selectDailyTimelineSteps', () => {
  test('returns 6 available daily entries when the forecast horizon covers them', () => {
    const steps = hourlySteps(24 * 8); // 8 days of hourly data
    const daily = selectDailyTimelineSteps(0, steps, 6);

    expect(daily).toHaveLength(6);
    expect(daily.every(d => d.available !== false)).toBe(true);
    expect(daily.every(d => d.role === 'daily')).toBe(true);
  });

  test('marks days beyond the forecast horizon as unavailable instead of guessing', () => {
    const steps = hourlySteps(24 * 2); // only 2 days of data
    const daily = selectDailyTimelineSteps(0, steps, 6);

    expect(daily.filter(d => d.available !== false).length).toBeLessThan(6);
    expect(daily[daily.length - 1]).toMatchObject({ available: false, time_index: null });
  });
});

describe('describeForecastShape', () => {
  test('returns null when there is no time series to describe', () => {
    expect(describeForecastShape([], 'small_craft')).toBeNull();
  });

  test('flags improving conditions when Avoid% drops through the forecast without ever reaching elevated risk', () => {
    const series = [
      { vessels: { small_craft: { warning_percent: 35 } } },
      { vessels: { small_craft: { warning_percent: 20 } } },
      { vessels: { small_craft: { warning_percent: 5 } } },
    ];
    const shape = describeForecastShape(series, 'small_craft');
    expect(shape.text).toMatch(/improve/i);
  });
});

describe('describeDailyTimeline', () => {
  test('returns null with fewer than 2 available data points', () => {
    const stepMeta = [{ available: true }];
    const summaries = [{ vessels: { small_craft: { warning_percent: 10 } } }];
    expect(describeDailyTimeline(stepMeta, summaries, 'small_craft')).toBeNull();
  });

  test('describes steady worsening across shown days', () => {
    const stepMeta = [{ available: true }, { available: true }, { available: true }];
    const summaries = [
      { vessels: { small_craft: { warning_percent: 5 } } },
      { vessels: { small_craft: { warning_percent: 30 } } },
      { vessels: { small_craft: { warning_percent: 40 } } },
    ];
    const result = describeDailyTimeline(stepMeta, summaries, 'small_craft');
    expect(result.text).toMatch(/worsen/i);
  });
});

describe('formatNumber', () => {
  test('reports null/undefined as unavailable, not a fabricated 0', () => {
    // Regression: Number(null) is 0, which is finite — checking
    // Number.isFinite(Number(value)) alone turned a missing reading into a
    // fabricated "0.00", visible as "0.00 m"/"0.0 kt" on an out-of-domain
    // route sample instead of "-".
    expect(formatNumber(null, 2)).toBe('-');
    expect(formatNumber(undefined, 1)).toBe('-');
  });

  test('still formats a real zero as a real zero', () => {
    expect(formatNumber(0, 2)).toBe('0.00');
  });

  test('formats a finite number to the requested digits', () => {
    expect(formatNumber(21.4, 1)).toBe('21.4');
  });

  test('reports NaN as unavailable', () => {
    expect(formatNumber('not-a-number', 1)).toBe('-');
  });
});

describe('computeExceedance', () => {
  const vesselType = 'small_craft'; // cautionWindKt:15, maxWindKt:20, cautionWaveHeightM:1.5, maxWaveHeightM:2.0

  test('returns null when the sample is within the Suitable envelope', () => {
    expect(computeExceedance(vesselType, { wind_speed_kt: 5, wave_height_m: 0.5 })).toBeNull();
  });

  test('returns null for an unknown vessel type', () => {
    expect(computeExceedance('not_a_vessel', { wind_speed_kt: 25, wave_height_m: 3 })).toBeNull();
  });

  test('flags an Avoid-level exceedance and picks the metric that clears its threshold by more', () => {
    const result = computeExceedance(vesselType, { wind_speed_kt: 25, wave_height_m: 1.8 });
    expect(result).toMatchObject({ metric: 'wind', level: 'avoid' });
    expect(result.delta).toBeCloseTo(5, 5); // 25 - 20
  });

  test('flags a Caution-level exceedance when no metric reaches Avoid', () => {
    const result = computeExceedance(vesselType, { wind_speed_kt: 17, wave_height_m: 0.5 });
    expect(result).toMatchObject({ metric: 'wind', level: 'caution' });
    expect(result.delta).toBeCloseTo(2, 5); // 17 - 15
  });

  test('prefers wave when wave clears its Avoid threshold by more than wind clears its own', () => {
    const result = computeExceedance(vesselType, { wind_speed_kt: 20.1, wave_height_m: 3.0 });
    expect(result).toMatchObject({ metric: 'wave', level: 'avoid' });
  });
});

describe('findWorstRun', () => {
  function sample(hazard, etaOffsetMin) {
    return { hazard_class: hazard, eta: new Date(Date.UTC(2026, 6, 7, 0, 0, 0) + etaOffsetMin * 60000).toISOString() };
  }

  test('returns null for an empty or all-unavailable sample list', () => {
    expect(findWorstRun([])).toBeNull();
    expect(findWorstRun([{ hazard_class: null, eta: '2026-07-07T00:00:00Z' }])).toBeNull();
  });

  test('finds the single worst contiguous run, not just the single worst sample', () => {
    const samples = [
      sample(0, 0), sample(0, 20), sample(1, 40), sample(2, 60), sample(2, 80), sample(2, 100), sample(1, 120), sample(0, 140),
    ];
    const run = findWorstRun(samples);
    expect(run.hazard).toBe(2);
    expect(run.startTime).toBe(samples[3].eta);
    expect(run.endTime).toBe(samples[5].eta);
    expect(run.durationHours).toBeCloseTo(40 / 60, 5);
  });

  test('picks the longer run when two runs share the same worst hazard', () => {
    const samples = [
      sample(2, 0), // isolated Avoid blip
      sample(0, 20),
      sample(2, 40), sample(2, 60), sample(2, 80), // longer Avoid run
    ];
    const run = findWorstRun(samples);
    expect(run.startTime).toBe(samples[2].eta);
    expect(run.endTime).toBe(samples[4].eta);
  });
});

describe('selectRouteTableRows', () => {
  function sample(index, hazard) {
    return { sample_index: index, hazard_class: hazard, eta: new Date(Date.UTC(2026, 6, 7, 0, 0, 0) + index * 3600000).toISOString() };
  }

  test('returns every sample unchanged when under the row cap', () => {
    const samples = [sample(0, 0), sample(1, 0), sample(2, 2)];
    expect(selectRouteTableRows(samples, 10)).toEqual(samples);
  });

  test('always pins the first, last, and worst sample when truncating', () => {
    // Worst sample (index 5, Avoid) sits well outside where a naive
    // samples.slice(0, N) would show it — this is the exact bug the review
    // flagged against the old 7-row table.
    const samples = Array.from({ length: 20 }, (_, i) => sample(i, i === 15 ? 2 : 0));
    const rows = selectRouteTableRows(samples, 8);
    expect(rows.length).toBeLessThanOrEqual(8);
    expect(rows[0]).toBe(samples[0]);
    expect(rows[rows.length - 1]).toBe(samples[19]);
    expect(rows).toContainEqual(samples[15]);
  });
});

describe('routeOperationalRecommendation', () => {
  test('a stale departure takes priority over the hazard verdict', () => {
    const text = routeOperationalRecommendation({ hazardAvailable: true, hazard: 0, worstRun: null, routePoints: [], isStaleDeparture: true });
    expect(text).toMatch(/already passed/i);
  });

  test('reports unavailable when the hazard could not be classified', () => {
    const text = routeOperationalRecommendation({ hazardAvailable: false, hazard: null, worstRun: null, routePoints: [], isStaleDeparture: false });
    expect(text).toMatch(/unavailable/i);
  });

  test('an all-clear route reads as a plain go-ahead', () => {
    const text = routeOperationalRecommendation({ hazardAvailable: true, hazard: 0, worstRun: null, routePoints: [], isStaleDeparture: false });
    expect(text).toMatch(/proceed/i);
    expect(text).not.toMatch(/caution|delay/i);
  });

  test('an Avoid verdict names the nearest waypoint to the worst run', () => {
    const routePoints = [{ lon: 0, lat: 0 }, { lon: 1, lat: 1 }, { lon: 2, lat: 2 }];
    const worstRun = {
      hazard: 2,
      startTime: '2026-07-07T01:00:00Z',
      endTime: '2026-07-07T02:00:00Z',
      startSample: { lon: 1.01, lat: 1.01 },
    };
    const text = routeOperationalRecommendation({ hazardAvailable: true, hazard: 2, worstRun, routePoints, isStaleDeparture: false });
    expect(text).toMatch(/delay departure/i);
    expect(text).toMatch(/waypoint 2/i); // index 1, 1-based in the message
  });
});
