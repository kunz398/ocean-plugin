/**
 * Custom Hooks for Table Data Processing
 * Separates business logic from presentation components
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  extractCoverageTimeseries, 
  filterToSixHourly 
} from '../utils/marineDataUtils.js';
import { 
  getVariableDefinition, 
  getOrderedVariables 
} from '../config/marineVariables.js';

// Hook for processing table data with performance optimization
export const useTableData = (perVariableData) => {
  const [tableRows, setTableRows] = useState([]);
  const [times, setTimes] = useState([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Memoize available data keys to prevent unnecessary recalculations
  const dataKeys = useMemo(() => {
    if (!perVariableData || typeof perVariableData !== 'object') {
      return [];
    }
    return Object.keys(perVariableData);
  }, [perVariableData]);

  // Process data with error handling and performance optimization
  const processData = useCallback(() => {
    setIsLoading(true);
    setError("");
    
    try {
      let allRows = [];
      let timesArr = [];
      
      // Use ordered variables for consistent display
      const orderedKeys = dataKeys.length > 0 
        ? getOrderedVariables(dataKeys)
        : ['dirm', 'hs', 'tm02', 'tpeak']; // Default marine parameters - direction first

      // Process each variable
      for (const key of orderedKeys) {
        const varDef = getVariableDefinition(key, perVariableData?.[key]);
        const range = varDef.actualRange || varDef.defaultRange;
        
        let values = [];
        
        // Process data if available and get actual values for dynamic range calculation
        if (perVariableData?.[key]) {
          const ts = extractCoverageTimeseries(perVariableData[key], key);
          if (ts?.values?.length > 0) {
            const filtered = filterToSixHourly(ts.times, ts.values);
            
            // Set times array from the first valid dataset
            if (!timesArr.length && filtered.times?.length > 0) {
              timesArr = filtered.times;
            }
            
            values = filtered.values;
          }
        }
        
        // Create configuration with the ACTUAL range from data, not parsed config
        const config = {
          calc: false,
          type: varDef.colorScheme,
          min: range.min,
          max: range.max,
          decimalPlaces: varDef.decimalPlaces
        };
        
        // Add row even if no data (for consistent table structure)
        allRows.push({
          key,
          label: varDef.label || key.toUpperCase(),
          config: {
            ...config,
            units: varDef.units,
            category: varDef.category
          },
          values,
          description: varDef.description
        });
      }
      
      setTableRows(allRows);
      setTimes(timesArr);
      
      // Set appropriate error message
      if (allRows.length === 0) {
        setError("No marine forecast parameters configured");
      } else if (allRows.every(row => row.values.length === 0)) {
        setError("No tabular timeseries data available for the selected location");
      }
      
    } catch (err) {
      console.error('Error processing table data:', err);
      setError(`Data processing error: ${err.message}`);
      setTableRows([]);
      setTimes([]);
    } finally {
      setIsLoading(false);
    }
  }, [dataKeys, perVariableData]);

  // Process data when dependencies change
  useEffect(() => {
    processData();
  }, [processData]);

  return {
    tableRows,
    times,
    error,
    isLoading,
    hasData: tableRows.length > 0 && times.length > 0,
    refresh: processData
  };
};

// Hook for dark mode detection with observer pattern
export const useDarkMode = () => {
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    // Initial check
    const checkTheme = () => {
      const theme = document.documentElement.getAttribute('data-theme');
      const isDark = theme === 'dark' ||
                    document.body.classList.contains('dark-mode') ||
                    document.documentElement.classList.contains('dark-mode');
      setIsDarkMode(isDark);
    };
    
    checkTheme();
    
    // Listen for theme changes on body and html elements
    const bodyObserver = new MutationObserver(checkTheme);
    const htmlObserver = new MutationObserver(checkTheme);
    
    bodyObserver.observe(document.body, { 
      attributes: true, 
      attributeFilter: ['class', 'data-theme'] 
    });
    
    htmlObserver.observe(document.documentElement, { 
      attributes: true, 
      attributeFilter: ['class', 'data-theme'] 
    });
    
    // Also listen for media query changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = () => {
      // Only use system preference if no explicit theme is set
      const explicitTheme = document.documentElement.getAttribute('data-theme') ||
                            document.body.classList.contains('dark-mode') ||
                            document.body.classList.contains('light-mode');
      if (!explicitTheme) {
        setIsDarkMode(mediaQuery.matches);
      }
    };
    
    mediaQuery.addEventListener('change', handleMediaChange);
    
    return () => {
      bodyObserver.disconnect();
      htmlObserver.disconnect();
      mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, []);

  return isDarkMode;
};

// Hook for table configuration and preferences
export const useTableConfig = () => {
  const [config, setConfig] = useState({
    showTooltips: true,
    enableKeyboardNavigation: true,
    compactMode: false,
    sortBy: null,
    sortDirection: 'asc'
  });

  const updateConfig = useCallback((newConfig) => {
    setConfig(prev => ({ ...prev, ...newConfig }));
  }, []);

  return {
    config,
    updateConfig
  };
};