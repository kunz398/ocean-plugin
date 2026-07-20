/**
 * Marine Variable Definitions and Configuration
 * Centralized configuration for marine forecast parameters
 */

import { calculateDynamicRange, extractCoverageTimeseries } from '../utils/marineDataUtils.js';

// ✅ Marine Forecast Configuration
export const MARINE_CONFIG = {
  // Model warm-up period configuration
  WARMUP_DAYS: 0,           // Skip first N days of model spin-up (0 = disabled, keep all data like Widget1)
  ENABLE_WARMUP_SKIP: false, // Toggle warm-up skip feature (disabled to match Widget1 behavior)
  
  // First timestep configuration
  SKIP_FIRST_TIMESTEP: false,  // Don't skip the 0-hour forecast
  
  // Slider initialization configuration
  DEFAULT_SLIDER_INDEX: 0,  // Start at index 0 (first available timestamp)
  
  // Time dimension configuration
  DEFAULT_STEP_HOURS: 6,    // Default timestep for marine forecasts
  
  // WMS configuration
  DEFAULT_WMS_VERSION: '1.3.0',
  DEFAULT_FORMAT: 'image/png',
  DEFAULT_TRANSPARENCY: true,
  
  // Display configuration
  SHOW_WARMUP_NOTICE: false, // Show notice about skipped warm-up period (disabled since we're not skipping)
};

// Marine variable definitions with WMO standards
export const MARINE_VARIABLES = {
  'hs': {
    key: 'hs',
    label: 'Significant Wave Height',
    description: 'The average height of the highest third of waves',
    defaultRange: { min: 0, max: 5 },
    colorScheme: 'bu',  // Blue scheme - MATCHING NIUE
    decimalPlaces: 1,
    units: 'm',
    category: 'wave',
    wmoCodes: ['height_of_wind_waves', 'significant_height_of_wind_and_swell_waves']
  },
  'tm02': {
    key: 'tm02', 
    label: 'Mean Wave Period',
    description: 'Mean zero-crossing period of waves',
    defaultRange: { min: 0, max: 20 },
    colorScheme: 'spectral',
    decimalPlaces: 0,
    units: 's',
    category: 'wave',
    wmoCodes: ['mean_period_of_wind_waves']
  },
  'tpeak': {
    key: 'tpeak',
    label: 'Peak Wave Period', 
    description: 'Wave period corresponding to the most energetic waves',
    defaultRange: { min: 0, max: 20 },  // 0-20 range - MATCHING NIUE
    colorScheme: 'magma',
    decimalPlaces: 0,
    units: 's',
    category: 'wave',
    wmoCodes: ['peak_period_of_wind_waves']
  },
  'dirm': {
    key: 'dirm',
    label: 'Mean Wave Direction',
    description: 'Direction from which waves are coming',
    defaultRange: { min: 0, max: 360 },
    colorScheme: 'dir',
    decimalPlaces: 0,
    units: '°',
    category: 'direction',
    wmoCodes: ['direction_of_wind_waves']
  },
  'ws': {
    key: 'ws',
    label: 'Wind Speed',
    description: '10-meter wind speed',
    defaultRange: { min: 0, max: 25 },
    colorScheme: 'jet',
    decimalPlaces: 1,
    units: 'm/s',
    category: 'wind',
    wmoCodes: ['wind_speed']
  },
  'wd': {
    key: 'wd',
    label: 'Wind Direction',
    description: 'Direction from which wind is blowing',
    defaultRange: { min: 0, max: 360 },
    colorScheme: 'dir',
    decimalPlaces: 0,
    units: '°',
    category: 'direction',
    wmoCodes: ['wind_from_direction']
  },
  'sst': {
    key: 'sst',
    label: 'Sea Surface Temperature',
    description: 'Temperature at the sea surface',
    defaultRange: { min: 20, max: 30 },
    colorScheme: 'rd',
    decimalPlaces: 1,
    units: '°C',
    category: 'temperature',
    wmoCodes: ['sea_surface_temperature']
  },
  // Swell partition variables (added for Cook Islands - matching Niue)
  'dirp': {
    key: 'dirp',
    label: 'Wave direction',
    description: 'Peak wave direction',
    defaultRange: { min: 0, max: 360 },
    colorScheme: 'dir',
    decimalPlaces: 0,
    units: '°',
    category: 'direction',
    wmoCodes: ['direction_of_peak_wave']
  },
  'transp_x': {
    key: 'transp_x',
    label: 'Wave Energy',
    description: 'Wave transport energy (X component)',
    defaultRange: { min: 0, max: 100 },
    colorScheme: 'jet',
    decimalPlaces: 0,
    units: 'kW/m',
    category: 'energy',
    isCalculated: true,
    wmoCodes: []
  },
  'transp_y': {
    key: 'transp_y',
    label: 'Wave Transport Y',
    description: 'Wave transport energy (Y component)',
    defaultRange: { min: 0, max: 100 },
    colorScheme: 'jet',
    decimalPlaces: 0,
    units: 'kW/m',
    category: 'energy',
    hidden: true, // Don't display this row (used for calculations)
    wmoCodes: []
  },
  'hs_p1': {
    key: 'hs_p1',
    label: 'Wind wave(m)',
    description: 'Wind wave significant height',
    defaultRange: { min: 0, max: 5 },
    colorScheme: 'bu',
    decimalPlaces: 1,
    units: 'm',
    category: 'swell',
    wmoCodes: []
  },
  'tp_p1': {
    key: 'tp_p1',
    label: 'Wind wave period',
    description: 'Wind wave peak period',
    defaultRange: { min: 0, max: 25 },
    colorScheme: 'rd',
    decimalPlaces: 0,
    units: 's',
    category: 'swell',
    wmoCodes: []
  },
  'dirp_p1': {
    key: 'dirp_p1',
    label: 'Wind wave dir',
    description: 'Wind wave direction',
    defaultRange: { min: 0, max: 360 },
    colorScheme: 'dir',
    decimalPlaces: 0,
    units: '°',
    category: 'direction',
    wmoCodes: []
  },
  'hs_p2': {
    key: 'hs_p2',
    label: 'Swell(m)',
    description: 'Primary swell significant height',
    defaultRange: { min: 0, max: 5 },
    colorScheme: 'bu',
    decimalPlaces: 1,
    units: 'm',
    category: 'swell',
    wmoCodes: []
  },
  'tp_p2': {
    key: 'tp_p2',
    label: 'Swell Period',
    description: 'Primary swell peak period',
    defaultRange: { min: 0, max: 25 },
    colorScheme: 'rd',
    decimalPlaces: 0,
    units: 's',
    category: 'swell',
    wmoCodes: []
  },
  'dirp_p2': {
    key: 'dirp_p2',
    label: 'Swell Dir',
    description: 'Primary swell direction',
    defaultRange: { min: 0, max: 360 },
    colorScheme: 'dir',
    decimalPlaces: 0,
    units: '°',
    category: 'direction',
    wmoCodes: []
  },
  'hs_p3': {
    key: 'hs_p3',
    label: '2.Swell (m)',
    description: 'Secondary swell significant height',
    defaultRange: { min: 0, max: 5 },
    colorScheme: 'bu',
    decimalPlaces: 1,
    units: 'm',
    category: 'swell',
    wmoCodes: []
  },
  'tp_p3': {
    key: 'tp_p3',
    label: '2.Swell Period',
    description: 'Secondary swell peak period',
    defaultRange: { min: 0, max: 25 },
    colorScheme: 'rd',
    decimalPlaces: 0,
    units: 's',
    category: 'swell',
    wmoCodes: []
  },
  'dirp_p3': {
    key: 'dirp_p3',
    label: '2. Swell Dir',
    description: 'Secondary swell direction',
    defaultRange: { min: 0, max: 360 },
    colorScheme: 'dir',
    decimalPlaces: 0,
    units: '°',
    category: 'direction',
    wmoCodes: []
  }
};

