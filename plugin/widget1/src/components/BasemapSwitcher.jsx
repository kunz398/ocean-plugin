import React, { useState } from 'react';
import { BASEMAP_OPTIONS, DEFAULT_BASEMAP_ID } from '../config/basemapConfig';
import './BasemapSwitcher.css';

// 'top-left' sits just below MapLibre's NavigationControl (3 buttons × 29px +
// 10px top margin ≈ 97px), clear of the CompassRose (top-right, and its own
// bottom-left mobile fallback) and the bottom timeline bar (.ft-root can run
// tall enough with the stale-forecast chip to reach well past 120px from the
// bottom — do not anchor new controls there without checking its height).
const POSITION_STYLES = {
  'top-left': { top: '112px', left: '15px' },
  'top-right': { top: '15px', right: '15px' },
  'bottom-right': { bottom: '80px', right: '15px' },
};

const BasemapSwitcher = ({ mapInstance, setBasemap, position = 'top-left' }) => {
  const [activeId, setActiveId] = useState(DEFAULT_BASEMAP_ID);

  const handleSelect = (id) => {
    if (id === activeId) return;
    setActiveId(id);
    setBasemap?.(id);
  };

  if (!mapInstance) return null;

  return (
    <div className="basemap-switcher" style={POSITION_STYLES[position] ?? POSITION_STYLES['top-left']}>
      {BASEMAP_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`basemap-switcher__btn${option.id === activeId ? ' basemap-switcher__btn--active' : ''}`}
          onClick={() => handleSelect(option.id)}
          title={option.label}
          aria-pressed={option.id === activeId}
          aria-label={`Switch basemap to ${option.label}`}
        >
          <i className={`bi ${option.icon}`} aria-hidden="true"></i>
        </button>
      ))}
    </div>
  );
};

export default BasemapSwitcher;
