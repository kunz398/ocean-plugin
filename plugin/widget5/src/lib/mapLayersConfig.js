const SFINCS_API_BASE = (process.env.REACT_APP_SFINCS_API_BASE || 'https://ocean-zarr.spc.int').replace(/\/+$/, '');
// SWAN_UGRID.zarr used to be pushed to Wasabi (spc-zarr-file/rarotonga_ugrid.zarr) and
// read directly from there. The pipeline's Wasabi upload step is now disabled — the wave
// Zarr only reaches THREDDS/zarr-api's bind-mounted data dir, served live by zarr-api's
// /zarr static route (confirmed: /zarr/SWAN_UGRID.zarr/.zmetadata returns 200 in prod).
// The old rarotonga_ugrid.zarr symlink path predates the container bind-mount deployment
// and now 400s — do not reintroduce it as a fallback.
const WAVE_ZARR_BASE = (process.env.REACT_APP_WAVE_ZARR_BASE_URL || `${SFINCS_API_BASE}/zarr`).replace(/\/+$/, '');
// Relative paths (starting with /) need the current origin AND the app's public
// path prefix (process.env.PUBLIC_URL, from package.json's "homepage") prepended.
// This app is served under /widget5/, and both the dev server and production
// only serve public/ assets under that prefix — window.location.origin alone
// resolves to the site root and 404s (silently falling back to index.html),
// which MapLibre can't decode as an image.
function resolvePublicAssetUrl(rawPath) {
  if (!rawPath) return '';
  if (rawPath.startsWith('http')) return rawPath;
  return `${window.location.origin}${process.env.PUBLIC_URL || ''}${rawPath}`;
}

const _DEM_TILES_RAW = (process.env.REACT_APP_RAROTONGA_DEM_TILES || '').trim();
const RAROTONGA_DEM_TILES = resolvePublicAssetUrl(_DEM_TILES_RAW);

const _ORTHO_2018_TILES_RAW = (process.env.REACT_APP_RAROTONGA_ORTHO_2018_TILES || '/imagery/rarotonga_2018/{z}/{x}/{y}.png').trim();
const RAROTONGA_ORTHO_2018_TILES = resolvePublicAssetUrl(_ORTHO_2018_TILES_RAW);

const COOK_ISLANDS_WAVE_BOUNDS = {
  southWest: [-21.9, -163.0],
  northEast: [-8.9,  -156.0],
};

const RAROTONGA_INUNDATION_BOUNDS = {
  southWest: [-21.282, -159.838],
  northEast: [-21.191, -159.717],
};

// The DEM tile pyramid has two different real extents depending on zoom:
// z9-16 fully cover a wide ~2.2°x2.1° box around Rarotonga (verified zero
// holes — legitimate, mostly-flat surrounding ocean), while z17-18 only have
// real high-detail data for the small island footprint itself. `bounds` must
// use the WIDE extent — using the tight island-only box here previously cut
// off the legitimate low-zoom ocean coverage, leaving MapLibre with no
// terrain data around the island and a placeholder hatch pattern instead of
// flat sea. The wide box still stops MapLibre from requesting tiles for
// genuinely far-away locations (the original "InvalidStateError: source
// image could not be decoded" bug from unbounded requests).
const RAROTONGA_DEM_BOUNDS = [-160.90000000000001, -22.24998279644920, -158.70006637645625, -20.15000000000000];

export const MAP_TERRAIN_CONFIG = {
  demSourceId: 'rarotonga-dem',
  hillshadeLayerId: 'rarotonga-dem-hillshade',
  tiles: RAROTONGA_DEM_TILES ? [RAROTONGA_DEM_TILES] : [],
  bounds: RAROTONGA_DEM_BOUNDS,
  encoding: process.env.REACT_APP_RAROTONGA_DEM_ENCODING || 'terrarium',
  tileSize: Number(process.env.REACT_APP_RAROTONGA_DEM_TILE_SIZE || 256),
  maxzoom: Number(process.env.REACT_APP_RAROTONGA_DEM_MAXZOOM || 14),
  exaggeration: Number(process.env.REACT_APP_RAROTONGA_TERRAIN_EXAGGERATION ?? 0.85),
  attribution: process.env.REACT_APP_RAROTONGA_DEM_ATTRIBUTION || '',
};

export const FLOOD_3D_CONFIG = {
  elevationScale: 6,
  opacity: 0.8,
  minDepth: 0.05,
  available: true,
};

