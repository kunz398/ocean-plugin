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

export const useMapInteraction = ({
  mapInstance,
  currentSliderDate,
  setBottomCanvasData,
  setShowBottomCanvas,
  debugMode = false,
  enabled = true
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
    if (!enabled) return;

    const map = mapInstance?.current;
    if (!map) return;
    
    try {
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
      
      // Handle loading state for WMS interactions
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
      servicesRef.current.canvasManager.showErrorState({
        featureInfo: "Map interaction failed",
        error: error.message,
        status: "error"
      });
    }
  }, [enabled, mapInstance, currentSliderDate]);
  
  // Initialize services when map is available
  useEffect(() => {
    const map = mapInstance?.current;
    if (!enabled) return;
    if (!map) return;
    
    // Initialize marker service with map instance
    servicesRef.current.markerService.initialize(map);
    
    return () => {
      servicesRef.current.markerService.cleanup();
    };
  }, [enabled, mapInstance]);

  // Set up map click listener
  useEffect(() => {
    const map = mapInstance?.current;
    if (!enabled) return;
    if (!map) return;
    
    map.on('click', handleMapClick);
    
    return () => {
      map.off('click', handleMapClick);
    };
  }, [enabled, mapInstance, handleMapClick]);
  
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
