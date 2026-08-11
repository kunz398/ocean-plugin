// useZarrMap.js — MapLibre GL map + ZarrOverlay/UgridOverlay management.
// Replaces: useMapRendering, useWMSCapabilities, useTimeAnimation, useMapInteraction.
import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { ZarrOverlay } from '../lib/ZarrOverlay';
import { UgridOverlay } from '../lib/UgridOverlay';
import { SfincsRasterOverlay } from '../lib/SfincsRasterOverlay';
import { NiueInundationOverlay } from '../lib/NiueInundationOverlay';
import { NiueSuitabilityOverlay, SUITABILITY_HAZARD_COLORS } from '../lib/NiueSuitabilityOverlay';
import { WaveParticleOverlay } from '../lib/WaveParticleOverlay';
import { SwellSourceArcOverlay } from '../lib/SwellSourceArcOverlay';
import { findLayerById } from '../lib/mapLayersConfig';
import { BASEMAP_LAYER_ID, BASEMAP_OPTIONS } from '../config/basemapConfig';
import { routeSamplesToSegmentFeatures } from '../services/routeForecastService';
import {
  fetchRiskDetails,
  fetchRiskPoints as fetchRiskPointsData,
} from '../services/riskDataService';

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
  },
  layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
};

const RISK_SOURCE = 'risk-points-src';
const RISK_CIRCLES_LAYER = 'risk-circles';
const RISK_COLORS = { 0: '#3498db', 1: '#f39c12', 2: '#e74c3c' };
const ROUTE_DRAFT_SOURCE = 'route-draft-src';
const ROUTE_SEGMENTS_SOURCE = 'route-segments-src';
const ROUTE_DRAFT_LAYER = 'route-draft-line';
const ROUTE_SEGMENTS_LAYER = 'route-forecast-segments';
const ROUTE_WAYPOINT_COLORS = { origin: '#22c55e', destination: '#ef4444', waypoint: '#38bdf8' };

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

function emptyFeatureCollection() {
  return { type: 'FeatureCollection', features: [] };
}

function routePointsToLineFeature(points = []) {
  const coords = points
    .filter((point) => Number.isFinite(point?.lon) && Number.isFinite(point?.lat))
    .map((point) => [point.lon, point.lat]);

  if (coords.length < 2) return emptyFeatureCollection();
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {},
    }],
  };
}

const EARTH_RADIUS_NM = 3440.065;

