export function hasTerrainDem(terrainConfig = {}) {
  return Array.isArray(terrainConfig.tiles) && terrainConfig.tiles.some(Boolean);
}

export function ensureTerrainSource(map, terrainConfig = {}) {
  if (!map || !hasTerrainDem(terrainConfig)) return false;

  const sourceId = terrainConfig.demSourceId || 'rarotonga-dem';
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: 'raster-dem',
      tiles: terrainConfig.tiles,
      tileSize: terrainConfig.tileSize || 256,
      maxzoom: terrainConfig.maxzoom || 14,
      encoding: terrainConfig.encoding || 'terrarium',
      attribution: terrainConfig.attribution || undefined,
      // Restricts tile requests to where DEM data actually exists — without this,
      // panning/zooming outside the DEM's real footprint makes MapLibre request
      // nonexistent tiles, which fail to decode in the browser.
      bounds: terrainConfig.bounds || undefined,
    });
  }

  return true;
}

export function ensureHillshadeLayer(map, terrainConfig = {}, beforeLayerId = undefined) {
  const terrainSourceId = terrainConfig.demSourceId || 'rarotonga-dem';
  // MapLibre warns if the same raster-dem source backs both the hillshade layer
  // and map.setTerrain() — each samples/caches the DEM tiles differently, so
  // sharing one degrades rendering quality. Register a second source (same
  // tiles) dedicated to hillshade, keeping setTerrain() on the original.
  const hillshadeSourceId = `${terrainSourceId}-hillshade-src`;
  const layerId = terrainConfig.hillshadeLayerId || `${terrainSourceId}-hillshade`;
  if (!map || !map.getSource(terrainSourceId) || map.getLayer(layerId)) return;

  if (!map.getSource(hillshadeSourceId)) {
    map.addSource(hillshadeSourceId, {
      type: 'raster-dem',
      tiles: terrainConfig.tiles,
      tileSize: terrainConfig.tileSize || 256,
      maxzoom: terrainConfig.maxzoom || 14,
      encoding: terrainConfig.encoding || 'terrarium',
      attribution: terrainConfig.attribution || undefined,
      bounds: terrainConfig.bounds || undefined,
    });
  }

  const before = beforeLayerId && map.getLayer(beforeLayerId) ? beforeLayerId : undefined;
  map.addLayer({
    id: layerId,
    type: 'hillshade',
    source: hillshadeSourceId,
    paint: {
      'hillshade-exaggeration': 0.22,
      'hillshade-shadow-color': 'rgba(0, 10, 20, 0.38)',
      'hillshade-highlight-color': 'rgba(255, 255, 255, 0.18)',
      'hillshade-accent-color': 'rgba(0, 100, 160, 0.08)',
    },
  }, before);
}

const BUILDINGS_SOURCE_ID = 'rarotonga-buildings';
const BUILDINGS_LAYER_ID  = 'rarotonga-buildings-3d';

export function ensureBuildingsLayer(map, beforeLayerId = undefined) {
  if (!map || map.getSource(BUILDINGS_SOURCE_ID)) return;

  map.addSource(BUILDINGS_SOURCE_ID, {
    type: 'geojson',
    // Must include PUBLIC_URL (app is served under /widget5/) — a bare root-relative
    // path here 404s (falls back to index.html) the same way the DEM/ortho tile URLs did.
    data: `${process.env.PUBLIC_URL || ''}/data/rarotonga_buildings.geojson`,
  });

  const before = beforeLayerId && map.getLayer(beforeLayerId) ? beforeLayerId : undefined;
  map.addLayer({
    id: BUILDINGS_LAYER_ID,
    type: 'fill-extrusion',
    source: BUILDINGS_SOURCE_ID,
    paint: {
      'fill-extrusion-color': [
        'match', ['get', 'building'],
        ['church', 'cathedral', 'chapel', 'place_of_worship'], '#c8a96e',
        ['commercial', 'retail', 'supermarket'],               '#6ea8c8',
        ['industrial', 'warehouse', 'hangar'],                 '#8c8c8c',
        ['hotel', 'motel'],                                    '#c86e6e',
        '#b0b8c4',
      ],
      'fill-extrusion-height':   ['get', 'height'],
      'fill-extrusion-base':     0,
      'fill-extrusion-opacity':  0.75,
    },
  }, before);
}

export function removeBuildingsLayer(map) {
  if (!map) return;
  try { if (map.getLayer(BUILDINGS_LAYER_ID))  map.removeLayer(BUILDINGS_LAYER_ID); } catch (_) {}
  try { if (map.getSource(BUILDINGS_SOURCE_ID)) map.removeSource(BUILDINGS_SOURCE_ID); } catch (_) {}
}

function resolveTerrainExaggeration(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.85;
  return Math.min(1.5, Math.max(0, numeric));
}

export function enableTerrain(map, terrainConfig = {}, beforeLayerId = undefined) {
  if (!ensureTerrainSource(map, terrainConfig)) return false;

  ensureHillshadeLayer(map, terrainConfig, beforeLayerId);
  ensureBuildingsLayer(map, beforeLayerId);
  map.setTerrain({
    source: terrainConfig.demSourceId || 'rarotonga-dem',
    exaggeration: resolveTerrainExaggeration(terrainConfig.exaggeration),
  });

  // Atmospheric fog — deepens sky horizon and adds perceived depth in 3D view
  try {
    map.setFog({
      color: 'rgba(190, 215, 232, 0.42)',
      'high-color': 'rgba(80, 135, 180, 0.28)',
      'horizon-blend': 0.04,
      'space-color': 'rgba(15, 25, 50, 1)',
      'star-intensity': 0.0,
      range: [1.2, 10],
    });
  } catch (_) {}

  return true;
}

export function disableTerrain(map, terrainConfig = {}) {
  if (!map) return;
  const layerId = terrainConfig.hillshadeLayerId || `${terrainConfig.demSourceId || 'rarotonga-dem'}-hillshade`;

  try { map.setTerrain(null); } catch (_) {}
  try { map.setFog(null); } catch (_) {}
  try { if (map.getLayer(layerId)) map.removeLayer(layerId); } catch (_) {}
  removeBuildingsLayer(map);
}
