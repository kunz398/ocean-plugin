/**
 * Custom hook for handling map interactions
 *
 * Orchestrates MapInteractionService and BottomCanvasManager
 * to provide clean map click handling with proper separation of concerns.
 */

import { useEffect, useCallback, useRef } from 'react';
import MapInteractionService from '../services/MapInteractionService';
import BottomCanvasManager from '../services/BottomCanvasManager';
import MapMarkerService from '../services/MapMarkerService';
import { createInundationProvider } from '../services/inundationProviderFactory';
import { isInundationLayer, INUNDATION_POPUP_ZOOM_THRESHOLD, getLayerBounds, isRasterSourceLayer } from '../config/layerConfig';

export const useMapInteraction = ({
  mapInstance,
  currentSliderDate,
  setBottomCanvasData,
  setShowBottomCanvas,
  selectedWaveForecast = '',
  selectedLayerConfig = null,
  inundationCategories = null,
  rangeWindow = null,
  debugMode = false
}) => {
  // Create stable service instances using useRef
  const servicesRef = useRef(null);

  if (!servicesRef.current) {
    servicesRef.current = {
      mapInteractionService: new MapInteractionService({ debugMode }),
      canvasManager: new BottomCanvasManager(setBottomCanvasData, setShowBottomCanvas),
      markerService: new MapMarkerService({ debugMode })
    };
  }

  // Keep a ref to the canvas setters so the click callback can reach them without
  // being in the useCallback dep array (they are stable React dispatch functions).
  const settersRef = useRef({ setBottomCanvasData, setShowBottomCanvas });
  useEffect(() => {
    settersRef.current = { setBottomCanvasData, setShowBottomCanvas };
  }, [setBottomCanvasData, setShowBottomCanvas]);

  // Update debug mode when it changes
  useEffect(() => {
    servicesRef.current.mapInteractionService.setDebugMode(debugMode);
    servicesRef.current.markerService.setDebugMode(debugMode);
  }, [debugMode]);

  // Update canvas manager when dependencies change
  useEffect(() => {
    servicesRef.current.canvasManager = new BottomCanvasManager(setBottomCanvasData, setShowBottomCanvas);
  }, [setBottomCanvasData, setShowBottomCanvas]);
  
  // Clean map click handler
  const handleMapClick = useCallback(async (clickEvent) => {
    const map = mapInstance?.current;
    if (!map) return;
    
    // Check if inundation layer is active and we're zoomed in
    const isInundation = isInundationLayer(selectedWaveForecast);
    const currentZoom = map.getZoom();
    const shouldShowPopup = isInundation && currentZoom >= INUNDATION_POPUP_ZOOM_THRESHOLD;
    const usesRasterSource = isRasterSourceLayer(selectedLayerConfig);
    
    // If inundation layer is active but not zoomed in enough, zoom to layer center
    if (isInundation && currentZoom < INUNDATION_POPUP_ZOOM_THRESHOLD) {
      const layerBounds = getLayerBounds(selectedWaveForecast);
      if (layerBounds) {
        console.log('🔍 Zooming to inundation layer at zoom level', INUNDATION_POPUP_ZOOM_THRESHOLD);
        // Calculate center of bounds
        const centerLat = (layerBounds.southWest[0] + layerBounds.northEast[0]) / 2;
        const centerLng = (layerBounds.southWest[1] + layerBounds.northEast[1]) / 2;
        // Zoom directly to the threshold level at the center
        map.setView([centerLat, centerLng], INUNDATION_POPUP_ZOOM_THRESHOLD, {
          animate: true,
          duration: 0.5
        });
      } else {
        // Fallback to click location if bounds not available
        console.log('🔍 Zooming to inundation click location at zoom', INUNDATION_POPUP_ZOOM_THRESHOLD);
        map.setView(clickEvent.latlng, INUNDATION_POPUP_ZOOM_THRESHOLD, {
          animate: true,
          duration: 0.5
        });
      }
      return; // Exit early, the zoom will trigger another click if needed
    }
    
    try {
      // For inundation layer when zoomed in, open bottom canvas with full timeseries
      if (shouldShowPopup) {
        const lat = clickEvent.latlng.lat;
        const lng = clickEvent.latlng.lng;

        // Drop a pin and show loading state immediately
        if (!servicesRef.current.markerService.mapInstance) {
          servicesRef.current.markerService.initialize(map);
        }
        servicesRef.current.markerService.addTemporaryMarker(clickEvent.latlng, { usePin: true }, map);

        settersRef.current.setBottomCanvasData({ mode: 'inundation', loading: true, lat, lng, rangeWindow });
        settersRef.current.setShowBottomCanvas(true);

        try {
          let timeseries = null;
          if (usesRasterSource) {
            const provider = createInundationProvider(selectedLayerConfig.apiBase);
            if (provider.capabilities.timeseries) {
              const result = await provider.getTimeseries({ lat, lng });
              timeseries = result?.values ?? null;
            }
          }
          settersRef.current.setBottomCanvasData({
            mode: 'inundation',
            lat,
            lng,
            timeseries,
            categories: inundationCategories,
            rangeWindow,
          });
        } catch (err) {
          console.error('Failed to fetch inundation timeseries:', err);
          settersRef.current.setBottomCanvasData({
            mode: 'inundation',
            lat,
            lng,
            timeseries: null,
            categories: inundationCategories,
            rangeWindow,
            error: err.message,
          });
        }
        return;
      }
      
      // Normal flow for non-inundation or low zoom: show bottom canvas
      // Add temporary marker at click location
      if (clickEvent.latlng) {
        // Ensure marker service is initialized with the map before use
        if (!servicesRef.current.markerService.mapInstance) {
          servicesRef.current.markerService.initialize(map);
        }
        servicesRef.current.markerService.addTemporaryMarker(
          clickEvent.latlng,
          { usePin: true },
          map
        );
      }
      
      const result = await servicesRef.current.mapInteractionService.handleMapClick(
        clickEvent, 
        map, 
        currentSliderDate
      );
      
      // Handle loading state for WMS interactions (normal behavior)
      if (result.loadingData) {
        await servicesRef.current.canvasManager.handleAsyncData(
          result.loadingData,
          Promise.resolve(result.data)
        );
      } else {
        // Direct result (fallback case)
        servicesRef.current.canvasManager.showSuccessState(result);
      }
      
    } catch (error) {
      console.error('Map interaction failed:', error);
      
      // For inundation layer errors when zoomed in, show error in canvas
      if (shouldShowPopup) {
        settersRef.current.setBottomCanvasData({
          mode: 'inundation',
          lat: clickEvent.latlng.lat,
          lng: clickEvent.latlng.lng,
          timeseries: null,
          categories: inundationCategories,
          rangeWindow,
          error: error.message,
        });
        return;
      }
      
      servicesRef.current.canvasManager.showErrorState({
        featureInfo: "Map interaction failed",
        error: error.message,
        status: "error"
      });
    }
  }, [mapInstance, currentSliderDate, selectedWaveForecast, selectedLayerConfig, inundationCategories, rangeWindow]);
  
  // Initialize services when map is available
  useEffect(() => {
    const map = mapInstance?.current;
    if (!map) return;
    
    // Initialize marker service with map instance
    servicesRef.current.markerService.initialize(map);
    
    return () => {
      servicesRef.current.markerService.cleanup();
    };
  }, [mapInstance]);

  // Set up map click listener
  useEffect(() => {
    const map = mapInstance?.current;
    if (!map) return;
    
    map.on('click', handleMapClick);
    
    return () => {
      map.off('click', handleMapClick);
    };
  }, [mapInstance, handleMapClick]);
  
  // Return control functions if needed
  return {
    hideCanvas: () => {
      servicesRef.current.canvasManager.hide();
      servicesRef.current.markerService.removeMarker();
    },
    setDebugMode: (enabled) => {
      servicesRef.current.mapInteractionService.setDebugMode(enabled);
      servicesRef.current.markerService.setDebugMode(enabled);
    },
    removeMarker: () => servicesRef.current.markerService.removeMarker()
  };
};

export default useMapInteraction;