// 0.5 m/px aerial survey (31/05/2018), reprojected + tiled from GISDATA/.../Rarotonga/SAT/2018.
// Shown only over its own footprint at high zoom; Esri World Imagery covers everywhere else
// and any zoom below minzoom, so this supplements rather than replaces the base imagery.
export const RAROTONGA_ORTHO_2018_CONFIG = {
  sourceId: 'rarotonga-ortho-2018',
  layerId: 'rarotonga-ortho-2018',
  tiles: [RAROTONGA_ORTHO_2018_TILES],
  tileSize: 256,
  minzoom: 13,
  maxzoom: 18,
  bounds: [-159.8361562, -21.2803793, -159.7182127, -21.1930325],
  attribution: process.env.REACT_APP_RAROTONGA_ORTHO_2018_ATTRIBUTION || 'Aerial survey 2018',
};

const COMMON_SWAN_LAYER = {
  type: 'ugrid',
  datasetName: 'SWAN_UGRID.zarr',
  zarrBaseUrl: WAVE_ZARR_BASE,
  ugridApiBase: SFINCS_API_BASE,
  bounds: COOK_ISLANDS_WAVE_BOUNDS,
  metadata: {
    model: 'SWAN',
    grid: 'UGRID',
    sourceLabel: 'SPC ocean forecast',
    showRunTime: true,
    showValidTime: true,
  },
};

