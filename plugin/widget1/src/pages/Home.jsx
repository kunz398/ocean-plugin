import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import BottomOffCanvas from './BottomOffCanvas';
import BottomBuoyOffCanvas from './BottomBuoyOffCanvas';
import ForecastApp from '../components/ForecastApp';
import ModernHeader from '../components/ModernHeader';
import { MAP_LAYERS, findLayerById } from '../lib/mapLayersConfig';
import { useZarrMap } from '../hooks/useZarrMap';
import useInundationThresholds from '../hooks/useInundationThresholds';
import { useLandingAreaTimeseries } from '../hooks/useLandingAreaTimeseries';
import { useSeaLevelTimeseries } from '../hooks/useSeaLevelTimeseries';
import { fetchRouteForecast, parseRouteFile, parseAsUtcWallClock } from '../services/routeForecastService';
import {
  MAX_SCENARIOS,
  createScenario,
  duplicateScenario,
  findBetterDeparture,
  runAllScenarios,
  runScenario,
} from '../services/scenarioService';

const widgetContainerStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100vw',
  height: '100dvh',
  zIndex: 9999,
};

// SPOT-31153C, SPOT-31071C and the old SPOT-31091C mooring all went dark
// (last data 2024-05, 2024-09, and never respectively per api.sofarocean.com) —
// SPOT-30979C is the buoy the SPC Ocean Portal currently shows as Active for
// Niue, redeployed a few hundred metres from the old SPOT-31091C position.
//
// Niue has two live insitu stations per ocean-obs-api.spc.int/insitu/stations/:
// the Spotter wave buoy above, and the Alofi tide gauge below (station_id
// "alofi", a completely separate provider/schema — sea-level, not wave data).
const NIUE_BUOYS = [
  { id: 'SPOT-30979C', type: 'wave-buoy', lon: -169.92995, lat: -19.05343, highlight: true },
  { id: 'alofi', type: 'tide-gauge', label: 'Alofi Tide Gauge', lon: -169.9209, lat: -19.0527 },
];

function buoyMarkerColor(buoy) {
  if (buoy.type === 'tide-gauge') return '#f59e0b';
  return buoy.highlight ? '#22c55e' : '#0ea5e9';
}

