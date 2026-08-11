import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './ForecastApp.css';
import '../styles/MapMarker.css';
import { UI_CONFIG } from '../config/UIConfig';
import { getLayerBounds, isRasterSourceLayer } from '../config/layerConfig';
import { ISLAND_ZOOM_TARGETS, findIslandZoomTarget } from '../config/islandConfig';
import CompassRose from './CompassRose';
import BasemapSwitcher from './BasemapSwitcher';
import ForecastTimeline from './ForecastTimeline';
import {
  ControlGroup,
  VariableButtons,
  OpacityControl,
  IslandZoomControl,
  DataInfo,
} from './shared/UIComponents';
import { Waves, Wind, Navigation, Activity, Info, Settings, Timer, Triangle, CloudRain, MapPin, SlidersHorizontal, BarChart2 } from 'lucide-react';
import FancyIcon from './FancyIcon';
import '../styles/fancyIcons.css';
import InundationThresholdEditor from './InundationThresholdEditor';
import InundationWindowControl from './InundationWindowControl';
import { X_SST_GRADIENT, buildInundationLegendBands, buildBreakLegendConfig, buildContinuousLegendConfig, parseLegendColorRange } from '../domain/inundation/legendBands';
import { getColormap } from '../lib/colormaps';


const ForecastApp = ({
  WAVE_FORECAST_LAYERS,
  ALL_LAYERS,
  selectedWaveForecast,
  setSelectedWaveForecast,
  opacity,
  setOpacity,
  sliderIndex,
  setSliderIndex,
  totalSteps,
  isPlaying,
  setIsPlaying,
  playSpeedMs = 700,
  setPlaySpeedMs,
  currentSliderDate,
  capTime,
  overlayStats,
  activeLayers,
  setActiveLayers,
  mapRef,
  mapInstance,
  setBasemap,
  isUpdatingVisualization,
  currentSliderDateStr,
  minIndex = 0,
  inundationThresholds,
  rangeWindow,
  setRangeWindow,
  fitBounds,       // (islandBounds) → map.fitBounds with coord conversion — from useZarrMap
  setShowContours,
  // Unused while the Terrain/Aerial imagery toggles and Flood display's
  // terrain-aware warning banner are commented out below (moved to
  // advanced-features branch).
  // eslint-disable-next-line no-unused-vars
  terrainEnabled = false,
  // eslint-disable-next-line no-unused-vars
  setTerrainEnabled,
  terrainConfig,
  // Unused while the Flood display (2D/3D) toggle is commented out below
  // (moved to advanced-features branch).
  // eslint-disable-next-line no-unused-vars
  floodDisplayMode = '2d',
  // eslint-disable-next-line no-unused-vars
  setFloodDisplayMode,
  flood3DConfig,
  // eslint-disable-next-line no-unused-vars
  flood3dElevScale = 6,
  // eslint-disable-next-line no-unused-vars
  setFlood3dElevScale,
  timeDisplayZone,
  setTimeDisplayZone,
}) => {
  const lastZoomedLayerRef = useRef(null);
  const [selectedIslandId, setSelectedIslandId] = useState(ISLAND_ZOOM_TARGETS[0]?.id || '');
  const [showThresholdEditor, setShowThresholdEditor] = useState(false);
  const [showTimelineInPanel, setShowTimelineInPanel] = useState(false);
  const [contoursEnabled, setContoursEnabled] = useState(false);
  const selectedLayer = useMemo(() => {
    return ALL_LAYERS.find(l => l.value === selectedWaveForecast) || null;
  }, [ALL_LAYERS, selectedWaveForecast]);
  const isRasterInundation = isRasterSourceLayer(selectedLayer);
  // Unused while the Terrain toggle is commented out below (moved to
  // advanced-features branch).
  // eslint-disable-next-line no-unused-vars
  const terrainAvailable = Array.isArray(terrainConfig?.tiles) && terrainConfig.tiles.some(Boolean);
  // Unused while the Flood display toggle is commented out below (moved to
  // advanced-features branch).
  // eslint-disable-next-line no-unused-vars
  const flood3DAvailable = Boolean(flood3DConfig?.available);

  const zoomToLayerBounds = useCallback((layerValue, { force = false } = {}) => {
    if (!layerValue) return;
    const layerBounds = getLayerBounds(layerValue);
    if (!layerBounds) return;
    if (!force && lastZoomedLayerRef.current === layerValue) return;

    const layer = ALL_LAYERS.find(l => l.value === layerValue);
    const isInundation = layer?.isStatic || layer?.sourceType === 'zarr' || false;
    const maxZoom = isInundation ? 17 : 14;

    if (fitBounds) {
      fitBounds(layerBounds, { padding: 20, maxZoom, animate: true });
    } else if (mapInstance?.current) {
      const map = mapInstance.current;
      const sw = layerBounds.southWest;
      const ne = layerBounds.northEast;
      map.fitBounds([[sw[1], sw[0]], [ne[1], ne[0]]], { padding: 20, maxZoom, animate: true });
    }
    lastZoomedLayerRef.current = layerValue;
  }, [mapInstance, ALL_LAYERS, fitBounds]);

  const zoomToIsland = useCallback((islandId = selectedIslandId) => {
    const island = findIslandZoomTarget(islandId);
    if (!island) return;
    setActiveLayers(prev => ({ ...prev, riskPoints: true }));
    if (fitBounds) {
      fitBounds(island.bounds, { padding: 42, maxZoom: 12 });
    } else if (mapInstance?.current) {
      const { southWest: sw, northEast: ne } = island.bounds;
      mapInstance.current.fitBounds([[sw[1], sw[0]], [ne[1], ne[0]]], { padding: 42, maxZoom: 12, animate: true });
    }
  }, [mapInstance, selectedIslandId, setActiveLayers, fitBounds]);

  const zoomToRarotonga = useCallback(() => {
    const rarotonga = findIslandZoomTarget('rarotonga');
    if (!rarotonga) return;
    if (fitBounds) {
      fitBounds(rarotonga.bounds, { padding: 20, maxZoom: 17 });
    } else if (mapInstance?.current) {
      const { southWest: sw, northEast: ne } = rarotonga.bounds;
      mapInstance.current.fitBounds([[sw[1], sw[0]], [ne[1], ne[0]]], { padding: 20, maxZoom: 17, animate: true });
    }
  }, [mapInstance, fitBounds]);

  useEffect(() => {
    zoomToLayerBounds(selectedWaveForecast);
  }, [selectedWaveForecast, zoomToLayerBounds]);

  // Reset contour toggle when layer changes so UI state matches the new overlay.
  useEffect(() => {
    const defaultEnabled = selectedLayer?.contours?.visibleByDefault ?? false;
    setContoursEnabled(defaultEnabled);
    setShowContours?.(defaultEnabled);
  }, [selectedLayer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedLegendLayer = useMemo(() => {
    if (!selectedWaveForecast) return null;

    const findLayerByValue = (layers, value) => {
      if (!Array.isArray(layers)) return null;
      for (const layer of layers) {
        if (layer?.value === value) {
          return layer;
        }
        if (layer?.composite && Array.isArray(layer.layers)) {
          const match = findLayerByValue(layer.layers, value);
          if (match) return match;
        }
      }
      return null;
    };

    const dynamicMatch = findLayerByValue(WAVE_FORECAST_LAYERS, selectedWaveForecast);
    const baseLayer = dynamicMatch || findLayerByValue(ALL_LAYERS, selectedWaveForecast);
    if (!baseLayer) {
      return null;
    }

    if (!baseLayer.composite) {
      return baseLayer;
    }

    const PRIORITY_VARIABLES = ['hs', 'wave_height', 'tm02', 'tpeak', 'period', 'inun', 'flood'];
    const { layers } = baseLayer;
    if (!Array.isArray(layers)) {
      return baseLayer;
    }

    const directMatch = layers.find(subLayer => subLayer?.value === selectedWaveForecast);
    if (directMatch) {
      return directMatch;
    }

    for (const key of PRIORITY_VARIABLES) {
      const match = layers.find(subLayer => subLayer?.value?.toLowerCase().includes(key));
      if (match) {
        return match;
      }
    }

    return layers[0] || baseLayer;
  }, [ALL_LAYERS, WAVE_FORECAST_LAYERS, selectedWaveForecast]);

  const inundationLegendBands = useMemo(() => {
    return buildInundationLegendBands({
      categories: inundationThresholds.lastValidCategories,
      minVisibleDepth: inundationThresholds.minVisibleDepth,
      colorscalerange: selectedLegendLayer?.colorscalerange,
      rasterMinDepth: selectedLegendLayer?.rasterMinDepth,
      rasterMaxDepth: selectedLegendLayer?.rasterMaxDepth,
    });
  }, [inundationThresholds.lastValidCategories, inundationThresholds.minVisibleDepth, selectedLegendLayer]);

  const activeOverlayRange = useMemo(() => {
    if (!overlayStats || overlayStats.layerId !== selectedWaveForecast) return null;
    const min = Number(overlayStats.colorMin);
    const max = Number(overlayStats.colorMax);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return null;
    return { min, max, units: overlayStats.units };
  }, [overlayStats, selectedWaveForecast]);

  // Dynamic marine legend configuration - RESPONDS TO ACTUAL DATA
  const getLegendConfig = (variable, layerData) => {
    const varLower = variable.toLowerCase();

    // Inundation must always reflect the live, user-editable threshold profile —
    // layerData.colorBreaks below is just the seeded config default, and checking
    // it first (as the generic branch does) permanently shadowed edited thresholds.
    if (varLower.includes('inun') || varLower.includes('hmax') || varLower.includes('h_max')) {
      return {
        units: 'm',
        ...inundationLegendBands,
      };
    }

    // Parse dynamic ranges from layer data
    const colorRange = layerData ? parseLegendColorRange(layerData.colorscalerange) : null;
    const dynamicMax = layerData?.activeBeaufortMax;

    // Any layer that has colorBreaks configured uses buildBreakLegendConfig so the
    // legend colormap always matches the map renderer — single source of truth.
    if (layerData?.colorBreaks?.length > 1) {
      return buildBreakLegendConfig({
        colorBreaks: layerData.colorBreaks,
        colorLabels: layerData.colorLabels,
        colorRange: { min: layerData.colorRange?.min ?? 0, max: layerData.colorRange?.max ?? 5 },
        units: layerData.units ?? '',
        colormapFn: getColormap(layerData.colormap),
      });
    }

    // ── per-variable fallbacks for layers without colorBreaks ──────────────────
    if (varLower.includes('hs')) {
      const minVal = activeOverlayRange?.min ?? colorRange?.min ?? 0;
      const maxVal = activeOverlayRange?.max ?? (Number.isFinite(dynamicMax) ? dynamicMax : (colorRange?.max ?? 4));
      const ticks = Array.from({length: 5}, (_, i) =>
        Number((minVal + (maxVal - minVal) * i / 4).toFixed(1))
      );
      return {
        gradient: X_SST_GRADIENT,
        min: minVal,
        max: maxVal,
        units: activeOverlayRange?.units ?? 'm',
        ticks,
      };
    }

    if (varLower.includes('tm02') || varLower.includes('tpeak')) {
      // Wave period (mean/peak) - continuous gradient sampled from the layer's
      // own colormap so the legend always matches what UgridOverlay renders.
      return buildContinuousLegendConfig({
        colorRange: { min: layerData?.colorRange?.min ?? 0, max: layerData?.colorRange?.max ?? 20 },
        colormapFn: getColormap(layerData?.colormap),
        units: 's',
      });
    }

    if (varLower.includes('dirm')) {
      // Wave direction - Static compass (doesn't change with data)
      return {
        gradient: 'conic-gradient(from 0deg, transparent)',
        min: 0,
        max: 360,
        units: '°',
        ticks: [0, 90, 180, 270, 360]
      };
    }

    return null;
  };

  // Function to get fancy icons for different variable types
  const getVariableIcon = (layer) => {
    const value = layer.value?.toLowerCase() || '';
    const label = layer.label?.toLowerCase() || '';
    
    if (value.includes('hs') || label.includes('wave height')) {
      return <FancyIcon icon={Waves} animationType="wave" size={14} color="#00bcd4" style={{ marginRight: '8px' }} />;
    }
    if (value.includes('tm02') || (label.includes('mean') && label.includes('period'))) {
      return <FancyIcon icon={Timer} animationType="pulse" size={14} color="#ff9800" style={{ marginRight: '8px' }} />;
    }
    if (value.includes('tpeak') || (label.includes('peak') && label.includes('period'))) {
      return <FancyIcon icon={Triangle} animationType="bounce" size={14} color="#4caf50" style={{ marginRight: '8px' }} />;
    }
    if (value.includes('dirm') || label.includes('direction')) {
      return <FancyIcon icon={Navigation} animationType="spin" size={14} color="#9c27b0" style={{ marginRight: '8px' }} />;
    }
    if (value.includes('inun') || label.includes('inundation')) {
      return <FancyIcon icon={CloudRain} animationType="shimmer" size={14} color="#2196f3" style={{ marginRight: '8px' }} />;
    }
    if (value.includes('wind') || label.includes('wind')) {
      return <FancyIcon icon={Wind} animationType="wave" size={14} color="#795548" style={{ marginRight: '8px' }} />;
    }
    
    // Default icon for unknown variables
    return <FancyIcon icon={Activity} animationType="pulse" size={14} color="#607d8b" style={{ marginRight: '8px' }} />;
  };

  const getVariableColor = (layer) => {
    const value = layer.value?.toLowerCase() || '';
    const label = layer.label?.toLowerCase() || '';
    if (value.includes('hs') || label.includes('wave height')) return '#00bcd4';
    if (value.includes('tm02') || (label.includes('mean') && label.includes('period'))) return '#00d4ff';
    if (value.includes('tpeak') || (label.includes('peak') && label.includes('period'))) return '#00d4ff';
    if (value.includes('dirm') || label.includes('direction')) return '#9c27b0';
    if (value.includes('inun') || label.includes('inundation')) return '#2196f3';
    if (value.includes('wind') || label.includes('wind')) return '#795548';
    return '#00d4ff';
  };

  const handleVariableChange = (layerValue) => {
    setSelectedWaveForecast(layerValue);
    setActiveLayers(prev => ({ ...prev, waveForecast: true }));

    const nextLayer = ALL_LAYERS.find((layer) => layer.value === layerValue);
    if (isRasterSourceLayer(nextLayer)) {
      setSelectedIslandId('rarotonga');
      zoomToRarotonga();
      return;
    }

    // Reset range-window mode when leaving the inundation layer so the shared
    // rangeWindow state doesn't disable the time slider on wave layers.
    if (rangeWindow?.mode && rangeWindow.mode !== 'single') {
      setRangeWindow({ mode: 'single' });
    }

    zoomToLayerBounds(layerValue, { force: true });
  };

  const handlePlayToggle = () => {
    setIsPlaying(!isPlaying);
  };

  const handleSliderChange = (value) => {
    setSliderIndex(parseInt(value));
  };

  const handlePreviousTimestamp = () => {
    setSliderIndex(prev => Math.max(prev - 1, minIndex));
  };

  const handleNextTimestamp = () => {
    setSliderIndex(prev => Math.min(prev + 1, totalSteps));
  };

  return (
    <div className="forecast-app">
      <div className="main-container">
        <div className="map-section">
          <div ref={mapRef} id="map" className="forecast-map"></div>

          <BasemapSwitcher
            mapInstance={mapInstance}
            setBasemap={setBasemap}
            position="top-left"
          />

          {/* Enhanced Professional Compass Rose */}
          <CompassRose 
            position="top-right" 
            size={90} 
            responsive={true}
            mapRotation={0} 
          />
          
          {selectedLegendLayer && (
            <div className="marine-legend">
              {(() => {
                const legendConfig = getLegendConfig(selectedLegendLayer.variable ?? selectedLegendLayer.value, selectedLegendLayer);
                if (!legendConfig) return null;
                const range = legendConfig.max - legendConfig.min;
                const toPos = (val) => range > 0 ? ((legendConfig.max - val) / range) * 100 : 0;

                const legendInfoText = [
                  selectedLegendLayer.legendNote,
                  selectedLegendLayer.showDirectionArrows ? selectedLegendLayer.arrowLegendLabel : null,
                ].filter(Boolean).join(' ');

                return (
                  <>
                    <div className="marine-legend-title">
                      {selectedLegendLayer.label}
                      {legendInfoText && (
                        <span className="marine-legend-info" aria-label={legendInfoText}>
                          ⓘ
                          <span className="marine-legend-info__tooltip">{legendInfoText}</span>
                        </span>
                      )}
                    </div>
                    {selectedLegendLayer.contours?.levels?.length > 0 && (
                      <button
                        className={`marine-legend-toggle${contoursEnabled ? ' marine-legend-toggle--active' : ''}`}
                        onClick={() => {
                          const next = !contoursEnabled;
                          setContoursEnabled(next);
                          setShowContours?.(next);
                        }}
                      >
                        {contoursEnabled ? 'Contours on' : 'Contours off'}
                      </button>
                    )}
                    <div className="marine-legend-content">

                      {/* Gradient bar — with threshold boundary hairlines overlaid when available */}
                      <div className="marine-legend-gradient-wrap">
                        <div
                          className="marine-legend-gradient"
                          style={{ background: legendConfig.gradient }}
                        />
                        {legendConfig.gradientMarkers?.map((cat) => (
                          <div
                            key={`marker-${cat.id}`}
                            className="marine-legend-band-marker"
                            style={{
                              top: `${toPos(cat.thresholdM)}%`,
                              borderTopColor: cat.color,
                            }}
                            title={`${cat.thresholdM.toFixed(2)} m — ${cat.label}`}
                          />
                        ))}
                      </div>

                      {/* Tick scale */}
                      <div className="marine-legend-scale">
                        {legendConfig.ticks.map((tick) => {
                          const band = legendConfig.tickBands?.[tick];
                          return (
                            <div
                              key={`tick-${tick}`}
                              className={`marine-legend-tick${band ? ' marine-legend-tick--labeled' : ''}`}
                              style={{ top: `${toPos(tick)}%`, transform: 'translateY(-50%)', left: '0px' }}
                            >
                              {/* Colored swatch — always visible when a band matches this tick */}
                              {band && (
                                <span
                                  className="marine-legend-tick__swatch"
                                  style={{ background: band.color }}
                                />
                              )}
                              <span className="marine-legend-tick__value">{tick}{legendConfig.units}</span>

                              {/* Full label + description tooltip on hover */}
                              {band && (
                                <span className="marine-legend-tick__severity">
                                  <strong>{band.label}</strong>
                                  {band.description && (
                                    <em>{band.description}</em>
                                  )}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* Bottom timeline overlay — hidden while pinned to the side panel */}
          {!showTimelineInPanel && (
            <ForecastTimeline
              sliderIndex={sliderIndex}
              totalSteps={totalSteps}
              minIndex={minIndex}
              currentSliderDate={currentSliderDate}
              capTime={capTime}
              isPlaying={isPlaying}
              playSpeedMs={playSpeedMs}
              timeDisplayZone={timeDisplayZone}
              disabled={selectedLayer?.isStatic || (isRasterInundation && rangeWindow?.mode && rangeWindow.mode !== 'single')}
              onTimeIndexChange={handleSliderChange}
              onPlayPause={handlePlayToggle}
              onPrevious={handlePreviousTimestamp}
              onNext={handleNextTimestamp}
              onSpeedChange={setPlaySpeedMs}
              onTimezoneChange={setTimeDisplayZone}
              showInPanel={showTimelineInPanel}
              onTogglePanel={() => setShowTimelineInPanel(v => !v)}
            />
          )}
        </div>

        <div className="controls-panel">
          <div className="forecast-controls">
        <ControlGroup
          icon={<FancyIcon icon={Activity} animationType="shimmer" color="#00bcd4" />}
          title={UI_CONFIG.SECTIONS.FORECAST_VARIABLES.title}
          ariaLabel={UI_CONFIG.SECTIONS.FORECAST_VARIABLES.ariaLabel}
        >
          <VariableButtons
            layers={ALL_LAYERS}
            selectedValue={selectedWaveForecast}
            onVariableChange={handleVariableChange}
            labelMap={UI_CONFIG.VARIABLE_LABELS}
            ariaLabel={UI_CONFIG.ARIA_LABELS.variableButton}
            getVariableIcon={getVariableIcon}
            getVariableColor={getVariableColor}
          />
          {/* Live condition summary — answers the question before the user asks it */}
          {activeOverlayRange && (
            <div style={{
              marginTop: '0.35rem',
              padding: '0.4rem 0.65rem',
              background: 'rgba(0, 212, 255, 0.07)',
              border: '1px solid rgba(0, 212, 255, 0.2)',
              borderRadius: '6px',
              fontSize: '0.8rem',
              color: '#e0f7ff',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.5rem',
            }}>
              <span style={{ opacity: 0.65, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                {selectedLegendLayer?.label ?? 'Current'}
              </span>
              <span style={{ fontWeight: 700, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                {activeOverlayRange.min.toFixed(1)}–{activeOverlayRange.max.toFixed(1)}{' '}
                <span style={{ fontWeight: 400, opacity: 0.7 }}>{activeOverlayRange.units}</span>
              </span>
            </div>
          )}
        </ControlGroup>

        {showTimelineInPanel && (
          <ForecastTimeline
            inline
            sliderIndex={sliderIndex}
            totalSteps={totalSteps}
            minIndex={minIndex}
            currentSliderDate={currentSliderDate}
            capTime={capTime}
            isPlaying={isPlaying}
            playSpeedMs={playSpeedMs}
            timeDisplayZone={timeDisplayZone}
            disabled={selectedLayer?.isStatic || (isRasterInundation && rangeWindow?.mode && rangeWindow.mode !== 'single')}
            onTimeIndexChange={handleSliderChange}
            onPlayPause={handlePlayToggle}
            onPrevious={handlePreviousTimestamp}
            onNext={handleNextTimestamp}
            onSpeedChange={setPlaySpeedMs}
            onTimezoneChange={setTimeDisplayZone}
            showInPanel={showTimelineInPanel}
            onTogglePanel={() => setShowTimelineInPanel(v => !v)}
          />
        )}

        <ControlGroup
          icon={<FancyIcon icon={MapPin} animationType="pulse" color="#4caf50" />}
          title={UI_CONFIG.SECTIONS.ISLAND_NAVIGATION.title}
          ariaLabel={UI_CONFIG.SECTIONS.ISLAND_NAVIGATION.ariaLabel}
        >
          <IslandZoomControl
            islands={ISLAND_ZOOM_TARGETS}
            selectedIsland={selectedIslandId}
            onIslandChange={(id) => {
              setSelectedIslandId(id);
              zoomToIsland(id);
            }}
          />
        </ControlGroup>

        {isRasterInundation && (
          <ControlGroup
            icon={<FancyIcon icon={SlidersHorizontal} animationType="pulse" color="#90caf9" />}
            title="Inundation Thresholds"
            ariaLabel="Inundation threshold configuration"
          >
            <div className="inundation-threshold-trigger">
              <button
                type="button"
                className={`inundation-threshold-trigger__btn${inundationThresholds.isDirty ? ' inundation-threshold-trigger__btn--dirty' : ''}`}
                onClick={() => setShowThresholdEditor(true)}
                title="Customise depth bands and severity labels"
              >
                <SlidersHorizontal size={14} />
                Edit Thresholds
                {inundationThresholds.isDirty && (
                  <span className="inundation-threshold-trigger__badge" title="Unsaved changes">●</span>
                )}
              </button>
              <span className="inundation-threshold-trigger__count">
                {`${inundationThresholds.categories.length} bands`}
              </span>
            </div>
            <div className="inundation-threshold-trigger__hint">
              Refine depth bands and severity descriptions as observed event data comes in. Changes apply live to the map popup and legend.
            </div>
          </ControlGroup>
        )}

        {isRasterInundation && rangeWindow !== undefined && (
          <ControlGroup
            icon={<FancyIcon icon={BarChart2} animationType="pulse" color="#38bdf8" />}
            title="Inundation Window"
            ariaLabel="Inundation time window mode"
          >
            <InundationWindowControl
              rangeWindow={rangeWindow}
              setRangeWindow={setRangeWindow}
              availableTimestamps={capTime?.availableTimestamps}
              disabled={capTime?.loading}
              currentTime={currentSliderDate}
              timeDisplayZone={timeDisplayZone}
            />
          </ControlGroup>
        )}

        <ControlGroup
          icon={<FancyIcon icon={Settings} animationType="spin" color="#9c27b0" />}
          title={UI_CONFIG.SECTIONS.DISPLAY_OPTIONS.title}
          ariaLabel={UI_CONFIG.SECTIONS.DISPLAY_OPTIONS.ariaLabel}
        >
          <OpacityControl
            opacity={opacity}
            onOpacityChange={setOpacity}
            formatPercent={UI_CONFIG.FORMATS.opacityPercent}
            ariaLabel={UI_CONFIG.ARIA_LABELS.overlayOpacity}
          />

          {/* Terrain toggle — moved to the advanced-features branch, disabled
              here on main. Restore by uncommenting this block
              (terrainEnabled/setTerrainEnabled/terrainAvailable props are
              still threaded through above, untouched, so re-enabling is just
              removing this comment).

          <div className="map-display-option">
            <div className="map-display-option__label">Terrain</div>
            <div className="map-display-option__segmented" role="radiogroup" aria-label="Terrain display mode">
              <button
                type="button"
                className={`map-display-option__btn${!terrainEnabled ? ' map-display-option__btn--active' : ''}`}
                role="radio"
                aria-checked={!terrainEnabled}
                onClick={() => setTerrainEnabled?.(false)}
              >
                Off
              </button>
              <button
                type="button"
                className={`map-display-option__btn${terrainEnabled ? ' map-display-option__btn--active' : ''}`}
                role="radio"
                aria-checked={terrainEnabled}
                disabled={!terrainAvailable}
                onClick={() => terrainAvailable && setTerrainEnabled?.(true)}
                title={terrainAvailable ? 'Enable 3D terrain relief' : 'Terrain DEM not configured'}
              >
                On
              </button>
            </div>
            <div className="map-display-option__hint">
              {terrainAvailable
                ? isRasterInundation
                  ? '3D terrain shows land relief. Inundation colours still represent modelled flood depth.'
                  : '3D terrain adds topographic shading to the basemap.'
                : 'Terrain DEM not configured — set REACT_APP_RAROTONGA_DEM_TILES to enable.'}
            </div>
          </div>
          */}

          {/* Flood display (2D depth bands / Experimental 3D depth) — moved to
              the advanced-features branch, disabled here on main. Restore by
              uncommenting this block (floodDisplayMode/setFloodDisplayMode,
              flood3dElevScale/setFlood3dElevScale, flood3DAvailable,
              flood3DConfig, and terrainEnabled props are still threaded
              through above, untouched, so re-enabling is just removing this
              comment).

          {isRasterInundation && (
            <div className="map-display-option">
              <div className="map-display-option__label">Flood display</div>
              <div className="map-display-option__segmented" role="radiogroup" aria-label="Flood display mode">
                <button
                  type="button"
                  className={`map-display-option__btn${floodDisplayMode !== '3d' ? ' map-display-option__btn--active' : ''}`}
                  role="radio"
                  aria-checked={floodDisplayMode !== '3d'}
                  onClick={() => setFloodDisplayMode?.('2d')}
                >
                  2D depth bands
                </button>
                <button
                  type="button"
                  className={`map-display-option__btn${floodDisplayMode === '3d' ? ' map-display-option__btn--active' : ''}`}
                  role="radio"
                  aria-checked={floodDisplayMode === '3d'}
                  disabled={!flood3DAvailable}
                  onClick={() => flood3DAvailable && setFloodDisplayMode?.('3d')}
                  title={flood3DAvailable ? 'Enable experimental 3D flood depth' : flood3DConfig?.unavailableReason}
                >
                  Experimental 3D depth
                </button>
              </div>
              <div className="map-display-option__hint">
                {floodDisplayMode === '3d'
                  ? `Column height is exaggerated ${flood3dElevScale}× for readability. Hover a column to see exact depth. Colour also shows depth.`
                  : 'Switch to 3D to see flood depth as extruded columns. Hover for exact depth.'}
              </div>
              {floodDisplayMode === '3d' && (
                <div className="opacity-control" style={{ marginTop: '0.5rem' }}>
                  <label htmlFor="elev-scale-slider">
                    Height exaggeration: <span>{flood3dElevScale}×</span>
                  </label>
                  <input
                    id="elev-scale-slider"
                    type="range"
                    className="opacity-slider"
                    min={1}
                    max={10}
                    step={1}
                    value={flood3dElevScale}
                    onChange={(e) => setFlood3dElevScale?.(Number(e.target.value))}
                    aria-label="Column height exaggeration factor"
                  />
                </div>
              )}
              {floodDisplayMode === '3d' && terrainEnabled && (
                <div style={{
                  marginTop: '0.5rem',
                  padding: '6px 9px',
                  background: 'rgba(255, 152, 0, 0.12)',
                  border: '1px solid rgba(255, 152, 0, 0.4)',
                  borderRadius: '5px',
                  fontSize: '0.8rem',
                  color: '#ffb74d',
                  lineHeight: 1.4,
                }}>
                  Terrain + 3D active: columns on higher ground appear taller even at the same flood depth. Use colour to compare depth across the map.
                </div>
              )}
            </div>
          )}
          */}
        </ControlGroup>

        <ControlGroup
          icon={<FancyIcon icon={Info} animationType="pulse" color="#2196f3" />}
          title={UI_CONFIG.SECTIONS.DATA_INFO.title}
          ariaLabel={UI_CONFIG.SECTIONS.DATA_INFO.ariaLabel}
        >
          <DataInfo
            source={UI_CONFIG.DATA_SOURCE.source}
            model={UI_CONFIG.DATA_SOURCE.model}
            resolution={UI_CONFIG.DATA_SOURCE.resolution}
            updateFrequency={UI_CONFIG.DATA_SOURCE.updateFrequency}
            coverage={UI_CONFIG.DATA_SOURCE.coverage}
          />
        </ControlGroup>
          </div>
        </div>

      </div>

      <InundationThresholdEditor
        isOpen={showThresholdEditor}
        onClose={() => setShowThresholdEditor(false)}
        categories={inundationThresholds.categories}
        paletteId={inundationThresholds.paletteId}
        minVisibleDepth={inundationThresholds.minVisibleDepth}
        validationErrors={inundationThresholds.validationErrors}
        isDirty={inundationThresholds.isDirty}
        savedAt={inundationThresholds.savedAt}
        timeDisplayZone={timeDisplayZone}
        saveError={inundationThresholds.saveError}
        canUndo={inundationThresholds.canUndo}
        canRedo={inundationThresholds.canRedo}
        updateRow={inundationThresholds.updateRow}
        addRow={inundationThresholds.addRow}
        removeRow={inundationThresholds.removeRow}
        moveRow={inundationThresholds.moveRow}
        updateMinVisibleDepth={inundationThresholds.updateMinVisibleDepth}
        undo={inundationThresholds.undo}
        redo={inundationThresholds.redo}
        applyPalette={inundationThresholds.applyPalette}
        save={inundationThresholds.save}
        resetToDefaults={inundationThresholds.resetToDefaults}
        exportJson={inundationThresholds.exportJson}
        importJson={inundationThresholds.importJson}
      />
    </div>
  );
};

export default ForecastApp;