function haversineNm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function formatEtaLabel(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function useZarrMap({
  selectedLayerId,
  sliderIndex,
  setSliderIndex,
  isPlaying,
  setIsPlaying,
  playSpeedMs = 700,
  opacity = 0.75,
  thresholds = null,
  riskEnabled = true,
  setBottomCanvasData,
  setShowBottomCanvas,
  inundationCategories = null,
  minVisibleDepth = null,
  rangeWindow = null,
  // 'off' | 'particles' | 'particles+raster'
  waveParticleMode = 'off',
  particleQuality = 'balanced',
  swellSourcesEnabled = false,
  selectedVessel = 'traditional_craft',
  landingAreaPickMode = false,
  onLandingAreaPick = null,
  routePickMode = false,
  onRoutePointPick = null,
  routePoints = [],
  routeForecastResult = null,
}) {
  // mapRef  = DOM container div ref  (used as <div ref={mapRef}>)
  // mapInstance = actual MapLibre map ref (used for fitBounds, getZoom, etc.)
  const mapRef = useRef(null);
  const mapInstance = useRef(null);

  const overlayRef = useRef(null);
  // Shared across every UgridOverlay instance this hook ever creates (unlike
  // the overlay's own `didAutoFit`, which is a per-instance flag that starts
  // false again on every layer switch — hs -> tm02 -> tpeak each got its own
  // fresh instance, so the camera snapped to the mesh bounds on *every*
  // switch, not just the first load). Wrapped in an object rather than a bare
  // boolean so UgridOverlay can flip it via a stable reference regardless of
  // which instance currently holds it.
  const autoFitStateRef = useRef({ done: false });
  const particleOverlayRef = useRef(null);
  const arcOverlayRef = useRef(null);
  const playIntervalRef = useRef(null);
  const pinMarkerRef = useRef(null);
  const routeWaypointMarkersRef = useRef([]);
  const routeLegLabelMarkersRef = useRef([]);
  const routeHoverPopupRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const resizeFrameRef = useRef(null);
  const riskLatestReqRef = useRef(0);
  const riskPointsRef = useRef([]);

  const [timeCount, setTimeCount] = useState(1);
  const [timeLabels, setTimeLabels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [overlayStats, setOverlayStats] = useState(null);

  // Keep latest callback params in refs to avoid stale closures in map event listeners
  const cbRef = useRef({});
  cbRef.current = {
    setBottomCanvasData, setShowBottomCanvas, inundationCategories, minVisibleDepth, rangeWindow, selectedLayerId,
    opacity, sliderIndex, swellSourcesEnabled, selectedVessel,
    landingAreaPickMode, onLandingAreaPick,
    routePickMode, onRoutePointPick,
  };

  const overlayRefR = useRef(overlayRef);
  overlayRefR.current = overlayRef;

  const scheduleMapResize = useCallback(() => {
    if (resizeFrameRef.current) cancelAnimationFrame(resizeFrameRef.current);
    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      const map = mapInstance.current;
      const container = mapRef.current;
      if (!map || !container) return;
      if (container.clientWidth <= 0 || container.clientHeight <= 0) return;

      map.resize();
      map.triggerRepaint?.();
    });
  }, []);

  // ── map init (once) ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: ESRI_SAT_STYLE,
      center: [-169.86, -19.05],
      zoom: 8,
      maxPitch: 0,
      // Required for reliable canvas capture by the advisory exporter's
      // "Current map view" option. Without it WebGL may clear the drawing
      // buffer before html2canvas reads the map, yielding a blank snapshot.
      preserveDrawingBuffer: true,
      attributionControl: true,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-left');
    mapInstance.current = map;

    scheduleMapResize();
    window.addEventListener('resize', scheduleMapResize);
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserverRef.current = new ResizeObserver(scheduleMapResize);
      resizeObserverRef.current.observe(mapRef.current);
    }

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

      map.addSource(ROUTE_DRAFT_SOURCE, {
        type: 'geojson',
        data: emptyFeatureCollection(),
      });
      map.addSource(ROUTE_SEGMENTS_SOURCE, {
        type: 'geojson',
        data: emptyFeatureCollection(),
      });
      map.addLayer({
        id: ROUTE_SEGMENTS_LAYER,
        type: 'line',
        source: ROUTE_SEGMENTS_SOURCE,
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 12, 6, 14, 8],
          'line-color': [
            'match', ['get', 'hazardClass'],
            0, SUITABILITY_HAZARD_COLORS[0],
            1, SUITABILITY_HAZARD_COLORS[1],
            2, SUITABILITY_HAZARD_COLORS[2],
            '#94a3b8',
          ],
          'line-opacity': 0.92,
        },
      });
      map.addLayer({
        id: ROUTE_DRAFT_LAYER,
        type: 'line',
        source: ROUTE_DRAFT_SOURCE,
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 12, 4, 14, 5],
          'line-color': '#e0f2fe',
          'line-dasharray': [2, 1.2],
          'line-opacity': 0.9,
        },
      });
      map.on('click', RISK_CIRCLES_LAYER, onRiskClick);
      map.on('mouseenter', RISK_CIRCLES_LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', RISK_CIRCLES_LAYER, () => { map.getCanvas().style.cursor = ''; });
      // Route segments carry per-leg wave/wind/ETA in their properties (see
      // routeSamplesToSegmentFeatures) so a hover can surface the same
      // reading the results table shows, without a trip back to the panel.
      map.on('mousemove', ROUTE_SEGMENTS_LAYER, onRouteSegmentHover);
      map.on('mouseleave', ROUTE_SEGMENTS_LAYER, () => { routeHoverPopupRef.current?.remove(); });
      map.on('moveend', doRefreshRisk);
      map.on('zoomend', doRefreshRisk);
      if (riskEnabled) doRefreshRisk();
      setMapReady(true);
    };

    if (map.loaded()) onLoad(); else map.on('load', onLoad);

    map.on('click', onMapClick);

    return () => {
      map.off('click', onMapClick);
      window.removeEventListener('resize', scheduleMapResize);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      if (resizeFrameRef.current) {
        cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      particleOverlayRef.current?.destroy();
      particleOverlayRef.current = null;
      arcOverlayRef.current?.destroy();
      arcOverlayRef.current = null;
      clearRouteMapMarkers();
      routeHoverPopupRef.current?.remove();
      routeHoverPopupRef.current = null;
      map.remove();
      mapInstance.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── overlay lifecycle ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    // Guard against creating deck.gl overlays (UgridOverlay etc.) before the
    // map has finished loading its style. Their layers use beforeId:
    // 'risk-circles', which is only added once the map's 'load' event fires
    // (see map-init effect above) — creating them earlier makes deck.gl spam
    // "layer does not exist" errors on every style update until it does.
    if (!mapReady) return;

    const layerCfg = findLayerById(selectedLayerId);
    if (!layerCfg) return;

    if (layerCfg.type === 'pending-adapter') {
      if (overlayRef.current) {
        overlayRef.current.destroy();
        overlayRef.current = null;
      }
      setLoading(false);
      setOverlayStats(null);
      setError(layerCfg.disabledReason || `${layerCfg.label || selectedLayerId} is not available yet.`);
      return;
    }

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

    const ov = layerCfg.type === 'ugrid'
      ? new UgridOverlay(map, { ...layerCfg, opacity, autoFitState: autoFitStateRef.current })
      : layerCfg.sourceType === 'sfincs-raster'
      ? new SfincsRasterOverlay(map, {
          ...layerCfg,
          opacity,
          inundationCategories: cbRef.current.inundationCategories,
          minVisibleDepth: cbRef.current.minVisibleDepth,
        })
      : layerCfg.sourceType === 'niue-inundation-raster'
      ? new NiueInundationOverlay(map, {
          ...layerCfg,
          opacity,
          inundationCategories: cbRef.current.inundationCategories,
          minVisibleDepth: cbRef.current.minVisibleDepth,
        })
      : layerCfg.sourceType === 'niue-suitability-raster'
      ? new NiueSuitabilityOverlay(map, {
          ...layerCfg,
          opacity,
          vessel: cbRef.current.selectedVessel || layerCfg.defaultVessel,
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

    setSliderIndex(0);
    // Don't reset timeCount to 1 here (same reasoning as leaving timeLabels alone
    // below): the playback interval's stop condition is `nextIndex >= timeCount`,
    // and metadata loads are routinely slower than playSpeedMs (Wasabi has no
    // Cache-Control, and _loadMetadata is several sequential/parallel requests).
    // A transient timeCount of 1 made that check fire on the interval's very
    // first tick after almost every layer switch made mid-playback, silently
    // stopping animation before the new overlay's real timeCount ever arrived.
    // Keep the previous layer's timeCount as a harmless upper bound until the
    // new overlay's onTimeChange (line ~365) replaces it with the real value.
    //
    // Don't clear timeLabels here — keep previous layer's labels so currentSliderDate
    // is never null during the metadata load window. They'll be replaced as soon as
    // the new overlay fires onTimeChange and the [timeCount] effect runs.
    setOverlayStats(null);
    setError(null);

    return () => { ov.destroy(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayerId, mapReady]);

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
  }, [sliderIndex]);

  // ── opacity ───────────────────────────────────────────────────────────────
  // In 'particles' mode, dim the raster so particles dominate.
  useEffect(() => {
    const ov = overlayRef.current;
    const effective = waveParticleMode === 'particles' ? opacity * 0.15 : opacity;
    if (ov && typeof ov.setOpacity === 'function') ov.setOpacity(effective);
    particleOverlayRef.current?.setOpacity(opacity);
  }, [opacity, waveParticleMode]);

  // ── landing-area pick-mode cursor ────────────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (map) map.getCanvas().style.cursor = (landingAreaPickMode || routePickMode) ? 'crosshair' : '';
  }, [landingAreaPickMode, routePickMode, mapInstance]);

  // ── route draft / forecast rendering ─────────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !mapReady) return;
    const draftSource = map.getSource?.(ROUTE_DRAFT_SOURCE);
    const segmentSource = map.getSource?.(ROUTE_SEGMENTS_SOURCE);
    if (!draftSource || !segmentSource) return;

    draftSource.setData(routePointsToLineFeature(routePoints));
    segmentSource.setData({
      type: 'FeatureCollection',
      features: routeSamplesToSegmentFeatures(routeForecastResult),
    });

    clearRouteMapMarkers();
    const validPoints = routePoints.filter((p) => Number.isFinite(p?.lon) && Number.isFinite(p?.lat));

    validPoints.forEach((point, index) => {
      const kind = index === 0 ? 'origin' : index === validPoints.length - 1 ? 'destination' : 'waypoint';
      const el = document.createElement('div');
      el.textContent = String(index + 1);
      el.style.cssText = `
        width: 22px; height: 22px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font: 700 11px system-ui, sans-serif; color: #fff;
        background: ${ROUTE_WAYPOINT_COLORS[kind]};
        border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.45);
      `;
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([point.lon, point.lat])
        .addTo(map);
      routeWaypointMarkersRef.current.push(marker);
    });

    // Per-leg distance labels at each segment's midpoint — mirrors the
    // annotated leg distances in reference route planners. Computed
    // client-side from the raw waypoints so labels appear immediately while
    // drawing, before a forecast has been run.
    for (let i = 0; i < validPoints.length - 1; i += 1) {
      const a = validPoints[i];
      const b = validPoints[i + 1];
      const nm = haversineNm(a, b);
      const midLon = (a.lon + b.lon) / 2;
      const midLat = (a.lat + b.lat) / 2;
      const el = document.createElement('div');
      el.textContent = `${nm.toFixed(1)} nm`;
      el.style.cssText = `
        padding: 2px 6px; border-radius: 4px;
        font: 700 10px system-ui, sans-serif; color: #f8fafc;
        background: rgba(15, 23, 42, 0.78); border: 1px solid rgba(255,255,255,0.25);
        white-space: nowrap; pointer-events: none;
      `;
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([midLon, midLat])
        .addTo(map);
      routeLegLabelMarkersRef.current.push(marker);
    }
  }, [routePoints, routeForecastResult, mapReady]);

  // ── wave particle overlay lifecycle ──────────────────────────────────────
  useEffect(() => {
    const map   = mapInstance.current;
    const layer = findLayerById(selectedLayerId);
    const isUgrid = layer?.type === 'ugrid';

    // Destroy existing particle overlay when mode turns off or layer is incompatible
    if (particleOverlayRef.current && (waveParticleMode === 'off' || !isUgrid)) {
      particleOverlayRef.current.destroy();
      particleOverlayRef.current = null;
    }

    if (!map || waveParticleMode === 'off' || !isUgrid) return;

    // Create new particle overlay if not already running for this layer
    if (!particleOverlayRef.current) {
      const pov = new WaveParticleOverlay(map, {
        zarrBaseUrl:  layer.zarrBaseUrl,
        datasetName:  layer.datasetName,
        quality:      particleQuality,
        opacity:      cbRef.current.opacity,
      });
      pov.onErrorChange = (msg) => console.warn('[WaveParticleOverlay]', msg);
      particleOverlayRef.current = pov;
      // Sync to the current slider position immediately
      pov.setTimeIndex(sliderIndex);
    }

    return () => {
      // Only destroy on unmount — the explicit waveParticleMode=off branch above
      // handles the user turning the feature off mid-session.
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveParticleMode, selectedLayerId]);

  // ── sync particle quality without rebuilding the overlay ─────────────────
  useEffect(() => {
    particleOverlayRef.current?.setQuality(particleQuality);
  }, [particleQuality]);

  // ── sync particle time index ──────────────────────────────────────────────
  useEffect(() => {
    particleOverlayRef.current?.setTimeIndex(sliderIndex);
  }, [sliderIndex]);

  // ── swell source arc overlay lifecycle ───────────────────────────────────
  useEffect(() => {
    const map   = mapInstance.current;
    const layer = findLayerById(selectedLayerId);
    const isUgrid = layer?.type === 'ugrid';

    if (arcOverlayRef.current && (!swellSourcesEnabled || !isUgrid)) {
      arcOverlayRef.current.destroy();
      arcOverlayRef.current = null;
    }

    if (!map || !swellSourcesEnabled || !isUgrid) return;

    if (!arcOverlayRef.current) {
      arcOverlayRef.current = new SwellSourceArcOverlay(map);
    }

    return () => {
      // Destroyed explicitly above when swellSourcesEnabled turns off
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swellSourcesEnabled, selectedLayerId]);

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
    } else if (ov instanceof NiueInundationOverlay) {
      ov.updateConfig({ inundationCategories, minVisibleDepth });
    }
  }, [rangeWindow, inundationCategories, minVisibleDepth]);

  // ── suitability vessel class ──────────────────────────────────────────────
  useEffect(() => {
    const ov = overlayRef.current;
    if (ov instanceof NiueSuitabilityOverlay) {
      ov.setVessel(selectedVessel);
    }
  }, [selectedVessel]);

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
  function doRefreshRisk() {
    const map = mapInstance.current;
    if (!map) return;
    if (!riskEnabled) {
      const src = map.getSource?.(RISK_SOURCE);
      if (src) src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
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
        src.setData({
          type: 'FeatureCollection',
          features: pts
            .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon))
            .map((p) => ({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
              properties: { id: p.id, riskLevel: p.riskLevel ?? 0, maxTWL: p.maxTWL ?? null, type: p.type ?? '' },
            })),
        });
      })
      .catch((err) => console.error('Risk points fetch failed:', err));
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
        console.error('[useZarrMap] Risk point details fetch failed:', err);
        cbRef.current.setBottomCanvasData({ mode: 'risk', point, status: 'error', error: err.message });
        cbRef.current.setShowBottomCanvas(true);
      });
  }

  function onMapClick(e) {
    const map = mapInstance.current;
    if (!map) return;

    // Landing-area pick mode short-circuits all normal click behavior below —
    // risk points, transient suitability/timeseries pin, etc. Defaults to
    // false/null everywhere it isn't explicitly enabled, so this is a no-op
    // for every existing flow when the feature is unused.
    const {
      landingAreaPickMode: pickMode,
      onLandingAreaPick,
      routePickMode: routeMode,
      onRoutePointPick,
    } = cbRef.current;
    if (pickMode) {
      onLandingAreaPick?.(e.lngLat.lng, e.lngLat.lat);
      return;
    }
    if (routeMode) {
      onRoutePointPick?.(e.lngLat.lng, e.lngLat.lat);
      return;
    }

    // Skip if clicking a risk point
    const feats = map.queryRenderedFeatures(e.point, { layers: [RISK_CIRCLES_LAYER] });
    if (feats.length > 0) return;

    const ov = overlayRef.current;
    const { setBottomCanvasData: setCB, setShowBottomCanvas: setSC, inundationCategories: cats, minVisibleDepth: minDepth, rangeWindow: rw, selectedLayerId: currentLayerId } = cbRef.current;
    const layerCfg = findLayerById(currentLayerId);
    if (!layerCfg) return;

    const { lng, lat } = e.lngLat;

    if (layerCfg.sourceType === 'niue-suitability-raster') {
      if (!ov?.getSuitabilityAtPoint) return;
      addPinMarker(lng, lat, map);
      setCB({ mode: 'suitability', loading: true, lat, lng });
      setSC(true);
      ov.getSuitabilityAtPoint(lng, lat)
        .then((result) => {
          setCB({ mode: 'suitability', lat, lng, result });
        })
        .catch((err) => {
          console.error('[useZarrMap] Suitability point query failed:', err);
          setCB({ mode: 'suitability', lat, lng, error: err.message });
        });
      return;
    }

    if (!ov?.getTimeseriesAtPoint) return;
    addPinMarker(lng, lat, map);
    const isInundationLayer = layerCfg.sourceType === 'sfincs-raster' || layerCfg.sourceType === 'niue-inundation-raster' || layerCfg.heightVariable === 'h' || layerCfg.variable === 'h';
    setCB(isInundationLayer
      ? { mode: 'inundation', loading: true, lat, lng, rangeWindow: rw }
      : { loading: true, lat, lng, selectedLayer: layerCfg }
    );
    setSC(true);

    ov.getTimeseriesAtPoint(lng, lat, minDepth)
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
          const resolvedLat = result.lat ?? result.node_lat ?? lat;
          const resolvedLng = result.lon ?? result.node_lon ?? lng;
          setCB({
            lat: resolvedLat,
            lng: resolvedLng,
            selectedLayer: layerCfg,
            perVariableData,
          });
          // Feed swell partition data to arc overlay if active
          const arc = arcOverlayRef.current;
          if (arc && cbRef.current.swellSourcesEnabled) {
            const partitions = extractSwellPartitions(perVariableData, cbRef.current.sliderIndex);
            arc.setSwellPoint({ lat: resolvedLat, lng: resolvedLng, partitions });
          }
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
        console.error('[useZarrMap] Point timeseries fetch failed:', err);
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
    arcOverlayRef.current?.clear();
  }

  function clearRouteMapMarkers() {
    routeWaypointMarkersRef.current.forEach((m) => m.remove());
    routeWaypointMarkersRef.current = [];
    routeLegLabelMarkersRef.current.forEach((m) => m.remove());
    routeLegLabelMarkersRef.current = [];
  }

  function onRouteSegmentHover(e) {
    const map = mapInstance.current;
    const feature = e.features?.[0];
    if (!map || !feature) return;
    const p = feature.properties || {};
    const eta = formatEtaLabel(p.eta);
    const rows = [
      `<div style="font-weight:700;">${p.hazardLabel ?? 'Unknown'}</div>`,
      eta ? `<div>${eta}</div>` : '',
      Number.isFinite(p.distanceNm) ? `<div>${p.distanceNm.toFixed(1)} nm</div>` : '',
      Number.isFinite(p.waveHeightM) ? `<div>Wave: ${p.waveHeightM.toFixed(2)} m</div>` : '',
      Number.isFinite(p.windSpeedKt) ? `<div>Wind: ${p.windSpeedKt.toFixed(1)} kt</div>` : '',
    ].filter(Boolean).join('');

    if (!routeHoverPopupRef.current) {
      routeHoverPopupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
    }
    routeHoverPopupRef.current
      .setLngLat(e.lngLat)
      .setHTML(`<div style="font:12px system-ui, sans-serif; color:#0f172a; line-height:1.5;">${rows}</div>`)
      .addTo(map);
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
  // SFINCS/inundation/suitability overlays — all added via addSource/addLayer
  // outside the style JSON — survive the switch untouched.
  const setBasemap = useCallback((basemapId) => {
    const map = mapInstance.current;
    if (!map) return;
    const option = BASEMAP_OPTIONS.find((b) => b.id === basemapId);
    if (!option) return;

    // addSource/addLayer/removeLayer are safe any time after the map exists —
    // no need to gate on isStyleLoaded(), which also reflects whether raster
    // tile sources have finished loading and can be false during ordinary
    // panning/zooming. Gating on it made this silently no-op: it fell back to
    // map.once('load', ...), but 'load' only ever fires once in a map's
    // lifetime (at initial style load), so that listener would never fire
    // again and the basemap switch would just be dropped.
    if (map.getLayer(BASEMAP_LAYER_ID)) map.removeLayer(BASEMAP_LAYER_ID);
    if (map.getSource(BASEMAP_LAYER_ID)) map.removeSource(BASEMAP_LAYER_ID);
    map.addSource(BASEMAP_LAYER_ID, option.source);
    const firstLayerId = map.getStyle()?.layers?.[0]?.id;
    // raster-fade-duration: 0 — otherwise MapLibre cross-fades the new tiles
    // against the just-destroyed previous source's tiles, and the next render
    // tick throws (parentTile.texture is gone): "Cannot read properties of
    // undefined (reading 'bind')" in draw_raster.
    map.addLayer({ id: BASEMAP_LAYER_ID, type: 'raster', source: BASEMAP_LAYER_ID, paint: { 'raster-fade-duration': 0 } }, firstLayerId);
  }, []);

  // ── capTime compatibility shim for ForecastApp/InundationWindowControl ─────
  // NOTE (performance): zarr chunks fetched from Wasabi hit S3 on every request
  // because the bucket doesn't serve Cache-Control headers. Fix: add
  // "Cache-Control: public, max-age=3600" to the Wasabi bucket policy for the
  // spc-zarr-file bucket — chunks are immutable per model run.
  const availableTimestamps = timeLabels.map(parseTimeLabel).filter(Boolean);
  const forecastStart = availableTimestamps[0] ?? null;
  const forecastStartAgeHours = forecastStart
    ? (Date.now() - forecastStart.getTime()) / 3_600_000
    : null;
  const capTime = {
    loading,
    availableTimestamps,
    stepHours: 1,
    warmupSkipped: false,
    warmupDays: 0,
    forecastStart,
    forecastStartAgeHours,
    // The zarr source currently exposes forecast valid times, not a certified
    // backend model-run/init timestamp. Keep these legacy fields null so UI
    // and scenario workflows do not present inferred valid-time age as model
    // run age.
    modelRunStart: null,
    modelRunAgeHours: null,
    isStale: false,
    runTimeSource: 'unavailable',
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
  };
}

function extractSwellPartitions(perVariableData, sliderIndex) {
  const getValue = (varName) => {
    const cov = perVariableData?.[varName];
    if (!cov) return null;
    const vals = cov.ranges?.[varName]?.values;
    if (!Array.isArray(vals)) return null;
    const v = Number.isFinite(vals[sliderIndex]) ? vals[sliderIndex] : vals[0];
    return Number.isFinite(v) ? v : null;
  };
  const partitions = [];
  for (const suffix of ['p1', 'p2', 'p3']) {
    const hs  = getValue(`hs_${suffix}`);
    const dir = getValue(`dirp_${suffix}`);
    const tp  = getValue(`tp_${suffix}`);
    if (hs !== null && hs > 0.05 && dir !== null) {
      partitions.push({ id: suffix, hs, dir, tp });
    }
  }
  return partitions;
}

function toCoverageByVariable(result) {
  // Two response shapes are supported:
  // Zarr fallback:      { timeLabels: string[], variables: [{name, values, units, label}] }
  // ugridApiBase (FastAPI): { times: string[], variables: {name: values[]}, units: {}, long_names: {} }
  const times = result?.timeLabels || result?.times || [];
  const out = {};

  if (Array.isArray(result?.variables)) {
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
