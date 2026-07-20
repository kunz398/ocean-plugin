// WMSStyleManager.js - Advanced WMS styling with multiple color palettes

export const WMSColorPalettes = {
  // ncWMS Available Palettes (verified from server capabilities)
  
  // Perceptually uniform palettes (excellent for scientific data)
  VIRIDIS: 'default-scalar/psu-viridis',
  PLASMA: 'default-scalar/psu-plasma',
  INFERNO: 'default-scalar/psu-inferno',
  MAGMA: 'default-scalar/psu-magma',
  
  // Diverging palettes (good for anomalies, deviations)
  SPECTRAL: 'default-scalar/div-Spectral',
  RdYlBu: 'default-scalar/div-RdYlBu',
  RdBu: 'default-scalar/div-RdBu',
  BrBG: 'default-scalar/div-BrBG',
  
  // Sequential palettes (good for single variable ranges)
  BLUES: 'default-scalar/seq-Blues',
  BLUEHEAT: 'default-scalar/blueheat',
  FERRET: 'default-scalar/ferret',
  OCCAM: 'default-scalar/occam',
  YLGNBU: 'default-scalar/seq-YlGnBu',
  X_SST: 'default-scalar/x-Sst',
  
  // Default fallback
  DEFAULT: 'default-scalar/default'
};

export const WMSStylePresets = {
  WAVE_HEIGHT: {
    style: WMSColorPalettes.X_SST,
    numcolorbands: 250, // Continuous like QGIS (max resolution)
    belowmincolor: 'transparent',
    abovemaxcolor: 'extend',
    interpolation: 'linear', // Linear interpolation like your QGIS example
    mode: 'continuous', // Continuous classification
    description: 'X-SST palette - matches inundation color story for Cook Islands',
    // Rounded, perceptually uniform color mapping (heights in meters) - X-SST palette
    colorMapping: {
      0: 'rgb(49, 54, 149)',    // Calm seas (0–1 m) - Deep blue
      1: 'rgb(69, 117, 180)',   // Slight (1–2 m) - Blue
      2: 'rgb(116, 173, 209)',  // Moderate (2–4 m) - Cyan
      4: 'rgb(171, 217, 233)',  // Rough (4–6 m) - Aqua
      6: 'rgb(254, 224, 144)',  // Very Rough (6–9 m) - Yellow
      9: 'rgb(253, 174, 97)',   // High (9–14 m) - Orange
      14: 'rgb(215, 48, 39)'    // Extreme (14+ m) - Red
    }
  },
  
  WAVE_PERIOD: {
    style: WMSColorPalettes.SPECTRAL,
    numcolorbands: 220,
    belowmincolor: 'transparent',
    abovemaxcolor: 'extend',
    description: 'Spectral palette for mean wave period: short periods red/orange, long periods blue/purple'
  },
  
  PEAK_WAVE_PERIOD: {
    style: WMSColorPalettes.MAGMA,
    numcolorbands: 256,
    belowmincolor: 'transparent',
    abovemaxcolor: 'extend',
    description: 'Magma palette optimized for peak wave period (tpeak) - server compatible'
  },
  
  INUNDATION: {
    style: WMSColorPalettes.X_SST,
    numcolorbands: 250,
    belowmincolor: 'transparent',
    abovemaxcolor: 'extend',
    description: 'X-SST palette for inundation depth visualisation'
  },
  
  WAVE_ENERGY: {
    style: WMSColorPalettes.INFERNO,
    numcolorbands: 300,
    belowmincolor: 'transparent',
    abovemaxcolor: 'extend',
    description: 'Inferno palette - high dynamic range for wave energy visualization'
  },
  
  TEMPERATURE: {
    style: WMSColorPalettes.COOLWARM,
    numcolorbands: 250,
    belowmincolor: 'blue',
    abovemaxcolor: 'red',
    description: 'Blue-to-red diverging palette for temperature data'
  },
  
  BATHYMETRY: {
    style: WMSColorPalettes.SPECTRAL,
    numcolorbands: 200,
    belowmincolor: 'darkblue',
    abovemaxcolor: 'brown',
    description: 'Spectral palette ideal for depth/elevation data'
  }
};

export class WMSStyleManager {
  constructor() {
    this.currentPalette = WMSColorPalettes.VIRIDIS;
    this.listeners = [];
  }