export const MAP_LAYERS = [
  {
    ...COMMON_SWAN_LAYER,
    id: 'swan-rarotonga',
    value: 'swan-rarotonga',
    label: 'Significant Wave Height',

    variable: 'hs',
    directionVariable: 'dirm',
    directionConvention: 'coming_from',

    colormap: 'x-sst',
    colorMode: 'fixed-breaks',
    numColorBands: 10,
    colorBreaks: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0],
    colorLabels: [
      '0–0.5 m', '0.5–1.0 m', '1.0–1.5 m', '1.5–2.0 m', '2.0–2.5 m',
      '2.5–3.0 m', '3.0–3.5 m', '3.5–4.0 m', '4.0–4.5 m', '4.5–5.0 m',
    ],
    colorRange: { min: 0, max: 5 },
    units: 'm',
    legendNote: 'Fixed scale. Colours are comparable across all forecast hours.',

    showDirectionArrows: true,
    minArrowZoom: 0,
    arrowStride: 80,
    arrowLegendLabel: 'Arrows show where waves are travelling. Larger arrows indicate higher waves.',
    arrowSize: 18,
    arrowMinSize: 13,
    arrowMaxSize: 24,
    arrowMagnitudeRef: 3.5,
    arrowColor: [255, 255, 255],
    arrowColorMode: 'neutral',
    minArrowMagnitude: 0.5,
    arrowDensityByZoom: [
      { zoom: 5,  stride: 90 },
      { zoom: 6,  stride: 90 },
      { zoom: 7,  stride: 80 },
      { zoom: 8,  stride: 75 },
      { zoom: 9,  stride: 55 },
      { zoom: 10, stride: 48 },
      { zoom: 11, stride: 40 },
      { zoom: 12, stride: 34 },
    ],

    contours: {
      enabled: true,
      visibleByDefault: false,
      levels: [1.0, 1.5, 2.0, 2.5, 3.0, 4.0],
      majorLevels: [2.0, 3.0],
      minZoom: 0,
      majorOnlyBelowZoom: 0,
      labelMinZoom: 7,
      units: 'm',
      labelDecimalPlaces: 1,
      legendNote: 'Bold contours mark advisory thresholds: 2 m small craft caution and 3 m hazardous seas.',
      style: {
        minorWidth: 1,
        majorWidth: 2,
        minorOpacity: 0.55,
        majorOpacity: 0.85,
        haloWidth: 2,
        haloOpacity: 0.4,
      },
    },

    advisoryRules: [
      { id: 'small-craft-caution', label: 'Small craft caution', variable: 'hs', operator: '>=', value: 2.0, severity: 'warning' },
      { id: 'hazardous-seas',      label: 'Hazardous seas',      variable: 'hs', operator: '>=', value: 3.0, severity: 'danger'  },
    ],

    pointVariables: [
      { name: 'hs',       label: 'Significant wave height',    units: 'm' },
      { name: 'dirm',     label: 'Mean wave direction',        units: '°', isDirection: true },
      { name: 'tm02',     label: 'Mean wave period',           units: 's' },
      { name: 'tpeak',    label: 'Peak wave period',           units: 's' },
      { name: 'dirp',     label: 'Peak wave direction',        units: '°', isDirection: true },
      { name: 'hs_p1',    label: 'Primary swell height',       units: 'm' },
      { name: 'tp_p1',    label: 'Primary swell period',       units: 's' },
      { name: 'dirp_p1',  label: 'Primary swell direction',    units: '°', isDirection: true },
      { name: 'hs_p2',    label: 'Secondary swell height',     units: 'm' },
      { name: 'tp_p2',    label: 'Secondary swell period',     units: 's' },
      { name: 'dirp_p2',  label: 'Secondary swell direction',  units: '°', isDirection: true },
      { name: 'hs_p3',    label: 'Tertiary swell height',      units: 'm' },
      { name: 'tp_p3',    label: 'Tertiary swell period',      units: 's' },
      { name: 'dirp_p3',  label: 'Tertiary swell direction',   units: '°', isDirection: true },
      { name: 'transp_x', label: 'Wave energy transport (X)',  units: 'W/m' },
      { name: 'transp_y', label: 'Wave energy transport (Y)',  units: 'W/m' },
    ],

    description: 'Significant wave height — SWAN UGRID model',
  },

  {
    ...COMMON_SWAN_LAYER,
    id: 'mean-wave-period',
    value: 'tm02',
    label: 'Mean Wave Period',

    variable: 'tm02',
    colormap: 'spectral',
    colorMode: 'fixed-breaks',
    colorBreaks: [0, 5, 7, 9, 11, 13, 16, 20],
    colorLabels: [
      'Wind chop: 0–5 s',
      'Short swell: 5–7 s',
      'Moderate: 7–9 s',
      'Moderate-long: 9–11 s',
      'Long: 11–13 s',
      'Very long: 13–16 s',
      'Extreme: 16–20 s',
    ],
    colorRange: { min: 0, max: 20 },
    units: 's',
    legendNote: 'Mean energy period. Longer values indicate more powerful swell.',

    contours: {
      enabled: true,
      visibleByDefault: false,
      levels: [5, 7, 9, 11, 13],
      majorLevels: [7, 11],
      minZoom: 0,
      majorOnlyBelowZoom: 0,
      labelMinZoom: 7,
      units: 's',
      labelDecimalPlaces: 0,
      legendNote: 'Bold contours at 7 s and 11 s mark key transitions from short swell to long-period swell.',
      style: {
        minorWidth: 1,
        majorWidth: 2,
        minorOpacity: 0.55,
        majorOpacity: 0.85,
        haloWidth: 2,
        haloOpacity: 0.4,
      },
    },

    description: 'Mean wave period — SWAN UGRID model',
  },

  {
    ...COMMON_SWAN_LAYER,
    id: 'peak-wave-period',
    value: 'tpeak',
    label: 'Peak Wave Period',

    variable: 'tpeak',
    colormap: 'magma',
    colorMode: 'fixed-breaks',
    colorBreaks: [0, 6, 8, 10, 12, 14, 17, 22],
    colorLabels: [
      'Short: 0–6 s',
      'Short swell: 6–8 s',
      'Moderate: 8–10 s',
      'Energetic: 10–12 s',
      'Long period: 12–14 s',
      'Very long: 14–17 s',
      'Extreme swell: 17–22 s',
    ],
    colorRange: { min: 0, max: 22 },
    units: 's',
    legendNote: 'Dominant swell period. Values above 14 s indicate powerful long-period swell.',

    contours: {
      enabled: true,
      visibleByDefault: false,
      levels: [6, 8, 10, 12, 14],
      majorLevels: [8, 12],
      minZoom: 0,
      majorOnlyBelowZoom: 0,
      labelMinZoom: 7,
      units: 's',
      labelDecimalPlaces: 0,
      legendNote: 'Bold contours at 8 s and 12 s mark key thresholds for swell energy and surf impact.',
      style: {
        minorWidth: 1,
        majorWidth: 2,
        minorOpacity: 0.55,
        majorOpacity: 0.85,
        haloWidth: 2,
        haloOpacity: 0.4,
      },
    },

    description: 'Peak wave period — SWAN UGRID model',
  },

  {
    id: 'sfincs-inundation',
    value: 'sfincs-inundation',
    label: 'Rarotonga Inundation',

    type: 'sfincs-raster',
    sourceType: 'sfincs-raster',
    apiBase: SFINCS_API_BASE,

    units: 'm',
    colorMode: 'fixed-breaks',
    colorRange: { min: 0.05, max: 3.0 },
    colorBreaks: [0.05, 0.1, 0.3, 0.5, 1.0, 2.0, 3.0],
    colorLabels: [
      'Trace: 0.05–0.1 m',
      'Shallow: 0.1–0.3 m',
      'Moderate: 0.3–0.5 m',
      'Deep: 0.5–1.0 m',
      'Very deep: 1.0–2.0 m',
      'Extreme: 2.0–3.0 m',
    ],
    legendNote: 'Only inundation depths above 0.05 m are shown.',

    advisoryRules: [
      { id: 'minor-inundation',     label: 'Minor inundation',     variable: 'depth', operator: '>=', value: 0.1, severity: 'watch'   },
      { id: 'dangerous-inundation', label: 'Dangerous inundation', variable: 'depth', operator: '>=', value: 0.5, severity: 'warning' },
    ],

    description: 'SFINCS model inundation depth — Rarotonga',
    bounds: RAROTONGA_INUNDATION_BOUNDS,
  },
];

