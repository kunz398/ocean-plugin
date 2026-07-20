import { useState, useEffect } from 'react';
import { MARINE_CONFIG } from '../config/marineVariables';
import { isRasterSourceLayer } from '../config/layerConfig';
import { createInundationProvider } from '../services/inundationProviderFactory';

/**
 * Hook for fetching and managing WMS capabilities
 * Handles time dimension parsing and capability metadata
 */
export const useWMSCapabilities = (selectedLayer, allLayers) => {
  const [capTime, setCapTime] = useState({ 
    loading: true, 
    start: new Date(), 
    end: new Date(), 
    stepHours: 1,
    originalStart: new Date() // Add originalStart to initial state
  });

  useEffect(() => {
    async function fetchCapabilities() {
      setCapTime((prev) => ({ ...prev, loading: true }));
      try {
        // First try to find layer directly
        let selectedLayerConfig = allLayers.find(l => l.value === selectedLayer);
        
        // If not found, check if it's a sub-layer of a composite layer
        if (!selectedLayerConfig) {
          for (const layer of allLayers) {
            if (layer?.composite && layer?.layers) {
              const subLayer = layer.layers.find(sub => sub?.value === selectedLayer);
              if (subLayer) {
                console.log(`🔍 Found sub-layer in composite: ${selectedLayer} in ${layer.value}`);
                selectedLayerConfig = layer; // Use parent composite for general config
                break;
              }
            }
          }
        }
        
        console.log(`🔍 Fetching capabilities for layer: ${selectedLayer}`);
        console.log(`🔍 Layer config:`, selectedLayerConfig);

        if (isRasterSourceLayer(selectedLayerConfig)) {
          const provider = createInundationProvider(selectedLayerConfig.apiBase);
          const [metadata, availableTimestamps] = await Promise.all([
            provider.loadMetadata(),
            provider.loadTimesteps()
          ]);

          const stepHours = getStepHoursFromTimestamps(availableTimestamps) || 1;
          const start = availableTimestamps[0] || new Date();
          const end = availableTimestamps[availableTimestamps.length - 1] || start;

          setCapTime({
            loading: false,
            start,
            end,
            stepHours,
            totalSteps: Math.max(availableTimestamps.length - 1, 0),
            availableTimestamps,
            originalStart: start,
            metadata,
            sourceType: selectedLayerConfig.sourceType
          });
          return;
        }
        
        // Skip capabilities fetch for static layers
        if (selectedLayerConfig?.isStatic) {
          console.log(`⏭️ Skipping capabilities for static layer: ${selectedLayer}`);
          setCapTime({
            loading: false,
            start: new Date(),
            end: new Date(),
            stepHours: 1,
            totalSteps: 0,
            availableTimestamps: [],
            originalStart: new Date(), // Add for consistency
            metadata: null,
            sourceType: selectedLayerConfig?.sourceType || 'wms'
          });
          return;
        }
        
        // Determine which layer to use for capabilities
        let capsLayer = selectedLayerConfig;
        if (selectedLayerConfig?.composite) {
          // For composite layers, find the appropriate sub-layer for capabilities
          // If we're looking for a specific sub-layer (like cook_forecast/hs), use that
          const requestedSubLayer = selectedLayerConfig.layers?.find(sub => sub?.value === selectedLayer);
          if (requestedSubLayer) {
            capsLayer = requestedSubLayer;
            console.log(`🔄 Using requested sub-layer for capabilities:`, capsLayer);
          } else {
            // Otherwise, prefer wave height layer for capabilities (not direction)
            const waveHeightLayer = selectedLayerConfig.layers?.find(layer => 
              layer.value && (layer.value.includes('hs') || layer.value.includes('height'))
            );
            capsLayer = waveHeightLayer || selectedLayerConfig.layers?.[0];
            console.log(`🔄 Using preferred sub-layer for capabilities:`, capsLayer);
          }
        }
        if (!capsLayer?.wmsUrl) {
          console.error("Layer configuration missing wmsUrl:", {
            selectedLayer: selectedLayer,
            selectedLayerConfig: selectedLayerConfig,
            capsLayer: capsLayer
          });
          throw new Error(`WMS URL not defined for layer: ${selectedLayer}`);
        }
        
        let urlForCaps = capsLayer.wmsUrl;
        const isThreddsServer = urlForCaps.includes('thredds');
        
        if (!urlForCaps.toLowerCase().includes("request=getcapabilities")) {
          urlForCaps += (urlForCaps.includes("?") ? "&" : "?") + "SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0";
        }
        
        // THREDDS servers may need different handling
        if (isThreddsServer) {
          console.log(`🌐 Using THREDDS server for capabilities: ${urlForCaps}`);
        }
        
        console.log(`🌐 Fetching capabilities from: ${urlForCaps}`);
        
        const res = await fetch(urlForCaps);
        if (!res.ok) {
          throw new Error(`Failed to fetch capabilities: ${res.status} ${res.statusText}`);
        }
        
        const xml = await res.text();
        console.log(`📄 Capabilities XML length: ${xml.length} characters`);
        
        const timeDim = parseTimeDimensionFromCapabilities(xml, capsLayer.value);
        if (!timeDim) {
          console.warn(`⚠️ No time dimension found for layer: ${capsLayer.value}`);
          
          // Special handling for THREDDS wave direction layers
          if (isThreddsServer && capsLayer.value === 'dirm') {
            console.log(`ℹ️ Wave direction layer from THREDDS - using time from wave height layer`);
            // Wave direction uses same time as wave height, so we'll handle this in composite layer logic
          }
          
          // For layers without time dimension, treat as static
          setCapTime({
            loading: false,
            start: new Date(),
            end: new Date(),
            stepHours: 1,
            totalSteps: 0,
            availableTimestamps: []
          });
          return;
        }
        
        console.log(`🕒 Time dimension for ${capsLayer.value}:`, timeDim.raw);
        
        const timeRange = getTimeRangeFromDimension(timeDim.raw);
        if (!timeRange) throw new Error("Could not parse time dimension.");
        
        const { start, end, stepHours, availableTimestamps, originalStart } = timeRange;
        const newTotalSteps = availableTimestamps ? availableTimestamps.length - 1 : 0;
        
        if (availableTimestamps) {
          console.log(`📅 Found ${availableTimestamps.length} available timestamps for ${capsLayer.value}`);
          console.log(`📅 First timestamp: ${availableTimestamps[0]?.toISOString()}`);
          console.log(`📅 Last timestamp: ${availableTimestamps[availableTimestamps.length - 1]?.toISOString()}`);
        }
        
        console.log(`⏰ Time Range Parsed:`);
        console.log(`   Original Start (Model Run): ${originalStart?.toISOString()}`);
        console.log(`   Adjusted Start (After Skips): ${start?.toISOString()}`);
        console.log(`   End: ${end?.toISOString()}`);
        console.log(`   Total Steps: ${newTotalSteps}`);
        
        setCapTime({
          loading: false,
          start: start || new Date(),
          end: end || new Date(),
          stepHours: stepHours || 6,
          totalSteps: newTotalSteps,
          availableTimestamps: availableTimestamps || [],
          originalStart: originalStart || start || new Date(), // Store original model run time
          metadata: null,
          sourceType: 'wms'
        });
      } catch (error) {
        console.error("Error fetching capabilities:", error.message);
        setCapTime((prev) => ({ ...prev, loading: false }));
      }
    }

    if (selectedLayer) {
      fetchCapabilities();
    }
  }, [selectedLayer, allLayers]);

  return capTime;
};

