import {
  buildRouteForecastPayload,
  normalizeRouteForecastResponse,
  parseAsUtcWallClock,
  parseRouteFile,
  parseRouteFileText,
  routeSamplesToSegmentFeatures,
} from '../routeForecastService';

describe('parseAsUtcWallClock', () => {
  // Assertions compare toISOString()/getTime() output, which is always UTC
  // regardless of the test runner's own local timezone — a TZ-dependent
  // assertion here would risk passing by accident on a UTC CI machine while
  // the underlying bug (browser-local interpretation of an undesignated
  // datetime-local string) stays broken for every non-UTC user.
  test('treats an undesignated datetime-local string as UTC wall-clock, not local time', () => {
    expect(parseAsUtcWallClock('2026-07-14T06:00').toISOString()).toBe('2026-07-14T06:00:00.000Z');
  });

  test('leaves an already-designated timestamp untouched', () => {
    expect(parseAsUtcWallClock('2026-07-14T06:00:00Z').toISOString()).toBe('2026-07-14T06:00:00.000Z');
    expect(parseAsUtcWallClock('2026-07-14T06:00:00+12:00').getTime())
      .toBe(new Date('2026-07-14T06:00:00+12:00').getTime());
  });

  test('returns null for missing input', () => {
    expect(parseAsUtcWallClock('')).toBeNull();
    expect(parseAsUtcWallClock(null)).toBeNull();
    expect(parseAsUtcWallClock(undefined)).toBeNull();
  });
});

