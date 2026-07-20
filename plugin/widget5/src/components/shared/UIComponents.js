/**
 * Shared UI Components for Forecast Application
 * 
 * Reusable components with consistent styling and accessibility
 * to maintain uniformity across widgets.
 */

import React from 'react';

/**
 * Control Group Container with consistent header styling
 */
export const ControlGroup = ({ 
  icon, 
  title, 
  ariaLabel, 
  children, 
  className = '' 
}) => (
  <div className={`control-group ${className}`} role="group" aria-label={ariaLabel}>
    <h3>{icon} {title}</h3>
    {children}
  </div>
);

/**
 * Variable Selection Buttons with Fancy Icons
 */
export const VariableButtons = ({
  layers,
  selectedValue,
  onVariableChange,
  labelMap = {},
  ariaLabel = "Select forecast variable",
  getVariableIcon = null,
  getVariableColor = null,
}) => {
  const getShortLabel = (label) => labelMap[label] || label;

  return (
    <div className="variable-buttons" role="radiogroup" aria-label={ariaLabel}>
      {layers.map((layer) => {
        const color = getVariableColor ? getVariableColor(layer) : null;
        return (
          <button
            type="button"
            key={layer.value}
            className={`var-btn ${selectedValue === layer.value ? 'active' : ''}`}
            onClick={() => onVariableChange(layer.value)}
            role="radio"
            aria-checked={selectedValue === layer.value}
            aria-label={`${getShortLabel(layer.label)} forecast variable`}
            style={color ? { '--var-color': color } : undefined}
          >
            {getVariableIcon && getVariableIcon(layer)}
            {getShortLabel(layer.label)}
          </button>
        );
      })}
    </div>
  );
};

/**
 * Time Control Section
 * @param {number} sliderIndex - Current time slider position
 * @param {number} totalSteps - Total number of forecast steps
 * @param {Date} currentSliderDate - Current date/time for the slider
 * @param {boolean} isPlaying - Whether forecast animation is playing
 * @param {Object} capTime - Capabilities time object
 * @param {Function} onSliderChange - Handler for slider changes
 * @param {Function} onPlayToggle - Handler for play/pause button
 * @param {Function} formatDateTime - Function to format date/time
 * @param {string} timeDisplayZone - Selected display timezone
 * @param {Function} onTimeDisplayZoneChange - Handler for display timezone changes
 * @param {number} stepHours - Hours per step (default: 1)
 * @param {React.ReactNode} playIcon - Icon for play button
 * @param {React.ReactNode} pauseIcon - Icon for pause button
 * @param {number} minIndex - Minimum slider index (default: 0)
 * @param {boolean} disabled - Whether to disable time controls for static layers (default: false)
 */
