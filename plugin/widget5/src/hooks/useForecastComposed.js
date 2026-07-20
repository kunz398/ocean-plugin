import { useEffect, useState } from 'react';
import { useWMSCapabilities } from './useWMSCapabilities';
import { useTimeAnimation } from './useTimeAnimation';
import { useUIState } from './useUIState';
import { useLayerManagement } from './useLayerManagement';
import { useMapRendering } from './useMapRendering';
import { useLegendManagement } from './useLegendManagement';
import { isRasterSourceLayer } from '../config/layerConfig';
import { createInundationProvider } from '../services/inundationProviderFactory';

/**
 * Main forecast hook that composes specialized hooks
 * This is a thin orchestrator that delegates to focused, testable hooks
 */
export const useForecast = (config) => {
  const {
    WAVE_FORECAST_LAYERS,
    STATIC_LAYERS,
    addWMSTileLayer,
    bounds,
    inundationCategories = null,
    inundationMinDepth = null,
    inundationResampleColors = false,
  } = config;

  // 1. Layer Management (selection, active layers, dynamic configs)
  const layerManagement = useLayerManagement(WAVE_FORECAST_LAYERS, STATIC_LAYERS);
  const {
    activeLayers,
    setActiveLayers,
    selectedWaveForecast,
    setSelectedWaveForecast,
    dynamicLayers,
    allLayers,
    selectedLayerConfig
  } = layerManagement;

  const [rangeWindow, setRangeWindow] = useState({ mode: 'single' });

  useEffect(() => {
    const rasterLayers = allLayers.filter(isRasterSourceLayer);

    if (!rasterLayers.length) {
      return;
    }

    rasterLayers.forEach((layer) => {
      const provider = createInundationProvider(layer.apiBase);

      if (!provider.capabilities.timestepRaster) return;

      Promise.all([
        provider.loadMetadata(),
        provider.loadTimesteps()
      ])
        .then(([, timesteps]) => provider.warmupFrames({
          startIndex: 0,
          count: 4,
          frameCount: timesteps.length,
          vmin: inundationMinDepth ?? layer.rasterMinDepth,
          vmax: layer.rasterMaxDepth,
          thresholdCategories: inundationCategories,
          resampleColors: inundationResampleColors,
        }))
        .catch((error) => {
          console.warn(`Failed raster warmup for ${layer.value}:`, error);
        });
    });
  }, [allLayers, inundationCategories, inundationMinDepth, inundationResampleColors]);

  // 2. WMS Capabilities (time dimensions, metadata)
  const capTime = useWMSCapabilities(selectedWaveForecast, allLayers);

  // 3. Time Animation (slider, playback controls)
  const timeAnimation = useTimeAnimation(
    capTime,
    selectedLayerConfig,
    inundationCategories,
    inundationMinDepth,
    inundationResampleColors,
    rangeWindow
  );
  const {
    sliderIndex,
    setSliderIndex,
    isPlaying,
    setIsPlaying,
    totalSteps,
    currentSliderDate,
    currentSliderDateStr,
    minIndex,
    getRasterFrame,
    isBuffering,
    rasterCacheVersion,
  } = timeAnimation;

  // 4. UI State (canvas visibility, drag state, responsive layout)
  const uiState = useUIState();
  const {
    showBuoyCanvas,
    setShowBuoyCanvas,
    showBottomCanvas,
    setShowBottomCanvas,
    bottomCanvasData,
    setBottomCanvasData,
    selectedBuoyId,
    wmsOpacity,
    setWmsOpacity,
    isUpdatingVisualization,
    openBottomCanvas
  } = uiState;

  // 5. Map Rendering (Leaflet integration, WMS layer rendering)
  const mapRendering = useMapRendering({
    activeLayers,
    selectedWaveForecast,
    selectedLayerConfig,
    dynamicLayers,
    staticLayers: STATIC_LAYERS,
    currentSliderDateStr,
    sliderIndex,
    getRasterFrame,
    isBuffering,
    rasterCacheVersion,
    capTime,
    wmsOpacity,
    addWMSTileLayer,
    handleShow: openBottomCanvas,
    bounds
  });
  const { mapRef, mapInstance } = mapRendering;

  // 6. Legend Management (legend rendering, image loading)
  const legendManagement = useLegendManagement({
    selectedWaveForecast,
    dynamicLayers,
    staticLayers: STATIC_LAYERS
  });

  // Return the composed API (same interface as before)
  return {
    // UI State
    showBuoyCanvas,
    setShowBuoyCanvas,
    showBottomCanvas,
    setShowBottomCanvas,
    bottomCanvasData,
    setBottomCanvasData,
    selectedBuoyId,
    
    // Layer Management
    activeLayers,
    setActiveLayers,
    selectedWaveForecast,
    setSelectedWaveForecast,
    
    // Time & Animation
    capTime,
    sliderIndex,
    setSliderIndex,
    totalSteps,
    isPlaying,
    setIsPlaying,
    currentSliderDate,
    minIndex,
    
    // Map & Rendering
    mapRef,
    mapInstance,
    wmsOpacity,
    setWmsOpacity,
    dynamicLayers,
    isUpdatingVisualization,
    
    // Legend
    ...legendManagement,
    
    // Additional computed values
    currentSliderDateStr,
    selectedLayerConfig,

    // Inundation window (range-max mode)
    rangeWindow,
    setRangeWindow,

    // Spread additional control functions
    ...timeAnimation,
    ...uiState,
    ...layerManagement
  };
};