describe('routeForecastService', () => {
  test('builds the backend route forecast payload', () => {
    const payload = buildRouteForecastPayload({
      vessel: 'small_craft',
      departureTime: '2026-07-09T18:00:00Z',
      speedKt: 8,
      routePoints: [
        { lon: -169.9, lat: -19.1 },
        { lng: -169.8, lat: -19.0 },
      ],
    });

    expect(payload).toEqual({
      vessel: 'small_craft',
      departure_time: '2026-07-09T18:00:00.000Z',
      speed_kt: 8,
      sample_spacing_nm: 1,
      route: [[-169.9, -19.1], [-169.8, -19.0]],
    });
  });

  test('treats a bare datetime-local departureTime (no timezone designator) as UTC, not the runner local time', () => {
    // This is the exact string shape a <input type="datetime-local"> sends
    // via routeDepartureTime — regression test for the timezone bug where
    // this path (unlike scenarioService's toComparableMs) used to hand a
    // bare string straight to new Date(), interpreting it in whatever
    // timezone the browser happened to be in instead of UTC.
    const payload = buildRouteForecastPayload({
      vessel: 'small_craft',
      departureTime: '2026-07-09T18:00',
      speedKt: 8,
      routePoints: [{ lon: -169.9, lat: -19.1 }, { lon: -169.8, lat: -19.0 }],
    });
    expect(payload.departure_time).toBe('2026-07-09T18:00:00.000Z');
  });

  test('truncating an over-long route preserves the destination instead of silently dropping it', () => {
    // Regression: a plain slice(0, MAX_ROUTE_POINTS) keeps the first 500
    // points and drops everything after — including the actual destination
    // on a long imported GPX track, with the forecast then modeling a route
    // that never reaches where the vessel is actually going.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const longRoute = Array.from({ length: 600 }, (_, i) => ({ lon: -170 + i * 0.001, lat: -19 }));
    const destination = { lon: -169.123, lat: -18.5 };
    const payload = buildRouteForecastPayload({
      vessel: 'small_craft',
      departureTime: '2026-07-09T18:00:00Z',
      speedKt: 8,
      routePoints: [...longRoute, destination],
    });
    expect(payload.route).toHaveLength(500);
    expect(payload.route[payload.route.length - 1]).toEqual([destination.lon, destination.lat]);
    warnSpy.mockRestore();
  });

  test('rejects routes with fewer than two points', () => {
    expect(() => buildRouteForecastPayload({
      vessel: 'small_craft',
      departureTime: '2026-07-09T18:00:00Z',
      speedKt: 8,
      routePoints: [{ lon: -169.9, lat: -19.1 }],
    })).toThrow('at least two route points');
  });

  test('parses GeoJSON LineString routes', () => {
    const points = parseRouteFileText(JSON.stringify({
      type: 'LineString',
      coordinates: [[-169.9, -19.1], [-169.8, -19.0]],
    }), 'route.geojson');

    expect(points).toEqual([
      { lon: -169.9, lat: -19.1 },
      { lon: -169.8, lat: -19.0 },
    ]);
  });

  test('parses GPX track routes', () => {
    const points = parseRouteFileText(`
      <gpx><trk><trkseg>
        <trkpt lat="-19.1" lon="-169.9" />
        <trkpt lat="-19.0" lon="-169.8" />
      </trkseg></trk></gpx>
    `, 'route.gpx');

    expect(points).toEqual([
      { lon: -169.9, lat: -19.1 },
      { lon: -169.8, lat: -19.0 },
    ]);
  });

  test('imports a GeoJSON file object from the route import control', async () => {
    const file = {
      name: 'imported-route.geojson',
      text: jest.fn().mockResolvedValue(JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [-170, -19] } },
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [[-169.95, -19.12], [-169.9, -19.08], [-169.86, -19.04]],
            },
          },
        ],
      })),
    };

    await expect(parseRouteFile(file)).resolves.toEqual([
      { lon: -169.95, lat: -19.12 },
      { lon: -169.9, lat: -19.08 },
      { lon: -169.86, lat: -19.04 },
    ]);
    expect(file.text).toHaveBeenCalledTimes(1);
  });

  test('imports a GPX route file object using rtept fallback', async () => {
    const file = {
      name: 'imported-route.gpx',
      text: jest.fn().mockResolvedValue(`
        <gpx><rte>
          <rtept lat="-19.12" lon="-169.95" />
          <rtept lat="-19.08" lon="-169.90" />
        </rte></gpx>
      `),
    };

    await expect(parseRouteFile(file)).resolves.toEqual([
      { lon: -169.95, lat: -19.12 },
      { lon: -169.9, lat: -19.08 },
    ]);
  });

  test('rejects imported routes with fewer than two valid coordinates', async () => {
    const file = {
      name: 'bad-route.geojson',
      text: jest.fn().mockResolvedValue(JSON.stringify({
        type: 'LineString',
        coordinates: [[-169.9, -19.1]],
      })),
    };

    await expect(parseRouteFile(file)).rejects.toThrow('at least two valid coordinates');
  });

  test('normalizes route forecast responses and derives missing recommendation', () => {
    const result = normalizeRouteForecastResponse({
      samples: [
        { lon: -169.9, lat: -19.1, hazard_class: 0 },
        { lon: -169.8, lat: -19.0, hazard_class: 2 },
      ],
    });

    expect(result.summary).toMatchObject({
      worst_hazard_class: 2,
      recommendation: 'Avoid',
    });
    expect(result.samples[1]).toMatchObject({
      sample_index: 1,
      hazard_label: 'Avoid',
    });
  });

  // Regression test: confirmed live against the real backend that its own
  // hazard_label/recommendation strings say "Warning" for hazard_class 2,
  // not "Avoid" like the rest of this app (map legend, PDF exporter). The
  // frontend must compute the label from hazard_class itself rather than
  // trusting whatever string the backend happens to send, or this
  // inconsistency reappears silently for every real API response (the
  // backend always populates these fields for available samples, so a
  // fallback-only fix is invisible in production).
  test('prefers the canonical label over the backend\'s own hazard_label/recommendation strings', () => {
    const result = normalizeRouteForecastResponse({
      samples: [
        { lon: -169.9, lat: -19.1, hazard_class: 2, hazard_label: 'Warning' },
      ],
      summary: { worst_hazard_class: 2, recommendation: 'Warning' },
    });

    expect(result.samples[0].hazard_label).toBe('Avoid');
    expect(result.summary.recommendation).toBe('Avoid');
  });

  // Regression test: Number(null) === 0 in JS, so the old
  // `Number.isFinite(Number(x)) ? Number(x) : fallback` idiom silently
  // turned the backend's explicit hazard_class: null (out-of-domain sample)
  // into hazard_class: 0 ("Suitable") — a route leaving the model domain
  // would have rendered as a green "safe" segment on the map.
  test('keeps an unavailable sample/segment null instead of coercing to Suitable, alongside a real 0', () => {
    const result = normalizeRouteForecastResponse({
      samples: [
        { lon: -169.9, lat: -19.1, hazard_class: 0, available: true },
        {
          lon: -160.0, lat: -19.0, hazard_class: null, hazard_label: null,
          available: false, unavailable_reason: 'outside suitability model domain',
        },
      ],
      segments: [
        { from_sample_index: 0, to_sample_index: 1, hazard_class: null, available: false },
      ],
    });

    // The real 0 ("Suitable") sample must pass through untouched...
    expect(result.samples[0].hazard_class).toBe(0);
    // ...and must not be confused with the genuinely missing one.
    expect(result.samples[1].hazard_class).toBeNull();
    expect(result.samples[1].hazard_label).toBe('Unavailable');
    expect(result.segments[0].hazard_class).toBeNull();
    expect(result.segments[0].available).toBe(false);
  });

  // Matches the real backend invariant: worst_hazard_class only stays null
  // when zero samples were in-domain/available at all.
  test('leaves worst_hazard_class null (not Suitable) when every sample is unavailable', () => {
    const result = normalizeRouteForecastResponse({
      samples: [
        { lon: -160.0, lat: -19.0, hazard_class: null, available: false },
        { lon: -160.1, lat: -19.1, hazard_class: null, available: false },
      ],
      summary: { worst_hazard_class: null, recommendation: 'Unavailable' },
    });

    expect(result.summary.worst_hazard_class).toBeNull();
    expect(result.summary.recommendation).toBe('Unavailable');
  });

  test('converts samples into fallback segment features', () => {
    const features = routeSamplesToSegmentFeatures({
      samples: [
        { lon: -169.9, lat: -19.1, hazard_class: 0 },
        { lon: -169.8, lat: -19.0, hazard_class: 1 },
      ],
    });

    expect(features).toHaveLength(1);
    expect(features[0].properties.hazardClass).toBe(1);
  });

  test('marks a fallback segment unavailable (not Suitable) when either endpoint is unavailable', () => {
    const features = routeSamplesToSegmentFeatures({
      samples: [
        { lon: -169.9, lat: -19.1, hazard_class: 0, available: true },
        { lon: -160.0, lat: -19.0, hazard_class: null, available: false },
      ],
    });

    expect(features).toHaveLength(1);
    expect(features[0].properties.hazardClass).toBeNull();
    expect(features[0].properties.available).toBe(false);
  });
});
