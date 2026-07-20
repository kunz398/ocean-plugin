import { useState, useEffect, useCallback, useRef } from 'react';
import { MARINE_CONFIG } from '../config/marineVariables.js';
import { isRasterSourceLayer } from '../config/layerConfig';
import { createInundationProvider } from '../services/inundationProviderFactory';

const SFINCS_PRELOAD_COUNT = 8;
const SFINCS_FRAME_INTERVAL_MS = 2000;
const SFINCS_MAX_CACHED_FRAMES = 12;

const clampIndex = (index, max, min = 0) => {
  const numericIndex = Number(index);
  const numericMax = Number(max);
  const numericMin = Number(min);

  if (!Number.isFinite(numericIndex)) {
    return Number.isFinite(numericMin) ? numericMin : 0;
  }

  const safeMin = Number.isFinite(numericMin) ? numericMin : 0;
  const safeMax = Number.isFinite(numericMax) ? numericMax : safeMin;

  return Math.max(safeMin, Math.min(Math.trunc(numericIndex), safeMax));
};
const isValidDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());

/**
 * A+ Time Animation Hook with Adaptive Timing and Frame Buffering
 * Features:
 * - Adaptive timing based on network conditions
 * - Frame buffering for smooth animation
 * - Performance monitoring and optimization
 * - Graceful error handling and recovery
 */
