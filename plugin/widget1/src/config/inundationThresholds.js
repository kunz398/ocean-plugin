import { INUNDATION_VISUAL_RANGE } from './layerConfig';

/**
 * Inundation threshold configuration for the Niue forecast dashboard.
 *
 * Depth bands define how modelled inundation depth (metres) maps to operational
 * severity labels. These defaults reflect best-available knowledge at launch and
 * should be refined as more observed inundation-event data comes in.
 *
 * Schema:
 *   id          — stable identifier; do not change after publication
 *   thresholdM  — lower boundary of this band (metres, ≥ 0)
 *   label       — short classification label (legend + popup)
 *   description — operational impact description for forecasters
 *   color       — 6-digit CSS hex color for legend swatch and popup badge
 */

/** @typedef {{id:string, thresholdM:number, label:string, description:string, color:string}} InundationCategory */

const X_SST_GRADIENT_RGB = [
  [0, 0, 128],
  [0, 60, 200],
  [0, 120, 255],
  [0, 200, 220],
  [100, 255, 100],
  [255, 255, 0],
  [255, 180, 0],
  [255, 100, 0],
  [200, 0, 0],
];

const VIRIDIS_GRADIENT_RGB = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

const CIVIDIS_GRADIENT_RGB = [
  [0, 32, 76],
  [40, 71, 109],
  [85, 104, 121],
  [140, 138, 116],
  [208, 183, 94],
  [253, 234, 69],
];

const TURBO_GRADIENT_RGB = [
  [48, 18, 59],
  [50, 76, 192],
  [18, 123, 216],
  [31, 188, 157],
  [151, 225, 63],
  [253, 197, 39],
  [245, 104, 37],
  [180, 4, 38],
];

const SPECTRAL_GRADIENT_RGB = [
  [94, 79, 162],
  [50, 136, 189],
  [102, 194, 165],
  [171, 221, 164],
  [255, 255, 191],
  [253, 174, 97],
  [244, 109, 67],
  [213, 62, 79],
  [158, 1, 66],
];

export const INUNDATION_PALETTE_OPTIONS = [
  { id: 'x-sst', label: 'x-Sst', description: 'Default SPC inundation palette.' },
  { id: 'viridis', label: 'Viridis', description: 'Perceptually uniform scientific palette.' },
  { id: 'cividis', label: 'Cividis', description: 'Color-vision-friendly and high-contrast.' },
  { id: 'turbo', label: 'Turbo', description: 'High-energy ramp with strong separation.' },
  { id: 'spectral', label: 'Spectral', description: 'Diverging palette for bold contrast.' },
  { id: 'custom', label: 'Custom', description: 'Manual swatch edits; no preset lock.' },
];