export const TimeControl = ({
  sliderIndex,
  totalSteps,
  currentSliderDate,
  isPlaying,
  capTime,
  onSliderChange,
  onPlayToggle,
  onPrevious,
  onNext,
  formatDateTime,
  timeDisplayZone = 'Pacific/Rarotonga',
  onTimeDisplayZoneChange,
  playIcon = '▶️',
  pauseIcon = '⏸️',
  minIndex = 0,
  disabled = false
}) => (
  <div className="time-control">
    <div className="forecast-info">
      {/* <div>Forecast Hour: <span>+{sliderIndex * stepHours}h</span></div> */}
      <div>Valid DateTime: <span>{formatDateTime(currentSliderDate)}</span></div>
      <div className="time-zone-row">
        <label htmlFor="forecast-time-zone">Display Time</label>
        <select
          id="forecast-time-zone"
          className="time-zone-select"
          value={timeDisplayZone}
          onChange={(event) => onTimeDisplayZoneChange?.(event.target.value)}
          disabled={capTime.loading}
          aria-label="Select forecast display timezone"
        >
          <option value="Pacific/Rarotonga">Cook Islands Local</option>
          <option value="UTC">UTC</option>
        </select>
      </div>
    </div>

    <div className="time-slider-container">
      <input
        id="ui-forecast-time-slider"
        name="ui-forecast-time-slider"
        title="Forecast Time"
        aria-label="Forecast Time"
        type="range"
        className="time-slider"
        min={minIndex}
        max={totalSteps}
        value={sliderIndex}
        onChange={(e) => onSliderChange(e.target.value)}
        disabled={capTime.loading || disabled}
      />

      <div className="playback-controls">
        <button
          type="button"
          className="prev-btn"
          onClick={onPrevious}
          disabled={capTime.loading || disabled || sliderIndex <= minIndex}
          aria-label="Previous timestep"
          title="Previous timestep"
        >
          &#8249; Prev
        </button>
        <button
          type="button"
          className="play-btn"
          onClick={onPlayToggle}
          disabled={capTime.loading || disabled}
          aria-label={isPlaying ? 'Pause forecast animation' : 'Play forecast animation'}
        >
          <span>{isPlaying ? <>{pauseIcon} Pause</> : <>{playIcon} Play</>}</span>
        </button>
        <button
          type="button"
          className="next-btn"
          onClick={onNext}
          disabled={capTime.loading || disabled || sliderIndex >= totalSteps}
          aria-label="Next timestep"
          title="Next timestep"
        >
          Next &#8250;
        </button>
      </div>
    </div>
    
    {/* <div className="forecast-info">
      {<div>Forecast Length: <strong>{totalSteps + 1} hours</strong></div> }
    </div> */}
    {disabled && (
      <div style={{ 
        marginTop: '0.5rem', 
        padding: '0.5rem', 
        background: 'rgba(255, 152, 0, 0.1)', 
        border: '1px solid rgba(255, 152, 0, 0.3)',
        borderRadius: '4px',
        fontSize: '0.85rem',
        color: '#ffb74d',
        textAlign: 'center'
      }}>
        Time controls disabled for static layers
      </div>
    )}
  </div>
);

/**
 * Opacity Control
 */
export const OpacityControl = ({
  opacity,
  onOpacityChange,
  formatPercent,
  ariaLabel = "overlay-opacity"
}) => (
  <div className="opacity-control">
    <label htmlFor="ui-opacity-slider">
      Overlay Opacity: <span>{formatPercent(opacity)}</span>
    </label>
    <input
      id="ui-opacity-slider"
      name="ui-opacity-slider"
      aria-label={ariaLabel}
      title={ariaLabel}
      type="range"
      className="opacity-slider"
      min="0"
      max="100"
      value={Math.round(opacity * 100)}
      onChange={(e) => onOpacityChange(e.target.value / 100)}
    />
  </div>
);

/**
 * Island zoom selector.
 */
export const IslandZoomControl = ({
  islands,
  selectedIsland,
  onIslandChange,
  disabled = false
}) => {
  const groupedIslands = islands.reduce((groups, island) => {
    const group = island.group || 'Islands';
    if (!groups[group]) {
      groups[group] = [];
    }
    groups[group].push(island);
    return groups;
  }, {});

  return (
    <div className="island-zoom-control">
      <label htmlFor="island-zoom-select">Island</label>
      <select
        id="island-zoom-select"
        className="island-zoom-select island-zoom-select--full"
        value={selectedIsland}
        onChange={(e) => onIslandChange(e.target.value)}
        disabled={disabled}
        aria-label="Select island to fly to"
        title="Select island to fly to"
      >
        {Object.entries(groupedIslands).map(([group, groupIslands]) => (
          <optgroup key={group} label={group}>
            {groupIslands.map((island) => (
              <option key={island.id} value={island.id}>
                {island.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
};

/**
 * Data Information Display
 * Simplified to show only Source and Update fields.
 * (Removed model, resolution, and coverage as part of UI simplification)
 * @param {string} source - Data source name
 * @param {string} updateFrequency - How often the data updates
 */
export const DataInfo = ({ 
  source, 
  updateFrequency
}) => (
  <div className="data-info">
    <div><strong>Source:</strong> {source}</div>
    <div><strong>Update:</strong> {updateFrequency}</div>
  </div>
);

/**
 * Status Bar Footer
 */
/**export const StatusBar = ({ copyright, lastUpdated }) => (
  <div className="status-bar">
    <div className="status-indicator">
      {lastUpdated && <span className="last-update-time">{lastUpdated}</span>}
    </div>
    <div>{copyright}</div>
  </div>
);**/

const UIComponents = {
  ControlGroup,
  VariableButtons,
  TimeControl,
  OpacityControl,
  IslandZoomControl,
  DataInfo,
  //StatusBar
};

export default UIComponents;