  /**
   * Get enhanced WMS options for a specific data type (QGIS-style continuous classification)
   * @param {string} dataType - Type of oceanographic data
   * @param {Object} baseOptions - Base WMS options
   * @returns {Object} Enhanced WMS options with optimal styling
   */
  getEnhancedWMSOptions(dataType, baseOptions = {}) {
    const preset = this.getPresetForDataType(dataType);
    
    return {
      ...baseOptions,
      style: preset.style,
      // QGIS-style continuous rendering
      numcolorbands: preset.numcolorbands || 256, // Maximum resolution like QGIS
      belowmincolor: preset.belowmincolor,
      abovemaxcolor: preset.abovemaxcolor,
      // Enhanced sampling for smoother gradients (like QGIS linear interpolation)
      version: '1.3.0',
      format: 'image/png',
      transparent: true,
      // Advanced rendering options for professional quality
      map_resolution: 200, // Higher resolution for crisp rendering
      bgcolor: '0x000000',
      // Anti-aliasing and smooth transitions
      smooth: true,
      antialias: true
    };
  }

  /**
   * Generate QGIS-style continuous color scale range with optimal breaks
   * @param {string} dataType - Type of data
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   * @returns {Object} Color scale configuration
   */
  getContinuousColorScale(dataType, min = 0, max = 4) {
    const preset = this.getPresetForDataType(dataType);
    
    // For wave height, create optimal color breaks like QGIS
    if (dataType.toLowerCase().includes('hs') || dataType.toLowerCase().includes('height')) {
      return {
        range: `${min},${max}`,
        breaks: this.generateColorBreaks(min, max, preset.colorMapping),
        numcolorbands: 256, // Continuous like QGIS
        interpolation: 'linear'
      };
    }
    
    return {
      range: `${min},${max}`,
      numcolorbands: preset.numcolorbands,
      interpolation: 'linear'
    };
  }

  /**
   * Generate color breaks similar to QGIS continuous classification
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value  
   * @param {Object} colorMapping - Color mapping object
   * @returns {Array} Array of color breaks
   */
  generateColorBreaks(min, max, colorMapping) {
    const breaks = [];
    const values = Object.keys(colorMapping).map(Number).sort((a, b) => a - b);
    let previousValue = min;

    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (value < min || value > max + Number.EPSILON) {
        continue;
      }

      const upperBound = Math.min(value, max);
      if (upperBound <= previousValue + Number.EPSILON) {
        previousValue = value;
        continue;
      }

      breaks.push({
        value: upperBound,
        color: colorMapping[value],
        label: this.getWaveHeightLabel(upperBound),
        description: this.getWaveHeightDescription(previousValue, upperBound, { dataMax: 15 })
      });

      previousValue = value;
    }