const INUNDATION_PALETTES = {
  'x-sst': X_SST_GRADIENT_RGB,
  viridis: VIRIDIS_GRADIENT_RGB,
  cividis: CIVIDIS_GRADIENT_RGB,
  turbo: TURBO_GRADIENT_RGB,
  spectral: SPECTRAL_GRADIENT_RGB,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const rgbToHex = (r, g, b) =>
  `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

const interpolatePaletteColor = (paletteRGB, depthM, minDepth, maxDepth) => {
  const normalized = clamp((depthM - minDepth) / (maxDepth - minDepth || 1), 0, 1);
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

  return rgbToHex(r, g, b);
};

export const getXSstColorAtDepth = (
  depthM,
  minDepth = INUNDATION_VISUAL_RANGE.min,
  maxDepth = INUNDATION_VISUAL_RANGE.max
) => {
  return interpolatePaletteColor(X_SST_GRADIENT_RGB, depthM, minDepth, maxDepth);
};

export const getPaletteColorAtDepth = (
  depthM,
  paletteId = 'x-sst',
  minDepth = INUNDATION_VISUAL_RANGE.min,
  maxDepth = INUNDATION_VISUAL_RANGE.max
) => {
  const palette = INUNDATION_PALETTES[paletteId] || X_SST_GRADIENT_RGB;
  return interpolatePaletteColor(palette, depthM, minDepth, maxDepth);
};

export const applyPaletteToThresholds = (categories, paletteId = 'x-sst') =>
  categories.map((category) => ({
    ...category,
    color: getPaletteColorAtDepth(category.thresholdM, paletteId),
  }));

const LEGACY_THRESHOLD_COLORS = new Set([
  '#e8f5e9',
  '#b3e5fc',
  '#4fc3f7',
  '#0288d1',
  '#01579b',
  '#1a237e',
  '#78909c',
]);

export const DEFAULT_INUNDATION_THRESHOLDS = [
  {
    id: 'niu-dry',
    thresholdM: 0,
    label: 'Dry / Negligible',
    description: 'No surface water; model noise below detection threshold',
    color: getXSstColorAtDepth(0),
  },
  {
    id: 'niu-minor',
    thresholdM: 0.1,
    label: 'Minor Inundation',
    description: 'Shallow ponding on low-lying ground; nuisance-level impact',
    color: getXSstColorAtDepth(0.1),
  },
  {
    id: 'niu-moderate',
    thresholdM: 0.3,
    label: 'Moderate Flooding',
    description: 'Ankle-to-knee depth across roads and low-lying properties',
    color: getXSstColorAtDepth(0.3),
  },
  {
    id: 'niu-significant',
    thresholdM: 0.6,
    label: 'Significant Flooding',
    description: 'Higher modelled inundation depth; review local exposure and impacts',
    color: getXSstColorAtDepth(0.6),
  },
  {
    id: 'niu-severe',
    thresholdM: 1.0,
    label: 'Severe Flooding',
    description: 'Very high modelled inundation depth; major disruption is possible',
    color: getXSstColorAtDepth(1.0),
  },
  {
    id: 'niu-extreme',
    thresholdM: 1.5,
    label: 'Extreme / Critical',
    description: 'Highest modelled depth category; verify against local guidance',
    color: getXSstColorAtDepth(1.5),
  },
  {
    id: 'niu-maximum',
    thresholdM: 3.0,
    label: 'Maximum Display Range',
    description: 'Upper bound of the default inundation legend and display scale',
    color: getXSstColorAtDepth(3.0),
  },
];

export const DEFAULT_INUNDATION_PROFILE_ID = 'niue-default';

const LEGACY_DEFAULT_SIGNATURE = [
  ['niu-dry', 0],
  ['niu-minor', 0.1],
  ['niu-moderate', 0.3],
  ['niu-significant', 0.6],
  ['niu-severe', 1.0],
  ['niu-extreme', 1.5],
];

const isLegacyDefaultThresholdSet = (categories) =>
  categories.length === LEGACY_DEFAULT_SIGNATURE.length &&
  LEGACY_DEFAULT_SIGNATURE.every(([id, threshold], index) => (
    categories[index]?.id === id &&
    Number(categories[index]?.thresholdM) === threshold
  ));

export const normalizeThresholdColors = (categories) =>
  (() => {
    const normalized = categories.map((category) => {
      const color = String(category?.color || '').toLowerCase();
      const thresholdM = Number(category?.thresholdM);
      if (!Number.isFinite(thresholdM)) {
        return category;
      }
      const currentXSstColor = getXSstColorAtDepth(thresholdM).toLowerCase();
      const oldRangeXSstColor = getXSstColorAtDepth(thresholdM, 0, 4).toLowerCase();

      if (
        LEGACY_THRESHOLD_COLORS.has(color) ||
        color === oldRangeXSstColor
      ) {
        return {
          ...category,
          color: currentXSstColor,
        };
      }
      return category;
    });

    if (isLegacyDefaultThresholdSet(normalized)) {
      return deepCloneDefaultThresholds();
    }

    return normalized;
  })();

export const deepCloneThresholds = (categories) =>
  (Array.isArray(categories) ? categories : []).map((category) => ({ ...category }));

const deepCloneDefaultThresholds = () =>
  DEFAULT_INUNDATION_THRESHOLDS.map((category) => ({ ...category }));

const createProfile = ({
  profileId,
  name,
  description,
  scopeLabel,
  status = 'published',
  version = '1.0.0',
  paletteId = 'x-sst',
  minVisibleDepth = 0,
  resampleColors = false,
  categories,
}) => ({
  profileId,
  name,
  description,
  scopeLabel,
  status,
  version,
  paletteId,
  minVisibleDepth,
  resampleColors,
  categories: deepCloneThresholds(categories),
  savedAt: null,
});

export const DEFAULT_INUNDATION_PROFILES = [
  createProfile({
    profileId: DEFAULT_INUNDATION_PROFILE_ID,
    name: 'Niue Default',
    description: 'Baseline hazard depth thresholds for national coastal inundation monitoring.',
    scopeLabel: 'National baseline',
    categories: DEFAULT_INUNDATION_THRESHOLDS,
  }),
];

export const deepCloneDefaultProfiles = () =>
  DEFAULT_INUNDATION_PROFILES.map((profile) => ({
    ...profile,
    categories: deepCloneThresholds(profile.categories),
  }));

/** Increment when the object shape changes in a breaking way. */
export const THRESHOLD_SCHEMA_VERSION = 1;

/**
 * Returns the severity category for a given depth value.
 * Always returns the highest matching category (last category whose thresholdM ≤ depth).
 *
 * @param {InundationCategory[]} categories - Sorted ascending by thresholdM
 * @param {number} depthM
 * @returns {InundationCategory|null}
 */
export const classifyDepth = (categories, depthM) => {
  if (!Array.isArray(categories) || !Number.isFinite(depthM)) return null;
  let match = null;
  for (const cat of categories) {
    if (depthM >= cat.thresholdM) match = cat;
  }
  return match;
};

/**
 * Validates a threshold array. Returns a list of human-readable error strings.
 * An empty array means the configuration is valid.
 *
 * @param {InundationCategory[]} categories
 * @returns {string[]}
 */
export const validateThresholds = (categories) => {
  const errors = [];

  if (!Array.isArray(categories) || categories.length < 2) {
    errors.push('At least two threshold categories are required.');
    return errors;
  }

  categories.forEach((cat, i) => {
    if (!cat.id) errors.push(`Row ${i + 1}: missing id.`);
    if (!cat.label?.trim()) errors.push(`Row ${i + 1}: label cannot be empty.`);
    if (typeof cat.thresholdM !== 'number' || !Number.isFinite(cat.thresholdM)) {
      errors.push(`Row ${i + 1} (${cat.label || '?'}): depth must be a number.`);
    } else if (cat.thresholdM < 0) {
      errors.push(`Row ${i + 1} (${cat.label}): depth cannot be negative.`);
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(cat.color)) {
      errors.push(`Row ${i + 1} (${cat.label || '?'}): color must be a 6-digit hex value (e.g. #0288d1).`);
    }
    if (i > 0) {
      const prev = categories[i - 1];
      if (
        typeof cat.thresholdM === 'number' &&
        typeof prev.thresholdM === 'number' &&
        cat.thresholdM <= prev.thresholdM
      ) {
        errors.push(
          `Row ${i + 1} (${cat.label}): depth ${cat.thresholdM} m must exceed the previous band (${prev.thresholdM} m).`
        );
      }
    }
  });

  return errors;
};
