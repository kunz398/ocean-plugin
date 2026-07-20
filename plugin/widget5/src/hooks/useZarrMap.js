// useZarrMap.js — MapLibre GL map + ZarrOverlay/UgridOverlay management.
// Replaces: useMapRendering, useWMSCapabilities, useTimeAnimation, useMapInteraction.
import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { ZarrOverlay } from '../lib/ZarrOverlay';
import { UgridOverlay } from '../lib/UgridOverlay';
import { SfincsRasterOverlay } from '../lib/SfincsRasterOverlay';
import { SfincsColumnOverlay } from '../lib/SfincsColumnOverlay';
import { findLayerById, RAROTONGA_ORTHO_2018_CONFIG } from '../lib/mapLayersConfig';
import { BASEMAP_LAYER_ID, BASEMAP_OPTIONS } from '../config/basemapConfig';
import { ISLAND_ZOOM_TARGETS } from '../config/islandConfig';
import {
  fetchRiskDetails,
  fetchRiskPoints as fetchRiskPointsData,
  getEffectiveRiskLevel,
  ensureRiskThresholdOverridesLoaded,
} from '../services/riskDataService';
import { disableTerrain, enableTerrain, hasTerrainDem } from '../lib/terrainMapLibre';

// Satellite/hybrid tiles from ESRI — no key needed
const ESRI_SAT_STYLE = {
  version: 8,
  sources: {
    sat: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Tiles © Esri',
      maxzoom: 19,
    },
    [RAROTONGA_ORTHO_2018_CONFIG.sourceId]: {
      type: 'raster',
      tiles: RAROTONGA_ORTHO_2018_CONFIG.tiles,
      tileSize: RAROTONGA_ORTHO_2018_CONFIG.tileSize,
      minzoom: RAROTONGA_ORTHO_2018_CONFIG.minzoom,
      maxzoom: RAROTONGA_ORTHO_2018_CONFIG.maxzoom,
      bounds: RAROTONGA_ORTHO_2018_CONFIG.bounds,
      attribution: RAROTONGA_ORTHO_2018_CONFIG.attribution,
    },
  },
  layers: [
    { id: 'sat', type: 'raster', source: 'sat' },
    // Sits above Esri; transparent outside its footprint / below minzoom, so Esri shows through.
    { id: RAROTONGA_ORTHO_2018_CONFIG.layerId, type: 'raster', source: RAROTONGA_ORTHO_2018_CONFIG.sourceId },
  ],
};

const RISK_SOURCE = 'risk-points-src';
const RISK_CIRCLES_LAYER = 'risk-circles';
const RISK_COLORS = { 0: '#3498db', 1: '#f39c12', 2: '#e74c3c' };

const ISLAND_LABELS_SOURCE = 'island-labels-src';
const ISLAND_LABELS_LAYER = 'island-labels';

const ISLAND_LABEL_FEATURES = {
  type: 'FeatureCollection',
  features: ISLAND_ZOOM_TARGETS.map(island => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [
        (island.bounds.southWest[1] + island.bounds.northEast[1]) / 2,
        (island.bounds.southWest[0] + island.bounds.northEast[0]) / 2,
      ],
    },
    properties: { name: island.label },
  })),
};

// Convert island bounds stored as {southWest:[lat,lng], northEast:[lat,lng]}
// to MapLibre LngLatBoundsLike [[sw_lng,sw_lat],[ne_lng,ne_lat]]
function islandBoundsToML(bounds) {
  if (!bounds) return null;
  const { southWest: sw, northEast: ne } = bounds;
  return [[sw[1], sw[0]], [ne[1], ne[0]]];
}