    return breaks;
  }

  /**
   * Get descriptive labels for wave height values
   * @param {number} value - Wave height in meters
   * @returns {string} Descriptive label
   */
  getWaveHeightLabel(value) {
    if (value <= 1) return 'Calm';
    if (value <= 2) return 'Slight';
    if (value <= 4) return 'Moderate';
    if (value <= 6) return 'Rough';
    if (value <= 9) return 'Very Rough';
    if (value <= 14) return 'High';
    return 'Extreme';
  }

  /**
   * Provide adaptive marine descriptions based on regional data characteristics and island-scale conditions
   * @param {number} min - Minimum height in meters
   * @param {number} max - Maximum height in meters (Infinity for open-ended)
   * @param {Object} context - Regional context (dataMax, location, etc.)
   * @returns {string} Context-aware marine classification
   */
  getWaveHeightDescription(min, max, context = {}) {
    const formattedRange = this.formatWaveHeightRange(min, max);
    const dataMax = context.dataMax || 15; // Default to global range if unknown
    const isIslandScale = dataMax < 3; // Tropical/protected waters
    const isModerateScale = dataMax < 8; // Temperate/coastal waters
    
    // Island-scale descriptions (tropical atolls, protected waters, data max < 3m)
    if (isIslandScale) {
      if (max <= 0.5) {
        return `Calm Lagoon Conditions: ${formattedRange}. Mirror-like conditions inside reef protection. Ideal for all water activities, kayaking, snorkeling. No reef breaking.`;
      }
      if (max <= 1) {
        return `Light Trade Wind Seas: ${formattedRange}. Gentle swells on outer reefs. Small craft operations normal. Light surf on windward shores. Tourism activities unaffected.`;
      }
      if (max <= 1.5) {
        return `Moderate Trade Conditions: ${formattedRange}. Active reef breaking on exposed coasts. Small craft may experience spray. Larger swells reach protected harbors.`;
      }
      if (max <= 2.5) {
        return `Strong Trade Wind Seas: ${formattedRange}. Significant reef breaking, restricted passage through cuts. Consider delayed departure for vessels <10m. Elevated surf conditions.`;
      }
      return `High Island Seas: ${formattedRange}. Maximum regional wave conditions. Heavy reef breaking, dangerous passages. Port restrictions likely. Emergency response preparations.`;
    }
    
    // Moderate coastal scale (temperate waters, data max 3-8m) 
    if (isModerateScale) {
      if (max <= 1) {
        return `WMO Sea State 0-2: ${formattedRange}. Calm to slight coastal seas. Safe for all vessels including recreational craft. Light onshore conditions.`;
      }
      if (max <= 2) {
        return `WMO Sea State 3: ${formattedRange}. Slight seas with occasional whitecaps. Normal coastal operations. Minor spray over breakwaters.`;
      }
      if (max <= 4) {
        return `WMO Sea State 4: ${formattedRange}. Moderate seas, frequent whitecaps. Small craft advisory conditions. Reduced speeds recommended for pleasure craft.`;
      }
      if (max <= 6) {
        return `WMO Sea State 5: ${formattedRange}. Rough coastal seas. Gale warning conditions. Restrict operations for vessels <15m LOA. Port approach difficulties.`;
      }
      return `WMO Sea State 6: ${formattedRange}. Very rough regional seas. Storm conditions approaching maximum for this area. Commercial traffic restrictions.`;
    }
    
    // Global scale descriptions (open ocean, data max >8m)
    if (max <= 1) {
      return `WMO Sea State 0-2: ${formattedRange}. Calm to slight seas. Wave crests smooth, no breaking. Safe for all vessel operations including small craft.`;
    }
    if (max <= 2) {
      return `WMO Sea State 3: ${formattedRange}. Slight seas. Short wavelength, few whitecaps. Minor spray may affect bridge visibility on smaller vessels.`;
    }
    if (max <= 4) {
      return `WMO Sea State 4: ${formattedRange}. Moderate seas. Frequent whitecaps, moderate spray. Small craft advisories may be issued. Reduced speed recommended.`;
    }
    if (max <= 6) {
      return `WMO Sea State 5: ${formattedRange}. Rough seas. Continuous whitecapping, heavy spray. Gale warning conditions. Restrict operations for vessels <20m LOA.`;
    }
    if (max <= 9) {
      return `WMO Sea State 6: ${formattedRange}. Very rough seas. Extensive foam patches, significant spray impairment. Storm warning conditions. Commercial traffic restricted.`;
    }
    if (max <= 14) {
      return `WMO Sea State 7-8: ${formattedRange}. High to very high seas. Continuous heavy breaking, severe visibility reduction. Hurricane-force conditions. Port closures likely.`;
    }
    return `WMO Sea State 9: ${formattedRange}. Phenomenal seas. Exceptional wave conditions exceeding operational design limits for most vessels. Emergency conditions.`;
  }

  /**
   * Format ranges with rounded breakpoints for display and tooltips
   */
  formatWaveHeightRange(min, max) {
    const minText = this.formatWaveHeightValue(min);
    if (!Number.isFinite(max)) {
      return `${minText}+ m`;
    }
    const maxText = this.formatWaveHeightValue(max);
    return `${minText}–${maxText} m`;
  }

  /**
   * Format individual values with minimal decimals
   */
  formatWaveHeightValue(value) {
    if (!Number.isFinite(value)) {
      return '';
    }
    if (Math.abs(value - Math.round(value)) < 1e-6) {
      return `${Math.round(value)}`;
    }
    return value.toFixed(1);
  }

  /**
   * Get appropriate style preset based on data type
   * @param {string} dataType - Type of data (height, period, direction, etc.)
   * @returns {Object} Style preset
   */
  getPresetForDataType(dataType) {
    const type = dataType.toLowerCase();
    
    if (type.includes('hs') || type.includes('height') || type.includes('wave')) {
      return WMSStylePresets.WAVE_HEIGHT;
    }
    
    if (type.includes('tpeak')) {
      return WMSStylePresets.PEAK_WAVE_PERIOD;
    }
    
    if (type.includes('inun') || type.includes('flood') || type.includes('inund')) {
      return WMSStylePresets.INUNDATION;
    }
    
    if (type.includes('period') || type.includes('tm')) {
      return WMSStylePresets.WAVE_PERIOD;
    }
    
    if (type.includes('energy') || type.includes('power') || type.includes('flux')) {
      return WMSStylePresets.WAVE_ENERGY;
    }
    
    if (type.includes('temp') || type.includes('sst')) {
      return WMSStylePresets.TEMPERATURE;
    }
    
    if (type.includes('depth') || type.includes('bathy') || type.includes('elevation')) {
      return WMSStylePresets.BATHYMETRY;
    }
    
    // Default to wave height styling
    return WMSStylePresets.WAVE_HEIGHT;
  }

  /**
   * Generate optimized color scale ranges based on data statistics
   * @param {string} dataType - Type of data
   * @param {Object} stats - Data statistics {min, max, mean, std}
   * @returns {string} Optimized color scale range
   */
  getOptimizedColorRange(dataType, stats = {}) {
    const type = dataType.toLowerCase();
    
    // Use provided statistics if available
    if (stats.min !== undefined && stats.max !== undefined) {
      // Add some padding for outliers
      const range = stats.max - stats.min;
      const min = Math.max(0, stats.min - range * 0.1);
      const max = stats.max + range * 0.1;
      return `${min.toFixed(1)},${max.toFixed(1)}`;
    }
    
    // Default ranges based on Cook Islands typical conditions
    if (type.includes('hs') || type.includes('height')) {
      return '0,6';  // Extended range for extreme events
    }
    
    if (type.includes('tpeak')) {
      return '9,14'; // Peak wave period optimized range (based on Cook Islands data)
    }
    
    if (type.includes('inun') || type.includes('inund')) {
      return '0,2'; // Typical inundation depth range in metres
    }
    
    if (type.includes('period') || type.includes('tm')) {
      return '2,25'; // More realistic period range
    }
    
    if (type.includes('temp') || type.includes('sst')) {
      return '20,32'; // Tropical Pacific temperature range
    }
    
    if (type.includes('depth') || type.includes('bathy')) {
      return '-4000,100'; // Pacific bathymetry range
    }
    
    return '0,10'; // Generic range
  }

  /**
   * Get legend URL with enhanced styling
   * @param {string} dataType - Type of data
   * @param {string} colorRange - Color scale range
   * @param {string} unit - Data unit
   * @returns {string} Enhanced legend URL
   */
  getEnhancedLegendUrl(dataType, colorRange, unit = '') {
    const preset = this.getPresetForDataType(dataType);
    const [min, max] = colorRange.split(',');
    
    // Determine appropriate layer map ID based on data type
    let layerMapId = 40; // Default for wave height
    if (dataType.includes('period')) layerMapId = 43;
    if (dataType.includes('temp')) layerMapId = 41;
    if (dataType.includes('depth')) layerMapId = 42;
    
    const step = Math.max(0.1, (parseFloat(max) - parseFloat(min)) / 10);
    
    return `https://ocean-plotter.spc.int/plotter/GetLegendGraphic?` +
           `layer_map=${layerMapId}&mode=enhanced&` +
           `min_color=${min}&max_color=${max}&step=${step}&` +
           `color=${this.getColorSchemeFromStyle(preset.style)}&` +
           `unit=${encodeURIComponent(unit)}&` +
           `bands=${preset.numcolorbands}&` +
           `quality=high`;
  }

  /**
   * Extract color scheme name from WMS style
   * @param {string} style - WMS style string
   * @returns {string} Color scheme name
   */
  getColorSchemeFromStyle(style) {
    if (style.includes('x-Sst')) return 'sst';
    if (style.includes('viridis')) return 'viridis';
    if (style.includes('plasma')) return 'plasma';
    if (style.includes('turbo')) return 'turbo';
    if (style.includes('coolwarm')) return 'coolwarm';
    if (style.includes('spectral')) return 'spectral';
    if (style.toLowerCase().includes('ylgnbu')) return 'ylgnbu';
    if (style.toLowerCase().includes('seq-blues')) return 'blues';
    if (style.includes('rainbow')) return 'rainbow';
    return 'jet'; // Default
  }

  /**
   * Add listener for style changes
   * @param {Function} callback - Callback function
   */
  addListener(callback) {
    this.listeners.push(callback);
  }

  /**
   * Remove listener
   * @param {Function} callback - Callback function to remove
   */
  removeListener(callback) {
    this.listeners = this.listeners.filter(cb => cb !== callback);
  }

  /**
   * Notify all listeners of style changes
   */
  notifyListeners() {
    this.listeners.forEach(callback => callback(this.currentPalette));
  }
}

const instance = new WMSStyleManager();
export default instance;