export const useTimeAnimation = (
  capTime,
  selectedLayerConfig = null,
  inundationCategories = null,
  inundationMinDepth = null,
  inundationResampleColors = false,
  rangeWindow = null
) => {
  const [sliderIndex, setSliderIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animationSpeed, setAnimationSpeed] = useState(3000); // Adaptive speed
  const [isBuffering, setIsBuffering] = useState(false);
  const [minIndex, setMinIndex] = useState(0); // Do not allow sliding before this index
  const [rasterCacheVersion, setRasterCacheVersion] = useState(0);
  
  // Performance tracking refs
  const frameLoadTimes = useRef([]);
  const lastFrameStart = useRef(null);
  const animationQuality = useRef('high'); // 'high', 'medium', 'low'
  
  // A+ Frame buffering system for smooth animation
  const frameBuffer = useRef(new Map());
  const bufferSize = useRef(3); // Adaptive buffer size
  const rasterFrameCache = useRef(new Map());
  const rasterFramePromises = useRef(new Map());
  
  // Calculate total steps from capTime
  const totalSteps = capTime.totalSteps || 0;
  const frameCount = totalSteps + 1;
  const isRasterAnimation = isRasterSourceLayer(selectedLayerConfig);
  const rasterCacheSignature = isRasterAnimation && selectedLayerConfig
    ? [
        selectedLayerConfig.value,
        selectedLayerConfig.apiBase,
        inundationMinDepth ?? selectedLayerConfig.rasterMinDepth,
        selectedLayerConfig.rasterMaxDepth,
        Array.isArray(inundationCategories)
          ? inundationCategories
            .map((category) => `${category.thresholdM}:${category.color}`)
            .join('|')
          : '',
        inundationResampleColors ? 'resample' : 'direct',
      ].join('|')
    : null;
  
  // Calculate current slider date using available timestamps if available
  const currentSliderDate = (() => {
    if (capTime.loading) return new Date();
    
    // Use available timestamps if they exist
    if (capTime.availableTimestamps && capTime.availableTimestamps.length > 0) {
      const index = clampIndex(sliderIndex, capTime.availableTimestamps.length - 1);
      const timestamp = capTime.availableTimestamps[index];
      return isValidDate(timestamp) ? timestamp : new Date();
    }
    
    // Fallback to calculated time
    return isValidDate(capTime.start)
      ? new Date(capTime.start.getTime() + sliderIndex * capTime.stepHours * 60 * 60 * 1000)
      : new Date();
  })();
  
  // Format current slider date for WMS requests
  const currentSliderDateStr = isValidDate(currentSliderDate)
    ? currentSliderDate.toISOString()
    : new Date().toISOString();

  const activeRangeWindow = rangeWindow && rangeWindow.mode !== 'single' ? rangeWindow : null;
  const rangeWindowKey = activeRangeWindow
    ? `range:${activeRangeWindow.mode}:${activeRangeWindow.startIndex ?? 0}-${activeRangeWindow.endIndex ?? 47}`
    : null;

  const preloadRasterFrame = useCallback(async (index) => {
    if (!isRasterAnimation || !selectedLayerConfig || frameCount <= 0 || !rasterCacheSignature) {
      return false;
    }

    const normalizedIndex = ((index % frameCount) + frameCount) % frameCount;
    const cacheKey = rangeWindowKey
      ? `${rasterCacheSignature}:${rangeWindowKey}`
      : `${rasterCacheSignature}:${normalizedIndex}`;

    if (rasterFrameCache.current.has(cacheKey)) {
      return true;
    }

    if (rasterFramePromises.current.has(cacheKey)) {
      return rasterFramePromises.current.get(cacheKey);
    }

    const provider = createInundationProvider(selectedLayerConfig.apiBase);

    const loadPromise = new Promise((resolve) => {
      provider.preloadFrame({
        timeIndex: normalizedIndex,
        rangeWindow: activeRangeWindow,
        vmin: inundationMinDepth ?? selectedLayerConfig.rasterMinDepth,
        vmax: selectedLayerConfig.rasterMaxDepth,
        thresholdCategories: inundationCategories,
        resampleColors: inundationResampleColors,
      }).then(({ url, image }) => {
        rasterFrameCache.current.set(cacheKey, {
          cacheKey,
          index: normalizedIndex,
          url,
          image
        });
        rasterFramePromises.current.delete(cacheKey);
        resolve(true);
      }).catch(() => {
        rasterFramePromises.current.delete(cacheKey);
        resolve(false);
      });
    });

    rasterFramePromises.current.set(cacheKey, loadPromise);
    return loadPromise;
  }, [isRasterAnimation, selectedLayerConfig, frameCount, rasterCacheSignature, inundationCategories, inundationMinDepth, inundationResampleColors, activeRangeWindow, rangeWindowKey]);

  const evictRasterFrames = useCallback((focusIndex) => {
    if (!isRasterAnimation || rasterFrameCache.current.size <= SFINCS_MAX_CACHED_FRAMES || frameCount <= 0) {
      return;
    }

    const entries = Array.from(rasterFrameCache.current.entries())
      .filter(([cacheKey]) => cacheKey.startsWith(`${rasterCacheSignature}:`));
    entries.sort((a, b) => {
      const distA = Math.min(
        Math.abs(a[1].index - focusIndex),
        frameCount - Math.abs(a[1].index - focusIndex)
      );
      const distB = Math.min(
        Math.abs(b[1].index - focusIndex),
        frameCount - Math.abs(b[1].index - focusIndex)
      );
      return distA - distB;
    });

    const keep = new Set(entries.slice(0, SFINCS_MAX_CACHED_FRAMES).map(([cacheKey]) => cacheKey));
    entries.forEach(([cacheKey]) => {
      if (!keep.has(cacheKey)) {
        rasterFrameCache.current.delete(cacheKey);
      }
    });
  }, [isRasterAnimation, frameCount, rasterCacheSignature]);

  const preloadRasterFrames = useCallback(async (startIndex) => {
    if (!isRasterAnimation || frameCount <= 0) {
      return;
    }

    setIsBuffering(true);
    const jobs = [];

    for (let i = 0; i < Math.min(SFINCS_PRELOAD_COUNT, frameCount); i++) {
      const index = (startIndex + i) % frameCount;
      const cacheKey = `${rasterCacheSignature}:${index}`;
      if (!rasterFrameCache.current.has(cacheKey)) {
        jobs.push(preloadRasterFrame(index));
      }
    }

    try {
      await Promise.all(jobs);
      evictRasterFrames(startIndex);
    } finally {
      setIsBuffering(false);
      setRasterCacheVersion(v => v + 1);
    }
  }, [isRasterAnimation, frameCount, preloadRasterFrame, evictRasterFrames, rasterCacheSignature]);

  const getRasterFrame = useCallback((index) => {
    if (!isRasterAnimation || frameCount <= 0) {
      return null;
    }

    if (rangeWindowKey) {
      return rasterFrameCache.current.get(`${rasterCacheSignature}:${rangeWindowKey}`) || null;
    }

    const normalizedIndex = ((index % frameCount) + frameCount) % frameCount;
    return rasterFrameCache.current.get(`${rasterCacheSignature}:${normalizedIndex}`) || null;
  }, [isRasterAnimation, frameCount, rasterCacheSignature, rangeWindowKey]);

  // Performance monitoring and adaptive speed calculation
  const calculateOptimalSpeed = useCallback(() => {
    if (isRasterAnimation) return SFINCS_FRAME_INTERVAL_MS;
    if (frameLoadTimes.current.length < 3) return 3000; // Default for first few frames
    
    const avgLoadTime = frameLoadTimes.current.reduce((a, b) => a + b, 0) / frameLoadTimes.current.length;
    const baseSpeed = Math.max(1500, avgLoadTime + 1000); // Minimum 1.5s, plus buffer
    
    // Adjust based on quality mode
    const qualityMultiplier = {
      'low': 0.8,    // Faster on poor connections
      'medium': 1.0,  // Standard speed
      'high': 1.2     // Slower for better quality
    };
    
    return baseSpeed * qualityMultiplier[animationQuality.current];
  }, [isRasterAnimation]); // Empty dependency array since it only uses refs

  // Track frame loading performance with layer complexity awareness
  const trackFramePerformance = useCallback((loadTime, layerCount = 1, isComposite = false) => {
    // Normalize load time based on layer complexity
    const normalizedLoadTime = isComposite ? loadTime * 0.8 : loadTime / Math.max(layerCount, 1);
    
    frameLoadTimes.current.push(normalizedLoadTime);
    // Keep only last 10 measurements for adaptive calculation
    if (frameLoadTimes.current.length > 10) {
      frameLoadTimes.current.shift();
    }
    
    // Update animation speed based on performance
    const newSpeed = calculateOptimalSpeed();
    setAnimationSpeed(newSpeed);
    
    // Adjust quality based on performance with layer-aware thresholds
    const avgLoadTime = frameLoadTimes.current.reduce((a, b) => a + b, 0) / frameLoadTimes.current.length;
    const performanceThreshold = isComposite ? 3500 : 4000; // Lower threshold for composite layers
    
    if (avgLoadTime > performanceThreshold) {
      animationQuality.current = 'low';
      bufferSize.current = 1; // Minimal buffering for poor performance
    } else if (avgLoadTime > 2000) {
      animationQuality.current = 'medium';
      bufferSize.current = 2; // Moderate buffering
    } else {
      animationQuality.current = 'high';
      bufferSize.current = 3; // Maximum buffering for optimal performance
    }
  }, [calculateOptimalSpeed]); // Stable dependency

  // A+ Intelligent frame preloading for smooth animation
  const preloadFrames = useCallback(async (currentIndex, direction = 1) => {
    if (isBuffering || !capTime.availableTimestamps) return;
    
    setIsBuffering(true);
    const framesToPreload = Math.min(bufferSize.current, totalSteps - currentIndex - 1);
    
    for (let i = 1; i <= framesToPreload; i++) {
      const nextIndex = (currentIndex + i * direction) % totalSteps;
      if (!frameBuffer.current.has(nextIndex)) {
        // Mark frame as being preloaded
        frameBuffer.current.set(nextIndex, 'loading');
        
        // Simulate preloading delay based on network quality
        const preloadDelay = animationQuality.current === 'high' ? 100 : 
                           animationQuality.current === 'medium' ? 200 : 300;
        
        await new Promise(resolve => setTimeout(resolve, preloadDelay));
        frameBuffer.current.set(nextIndex, 'ready');
      }
    }
    
    setIsBuffering(false);
  }, [totalSteps, isBuffering, capTime.availableTimestamps]); // Stable dependencies

  // Reset slider when capabilities change - Initialize to (last available - 7 days)
  useEffect(() => {
    if (!capTime.loading && totalSteps > 0) {
      let initialIndex = isRasterAnimation ? 0 : MARINE_CONFIG.DEFAULT_SLIDER_INDEX;
      
      if (isRasterAnimation) {
        initialIndex = 0;
        console.log(`🎯 Raster slider initialization: starting at frame ${initialIndex}`);
      } else if (capTime.availableTimestamps && capTime.availableTimestamps.length > 0) {
        // If we have timestamps, try to find the one closest to "now" (or slightly in the past)
        const timestamps = capTime.availableTimestamps;
        const now = Date.now();
        
        // Find the first timestamp that is >= now, or use the last one if all are in the past
        let idx = timestamps.findIndex(t => t.getTime() >= now);
        
        if (idx === -1) {
          // All timestamps are in the past, use the last one (most recent)
          initialIndex = timestamps.length - 1;
        } else if (idx > 0) {
          // Found a future timestamp, but use the one just before it (most recent past/current)
          initialIndex = idx - 1;
        } else {
          // The first timestamp is in the future, use it
          initialIndex = 0;
        }
        
        initialIndex = Math.max(0, Math.min(initialIndex, totalSteps));
        
        console.log(`🎯 Slider Initialization (closest to now):`);
        console.log(`   Current time: ${new Date().toISOString()}`);
        console.log(`   Using index: ${initialIndex} / ${totalSteps}`);
        console.log(`   Selected time: ${timestamps[initialIndex]?.toISOString()}`);
        console.log(`   First available: ${timestamps[0]?.toISOString()}`);
        console.log(`   Last available: ${timestamps[timestamps.length - 1]?.toISOString()}`);
      } else {
        console.log(`🎯 Slider Initialization (using config default): ${initialIndex}`);
      }

      setSliderIndex(initialIndex);
      setMinIndex(0);
      setIsPlaying(false);

      // Reset performance tracking and buffer
      frameLoadTimes.current = [];
      frameBuffer.current.clear();
      rasterFrameCache.current.clear();
      rasterFramePromises.current.clear();
      animationQuality.current = 'high';
      setAnimationSpeed(isRasterAnimation ? SFINCS_FRAME_INTERVAL_MS : 3000);
    }
  }, [capTime.loading, totalSteps, capTime.availableTimestamps, capTime.start, capTime.end, capTime.stepHours, isRasterAnimation, selectedLayerConfig, rasterCacheSignature]);

  // Force stop playback when entering range-max mode
  useEffect(() => {
    if (activeRangeWindow) {
      setIsPlaying(false);
    }
  }, [activeRangeWindow]);

  useEffect(() => {
    if (!isRasterAnimation || !selectedLayerConfig || capTime.loading || frameCount <= 0) {
      return;
    }

    // For range-max modes, trigger a single preload of the range-max frame
    preloadRasterFrames(clampIndex(sliderIndex, totalSteps, minIndex)).catch(console.warn);
  }, [isRasterAnimation, selectedLayerConfig, capTime.loading, frameCount, sliderIndex, totalSteps, minIndex, preloadRasterFrames, rangeWindowKey]);

  // Enhanced playback timer with adaptive timing and frame buffering
  useEffect(() => {
    let animationFrameId;

    if (isRasterAnimation) {
      if (!isPlaying || capTime.loading || frameCount <= 0) {
        return undefined;
      }

      animationFrameId = setInterval(() => {
        setSliderIndex((currentIndex) => {
          const nextIndex = currentIndex + 1 >= frameCount ? 0 : currentIndex + 1;

          const nextCacheKey = `${rasterCacheSignature}:${nextIndex}`;

          if (!rasterFrameCache.current.has(nextCacheKey)) {
            setIsBuffering(true);
            preloadRasterFrames(currentIndex).catch(console.warn);
            return currentIndex;
          }

          preloadRasterFrames(nextIndex).catch(console.warn);
          setIsBuffering(false);
          return nextIndex;
        });
      }, SFINCS_FRAME_INTERVAL_MS);

      return () => {
        clearInterval(animationFrameId);
      };
    }
    
    if (isPlaying && !capTime.loading && totalSteps > 0) {
      const animate = () => {
        lastFrameStart.current = Date.now();
        setIsBuffering(true);
        
        setSliderIndex(currentIndex => {
          // Move to next available frame
          const nextIndex = currentIndex + 1;
          
          if (nextIndex > totalSteps) {
            // Completed a full cycle, loop back to beginning
            setIsPlaying(false); // Stop at the end, user can restart if needed
            setIsBuffering(false);
            frameBuffer.current.clear(); // Clear buffer on animation end
            return minIndex; // Respect minimum allowed index
          }
          
          // Track performance for this frame transition
          if (lastFrameStart.current) {
            const frameTime = Date.now() - lastFrameStart.current;
            trackFramePerformance(frameTime);
          }
          
          // Intelligent preloading: Start preloading next frames if buffer is low
          const bufferedFrames = Array.from(frameBuffer.current.entries())
            .filter(([, status]) => status === 'ready').length;
          
          if (bufferedFrames < 2 && nextIndex < totalSteps - 2) {
            preloadFrames(nextIndex).catch(console.warn);
          }
          
          return nextIndex;
        });
        
        // Use adaptive timing instead of fixed 3 seconds
        if (isPlaying) {
          const currentSpeed = calculateOptimalSpeed();
          animationFrameId = setTimeout(() => {
            setIsBuffering(false);
            animate();
          }, currentSpeed);
        } else {
          setIsBuffering(false);
        }
      };

      // Start animation with adaptive delay
      const initialSpeed = calculateOptimalSpeed();
      animationFrameId = setTimeout(() => {
        setIsBuffering(false);
        animate();
      }, initialSpeed);
    }

    return () => {
      if (animationFrameId) {
        clearTimeout(animationFrameId);
      }
      setIsBuffering(false);
    };
  }, [isPlaying, capTime.loading, totalSteps, frameCount, calculateOptimalSpeed, trackFramePerformance, preloadFrames, preloadRasterFrames, minIndex, isRasterAnimation, rasterCacheSignature]);

  // Control functions
  const play = useCallback(() => setIsPlaying(true), []);
  const pause = useCallback(() => setIsPlaying(false), []);
  const togglePlayback = useCallback(() => setIsPlaying(prev => !prev), []);
  
  const stepForward = useCallback(() => {
    if (!capTime.loading && totalSteps > 0) {
      setSliderIndex(prev => {
        const nextIndex = isRasterAnimation
          ? (prev + 1 >= frameCount ? 0 : prev + 1)
          : Math.min(prev + 1, totalSteps);
        return nextIndex;
      });
    }
  }, [capTime.loading, totalSteps, frameCount, isRasterAnimation]);
  
  const stepBackward = useCallback(() => {
    setSliderIndex(prev => {
      const prevIndex = Math.max(prev - 1, minIndex);
      return prevIndex;
    });
  }, [minIndex]);
  
  const setSliderToIndex = useCallback((indexOrUpdater) => {
    setSliderIndex((previousIndex) => {
      const nextIndex = typeof indexOrUpdater === 'function'
        ? indexOrUpdater(previousIndex)
        : indexOrUpdater;
      const clampedIndex = clampIndex(nextIndex, totalSteps, minIndex);

      if (isRasterAnimation) {
        preloadRasterFrames(clampedIndex).catch(console.warn);
      }

      return clampedIndex;
    });
  }, [totalSteps, minIndex, isRasterAnimation, preloadRasterFrames]);

  return {
    sliderIndex,
    setSliderIndex: setSliderToIndex,
    isPlaying,
    setIsPlaying,
    totalSteps,
    currentSliderDate,
    currentSliderDateStr,
    minIndex,
    rasterCacheVersion,
    // A+ Features
    isBuffering,
    animationSpeed,
    animationQuality: animationQuality.current,
    // Control functions
    play,
    pause,
    togglePlayback,
    stepForward,
    stepBackward,
    // Performance utilities
    trackFramePerformance,
    getRasterFrame,
    // Range-max window state (derived)
    isRangeMaxMode: !!activeRangeWindow,
  };
};
