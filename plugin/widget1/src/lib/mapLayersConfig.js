const NIUE_INUNDATION_API_BASE = (
  process.env.REACT_APP_SFINCS_API_BASE || 'https://ocean-zarr.spc.int'
).replace(/\/+$/, '');

// Used to default to '/widget1/zarr', an nginx alias to a bind-mounted
// /data/niue/zarr directory that was never actually populated in production —
// requests fell through to the SPA's index.html (200 OK, wrong content) instead
// of erroring, so the wave layer silently failed. zarr-api now serves this
// directly at /niue/zarr/{file}, mirroring the Cook Islands /zarr/{file} route
// (confirmed live: /niue/zarr/ForecastNiue_latest.zarr/.zmetadata returns 200).
const WAVE_ZARR_BASE = (
  process.env.REACT_APP_NIUE_WAVE_ZARR_BASE_URL || `${NIUE_INUNDATION_API_BASE}/niue/zarr`
).replace(/\/+$/, '');

const NIUE_BOUNDS = {
  southWest: [-19.5, -170.5],
  northEast: [-18.5, -169.3],
};

// Shared across every Niue "ugrid" wave layer so the Tabular/Timeseries panel
// is a complete point report no matter which map layer happens to be active —
// previously only niue-wave-height carried this list, so selecting Mean
// Period or Peak Period fetched just that one bare variable and left the
// Tabular panel mostly or entirely blank (see BottomOffCanvas.jsx/tabular.js
// variableDefs, which expects all of these keys to be present).
const NIUE_WAVE_POINT_VARIABLES = [
  { name: 'hs', units: 'm' },
  { name: 'tm02', units: 's' },
  { name: 'tpeak', units: 's' },
  { name: 'dirm', units: 'degree', isDirection: true },
  { name: 'dirp', units: 'degree', isDirection: true },
  { name: 'dspr', units: 'degree' },
  { name: 'transp_x', units: 'm2/s' },
  { name: 'transp_y', units: 'm2/s' },
  { name: 'hs_p1', units: 'm' },
  { name: 'tp_p1', units: 's' },
  { name: 'dirp_p1', units: 'degree', isDirection: true },
  { name: 'hs_p2', units: 'm' },
  { name: 'tp_p2', units: 's' },
  { name: 'dirp_p2', units: 'degree', isDirection: true },
  { name: 'hs_p3', units: 'm' },
  { name: 'tp_p3', units: 's' },
  { name: 'dirp_p3', units: 'degree', isDirection: true },
];

export const MAP_LAYERS = [
  {
    id: 'niue-wave-height',
    value: 'hs',
    label: 'Significant Wave Height',
    type: 'ugrid',
    variable: 'hs',
    directionVariable: 'dirm',
    datasetName: 'ForecastNiue_latest.zarr',
    zarrBaseUrl: WAVE_ZARR_BASE,
    ugridApiBase: NIUE_INUNDATION_API_BASE,
    ugridTimeseriesPath: '/niue/wave/ugrid/timeseries',
    colormap: 'x-sst',
    colorRange: { min: 0, max: 4 },
    colorscalerange: '0,4',
    units: 'm',
    showDirectionArrows: true,
    minArrowZoom: 8,
    arrowStride: 56,
    arrowSize: 18,
    arrowMinSize: 12,
    arrowMaxSize: 24,
    minArrowMagnitude: 0.15,
    pointVariables: NIUE_WAVE_POINT_VARIABLES,
    description: 'Significant wave height - SWAN UGRID model for Niue',
    bounds: NIUE_BOUNDS,
  },
  {
    id: 'niue-mean-wave-period',
    value: 'tm02',
    label: 'Mean Wave Period',
    type: 'ugrid',
    variable: 'tm02',
    datasetName: 'ForecastNiue_latest.zarr',
    zarrBaseUrl: WAVE_ZARR_BASE,
    ugridApiBase: NIUE_INUNDATION_API_BASE,
    ugridTimeseriesPath: '/niue/wave/ugrid/timeseries',
    colormap: 'spectral',
    colorRange: { min: 0, max: 20 },
    colorscalerange: '0,20',
    units: 's',
    pointVariables: NIUE_WAVE_POINT_VARIABLES,
    description: 'Mean wave period - SWAN UGRID model for Niue',
    bounds: NIUE_BOUNDS,
  },
  {
    id: 'niue-peak-wave-period',
    value: 'tpeak',
    label: 'Peak Wave Period',
    type: 'ugrid',
    variable: 'tpeak',
    datasetName: 'ForecastNiue_latest.zarr',
    zarrBaseUrl: WAVE_ZARR_BASE,
    ugridApiBase: NIUE_INUNDATION_API_BASE,
    ugridTimeseriesPath: '/niue/wave/ugrid/timeseries',
    colormap: 'ylorrd',
    colorRange: { min: 0, max: 18 },
    colorscalerange: '0,18',
    units: 's',
    pointVariables: NIUE_WAVE_POINT_VARIABLES,
    description: 'Peak wave period - SWAN UGRID model for Niue',
    bounds: NIUE_BOUNDS,
  },
  {
    id: 'niue-inundation',
    value: 'inundation',
    label: 'Inundation Depth',
    type: 'niue-inundation-raster',
    sourceType: 'niue-inundation-raster',
    apiBase: NIUE_INUNDATION_API_BASE,
    variable: 'inundation',
    colormap: 'x-sst',
    colorRange: { min: 0.05, max: 6.0 },
    colorscalerange: '0.05,6.0',
    units: 'm',
    description: 'Predicted inundation depth - Niue (DeepONet, served via ocean-zarr.spc.int)',
    bounds: NIUE_BOUNDS,
  },
  {
    id: 'niue-suitability',
    value: 'suitability',
    label: 'Vessel Suitability',
    type: 'niue-suitability-raster',
    sourceType: 'niue-suitability-raster',
    apiBase: NIUE_INUNDATION_API_BASE,
    variable: 'suitability',
    defaultVessel: 'traditional_craft',
    units: '',
    description: 'Vessel-class marine hazard suitability - Niue (wind/wave, served via ocean-zarr.spc.int)',
    bounds: NIUE_BOUNDS,
  },
];

export function findLayerById(id) {
  return MAP_LAYERS.find((layer) => layer.id === id || layer.value === id) ?? null;
}

export { NIUE_BOUNDS };