const getStepHoursFromTimestamps = (timestamps) => {
  if (!Array.isArray(timestamps) || timestamps.length < 2) {
    return 1;
  }

  const firstStepMs = timestamps[1].getTime() - timestamps[0].getTime();
  if (!Number.isFinite(firstStepMs) || firstStepMs <= 0) {
    return 1;
  }

  return firstStepMs / (60 * 60 * 1000);
};

// Helper functions (move these from the main file)
const WMS_NAMESPACE = 'http://www.opengis.net/wms';

const parseTimeDimensionFromCapabilities = (xml, layerName) => {
  try {
    // Use requestIdleCallback for better performance if available
    const parseWork = () => {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xml, "text/xml");

      const resolveNamespace = (prefix) => {
        if (prefix === 'wms') return WMS_NAMESPACE;
        return xmlDoc.lookupNamespaceURI(prefix) || null;
      };

      let targetLayer = null;

      // Attempt namespace-aware XPath lookup first
      if (xmlDoc.evaluate) {
        const xpath = `//wms:Layer[wms:Name[text()='${layerName}']]`;
        const result = xmlDoc.evaluate(
          xpath,
          xmlDoc,
          resolveNamespace,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        targetLayer = result?.singleNodeValue || null;
      }

      // Fallback to manual traversal when XPath misses (common with default namespaces)
      if (!targetLayer) {
        const layers = Array.from(
          xmlDoc.getElementsByTagNameNS(WMS_NAMESPACE, 'Layer')
        );

        if (!layers.length) {
          // As a last resort, allow namespace-agnostic search
          layers.push(...Array.from(xmlDoc.getElementsByTagName('Layer')));
        }

        targetLayer = layers.find(layer => {
          const nameNode = layer.getElementsByTagNameNS(WMS_NAMESPACE, 'Name')[0]
            || layer.getElementsByTagName('Name')[0];
          const candidateName = nameNode?.textContent?.trim();
          return candidateName === layerName;
        }) || null;

        if (targetLayer) {
          console.info(`✅ Found target layer via fallback search: ${layerName}`);
        }
      }

      if (!targetLayer) {
        console.info(`❌ Layer ${layerName} not found in capabilities`);
        return null;
      }

      const dimensionCandidates = [
        ...Array.from(targetLayer.getElementsByTagNameNS(WMS_NAMESPACE, 'Dimension')),
        ...Array.from(targetLayer.getElementsByTagNameNS(WMS_NAMESPACE, 'Extent')),
        ...Array.from(targetLayer.getElementsByTagName('Dimension')),
        ...Array.from(targetLayer.getElementsByTagName('Extent')),
      ];

      const timeDim = dimensionCandidates.find((dim) => {
        const nameAttr = dim.getAttribute('name') || dim.getAttribute('Name');
        return nameAttr?.toLowerCase() === 'time';
      });

      if (timeDim) {
        const rawTimeData = timeDim.textContent?.trim() || '';
        console.log(`🕒 Found time dimension: ${rawTimeData}`);
        return {
          raw: rawTimeData,
          units: timeDim.getAttribute('units') || 'ISO8601'
        };
      }

      console.warn(`⚠️ No time dimension found in layer: ${layerName}`);
      return null;
    };

    return parseWork();
  } catch (error) {
    console.error("Error parsing capabilities XML:", error);
    return null;
  }
};

