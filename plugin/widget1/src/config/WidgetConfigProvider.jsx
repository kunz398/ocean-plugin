/**
 * Widget Configuration Provider
 * Allows for easy customization and theming of forecast widgets
 */

import React, { createContext, useContext } from 'react';
import PropTypes from 'prop-types';
import { UI_CONFIG } from '../config/UIConfig';

const WidgetConfigContext = createContext(null);

/**
 * Provider component for widget configuration
 */
export const WidgetConfigProvider = ({ 
  children, 
  config = UI_CONFIG,
  theme = 'default',
  region = 'Niue'
}) => {
  const contextValue = {
    config: {
      ...config,
      // Allow region-specific overrides
      dataInfo: {
        ...config.dataInfo,
        coverage: region
      }
    },
    theme,
    region
  };

  return (
    <WidgetConfigContext.Provider value={contextValue}>
      {children}
    </WidgetConfigContext.Provider>
  );
};

WidgetConfigProvider.propTypes = {
  children: PropTypes.node.isRequired,
  config: PropTypes.object,
  theme: PropTypes.string,
  region: PropTypes.string
};

/**
 * Hook to access widget configuration
 */
export const useWidgetConfig = () => {
  const context = useContext(WidgetConfigContext);
  if (!context) {
    // Return default config if no provider
    return {
      config: UI_CONFIG,
      theme: 'default',
      region: 'Niue'
    };
  }
  return context;
};

/**
 * Configuration override component for easy regional customization
 */
export const RegionalConfig = {
  NIUE: {
    ...UI_CONFIG,
    dataInfo: {
      ...UI_CONFIG.dataInfo,
      coverage: 'Niue',
      timezone: 'Pacific/Niue'
    },
    footer: {
      copyright: '© 2025 Niue Marine Forecast'
    }
  },
  
  FIJI: {
    ...UI_CONFIG,
    dataInfo: {
      ...UI_CONFIG.dataInfo,
      coverage: 'Fiji Islands',
      timezone: 'Pacific/Fiji'
    },
    footer: {
      copyright: '© 2025 Fiji Marine Forecast'
    }
  },
  
  VANUATU: {
    ...UI_CONFIG,
    dataInfo: {
      ...UI_CONFIG.dataInfo,
      coverage: 'Vanuatu',
      timezone: 'Pacific/Efate'
    },
    footer: {
      copyright: '© 2025 Vanuatu Marine Forecast'
    }
  }
};

/**
 * Utility function to get regional configuration
 * @param {string} region - Region identifier
 * @returns {Object} Regional configuration object
 */
export const getRegionalConfig = (region) => {
  const key = region.toUpperCase().replace(/\s+/g, '_');
  return RegionalConfig[key] || RegionalConfig.NIUE;
};