function Home() {
  const allLayers = useMemo(() => MAP_LAYERS, []);
  const [selectedWaveForecast, setSelectedWaveForecast] = useState(allLayers[0]?.value ?? '');
  const [wmsOpacity, setWmsOpacity] = useState(1);
  // riskPoints defaults to false: Niue has no risk/points.json published on
  // THREDDS yet (unlike Cook Islands). The fetch/render code is wired and
  // ready — flip this once SPC publishes NIU/risk/points.json.
  const [activeLayers, setActiveLayers] = useState({ waveForecast: true, riskPoints: false });
  const [sliderIndex, setSliderIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeedMs, setPlaySpeedMs] = useState(700);
  const [waveParticleMode, setWaveParticleMode] = useState('off');
  const [particleQuality, setParticleQuality] = useState('balanced');
  const [swellSourcesEnabled, setSwellSourcesEnabled] = useState(false);
  const [selectedVessel, setSelectedVessel] = useState('traditional_craft');
  const [showBottomCanvas, setShowBottomCanvas] = useState(false);
  const [bottomCanvasData, setBottomCanvasData] = useState(null);
  const [showBuoyCanvas, setShowBuoyCanvas] = useState(false);
  const [selectedBuoyId, setSelectedBuoyId] = useState(null);
  const [selectedBuoyType, setSelectedBuoyType] = useState(null);
  const buoyMarkersRef = useRef([]);

  // Landing-area advisory: a persistent, user-selected launch point (preset or
  // clicked), distinct from the transient click-to-query pin in useZarrMap.js.
  const [landingArea, setLandingArea] = useState(null); // {label, lon, lat, source:'preset'|'click'}
  const [landingAreaPickMode, setLandingAreaPickMode] = useState(false);
  const landingMarkerRef = useRef(null);
  const suitabilityApiBase = findLayerById('niue-suitability')?.apiBase ?? '';
  const landingAreaTimeseries = useLandingAreaTimeseries(landingArea, selectedVessel, suitabilityApiBase);
  const [routePoints, setRoutePoints] = useState([]);
  const [routePickMode, setRoutePickMode] = useState(false);
  const [routeSpeedKt, setRouteSpeedKt] = useState(8);
  const [routeDepartureTime, setRouteDepartureTime] = useState('');
  // App-wide display zone for every date/time readout (NUT = Pacific/Niue,
  // fixed UTC-11 year-round, or UTC) — lifted here (rather than living inside
  // ForecastApp, which owned it before) so ModernHeader and the BottomOffCanvas
  // panels can respect the same toggle as the timeline.
  const [timeDisplayZone, setTimeDisplayZone] = useState('Pacific/Niue');
  const [routeForecastResult, setRouteForecastResult] = useState(null);
  const [routeForecastLoading, setRouteForecastLoading] = useState(false);
  const [routeForecastError, setRouteForecastError] = useState('');

  // Scenario comparison: saved snapshots of route/vessel/speed/departure,
  // each independently run against /niue/suitability/route and kept
  // side-by-side, unlike routeForecastResult above which is a single slot
  // that gets clobbered on every new run.
  const [scenarios, setScenarios] = useState([]);
  const [runningScenarioIds, setRunningScenarioIds] = useState([]);
  // Set to the scenario's id right after "Confirm & compare" creates it, so
  // the sidebar's ScenarioComparisonPanel can scroll to and briefly highlight
  // that specific card — the confirm button lives in a different part of the
  // screen (the route-forecast results panel) than where its result appears.
  const [confirmedScenarioId, setConfirmedScenarioId] = useState(null);

  // Route-forecast suggestions: "suggest a better vessel" is computed
  // client-side inline in RouteForecastPanel (no state needed here — see
  // handleConfirmVesselSuggestion below for its one-call confirm step).
  // "Suggest better departure" makes several real backend calls, so its
  // progress/result live here alongside the other routeForecast* state it
  // parallels.
  const [departureSuggestionLoading, setDepartureSuggestionLoading] = useState(false);
  const [departureSuggestionProgress, setDepartureSuggestionProgress] = useState(null);
  const [departureSuggestionResult, setDepartureSuggestionResult] = useState(null);
  const [departureSuggestionError, setDepartureSuggestionError] = useState('');

  // Describes a specific route/vessel/speed/departure snapshot — if any of
  // those change, or a fresh route forecast is run, a stale suggestion must
  // not be applyable/exportable against inputs it no longer describes.
  const clearRouteSuggestions = useCallback(() => {
    setDepartureSuggestionResult(null);
    setDepartureSuggestionError('');
  }, []);

  useEffect(() => {
    clearRouteSuggestions();
  }, [routePoints, selectedVessel, routeSpeedKt, routeDepartureTime, clearRouteSuggestions]);

  // Landing-area pick and route-point pick are two independent toggles that
  // both put the map into "next click does something special" mode. Nothing
  // previously stopped both being on at once, which made a map click
  // ambiguous (only landingAreaPickMode actually won, per useZarrMap's
  // branch order — but the route toggle stayed lit as if it were still
  // live). Force them mutually exclusive at the point of turning one on.
  const handleSetLandingAreaPickMode = useCallback((valueOrUpdater) => {
    setLandingAreaPickMode((prev) => {
      const next = typeof valueOrUpdater === 'function' ? valueOrUpdater(prev) : valueOrUpdater;
      if (next) setRoutePickMode(false);
      return next;
    });
  }, []);

  const handleSetRoutePickMode = useCallback((valueOrUpdater) => {
    setRoutePickMode((prev) => {
      const next = typeof valueOrUpdater === 'function' ? valueOrUpdater(prev) : valueOrUpdater;
      if (next) setLandingAreaPickMode(false);
      return next;
    });
  }, []);

  const handleLandingAreaPick = useCallback((lng, lat) => {
    setLandingArea({ label: 'Custom location', lon: lng, lat, source: 'click' });
    setLandingAreaPickMode(false);
  }, []);

  const handleRoutePointPick = useCallback((lng, lat) => {
    setRoutePoints((points) => [...points, { lon: lng, lat }]);
    setRouteForecastResult(null);
    setRouteForecastError('');
  }, []);

  const handleClearRoute = useCallback(() => {
    setRoutePoints([]);
    setRouteForecastResult(null);
    setRouteForecastError('');
    setRoutePickMode(false);
  }, []);

  const handleUndoRoutePoint = useCallback(() => {
    setRoutePoints((points) => points.slice(0, -1));
    setRouteForecastResult(null);
    setRouteForecastError('');
  }, []);

  const handleRouteImport = useCallback(async (file) => {
    try {
      const points = await parseRouteFile(file);
      setRoutePoints(points);
      setRouteForecastResult(null);
      setRouteForecastError('');
      setRoutePickMode(false);
    } catch (err) {
      console.error('[Home] Route import failed:', err);
      setRouteForecastError(err.message || 'Imported route could not be read.');
    }
  }, []);

  useEffect(() => {
    if (showBottomCanvas) setShowBuoyCanvas(false);
  }, [showBottomCanvas]);

  useEffect(() => {
    if (showBuoyCanvas) setShowBottomCanvas(false);
  }, [showBuoyCanvas]);

  const inundationThresholds = useInundationThresholds();

  const {
    mapRef,
    mapInstance,
    timeCount,
    currentSliderDate,
    capTime,
    loading,
    error: overlayError,
    overlayStats,
    fitBounds,
    setBasemap,
    removePinMarker,
  } = useZarrMap({
    selectedLayerId: selectedWaveForecast,
    sliderIndex,
    setSliderIndex,
    isPlaying,
    setIsPlaying,
    playSpeedMs,
    opacity: wmsOpacity,
    thresholds: null,
    inundationCategories: inundationThresholds.categories,
    minVisibleDepth: inundationThresholds.minVisibleDepth,
    riskEnabled: activeLayers?.riskPoints !== false,
    setBottomCanvasData,
    setShowBottomCanvas,
    waveParticleMode,
    particleQuality,
    swellSourcesEnabled,
    selectedVessel,
    landingAreaPickMode,
    onLandingAreaPick: handleLandingAreaPick,
    routePickMode,
    onRoutePointPick: handleRoutePointPick,
    routePoints,
    routeForecastResult,
  });

  // Layer errors are dev/ops signal, not something to alarm the end user with —
  // log to console instead of the "Layer error" banner this used to render.
  useEffect(() => {
    if (overlayError) console.error('[Home] Layer error:', overlayError);
  }, [overlayError]);

  const seaLevelStartTime = capTime.availableTimestamps?.[0]?.toISOString?.() ?? null;
  const seaLevelEndTime = capTime.availableTimestamps?.[capTime.availableTimestamps.length - 1]?.toISOString?.() ?? null;
  // Last timestep of the currently active wave-forecast layer — the single
  // source of truth for "how far ahead can a route/vessel-suitability
  // departure time go." Shared by the departure-time picker's max (via
  // ForecastApp -> RouteForecastControls), the run-forecast clamp below, and
  // findBetterDeparture's own probe-offset filtering, so all three always
  // agree on the same boundary.
  const forecastEndTime = useMemo(
    () => capTime.availableTimestamps?.[capTime.availableTimestamps.length - 1] ?? null,
    [capTime.availableTimestamps]
  );
  // First timestep of the currently active wave-forecast layer — the lower
  // bound counterpart to forecastEndTime, so the departure-time picker can't
  // be set before the forecast window even starts.
  const forecastStartTime = useMemo(
    () => capTime.availableTimestamps?.[0] ?? null,
    [capTime.availableTimestamps]
  );
  const seaLevelTimeseries = useSeaLevelTimeseries(
    suitabilityApiBase,
    seaLevelStartTime,
    seaLevelEndTime,
    showBottomCanvas
  );

  const totalSteps = Math.max(1, timeCount) - 1;

  const handleRunRouteForecast = useCallback(async () => {
    let departureTime = routeDepartureTime || currentSliderDate?.toISOString?.();
    // Belt-and-braces: RouteForecastControls constrains and clamps the date
    // picker itself, but a departure time can still reach here stale (e.g.
    // set before a layer switch shortened the forecast window, or restored
    // from an imported/saved scenario) — never send the backend a departure
    // beyond the data we actually have.
    // parseAsUtcWallClock, not new Date() — departureTime here is sometimes
    // the truncated no-Z routeDepartureTime string (which new Date() would
    // silently parse as local time, not UTC) and sometimes a full Z-suffixed
    // ISO string from currentSliderDate; only parseAsUtcWallClock handles both correctly.
    if (departureTime && forecastEndTime && parseAsUtcWallClock(departureTime)?.getTime() > forecastEndTime.getTime()) {
      console.warn(
        `[Home] Route departure time ${departureTime} is beyond the forecast end (${forecastEndTime.toISOString()}) — clamping.`
      );
      departureTime = forecastEndTime.toISOString();
    }
    if (departureTime && forecastStartTime && parseAsUtcWallClock(departureTime)?.getTime() < forecastStartTime.getTime()) {
      console.warn(
        `[Home] Route departure time ${departureTime} is before the forecast start (${forecastStartTime.toISOString()}) — clamping.`
      );
      departureTime = forecastStartTime.toISOString();
    }
    clearRouteSuggestions(); // a fresh result invalidates suggestions computed against the old one
    setRouteForecastLoading(true);
    setRouteForecastError('');
    setBottomCanvasData({ mode: 'route-forecast', loading: true, routePoints, selectedVessel, speedKt: routeSpeedKt });
    setShowBottomCanvas(true);
    try {
      const result = await fetchRouteForecast(suitabilityApiBase, {
        routePoints,
        vessel: selectedVessel,
        departureTime,
        speedKt: routeSpeedKt,
      });
      setRouteForecastResult(result);
      setBottomCanvasData({
        mode: 'route-forecast',
        routePoints,
        selectedVessel,
        speedKt: routeSpeedKt,
        departureTime,
        result,
        // Provenance: when this was fetched, and which forecast window was
        // active at the time — see RouteForecastPanel's rerun/superseded
        // banners, and scenarioService's isScenarioSuperseded.
        generatedAt: new Date().toISOString(),
        modelRunStartAtFetch: capTime.modelRunStart,
      });
      setShowBottomCanvas(true);
    } catch (err) {
      const message = err.message || 'Route forecast failed. Please try again.';
      console.error('[Home] Route forecast failed:', err);
      setRouteForecastError(message);
      setRouteForecastResult(null);
      setBottomCanvasData({
        mode: 'route-forecast',
        routePoints,
        selectedVessel,
        speedKt: routeSpeedKt,
        departureTime,
        error: message,
      });
      setShowBottomCanvas(true);
    } finally {
      setRouteForecastLoading(false);
    }
  }, [currentSliderDate, routeDepartureTime, routePoints, routeSpeedKt, selectedVessel, suitabilityApiBase, capTime.modelRunStart, forecastEndTime, forecastStartTime, clearRouteSuggestions]);

  // ── Scenario comparison ─────────────────────────────────────────────────
  const handleSaveCurrentAsScenario = useCallback(() => {
    setScenarios((prev) => {
      if (prev.length >= MAX_SCENARIOS || routePoints.length < 2) return prev;
      const departureTime = routeDepartureTime || currentSliderDate?.toISOString?.() || '';
      return [...prev, createScenario({
        vessel: selectedVessel,
        routePoints,
        departureTime,
        speedKt: routeSpeedKt,
        existingScenarios: prev,
      })];
    });
  }, [currentSliderDate, routeDepartureTime, routePoints, routeSpeedKt, selectedVessel]);

  const handleDuplicateScenario = useCallback((scenarioId) => {
    setScenarios((prev) => {
      if (prev.length >= MAX_SCENARIOS) return prev;
      const original = prev.find((s) => s.id === scenarioId);
      if (!original) return prev;
      return [...prev, duplicateScenario(original, {}, prev)];
    });
  }, []);

  const handleRemoveScenario = useCallback((scenarioId) => {
    setScenarios((prev) => prev.filter((s) => s.id !== scenarioId));
    setRunningScenarioIds((prev) => prev.filter((id) => id !== scenarioId));
  }, []);

  const handleRunScenario = useCallback(async (scenarioId) => {
    const target = scenarios.find((s) => s.id === scenarioId);
    if (!target) return;
    setRunningScenarioIds((prev) => (prev.includes(scenarioId) ? prev : [...prev, scenarioId]));
    setScenarios((prev) => prev.map((s) => (s.id === scenarioId ? { ...s, status: 'running' } : s)));
    const updated = await runScenario(suitabilityApiBase, target, { modelRunStart: capTime.modelRunStart });
    setScenarios((prev) => prev.map((s) => (s.id === scenarioId ? updated : s)));
    setRunningScenarioIds((prev) => prev.filter((id) => id !== scenarioId));
  }, [scenarios, suitabilityApiBase, capTime.modelRunStart]);

  const handleRunAllScenarios = useCallback(async () => {
    if (!scenarios.length) return;
    const ids = scenarios.map((s) => s.id);
    setRunningScenarioIds(ids);
    setScenarios((prev) => prev.map((s) => (ids.includes(s.id) ? { ...s, status: 'running' } : s)));
    await runAllScenarios(suitabilityApiBase, scenarios, {
      modelRunStart: capTime.modelRunStart,
      onScenarioSettled: (updated) => {
        setScenarios((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        setRunningScenarioIds((prev) => prev.filter((id) => id !== updated.id));
      },
    });
  }, [scenarios, suitabilityApiBase, capTime.modelRunStart]);

  // ── Route-forecast suggestions ──────────────────────────────────────────

  // Feature A's initial suggestion is computed inline in RouteForecastPanel
  // (pure, no fetch). This "Confirm & compare" step is its only network call:
  // exactly one real fetchRouteForecast (via the existing runScenario), which
  // becomes a normal comparable scenario — no bespoke fetch logic needed.
  const handleConfirmVesselSuggestion = useCallback(async (vesselCode) => {
    if (!vesselCode || scenarios.length >= MAX_SCENARIOS) return;
    const departureTime = routeForecastResult?.departure_time || routeDepartureTime || currentSliderDate?.toISOString?.() || '';
    const draft = createScenario({
      vessel: vesselCode, routePoints, departureTime, speedKt: routeSpeedKt, existingScenarios: scenarios,
    });
    setScenarios((prev) => [...prev, draft]);
    setRunningScenarioIds((prev) => [...prev, draft.id]);
    const updated = await runScenario(suitabilityApiBase, draft, { modelRunStart: capTime.modelRunStart });
    setScenarios((prev) => prev.map((s) => (s.id === draft.id ? updated : s)));
    setRunningScenarioIds((prev) => prev.filter((id) => id !== draft.id));
    setConfirmedScenarioId(updated.id);
    return updated;
  }, [scenarios, routeForecastResult, routeDepartureTime, currentSliderDate, routePoints, routeSpeedKt, suitabilityApiBase, capTime.modelRunStart]);

  const handleSuggestBetterDeparture = useCallback(async () => {
    if (!routeForecastResult || departureSuggestionLoading) return;
    setDepartureSuggestionLoading(true);
    setDepartureSuggestionError('');
    setDepartureSuggestionResult(null);
    setDepartureSuggestionProgress(null);
    try {
      const result = await findBetterDeparture(suitabilityApiBase, {
        routePoints,
        vessel: selectedVessel,
        departureTime: routeForecastResult.departure_time,
        speedKt: routeSpeedKt,
        maxDepartureTime: forecastEndTime,
      }, { onProgress: setDepartureSuggestionProgress });
      setDepartureSuggestionResult(result.found ? result : null);
      if (!result.found) {
        setDepartureSuggestionError(
          result.checkedOffsets.length === 0
            ? 'Already at the end of the available forecast — no later departure times to check.'
            : result.skippedOffsets.length > 0
              ? `No better departure window found in the next ${Math.max(...result.checkedOffsets)}h (the forecast ends before later options could be checked).`
              : 'No better departure window found in the next 24 hours.'
        );
      }
    } catch (err) {
      console.error('[Home] Departure suggestion failed:', err);
      setDepartureSuggestionError(err.message || 'Could not check alternative departure times.');
    } finally {
      setDepartureSuggestionLoading(false);
      setDepartureSuggestionProgress(null);
    }
  }, [routeForecastResult, departureSuggestionLoading, suitabilityApiBase, routePoints, selectedVessel, routeSpeedKt, forecastEndTime]);

  // Applies an already-fetched suggestion directly — no redundant re-fetch,
  // we already have the real result from findBetterDeparture. Setting
  // routeDepartureTime triggers the clearRouteSuggestions effect above,
  // which is fine: departureTime/result are already captured locally here.
  const handleApplyDepartureSuggestion = useCallback(() => {
    if (!departureSuggestionResult) return;
    const { departureTime, result } = departureSuggestionResult;
    setRouteDepartureTime(departureTime.slice(0, 16));
    setRouteForecastResult(result);
    setBottomCanvasData({
      mode: 'route-forecast',
      routePoints, selectedVessel, speedKt: routeSpeedKt, departureTime,
      result,
      generatedAt: new Date().toISOString(),
      modelRunStartAtFetch: capTime.modelRunStart,
    });
    setShowBottomCanvas(true);
  }, [departureSuggestionResult, routePoints, selectedVessel, routeSpeedKt, capTime.modelRunStart]);

  // Also skips a redundant re-fetch — builds a ready scenario directly from
  // the result findBetterDeparture already confirmed.
  const handleSaveDepartureSuggestionAsScenario = useCallback(() => {
    if (!departureSuggestionResult || scenarios.length >= MAX_SCENARIOS) return;
    const { departureTime, result } = departureSuggestionResult;
    const now = new Date().toISOString();
    const draft = createScenario({
      vessel: selectedVessel, routePoints, departureTime, speedKt: routeSpeedKt, existingScenarios: scenarios,
    });
    setScenarios((prev) => [...prev, {
      ...draft, status: 'ready', forecastResult: result, updatedAt: now, generatedAt: now, modelRunStartAtRun: capTime.modelRunStart,
    }]);
  }, [departureSuggestionResult, scenarios, selectedVessel, routePoints, routeSpeedKt, capTime.modelRunStart]);

  useEffect(() => {
    if (!routeDepartureTime && currentSliderDate) {
      setRouteDepartureTime(currentSliderDate.toISOString().slice(0, 16));
    }
  }, [currentSliderDate, routeDepartureTime]);

  const handleHideBottomCanvas = useCallback(() => {
    setShowBottomCanvas(false);
    removePinMarker?.();
  }, [removePinMarker]);

  const handleBuoySelect = useCallback((buoy) => {
    setSelectedBuoyId(buoy.id);
    setSelectedBuoyType(buoy.type);
    setShowBuoyCanvas(true);
  }, []);

  const handleTimeSelect = useCallback((date) => {
    const timestamps = capTime.availableTimestamps;
    if (!timestamps?.length || !date) return;
    const target = date.getTime();
    let bestIndex = 0;
    let bestDiff = Infinity;

    timestamps.forEach((timestamp, index) => {
      const diff = Math.abs(timestamp.getTime() - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = index;
      }
    });

    setSliderIndex(bestIndex);
  }, [capTime.availableTimestamps]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return undefined;

    buoyMarkersRef.current.forEach((marker) => marker.remove());
    buoyMarkersRef.current = [];

    buoyMarkersRef.current = NIUE_BUOYS.map((buoy) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.title = buoy.label ?? buoy.id;
      el.className = 'maplibre-buoy-marker';
      el.style.cssText = [
        'width:22px',
        'height:22px',
        'border-radius:50%',
        'border:3px solid #ffffff',
        `background:${buoyMarkerColor(buoy)}`,
        'box-shadow:0 2px 8px rgba(0,0,0,0.35)',
        'cursor:pointer',
      ].join(';');
      el.addEventListener('click', (event) => {
        event.stopPropagation();
        handleBuoySelect(buoy);
      });

      return new maplibregl.Marker({ element: el })
        .setLngLat([buoy.lon, buoy.lat])
        .addTo(map);
    });

    return () => {
      buoyMarkersRef.current.forEach((marker) => marker.remove());
      buoyMarkersRef.current = [];
    };
  }, [handleBuoySelect, mapInstance]);

  // Persistent landing-area flag marker — separate from useZarrMap's
  // transient click-query pin (pinMarkerRef/addPinMarker/removePinMarker).
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return undefined;

    landingMarkerRef.current?.remove();
    landingMarkerRef.current = null;
    if (!landingArea) return undefined;

    const el = document.createElement('button');
    el.type = 'button';
    el.title = landingArea.label;
    el.className = 'landing-area-flag-marker';
    el.style.cssText = [
      'width:26px',
      'height:26px',
      'border-radius:50% 50% 50% 0',
      'transform:rotate(-45deg)',
      'border:3px solid #ffffff',
      'background:#e11d48',
      'box-shadow:0 2px 8px rgba(0,0,0,0.35)',
      'cursor:pointer',
    ].join(';');
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      setBottomCanvasData({ mode: 'landing-area', landingArea, selectedVessel });
      setShowBottomCanvas(true);
    });

    landingMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([landingArea.lon, landingArea.lat])
      .addTo(map);

    return () => {
      landingMarkerRef.current?.remove();
      landingMarkerRef.current = null;
    };
  }, [landingArea, mapInstance, selectedVessel]);

  return (
    <div style={widgetContainerStyle}>
      <ModernHeader capTime={capTime} timeDisplayZone={timeDisplayZone} />
      <ForecastApp
        inundationThresholds={inundationThresholds}
        WAVE_FORECAST_LAYERS={allLayers}
        ALL_LAYERS={allLayers}
        selectedWaveForecast={selectedWaveForecast}
        setSelectedWaveForecast={setSelectedWaveForecast}
        opacity={wmsOpacity}
        setOpacity={setWmsOpacity}
        sliderIndex={sliderIndex}
        setSliderIndex={setSliderIndex}
        totalSteps={totalSteps}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        playSpeedMs={playSpeedMs}
        setPlaySpeedMs={setPlaySpeedMs}
        waveParticleMode={waveParticleMode}
        setWaveParticleMode={setWaveParticleMode}
        particleQuality={particleQuality}
        setParticleQuality={setParticleQuality}
        swellSourcesEnabled={swellSourcesEnabled}
        setSwellSourcesEnabled={setSwellSourcesEnabled}
        selectedVessel={selectedVessel}
        setSelectedVessel={setSelectedVessel}
        currentSliderDate={currentSliderDate}
        capTime={capTime}
        forecastEndTime={forecastEndTime}
        forecastStartTime={forecastStartTime}
        timeDisplayZone={timeDisplayZone}
        setTimeDisplayZone={setTimeDisplayZone}
        overlayStats={overlayStats}
        activeLayers={activeLayers}
        setActiveLayers={setActiveLayers}
        mapRef={mapRef}
        mapInstance={mapInstance}
        setBasemap={setBasemap}
        isUpdatingVisualization={loading}
        minIndex={0}
        isBuffering={false}
        fitBounds={fitBounds}
        enableLegacyMapInteraction={false}
        setBottomCanvasData={setBottomCanvasData}
        setShowBottomCanvas={setShowBottomCanvas}
        landingArea={landingArea}
        setLandingArea={setLandingArea}
        landingAreaPickMode={landingAreaPickMode}
        setLandingAreaPickMode={handleSetLandingAreaPickMode}
        routePoints={routePoints}
        routePickMode={routePickMode}
        setRoutePickMode={handleSetRoutePickMode}
        routeSpeedKt={routeSpeedKt}
        setRouteSpeedKt={setRouteSpeedKt}
        routeDepartureTime={routeDepartureTime}
        setRouteDepartureTime={setRouteDepartureTime}
        routeForecastResult={routeForecastResult}
        routeForecastLoading={routeForecastLoading}
        routeForecastError={routeForecastError}
        onRunRouteForecast={handleRunRouteForecast}
        onClearRoute={handleClearRoute}
        onUndoRoutePoint={handleUndoRoutePoint}
        onRouteImport={handleRouteImport}
        scenarios={scenarios}
        confirmedScenarioId={confirmedScenarioId}
        runningScenarioIds={runningScenarioIds}
        currentModelRunStart={capTime.modelRunStart}
        onSaveCurrentAsScenario={handleSaveCurrentAsScenario}
        onDuplicateScenario={handleDuplicateScenario}
        onRemoveScenario={handleRemoveScenario}
        onRunScenario={handleRunScenario}
        onRunAllScenarios={handleRunAllScenarios}
        oceanStations={NIUE_BUOYS}
        onOceanStationSelect={handleBuoySelect}
      />
      <BottomOffCanvas
        show={showBottomCanvas}
        onTimeSelect={handleTimeSelect}
        onHide={handleHideBottomCanvas}
        data={bottomCanvasData}
        currentSliderDate={currentSliderDate}
        timeDisplayZone={timeDisplayZone}
        landingAreaTimeseries={landingAreaTimeseries}
        seaLevelTimeseries={seaLevelTimeseries}
        suitabilityApiBase={suitabilityApiBase}
        currentTimeIndex={sliderIndex}
        onRunRouteForecast={handleRunRouteForecast}
        currentRouteInputs={{ routePoints, vessel: selectedVessel, speedKt: routeSpeedKt, departureTime: routeDepartureTime }}
        currentModelRunStart={capTime.modelRunStart}
        scenarioCount={scenarios.length}
        onConfirmVesselSuggestion={handleConfirmVesselSuggestion}
        departureSuggestionLoading={departureSuggestionLoading}
        departureSuggestionProgress={departureSuggestionProgress}
        departureSuggestionResult={departureSuggestionResult}
        departureSuggestionError={departureSuggestionError}
        onSuggestBetterDeparture={handleSuggestBetterDeparture}
        onApplyDepartureSuggestion={handleApplyDepartureSuggestion}
        onSaveDepartureSuggestionAsScenario={handleSaveDepartureSuggestionAsScenario}
      />
      <BottomBuoyOffCanvas
        show={showBuoyCanvas}
        onHide={() => setShowBuoyCanvas(false)}
        buoyId={selectedBuoyId}
        buoyType={selectedBuoyType}
        buoyLabel={NIUE_BUOYS.find((b) => b.id === selectedBuoyId)?.label}
      />
    </div>
  );
}

export default Home;
