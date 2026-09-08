// Basemap options for the main MapLibre map. All are free, keyless raster
// tile sources so no API credentials are needed.
export const BASEMAP_LAYER_ID = 'sat';

export const BASEMAP_OPTIONS = [
  {
    id: 'satellite',
    label: 'Satellite',
    icon: 'bi-globe-americas',
    source: {
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
  },
];

export const DEFAULT_BASEMAP_ID = 'satellite';