const getTimeRangeFromDimension = (timeDimString) => {
  if (!timeDimString) return null;
  
  // ✅ Configuration: Skip warm-up period (model initialization with unreliable data)
  const WARMUP_DAYS = MARINE_CONFIG.WARMUP_DAYS;
  const ENABLE_WARMUP_SKIP = MARINE_CONFIG.ENABLE_WARMUP_SKIP;
  
  try {
    // Handle comma-separated individual timestamps
    if (timeDimString.includes(',')) {
      const timestamps = timeDimString.split(',').map(t => t.trim()).filter(Boolean);
      const validTimestamps = timestamps
        .map(t => new Date(t))
        .filter(d => !isNaN(d.getTime()))
        .sort((a, b) => a.getTime() - b.getTime());
      
      if (validTimestamps.length > 0) {
        // ✅ Use first available timestamp as-is (no inference needed)
        // The first timestamp in the data is the actual start of the forecast
        const firstAvailable = validTimestamps[0];
        
        console.log(`🎯 Using first available timestamp as start:`);
        console.log(`   First available: ${firstAvailable.toISOString()}`);
        
        const originalStart = firstAvailable; // Use first available timestamp directly
        const originalEnd = validTimestamps[validTimestamps.length - 1];
        
        // ✅ Skip warm-up period if enabled
        let filteredTimestamps = validTimestamps;
        let actualStart = originalStart;
        
        if (ENABLE_WARMUP_SKIP && WARMUP_DAYS > 0) {
          const warmupCutoff = new Date(originalStart.getTime() + WARMUP_DAYS * 24 * 60 * 60 * 1000);
          filteredTimestamps = validTimestamps.filter(t => t >= warmupCutoff);
          
          if (filteredTimestamps.length > 0) {
            actualStart = filteredTimestamps[0];
            console.log(`🌊 Skipping ${WARMUP_DAYS}-day warm-up period for model spin-up`);
            console.log(`   Original start: ${originalStart.toISOString()}`);
            console.log(`   Reliable data start: ${actualStart.toISOString()}`);
            console.log(`   Removed ${validTimestamps.length - filteredTimestamps.length} warm-up timestamps`);
          } else {
            console.warn(`⚠️ Warm-up skip would remove all timestamps, keeping original range`);
            filteredTimestamps = validTimestamps;
            actualStart = originalStart;
          }
        }
        
        // ✅ Skip first timestep (0-hour) if enabled - often analysis/nowcast, not forecast
        if (MARINE_CONFIG.SKIP_FIRST_TIMESTEP && filteredTimestamps.length > 1) {
          console.log(`🎯 Skipping 0-hour timestep (analysis/nowcast)`);
          console.log(`   Removed timestamp: ${filteredTimestamps[0].toISOString()}`);
          filteredTimestamps = filteredTimestamps.slice(1); // Remove first timestamp
          actualStart = filteredTimestamps[0];
          console.log(`   New start: ${actualStart.toISOString()}`);
        }
        
        return {
          start: actualStart,
          end: originalEnd,
          step: 'PT1H', // Default step
          availableTimestamps: filteredTimestamps,
          originalStart: originalStart, // ✅ Use actual first timestamp (no inference)
          warmupDays: ENABLE_WARMUP_SKIP ? WARMUP_DAYS : 0,
          warmupSkipped: ENABLE_WARMUP_SKIP && filteredTimestamps.length < validTimestamps.length
        };
      }
    }
    
    // Handle range format (start/end/step)
    if (timeDimString.includes('/')) {
      const parts = timeDimString.split('/');
      if (parts.length >= 2) {
        const originalStart = new Date(parts[0]);
        const end = new Date(parts[1]);
        const step = parts[2] || 'PT6H'; // Default to 6 hours for marine forecast
        
        if (!isNaN(originalStart.getTime()) && !isNaN(end.getTime())) {
          // ✅ Calculate warm-up cutoff
          let actualStart = originalStart;
          if (ENABLE_WARMUP_SKIP && WARMUP_DAYS > 0) {
            const warmupCutoff = new Date(originalStart.getTime() + WARMUP_DAYS * 24 * 60 * 60 * 1000);
            
            // Only apply if cutoff is before end date
            if (warmupCutoff < end) {
              actualStart = warmupCutoff;
              console.log(`🌊 Skipping ${WARMUP_DAYS}-day warm-up period for range format`);
              console.log(`   Original start: ${originalStart.toISOString()}`);
              console.log(`   Reliable data start: ${actualStart.toISOString()}`);
            } else {
              console.warn(`⚠️ Warm-up skip would exceed end date, keeping original range`);
            }
          }
          
          // Generate available timestamps starting from actual start (after warm-up if enabled)
          const stepHours = getStepHours(step);
          const availableTimestamps = [];
          let current = new Date(actualStart);
          
          console.log(`🌊 Generating timestamps from ${actualStart.toISOString()} to ${end.toISOString()}, step: ${stepHours}h`);
          
          while (current <= end) {
            availableTimestamps.push(new Date(current));
            current = new Date(current.getTime() + stepHours * 60 * 60 * 1000);
          }
          
          console.log(`🌊 Generated ${availableTimestamps.length} available timestamps`);
          
          // ✅ Skip first timestep (0-hour) if enabled - often analysis/nowcast, not forecast
          let finalTimestamps = availableTimestamps;
          let finalStart = actualStart;
          
          if (MARINE_CONFIG.SKIP_FIRST_TIMESTEP && availableTimestamps.length > 1) {
            console.log(`🎯 Skipping 0-hour timestep (analysis/nowcast)`);
            console.log(`   Removed timestamp: ${availableTimestamps[0].toISOString()}`);
            finalTimestamps = availableTimestamps.slice(1);
            finalStart = finalTimestamps[0];
            console.log(`   New start: ${finalStart.toISOString()}`);
          }
          
          return { 
            start: finalStart,
            end, 
            step, 
            stepHours, 
            availableTimestamps: finalTimestamps,
            originalStart: originalStart,
            warmupDays: ENABLE_WARMUP_SKIP ? WARMUP_DAYS : 0,
            warmupSkipped: ENABLE_WARMUP_SKIP && actualStart > originalStart
          };
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error("Error parsing time range:", error);
    return null;
  }
};

const getStepHours = (stepString) => {
  if (!stepString) return 6; // Default to 6 hours since data is available every 6 hours
  
  try {
    // Parse ISO 8601 duration (e.g., PT1H, PT3H, PT6H)
    if (stepString.startsWith('PT') && stepString.endsWith('H')) {
      const hours = parseInt(stepString.slice(2, -1));
      return isNaN(hours) ? 6 : hours;
    }
    
    // Handle other formats
    if (stepString.includes('hour')) {
      const match = stepString.match(/(\d+)\s*hour/i);
      if (match) {
        return parseInt(match[1]) || 6;
      }
    }
    
    return 6; // Default to 6 hours for marine forecast data
  } catch (error) {
    console.error("Error parsing step hours:", error);
    return 6;
  }
};
