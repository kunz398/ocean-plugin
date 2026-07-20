import { buildInundationLegendBands, parseLegendColorRange, X_SST_GRADIENT } from '../legendBands';

describe('legendBands', () => {
  test('parses color scale ranges', () => {
    expect(parseLegendColorRange('0,3')).toEqual({ min: 0, max: 3 });
    expect(parseLegendColorRange('bad')).toBeNull();
  });

  test('builds inundation legend markers from thresholds', () => {
    const result = buildInundationLegendBands({
      categories: [
        { id: 'a', thresholdM: 0, color: '#000000' },
        { id: 'b', thresholdM: 0.5, color: '#111111' },
        { id: 'c', thresholdM: 1.0, color: '#222222' },
      ],
      minVisibleDepth: 0.02,
      colorscalerange: '0,1',
      rasterMinDepth: 0,
      rasterMaxDepth: 1,
    });

    expect(result.gradient).toBe(X_SST_GRADIENT);
    expect(result.min).toBe(0);
    expect(result.max).toBeGreaterThan(1);
    expect(result.ticks).toContain(0.5);
    expect(result.tickBands[0.5].id).toBe('b');
    expect(result.gradientMarkers).toHaveLength(2);
    expect(result.gradientMarkers[0].id).toBe('b');
    expect(result.gradientMarkers[1].id).toBe('c');
  });
});
