// Basemap options for the main MapLibre map — same five styles as niu_current's
// MapPanel/zarrMapPanel BASEMAPS array. Each is a full MapLibre style (object or
// URL string) applied via map.setStyle(), not a single raster source swap — the
// vector styles (dark/osm/carto) carry their own sources/sprite/glyphs, so a
// simple addSource/addLayer swap (as this file used before) can't represent
// them. All are free/keyless.
const SATELLITE_STYLE = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Tiles &copy; Esri',
      // Esri's free World_Imagery coverage for small/remote Pacific islands
      // (Niue included) tops out around z17 in practice — verified z18/z19
      // tiles over Niue return a blank "Map data not yet available" gray
      // placeholder instead of real imagery. Capping here makes MapLibre
      // overzoom (stretch) the last real z17 tile past this point instead of
      // fetching that blank placeholder.
      maxzoom: 17,
    },
    // Esri's imagery tiles carry no place names on their own — this is Esri's
    // companion "reference" layer (transparent PNGs with place/road labels and
    // boundaries) meant to be stacked on top of World_Imagery for exactly that.
    satelliteLabels: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
    },
  },
  layers: [
    { id: 'satellite', type: 'raster', source: 'satellite' },
    { id: 'satellite-labels', type: 'raster', source: 'satelliteLabels' },
  ],
};

const TOPO_STYLE = {
  version: 8,
  sources: {
    topo: {
      type: 'raster',
      tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)',
    },
  },
  layers: [{ id: 'topo', type: 'raster', source: 'topo' }],
};

export const BASEMAP_OPTIONS = [
  { id: 'satellite', label: 'Satellite',     icon: 'bi-globe-americas', style: SATELLITE_STYLE },
  { id: 'topo',       label: 'Topo',          icon: 'bi-triangle',       style: TOPO_STYLE },
  { id: 'dark',       label: 'Dark',          icon: 'bi-moon-stars',     style: 'https://tiles.openfreemap.org/styles/dark' },
  { id: 'osm',        label: 'OpenStreetMap', icon: 'bi-signpost-2',     style: 'https://tiles.openfreemap.org/styles/liberty' },
  { id: 'carto',      label: 'CartoDB',       icon: 'bi-palette2',       style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json' },
];

// Keep the app's current basemap ("satellite") as the default — only adding
// the other niu_current options alongside it, not replacing it.
export const DEFAULT_BASEMAP_ID = 'satellite';
