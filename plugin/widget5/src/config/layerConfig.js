/**
 * Layer Configuration for Cook Islands Dashboard
 * Centralizes layer-specific settings for consistency across components
 */

// Inundation layer identifiers - exact match to avoid false positives
export const INUNDATION_LAYER_IDS = [
  'hmax',           // SFINCS maximum water depth (THREDDS)
  'H_max',          // Legacy capitalized variant (deprecated)
  'raro_inun/Band1',
  'raro_inun'
];

// Shared inundation visualization range used across tile rendering, metadata fallbacks,
// and legends so the displayed palette matches the popup values.
export const INUNDATION_VISUAL_RANGE = {
  min: -0.05,
  max: 3.0
};

export const INUNDATION_VISUAL_COLOR_SCALE_RANGE =
  `${INUNDATION_VISUAL_RANGE.min},${INUNDATION_VISUAL_RANGE.max}`;

export const RASTER_SOURCE_TYPE = 'sfincs-raster';

/**
 * Check if a layer value corresponds to an inundation layer
 * Uses exact matching against known inundation layer identifiers
 * @param {string} layerValue - The layer value to check
 * @returns {boolean} True if the layer is an inundation layer
 */
export const isInundationLayer = (layerValue) => {
  if (!layerValue) return false;
  return INUNDATION_LAYER_IDS.some(id => layerValue === id || layerValue.endsWith(id));
};

export const isRasterSourceLayer = (layerConfig) =>
  layerConfig?.sourceType === RASTER_SOURCE_TYPE;

// Layer bounds for auto-zoom functionality
export const LAYER_BOUNDS = {
  // Zarr-based layers (new)
  'sfincs-inundation': {
    southWest: [-21.282, -159.838],
    northEast: [-21.191, -159.717],
  },
  'swan-rarotonga': {
    southWest: [-21.9, -163.0],
    northEast: [-8.9, -156.0],
  },
  'mean-wave-period': {
    southWest: [-21.9, -163.0],
    northEast: [-8.9, -156.0],
  },
  'peak-wave-period': {
    southWest: [-21.9, -163.0],
    northEast: [-8.9, -156.0],
  },
  // Rarotonga SFINCS inundation layer bounds (THREDDS - actual data extent from GetCapabilities)
  'hmax': {
    southWest: [-21.281671213355985, -159.83717346191406],
    northEast: [-21.19118441998148, -159.71783447265625]
  },
  'H_max': {
    southWest: [-21.281671213355985, -159.83717346191406],
    northEast: [-21.19118441998148, -159.71783447265625]
  },
  // Rarotonga inundation layer bounds (legacy ncWMS)
  'raro_inun/Band1': {
    southWest: [-21.28, -159.85],
    northEast: [-21.17, -159.70]
  },
  'raro_inun': {
    southWest: [-21.28, -159.85],
    northEast: [-21.17, -159.70]
  }
};

/**
 * Get bounds for a layer if available
 * Uses exact matching first, then checks for parent key matching
 * @param {string} layerValue - The layer value
 * @returns {Object|null} Bounds object with southWest and northEast, or null
 */
export const getLayerBounds = (layerValue) => {
  if (!layerValue) return null;
  
  // Check for exact match first
  if (LAYER_BOUNDS[layerValue]) {
    return LAYER_BOUNDS[layerValue];
  }
  
  // Check if the layer value starts with a known parent key (e.g., 'raro_inun/Band1' starts with 'raro_inun')
  for (const key of Object.keys(LAYER_BOUNDS)) {
    if (layerValue.startsWith(key + '/') || layerValue.startsWith(key)) {
      return LAYER_BOUNDS[key];
    }
  }
  
  return null;
};

// Zoom threshold for showing popup instead of bottom canvas for inundation
export const INUNDATION_POPUP_ZOOM_THRESHOLD = 14;