function parseTimeLabel(label) {
  if (!label) return null;
  try {
    const d = new Date(label.replace(' UTC', 'Z').replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

export function useZarrMap({
  selectedLayerId,
  sliderIndex,
  setSliderIndex,
  isPlaying,
  setIsPlaying,
  opacity = 0.75,
  thresholds = null,
  riskEnabled = true,
  setBottomCanvasData,
  setShowBottomCanvas,
  inundationCategories = null,
  minVisibleDepth = null,
  rangeWindow = null,
  playSpeedMs = 700,
  terrainEnabled = false,
  terrainConfig = null,
  showOrtho2018 = true,
  flood3dEnabled = false,
  flood3dConfig = null,
  flood3dElevScale = null,
}) {
  // mapRef  = DOM container div ref  (used as <div ref={mapRef}>)
  // mapInstance = actual MapLibre map ref (used for fitBounds, getZoom, etc.)
  const mapRef = useRef(null);
  const mapInstance = useRef(null);

  const overlayRef = useRef(null);
  const columnOverlayRef = useRef(null);
  const playIntervalRef = useRef(null);
  const pinMarkerRef = useRef(null);
  const riskLatestReqRef = useRef(0);
  const riskPointsRef = useRef([]);

  const [timeCount, setTimeCount] = useState(1);
  const [timeLabels, setTimeLabels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [overlayStats, setOverlayStats] = useState(null);

  // Keep latest callback params in refs to avoid stale closures in map event listeners
  const cbRef = useRef({});
  cbRef.current = { setBottomCanvasData, setShowBottomCanvas, inundationCategories, minVisibleDepth, rangeWindow, selectedLayerId, opacity, flood3dElevScale, sliderIndex };

  const overlayRefR = useRef(overlayRef);
  overlayRefR.current = overlayRef;

  // ── map init (once) ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: ESRI_SAT_STYLE,
      center: [-159.78, -21.24],
      zoom: 8,
      maxPitch: 60,
      attributionControl: true,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-left');
    mapInstance.current = map;

    const onLoad = () => {
      // Risk points layer
      map.addSource(RISK_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: RISK_CIRCLES_LAYER,
        type: 'circle',
        source: RISK_SOURCE,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 12, 7, 14, 9],
          'circle-color': [
            'match', ['get', 'riskLevel'],
            0, RISK_COLORS[0], 1, RISK_COLORS[1], 2, RISK_COLORS[2], RISK_COLORS[0],
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.75,
        },
      });

      // Island name labels — rendered on top of the wave overlay (interleaved deck.gl)
      map.addSource(ISLAND_LABELS_SOURCE, { type: 'geojson', data: ISLAND_LABEL_FEATURES });
      map.addLayer({
        id: ISLAND_LABELS_LAYER,
        type: 'symbol',
        source: ISLAND_LABELS_SOURCE,
        minzoom: 5,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 9, 8, 12, 12, 15],
          'text-anchor': 'bottom',
          'text-offset': [0, -0.3],
          'text-allow-overlap': false,
          'text-ignore-placement': false,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0, 15, 35, 0.85)',
          'text-halo-width': 2,
          'text-opacity': 0.92,
        },
      });

      map.on('click', RISK_CIRCLES_LAYER, onRiskClick);
      map.on('mouseenter', RISK_CIRCLES_LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', RISK_CIRCLES_LAYER, () => { map.getCanvas().style.cursor = ''; });
      map.on('moveend', doRefreshRisk);
      map.on('zoomend', doRefreshRisk);
      doRefreshRisk();
    };

    // 'load' waits for the initial viewport's tiles across ALL sources to finish
    // fetching (now 4 raster sources instead of 1, so measurably slower) — but
    // adding a layer only needs the style itself to be parsed, which is ready
    // much earlier. Waiting on 'load' let UgridOverlay's first render (which
    // targets beforeId: 'risk-circles') fire before this layer existed, sending
    // deck.gl's MapboxOverlay into a permanently-stuck add/move failure loop.
    if (map.isStyleLoaded()) onLoad(); else map.once('style.load', onLoad);

    map.on('click', onMapClick);

    return () => {
      map.off('click', onMapClick);
      map.remove();
      mapInstance.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── overlay lifecycle ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    const layerCfg = findLayerById(selectedLayerId);
    if (!layerCfg) return;

    const prev = overlayRef.current;
    if (prev) {
      // Null callbacks BEFORE destroy so any in-flight async work on the old
      // overlay cannot race against the new overlay's loading state.
      prev.onLoadingChange = null;
      prev.onTimeChange = null;
      prev.onErrorChange = null;
      prev.onStatsChange = null;
      prev.destroy();
      overlayRef.current = null;
    }

    // Reset loading so a stale true from the previous layer doesn't bleed through.
    setLoading(false);
    setSliderIndex(0);
    setTimeCount(1);
    // Don't clear timeLabels here — keep previous layer's labels so currentSliderDate
    // is never null during the metadata load window. They'll be replaced as soon as
    // the new overlay fires onTimeChange and the [timeCount] effect runs.
    setOverlayStats(null);
    setError(null);

    // Construction is deferred one frame past prev.destroy(). UgridOverlay (and
    // SfincsColumnOverlay, constructed by a sibling effect below) both use deck.gl's
    // *interleaved* MapboxOverlay, which shares ONE Deck instance per map, cached on
    // map.__deck (see @deck.gl/mapbox/deck-utils.js getDeckInstance/removeDeckInstance).
    // Removing an interleaved overlay unconditionally finalizes and nulls that shared
    // instance, even if a sibling interleaved overlay is still relying on it — and
    // MapboxOverlay's own layer sync (resolveLayers) runs synchronously off whatever
    // that reference currently is. Giving the previous overlay's teardown a full
    // render frame before the next one starts inserting layers (with beforeId:
    // 'risk-circles') avoids that hazard; this is the source of the intermittent
    // "cannot add/move layer" MapLibre console errors seen when switching wave
    // variable/island. (Traced from source, not live-verified — see conversation notes.)
    let cancelled = false;
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      const ov = layerCfg.type === 'ugrid'
        ? new UgridOverlay(map, { ...layerCfg, opacity })
        : layerCfg.sourceType === 'sfincs-raster'
        ? new SfincsRasterOverlay(map, {
            ...layerCfg,
            opacity,
            inundationCategories: cbRef.current.inundationCategories,
            minVisibleDepth: cbRef.current.minVisibleDepth,
          })
        : new ZarrOverlay(map, { ...layerCfg, opacity, thresholds });

      ov.onTimeChange = (_label, _idx, maxIdx) => setTimeCount(maxIdx + 1);
      ov.onLoadingChange = setLoading;
      ov.onErrorChange = setError;
      ov.onStatsChange = (min, max, units, extra = {}) => {
        setOverlayStats({
          min,
          max,
          units,
          colorMin: extra.colorMin ?? min,
          colorMax: extra.colorMax ?? max,
          variable: extra.variable ?? layerCfg.variable,
          layerId: layerCfg.value,
        });
      };
      overlayRef.current = ov;
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      const current = overlayRef.current;
      if (current) {
        current.onLoadingChange = null;
        current.onTimeChange = null;
        current.onErrorChange = null;
        current.onStatsChange = null;
        current.destroy();
        overlayRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayerId]);

  // Auto-dismiss transient layer errors (e.g. S3 503 throttle) after 8 s.
  // The user can switch layers to clear immediately; this handles the case
  // where they stay on the same layer after a transient blip.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(t);
  }, [error]);

  // Grab time labels from either overlay type once they're loaded (after timeCount updates)
  useEffect(() => {
    const ov = overlayRef.current;
    if (ov && typeof ov.getTimeLabels === 'function') {
      const labels = ov.getTimeLabels();
      if (labels.length > 0) setTimeLabels(labels);
    }
  }, [timeCount]);

  // ── slider → overlay ──────────────────────────────────────────────────────
  useEffect(() => {
    overlayRef.current?.setTimeIndex(sliderIndex);
    columnOverlayRef.current?.setTimeIndex(sliderIndex);
  }, [sliderIndex]);

  // ── opacity ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const ov = overlayRef.current;
    if (ov && typeof ov.setOpacity === 'function') ov.setOpacity(opacity);
    columnOverlayRef.current?.setOpacity(opacity);
  }, [opacity]);

  // ── thresholds (ZarrOverlay / UgridOverlay) ───────────────────────────────
  useEffect(() => {
    const ov = overlayRef.current;
    if (ov && typeof ov.setThresholds === 'function') ov.setThresholds(thresholds);
  }, [thresholds]);

  // ── sfincs config (rangeWindow / inundationCategories / minVisibleDepth) ──
  useEffect(() => {
    const ov = overlayRef.current;
    if (ov instanceof SfincsRasterOverlay) {
      ov.updateConfig({ rangeWindow, inundationCategories, minVisibleDepth });
    }
  }, [rangeWindow, inundationCategories, minVisibleDepth]);

  // ── optional MapLibre terrain ────────────────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    // Wave/SWAN layers render as a flat, sea-level deck.gl UGRID mesh (see
    // UgridOverlay.js) — even interleaved with MapLibre's WebGL context, the
    // mesh geometry itself has no elevation, so wherever the wave domain
    // overlaps the coastline it visually disagrees with 3D land terrain
    // (jagged cutouts, broken-looking colors at the shoreline). Terrain was
    // built for the inundation raster path; force it off for UGRID layers
    // regardless of the user's terrain toggle, and let the toggle resume
    // control as soon as they switch back to a non-UGRID layer.
    const isUgridLayer = findLayerById(selectedLayerId)?.type === 'ugrid';

    if (isUgridLayer || !terrainEnabled || !hasTerrainDem(terrainConfig)) {
      disableTerrain(map, terrainConfig || {});
      if (map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 350 });
      // Drop flood columns back to sea-level positioning now that terrain is off.
      columnOverlayRef.current?.refreshTerrainAlignment();
      return;
    }

    const applyTerrain = () => {
      // Insert hillshade before risk-circles so it sits below overlay layers
      const enabled = enableTerrain(map, terrainConfig, 'risk-circles');
      if (enabled) {
        map.easeTo({ pitch: 58, bearing: -15, duration: 800 });
        // DEM tiles for the current view may still be loading; re-anchor columns
        // immediately with whatever's cached, then again once tiles settle.
        columnOverlayRef.current?.refreshTerrainAlignment();
        map.once('idle', () => columnOverlayRef.current?.refreshTerrainAlignment());
      }
    };

    if (map.loaded()) applyTerrain();
    else map.once('load', applyTerrain);

    // Remove the once() listener if this effect re-runs before the map loads
    return () => map.off('load', applyTerrain);
  }, [terrainEnabled, terrainConfig, selectedLayerId]);

  // ── optional: hide the local high-res 2018 aerial overlay, showing only
  // the Esri "sat" basemap underneath. Terrain draping is a global scene
  // property (map.setTerrain()), not per-layer, so the basemap still drapes
  // over 3D terrain exactly like the ortho overlay does when it's visible.
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    const applyVisibility = () => {
      if (map.getLayer(RAROTONGA_ORTHO_2018_CONFIG.layerId)) {
        map.setLayoutProperty(
          RAROTONGA_ORTHO_2018_CONFIG.layerId,
          'visibility',
          showOrtho2018 ? 'visible' : 'none'
        );
      }
    };

    if (map.loaded()) applyVisibility();
    else map.once('load', applyVisibility);

    return () => map.off('load', applyVisibility);
  }, [showOrtho2018]);

  // ── 3D flood column overlay ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    const layerCfg = findLayerById(selectedLayerId);
    const isSfincs = layerCfg?.sourceType === 'sfincs-raster';

    // Destroy any existing column overlay first
    if (columnOverlayRef.current) {
      columnOverlayRef.current.destroy();
      columnOverlayRef.current = null;
    }

    if (!flood3dEnabled || !isSfincs || !map) return;

    // Deferred one frame past the destroy above for the same reason as the main
    // overlay-lifecycle effect: this is also an interleaved deck.gl MapboxOverlay
    // sharing the map's single cached Deck instance (map.__deck) with UgridOverlay.
    let cancelled = false;
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      // Read latest values from cbRef to avoid stale closure when 3D is toggled off/on
      const { opacity: latestOpacity, flood3dElevScale: latestElevScale, inundationCategories: latestCats } = cbRef.current;
      const col = new SfincsColumnOverlay(map, {
        apiBase: layerCfg.apiBase,
        colorRange: layerCfg.colorRange,
        opacity: latestOpacity,
        inundationCategories: latestCats,
        flood3dConfig: {
          ...(flood3dConfig ?? {}),
          elevationScale: latestElevScale ?? flood3dConfig?.elevationScale ?? 6,
        },
        // Insert columns below labels so map text remains readable
        beforeLayerId: map.getLayer(ISLAND_LABELS_LAYER) ? ISLAND_LABELS_LAYER : null,
      });
      col.onLoadingChange = setLoading;
      col.onErrorChange = setError;
      columnOverlayRef.current = col;
      col.setTimeIndex(sliderIndex);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (columnOverlayRef.current) {
        columnOverlayRef.current.destroy();
        columnOverlayRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flood3dEnabled, selectedLayerId]);

  // ── column overlay: sync categories ──────────────────────────────────────
  useEffect(() => {
    columnOverlayRef.current?.updateConfig({ inundationCategories });
  }, [inundationCategories]);

  // ── column overlay: sync elevation scale ─────────────────────────────────
  useEffect(() => {
    if (flood3dElevScale != null) {
      columnOverlayRef.current?.setElevationScale(flood3dElevScale);
    }
  }, [flood3dElevScale]);

  // ── playback ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (playIntervalRef.current) { clearInterval(playIntervalRef.current); playIntervalRef.current = null; }
    if (!isPlaying) return;
    playIntervalRef.current = setInterval(() => {
      setSliderIndex((prev) => {
        const next = prev + 1;
        if (next >= timeCount) { setIsPlaying(false); return prev; }
        return next;
      });
    }, playSpeedMs);
    return () => { if (playIntervalRef.current) clearInterval(playIntervalRef.current); };
  }, [isPlaying, timeCount, setSliderIndex, setIsPlaying, playSpeedMs]);

  // ── risk points ───────────────────────────────────────────────────────────
  function riskPointsToFeatureCollection(pts) {
    return {
      type: 'FeatureCollection',
      features: pts
        .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon))
        .map((p) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          properties: { id: p.id, riskLevel: getEffectiveRiskLevel(p), maxTWL: p.maxTWL ?? null, type: p.type ?? '' },
        })),
    };
  }

  function doRefreshRisk() {
    const map = mapInstance.current;
    if (!map) return;
    const reqId = ++riskLatestReqRef.current;
    const bnds = map.getBounds();
    const bbox = [bnds.getWest(), bnds.getSouth(), bnds.getEast(), bnds.getNorth()].join(',');
    const zoom = map.getZoom();
    fetchRiskPointsData({ zoom, bbox })
      .then((payload) => {
        if (riskLatestReqRef.current !== reqId) return;
        const pts = Array.isArray(payload?.points) ? payload.points : [];
        riskPointsRef.current = pts;
        const src = map.getSource?.(RISK_SOURCE);
        if (!src) return;
        src.setData(riskPointsToFeatureCollection(pts));
      })
      .catch((err) => console.error('Risk points fetch failed:', err));
  }

  // Re-colors markers from the already-fetched point list — no network round trip.
  // Used after a per-point threshold edit is saved (locally) in RiskDetailsPanel,
  // so the marker's color picks up the new override immediately instead of waiting
  // for the next moveend/zoomend refetch.
  function refreshRiskMarkerColors() {
    const map = mapInstance.current;
    if (!map) return;
    const src = map.getSource?.(RISK_SOURCE);
    if (!src) return;
    src.setData(riskPointsToFeatureCollection(riskPointsRef.current));
  }

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    if (!riskEnabled) {
      const src = map.getSource?.(RISK_SOURCE);
      if (src) src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    if (map.loaded()) doRefreshRisk(); else map.once('load', doRefreshRisk);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskEnabled]);

  // Server-saved threshold overrides load asynchronously (separate request from the
  // points fetch above) — once they land, re-color markers already on the map so a
  // returning user sees their previously-saved thresholds without needing a pan/zoom.
  useEffect(() => {
    let cancelled = false;
    ensureRiskThresholdOverridesLoaded().then(() => {
      if (!cancelled) refreshRiskMarkerColors();
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── event handlers (stable refs, read latest values via cbRef) ────────────
  function onRiskClick(e) {
    const feature = e.features?.[0];
    if (!feature) return;
    const { id, riskLevel, maxTWL, type: pType } = feature.properties;
    const point = { id, riskLevel, maxTWL, type: pType, lat: e.lngLat.lat, lon: e.lngLat.lng };
    removePinMarker();
    cbRef.current.setBottomCanvasData({ mode: 'risk', point, status: 'loading' });
    cbRef.current.setShowBottomCanvas(true);
    fetchRiskDetails(id)
      .then((details) => {
        cbRef.current.setBottomCanvasData({ mode: 'risk', point, details, status: 'success' });
        cbRef.current.setShowBottomCanvas(true);
      })
      .catch((err) => {
        cbRef.current.setBottomCanvasData({ mode: 'risk', point, status: 'error', error: err.message });
        cbRef.current.setShowBottomCanvas(true);
      });
  }

  function onMapClick(e) {
    const map = mapInstance.current;
    if (!map) return;
    // Skip if clicking a risk point
    const feats = map.queryRenderedFeatures(e.point, { layers: [RISK_CIRCLES_LAYER] });
    if (feats.length > 0) return;

    const ov = overlayRef.current;
    if (!ov?.getTimeseriesAtPoint) return;
    const { setBottomCanvasData: setCB, setShowBottomCanvas: setSC, inundationCategories: cats, rangeWindow: rw, selectedLayerId: currentLayerId } = cbRef.current;
    const layerCfg = findLayerById(currentLayerId);
    if (!layerCfg) return;

    const { lng, lat } = e.lngLat;
    addPinMarker(lng, lat, map);
    const isInundationLayer = layerCfg.sourceType === 'sfincs-raster' || layerCfg.heightVariable === 'h' || layerCfg.variable === 'h';
    setCB(isInundationLayer
      ? { mode: 'inundation', loading: true, lat, lng, rangeWindow: rw }
      : { loading: true, lat, lng, selectedLayer: layerCfg }
    );
    setSC(true);

    ov.getTimeseriesAtPoint(lng, lat)
      .then((result) => {
        if (!result) {
          setCB(isInundationLayer
            ? { mode: 'inundation', lat, lng, timeseries: null, rangeWindow: rw,
                noData: true }
            : { lat, lng, selectedLayer: layerCfg, error: 'No data at this location' }
          );
          return;
        }
        if (!isInundationLayer) {
          const perVariableData = toCoverageByVariable(result);
          setCB({
            lat: result.lat ?? result.node_lat ?? lat,
            lng: result.lon ?? result.node_lon ?? lng,
            selectedLayer: layerCfg,
            perVariableData,
          });
          return;
        }
        // InundationTimeseries expects [{time: string, depth_m: number}] objects.
        // Reconstruct from the generic {timeLabels, variables[0].values} format.
        const depthVals = result.variables?.[0]?.values ?? [];
        const timeLabels = result.timeLabels ?? [];
        const timeseries = timeLabels.length > 0
          ? timeLabels.map((t, i) => ({
              time: t,
              depth_m: Number.isFinite(depthVals[i]) ? depthVals[i] : 0,
            }))
          : null;
        setCB({
          mode: 'inundation',
          lat: result.lat ?? lat,
          lng: result.lon ?? lng,
          timeseries,
          categories: cats,
          rangeWindow: rw,
        });
      })
      .catch((err) => {
        setCB(isInundationLayer
          ? { mode: 'inundation', lat, lng, timeseries: null, rangeWindow: rw, error: err.message }
          : { lat, lng, selectedLayer: layerCfg, error: err.message }
        );
      });
  }

  function addPinMarker(lng, lat, map) {
    removePinMarker();
    const el = document.createElement('div');
    el.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#ff6b35;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)';
    pinMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
  }

  function removePinMarker() {
    if (pinMarkerRef.current) { pinMarkerRef.current.remove(); pinMarkerRef.current = null; }
  }

  // ── exposed fitBounds (island bounds are [lat,lng], convert for MapLibre) ──
  const fitBounds = useCallback((islandBounds, options = {}) => {
    const map = mapInstance.current;
    if (!map) return;
    const mlBounds = islandBoundsToML(islandBounds);
    if (!mlBounds) return;
    map.fitBounds(mlBounds, { padding: 30, animate: true, ...options });
  }, []);

  // Swaps only the 'sat' source/layer in place (never map.setStyle()) so the
  // Rarotonga ortho overlay and SFINCS/inundation raster overlays — all added
  // outside this style JSON, or layered above 'sat' within it — survive the
  // switch untouched.
  const setBasemap = useCallback((basemapId) => {
    const map = mapInstance.current;
    if (!map) return;
    const option = BASEMAP_OPTIONS.find((b) => b.id === basemapId);
    if (!option) return;

    const applySwap = () => {
      if (map.getLayer(BASEMAP_LAYER_ID)) map.removeLayer(BASEMAP_LAYER_ID);
      if (map.getSource(BASEMAP_LAYER_ID)) map.removeSource(BASEMAP_LAYER_ID);
      map.addSource(BASEMAP_LAYER_ID, option.source);
      const firstLayerId = map.getStyle()?.layers?.[0]?.id;
      map.addLayer({ id: BASEMAP_LAYER_ID, type: 'raster', source: BASEMAP_LAYER_ID }, firstLayerId);
    };

    if (map.isStyleLoaded()) {
      applySwap();
    } else {
      map.once('load', applySwap);
    }
  }, []);

  // ── capTime compatibility shim for ForecastApp/InundationWindowControl ─────
  // NOTE (performance): zarr chunks fetched from Wasabi hit S3 on every request
  // because the bucket doesn't serve Cache-Control headers. Fix: add
  // "Cache-Control: public, max-age=3600" to the Wasabi bucket policy for the
  // spc-zarr-file bucket — chunks are immutable per model run.
  const availableTimestamps = timeLabels.map(parseTimeLabel).filter(Boolean);
  const modelRunStart = availableTimestamps[0] ?? null;
  const modelRunAgeHours = modelRunStart
    ? (Date.now() - modelRunStart.getTime()) / 3_600_000
    : null;
  const capTime = {
    loading,
    availableTimestamps,
    stepHours: 1,
    warmupSkipped: false,
    warmupDays: 0,
    modelRunStart,
    modelRunAgeHours,
    // True when data is older than 30 h — indicates a missed pipeline run
    isStale: modelRunAgeHours !== null && modelRunAgeHours > 30,
  };

  const currentSliderDate = timeLabels[sliderIndex] ? parseTimeLabel(timeLabels[sliderIndex]) : null;

  return {
    mapRef,         // DOM div ref  → <div ref={mapRef} />
    mapInstance,    // MapLibre map ref → map.fitBounds, etc.
    timeCount,
    timeLabels,
    currentSliderDate,
    capTime,
    loading,
    error,
    overlayStats,
    fitBounds,      // (islandBounds, options) → map.fitBounds with coord conversion
    setBasemap,     // (basemapId) → swap 'sat' raster source/layer in place
    removePinMarker,
    setShowContours: (enabled) => { overlayRef.current?.setShowContours?.(enabled); },
    refreshRiskMarkerColors,
  };
}

function toCoverageByVariable(result) {
  // Two API response shapes are supported:
  // Old (zarr fallback):  { timeLabels: string[], variables: [{name, values, units, label}] }
  // New (ocean-zarr.spc.int): { times: string[], variables: {name: values[]}, units: {}, long_names: {} }
  const times = result?.timeLabels || result?.times || [];
  const out = {};

  if (Array.isArray(result?.variables)) {
    // Old list-of-objects format
    for (const variable of result.variables) {
      if (!variable?.name) continue;
      out[variable.name] = {
        type: 'Coverage',
        domain: { axes: { t: { values: times } } },
        ranges: { [variable.name]: { values: variable.values || [] } },
        parameters: {
          [variable.name]: {
            observedProperty: { label: { en: variable.label || variable.name } },
            unit: { symbol: variable.units || '' },
          },
        },
      };
    }
  } else if (result?.variables && typeof result.variables === 'object') {
    // New dict format: variables[name] = values[]
    const units = result.units ?? {};
    const longNames = result.long_names ?? {};
    for (const [name, values] of Object.entries(result.variables)) {
      out[name] = {
        type: 'Coverage',
        domain: { axes: { t: { values: times } } },
        ranges: { [name]: { values: Array.isArray(values) ? values : [] } },
        parameters: {
          [name]: {
            observedProperty: { label: { en: longNames[name] || name } },
            unit: { symbol: units[name] || '' },
          },
        },
      };
    }
  }

  return out;
}

export default useZarrMap;
