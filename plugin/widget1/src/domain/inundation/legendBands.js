const X_SST_GRADIENT_RGB = [
  [8,   15,  120],
  [10,  55,  210],
  [0,   130, 225],
  [20,  190, 200],
  [45,  195, 145],
  [90,  195, 70 ],
  [175, 205, 35 ],
  [225, 195, 30 ],
  [230, 115, 20 ],
  [215, 40,  20 ],
  [130, 0,   5  ],
];

const generateGradientBands = (paletteRGB, bands = 250) => {
  const colors = [];
  for (let i = 0; i < bands; i += 1) {
    const normalized = i / (bands - 1);
    const maxIndex = paletteRGB.length - 1;
    const index = normalized * maxIndex;
    const lowerIndex = Math.floor(index);
    const upperIndex = Math.min(Math.ceil(index), maxIndex);
    const fraction = index - lowerIndex;

    const lower = paletteRGB[lowerIndex];
    const upper = paletteRGB[upperIndex];

    const r = Math.round(lower[0] + (upper[0] - lower[0]) * fraction);
    const g = Math.round(lower[1] + (upper[1] - lower[1]) * fraction);
    const b = Math.round(lower[2] + (upper[2] - lower[2]) * fraction);

    colors.push(`rgb(${r}, ${g}, ${b})`);
  }
  return colors;
};

const X_SST_250_BANDS = generateGradientBands(X_SST_GRADIENT_RGB, 250);

export const X_SST_GRADIENT = `linear-gradient(to top, ${X_SST_250_BANDS.map((color, i) =>
  `${color} ${(i / (X_SST_250_BANDS.length - 1) * 100).toFixed(2)}%`
).join(', ')})`;

/**
 * Build a stepped legend config from explicit colorBreaks.
 * colormapFn must be the same function used by the renderer so colours match exactly.
 * Returns the same shape as getLegendConfig so the existing legend JSX works unchanged.
 */
export function buildBreakLegendConfig({ colorBreaks, colorLabels, colorRange, units = 'm', colormapFn }) {
  const { min, max } = colorRange;
  const range = max - min || 1;
  const numBands = colorBreaks.length - 1;

  // One colour per band, sampled at the band's normalised midpoint using the renderer's colormap
  const bandCss = Array.from({ length: numBands }, (_, i) => {
    const mid = (colorBreaks[i] + colorBreaks[i + 1]) / 2;
    const t = Math.max(0, Math.min(1, (mid - min) / range));
    const [r, g, b] = colormapFn ? colormapFn(t) : [128, 128, 128];
    return `rgb(${r},${g},${b})`;
  });

  // Hard-stop CSS gradient: each band occupies its exact fraction of the bar
  const stops = Array.from({ length: numBands }, (_, i) => {
    const s = (((colorBreaks[i]     - min) / range) * 100).toFixed(2);
    const e = (((colorBreaks[i + 1] - min) / range) * 100).toFixed(2);
    return `${bandCss[i]} ${s}% ${e}%`;
  });
  const gradient = `linear-gradient(to top, ${stops.join(', ')})`;

  // Ticks at every break value; tickBands maps each UPPER bound to the band below it.
  // This ensures the swatch at each tick matches the gradient colour just below that tick,
  // and the topmost tick gets a swatch + range label rather than rendering as an orphan.
  const tickBands = {};
  for (let i = 0; i < numBands; i++) {
    tickBands[colorBreaks[i + 1]] = {
      color: bandCss[i],
      label: colorLabels?.[i] ?? `${colorBreaks[i]}–${colorBreaks[i+1]} ${units}`,
    };
  }

  return { gradient, min, max, units, ticks: colorBreaks, tickBands };
}

export const parseLegendColorRange = (rangeString) => {
  if (!rangeString) return null;
  const parts = rangeString.split(',');
  if (parts.length !== 2) return null;
  const min = Number(parts[0]);
  const max = Number(parts[1]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  return { min, max };
};

export const buildInundationLegendBands = ({
  categories,
  minVisibleDepth,
  colorscalerange,
  rasterMinDepth,
  rasterMaxDepth,
}) => {
  const colorRange = parseLegendColorRange(colorscalerange);
  const configuredMin = minVisibleDepth
    ?? colorRange?.min
    ?? rasterMinDepth
    ?? -0.05;
  const configuredMax = colorRange?.max ?? rasterMaxDepth ?? 3.0;

  if (!categories || categories.length < 2) {
    return {
      gradient: X_SST_GRADIENT,
      ticks: [configuredMin, configuredMax],
      tickBands: {},
      gradientMarkers: [],
      min: configuredMin,
      max: configuredMax,
    };
  }

  const firstThreshold = categories[0]?.thresholdM ?? configuredMin;
  const lastThreshold = categories[categories.length - 1]?.thresholdM ?? configuredMax;
  const minVal = Math.min(configuredMin, firstThreshold);
  const upperBound = Math.max(configuredMax, lastThreshold);
  const headroom =
    upperBound === lastThreshold
      ? Math.max(0.05, Math.abs(lastThreshold) * 0.05)
      : 0;
  const maxVal = Number((upperBound + headroom).toFixed(2));
  const span = maxVal - minVal;

  if (span <= 0) {
    return {
      gradient: X_SST_GRADIENT,
      ticks: [minVal, maxVal],
      tickBands: {},
      gradientMarkers: [],
      min: minVal,
      max: maxVal,
    };
  }

  const tickSet = new Set([Number(minVal.toFixed(2)), Number(maxVal.toFixed(2))]);
  categories.forEach((category) => {
    tickSet.add(Number(category.thresholdM.toFixed(2)));
  });
  const ticks = [...tickSet].sort((a, b) => a - b);

  const tickBands = {};
  const gradientMarkers = categories.filter(
    (category) => category.thresholdM > minVal && category.thresholdM < maxVal
  );

  categories.forEach((category) => {
    const key = Number(category.thresholdM.toFixed(2));
    if (tickSet.has(key)) {
      tickBands[key] = category;
    }
  });

  return {
    gradient: X_SST_GRADIENT,
    ticks,
    tickBands,
    gradientMarkers,
    min: minVal,
    max: maxVal,
  };
};
