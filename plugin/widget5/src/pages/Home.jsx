import React, { useCallback, useEffect, useMemo, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import BottomOffCanvas from './BottomOffCanvas';
import BottomBuoyOffCanvas from './BottomBuoyOffCanvas';
import ForecastApp from '../components/ForecastApp';
import useInundationThresholds from '../hooks/useInundationThresholds';
import ModernHeader from '../components/ModernHeader';
import { FLOOD_3D_CONFIG, MAP_LAYERS, MAP_TERRAIN_CONFIG } from '../lib/mapLayersConfig';
import { useZarrMap } from '../hooks/useZarrMap';

const widgetContainerStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100vw',
  height: 'calc(100dvh - 0px)',
  zIndex: 9999,
};

function CookIslandsForecast() {
  const inundationThresholds = useInundationThresholds();

  // ── layer / variable selection ───────────────────────────────────────────
  const ALL_LAYERS = useMemo(() => MAP_LAYERS, []);
  const [selectedWaveForecast, setSelectedWaveForecast] = useState(ALL_LAYERS[0]?.value ?? '');
  const [wmsOpacity, setWmsOpacity] = useState(1.0);
  const [activeLayers, setActiveLayers] = useState({
    waveForecast: true,
    riskPoints: true,
  });
  const [sliderIndex, setSliderIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeedMs, setPlaySpeedMs] = useState(700);
  const [rangeWindow, setRangeWindow] = useState({ mode: 'single' });
  // App-wide display zone for every date/time readout (CKT = Pacific/Rarotonga,
  // fixed UTC-10 year-round, or UTC) — lifted here (rather than living inside
  // ForecastApp, which owned it before) so ModernHeader and the BottomOffCanvas
  // panels can respect the same toggle as the timeline.
  const [timeDisplayZone, setTimeDisplayZone] = useState('Pacific/Rarotonga');
  const [terrainEnabled, setTerrainEnabled] = useState(false);
  const [floodDisplayMode, setFloodDisplayMode] = useState('2d');
  const [flood3dElevScale, setFlood3dElevScale] = useState(FLOOD_3D_CONFIG.elevationScale ?? 6);

  // ── canvas visibility ────────────────────────────────────────────────────
  const [showBottomCanvas, setShowBottomCanvas] = useState(false);
  const [bottomCanvasData, setBottomCanvasData] = useState(null);
  const [showBuoyCanvas, setShowBuoyCanvas] = useState(false);

  // Mutual exclusion: only one panel open at a time
  useEffect(() => { if (showBottomCanvas) setShowBuoyCanvas(false); }, [showBottomCanvas]);
  useEffect(() => { if (showBuoyCanvas) setShowBottomCanvas(false); }, [showBuoyCanvas]);

  // ── thresholds → zarr overlay thresholds ────────────────────────────────
  const zarrThresholds = useMemo(() => {
    const cats = inundationThresholds.lastValidCategories;
    if (!Array.isArray(cats) || cats.length === 0) return null;
    return cats
      .filter((c) => Number.isFinite(c?.thresholdM))
      .sort((a, b) => a.thresholdM - b.thresholdM)
      .map((c) => ({ value: c.thresholdM, color: hexToRgb(c.color) }));
  }, [inundationThresholds.lastValidCategories]);

  // ── main map + overlay hook ──────────────────────────────────────────────
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
    setShowContours,
    refreshRiskMarkerColors,
  } = useZarrMap({
    selectedLayerId: selectedWaveForecast,
    sliderIndex,
    setSliderIndex,
    isPlaying,
    setIsPlaying,
    playSpeedMs,
    opacity: wmsOpacity,
    thresholds: zarrThresholds,
    riskEnabled: activeLayers?.riskPoints !== false,
    setBottomCanvasData,
    setShowBottomCanvas,
    inundationCategories: inundationThresholds.lastValidCategories,
    minVisibleDepth: inundationThresholds.minVisibleDepth,
    rangeWindow,
    terrainEnabled,
    terrainConfig: MAP_TERRAIN_CONFIG,
    flood3dEnabled: floodDisplayMode === '3d',
    flood3dConfig: FLOOD_3D_CONFIG,
    flood3dElevScale,
  });

  const totalSteps = Math.max(1, timeCount) - 1;

  // Layer errors are dev/ops signal, not something to alarm the end user with —
  // log to console instead of the "Layer error" banner this used to render.
  useEffect(() => {
    if (overlayError) console.error('[Home] Layer error:', overlayError);
  }, [overlayError]);

  const handleHideBottomCanvas = useCallback(() => {
    setShowBottomCanvas(false);
    removePinMarker();
  }, [removePinMarker]);

  const handleTimeSelect = useCallback((date) => {
    const timestamps = capTime.availableTimestamps;
    if (!timestamps?.length || !date) return;
    const t = date.getTime();
    let best = 0, bestDiff = Infinity;
    timestamps.forEach((ts, i) => {
      const diff = Math.abs(ts.getTime() - t);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    });
    setSliderIndex(best);
  }, [capTime.availableTimestamps, setSliderIndex]);

  return (
    <div style={widgetContainerStyle}>
      <ModernHeader timeDisplayZone={timeDisplayZone} />
      <ForecastApp
        WAVE_FORECAST_LAYERS={ALL_LAYERS}
        ALL_LAYERS={ALL_LAYERS}
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
        currentSliderDate={currentSliderDate}
        capTime={capTime}
        overlayStats={overlayStats}
        activeLayers={activeLayers}
        setActiveLayers={setActiveLayers}
        mapRef={mapRef}
        mapInstance={mapInstance}
        setBasemap={setBasemap}
        isUpdatingVisualization={loading}
        minIndex={0}
        isBuffering={false}
        inundationThresholds={inundationThresholds}
        rangeWindow={rangeWindow}
        setRangeWindow={setRangeWindow}
        fitBounds={fitBounds}
        setShowContours={setShowContours}
        terrainEnabled={terrainEnabled}
        setTerrainEnabled={setTerrainEnabled}
        terrainConfig={MAP_TERRAIN_CONFIG}
        floodDisplayMode={floodDisplayMode}
        setFloodDisplayMode={setFloodDisplayMode}
        flood3DConfig={FLOOD_3D_CONFIG}
        flood3dElevScale={flood3dElevScale}
        setFlood3dElevScale={setFlood3dElevScale}
        timeDisplayZone={timeDisplayZone}
        setTimeDisplayZone={setTimeDisplayZone}
      />

      <BottomOffCanvas
        show={showBottomCanvas}
        onTimeSelect={handleTimeSelect}
        onHide={handleHideBottomCanvas}
        data={bottomCanvasData}
        currentSliderDate={currentSliderDate}
        timeDisplayZone={timeDisplayZone}
        onRiskThresholdsSaved={refreshRiskMarkerColors}
      />
      <BottomBuoyOffCanvas
        show={showBuoyCanvas}
        onHide={() => setShowBuoyCanvas(false)}
        buoyId={null}
      />
    </div>
  );
}

export default CookIslandsForecast;

// ── helpers ──────────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return [128, 128, 128];
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m || m.length < 3) return [128, 128, 128];
  return [parseInt(m[0], 16), parseInt(m[1], 16), parseInt(m[2], 16)];
}
