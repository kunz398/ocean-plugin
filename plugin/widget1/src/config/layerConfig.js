/**
 * Layer configuration helpers for the Niue dashboard.
 * Trimmed down from widget5's Cook Islands layerConfig.js: only the pieces
 * needed by the inundation threshold/legend system are kept here. Raster
 * source helpers are included for when the Niue inundation raster adapter
 * (see lib/mapLayersConfig.js 'pending-adapter' layer) lands.
 */

import { NIUE_BOUNDS } from '../lib/mapLayersConfig';

// Shared inundation visualization range used across tile rendering, metadata
// fallbacks, and legends so the displayed palette matches the popup values.
export const INUNDATION_VISUAL_RANGE = {
  min: -0.05,
  max: 3.0,
};

export const INUNDATION_VISUAL_COLOR_SCALE_RANGE =
  `${INUNDATION_VISUAL_RANGE.min},${INUNDATION_VISUAL_RANGE.max}`;

export const RASTER_SOURCE_TYPE = 'sfincs-raster';

export const isRasterSourceLayer = (layerConfig) =>
  layerConfig?.sourceType === RASTER_SOURCE_TYPE;

// Niue inundation layer identifier (see lib/mapLayersConfig.js).
export const INUNDATION_LAYER_IDS = ['niue-inundation', 'inundation'];

export const isInundationLayer = (layerValue) => {
  if (!layerValue) return false;
  return INUNDATION_LAYER_IDS.some((id) => layerValue === id || layerValue.endsWith(id));
};

export const LAYER_BOUNDS = {
  'niue-inundation': NIUE_BOUNDS,
};

export const getLayerBounds = (layerValue) => {
  if (!layerValue) return null;
  if (LAYER_BOUNDS[layerValue]) return LAYER_BOUNDS[layerValue];
  for (const key of Object.keys(LAYER_BOUNDS)) {
    if (layerValue.startsWith(`${key}/`) || layerValue.startsWith(key)) {
      return LAYER_BOUNDS[key];
    }
  }
  return null;
};

// Zoom threshold for showing popup instead of bottom canvas for inundation
export const INUNDATION_POPUP_ZOOM_THRESHOLD = 14;