export function findLayerById(id) {
  return MAP_LAYERS.find((l) => l.id === id || l.value === id) ?? null;
}

// Development-only config validation — catches mismatches before they silently break the map.
if (process.env.NODE_ENV === 'development') {
  const errors = MAP_LAYERS.flatMap((layer) => {
    const e = [];
    if (!layer.id)    e.push(`Layer missing id`);
    if (!layer.value) e.push(`Layer ${layer.id}: missing value`);
    if (!layer.type)  e.push(`Layer ${layer.id}: missing type`);
    if (layer.colorBreaks && layer.colorLabels) {
      const expected = layer.colorBreaks.length - 1;
      if (layer.colorLabels.length !== expected)
        e.push(`Layer ${layer.id}: ${layer.colorLabels.length} colorLabels but expected ${expected}`);
    }
    if (layer.dynamicColorRange && layer.colorBreaks)
      e.push(`Layer ${layer.id}: has both dynamicColorRange and colorBreaks — check intended colour mode`);
    if (layer.directionVariable && !layer.directionConvention)
      e.push(`Layer ${layer.id}: has directionVariable but no directionConvention`);
    if (layer.colorMode === 'fixed-breaks' && !layer.colorBreaks)
      e.push(`Layer ${layer.id}: colorMode is fixed-breaks but colorBreaks is missing`);
    if (layer.colorBreaks && layer.colorRange) {
      const b0 = layer.colorBreaks[0];
      const bN = layer.colorBreaks[layer.colorBreaks.length - 1];
      if (layer.colorRange.min !== b0 || layer.colorRange.max !== bN)
        e.push(`Layer ${layer.id}: colorRange ${layer.colorRange.min}–${layer.colorRange.max} does not match colorBreaks ${b0}–${bN}`);
    }
    if (Array.isArray(layer.arrowDensityByZoom)) {
      const seen = new Set();
      for (const entry of layer.arrowDensityByZoom) {
        if (!Number.isFinite(entry.zoom) || !Number.isFinite(entry.stride))
          e.push(`Layer ${layer.id}: arrowDensityByZoom entry has invalid zoom/stride`);
        else if (seen.has(entry.zoom))
          e.push(`Layer ${layer.id}: arrowDensityByZoom duplicate zoom ${entry.zoom}`);
        else if (entry.stride < 12)
          e.push(`Layer ${layer.id}: arrowDensityByZoom stride ${entry.stride} is dangerously small`);
        seen.add(entry.zoom);
      }
    }
    if (layer.contours?.enabled) {
      const { levels, majorLevels, minZoom, majorOnlyBelowZoom, labelMinZoom } = layer.contours;
      if (!Array.isArray(levels) || levels.length === 0)
        e.push(`Layer ${layer.id}: contours.enabled but contours.levels is missing`);
      if (levels?.some((v) => !Number.isFinite(v)))
        e.push(`Layer ${layer.id}: contours.levels contains non-numeric values`);
      if (majorLevels?.some((v) => !levels?.includes(v)))
        e.push(`Layer ${layer.id}: contours.majorLevels contains values absent from contours.levels`);
      if (Number.isFinite(majorOnlyBelowZoom) && Number.isFinite(minZoom) && majorOnlyBelowZoom < minZoom)
        e.push(`Layer ${layer.id}: contours.majorOnlyBelowZoom < contours.minZoom`);
      if (Number.isFinite(labelMinZoom) && Number.isFinite(minZoom) && labelMinZoom < minZoom)
        e.push(`Layer ${layer.id}: contours.labelMinZoom < contours.minZoom`);
    }
    return e;
  });
  if (errors.length) console.warn('[mapLayersConfig] config issues:', errors);
}