// Get variable definition with dynamic range calculation
export const getVariableDefinition = (key, actualData = null) => {
  const baseDefinition = MARINE_VARIABLES[key] || {
    key,
    label: key.toUpperCase(),
    description: `Marine parameter: ${key}`,
    defaultRange: { min: 0, max: 10 },
    colorScheme: 'bu',
    decimalPlaces: 1,
    units: '',
    category: 'unknown',
    wmoCodes: []
  };

  // Create a copy to avoid mutation
  const definition = { ...baseDefinition };

  // Calculate actual range if data is provided
  if (actualData) {
    const ts = extractCoverageTimeseries(actualData, key);
    if (ts?.values) {
      const actualRange = calculateDynamicRange(
        ts.values, 
        definition.defaultRange.min, 
        definition.defaultRange.max
      );
      definition.actualRange = actualRange;
    }
  }

  return definition;
};

// Get all available marine variables
export const getAllVariableKeys = () => Object.keys(MARINE_VARIABLES);

// Get variables by category
export const getVariablesByCategory = (category) => {
  return Object.values(MARINE_VARIABLES).filter(v => v.category === category);
};

// Validate variable configuration
export const validateVariableConfig = (config) => {
  const required = ['key', 'label', 'defaultRange', 'colorScheme', 'units'];
  const missing = required.filter(field => !(field in config));
  
  if (missing.length > 0) {
    console.warn(`Variable config missing required fields: ${missing.join(', ')}`);
    return false;
  }
  
  const { defaultRange } = config;
  if (!defaultRange || typeof defaultRange.min !== 'number' || typeof defaultRange.max !== 'number') {
    console.warn('Invalid defaultRange in variable config');
    return false;
  }
  
  if (defaultRange.min >= defaultRange.max) {
    console.warn('Invalid range: min must be less than max');
    return false;
  }
  
  return true;
};

// Default variable order for table display - Same order as Niue (Widget1)
export const DEFAULT_VARIABLE_ORDER = [
  'hs',      // Wave
  'tpeak',   // Wave Period
  'dirp',    // Wave direction
  'transp_x',// Wave Energy (calculated)
  'hs_p2',   // Swell(m)
  'tp_p2',   // Swell Period
  'dirp_p2', // Swell Dir
  'hs_p3',   // 2.Swell (m)
  'tp_p3',   // 2.Swell Period
  'dirp_p3', // 2.Swell Dir
  'hs_p1',   // Wind wave(m)
  'tp_p1',   // Wind wave period
  'dirp_p1', // Wind wave dir
  'dirm',    // Mean wave direction
  'tm02',    // Mean wave period
  'ws',      // Wind speed
  'wd',      // Wind direction
  'sst'      // Sea surface temp
];

// Get ordered variables based on availability
export const getOrderedVariables = (availableKeys) => {
  const ordered = DEFAULT_VARIABLE_ORDER.filter(key => availableKeys.includes(key));
  const remaining = availableKeys.filter(key => !DEFAULT_VARIABLE_ORDER.includes(key));
  return [...ordered, ...remaining];
};
