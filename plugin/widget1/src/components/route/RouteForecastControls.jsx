import React, { useRef } from 'react';
import { Play, RotateCcw, Route, Trash2, Undo2, Upload } from 'lucide-react';

// Mirrors routeForecastService.js's 404 message — retrying can't fix "this
// backend doesn't have the endpoint yet."
const NON_RETRYABLE_ERROR_PATTERN = /not available/i;

function RouteForecastControls({
  routePoints,
  routePickMode,
  setRoutePickMode,
  routeSpeedKt,
  setRouteSpeedKt,
  routeDepartureTime,
  setRouteDepartureTime,
  routeForecastLoading,
  routeForecastError,
  onRunRouteForecast,
  onClearRoute,
  onUndoRoutePoint,
  onRouteImport,
}) {
  const fileInputRef = useRef(null);
  const pointCount = routePoints?.length ?? 0;
  const canRun = pointCount >= 2 && !routeForecastLoading;

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (file) onRouteImport?.(file);
    event.target.value = '';
  };

  // Named workflow stages ("add origin" → "add destination" → "ready") so
  // the user always knows what clicking the map will do next, instead of a
  // single generic "click to add points" instruction throughout.
  const workflowHint = routePickMode
    ? pointCount === 0
      ? 'Click the map to set your origin.'
      : pointCount === 1
        ? 'Origin set. Click the map to add your destination (or more waypoints).'
        : `${pointCount} points added. Keep clicking to add waypoints, or click "Draw" again once your destination is set.`
    : pointCount === 0
      ? 'Click "Draw" to start plotting a route, or import a GPX/GeoJSON file.'
      : pointCount === 1
        ? '1 point selected — add at least one more to run a forecast.'
        : `Route ready — ${pointCount} points. Tap "Run forecast" below.`;
  const retryable = routeForecastError && canRun && !NON_RETRYABLE_ERROR_PATTERN.test(routeForecastError);

  return (
    <div className="map-display-option">
      <div className="map-display-option__label">Route forecast</div>

      <div className="map-display-option__segmented" role="group" aria-label="Route drawing actions">
        <button
          type="button"
          className={`map-display-option__btn${routePickMode ? ' map-display-option__btn--active' : ''}`}
          aria-pressed={routePickMode}
          onClick={() => setRoutePickMode?.((value) => !value)}
        >
          <Route size={13} style={{ marginRight: 5, verticalAlign: 'text-bottom' }} />
          {routePickMode ? 'Click map...' : 'Draw'}
        </button>
        <button
          type="button"
          className="map-display-option__btn"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={13} style={{ marginRight: 5, verticalAlign: 'text-bottom' }} />
          Import
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".gpx,.geojson,.json,application/geo+json,application/json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.65fr', gap: '0.45rem', marginTop: '0.5rem' }}>
        <label className="map-display-option__hint" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          Departure
          <input
            className="map-display-option__btn"
            type="datetime-local"
            value={routeDepartureTime || ''}
            onChange={(e) => setRouteDepartureTime?.(e.target.value)}
            style={{ width: '100%', textAlign: 'left' }}
          />
        </label>
        <label className="map-display-option__hint" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          Speed kt
          <input
            className="map-display-option__btn"
            type="number"
            min="0.1"
            step="0.5"
            value={routeSpeedKt}
            onChange={(e) => setRouteSpeedKt?.(e.target.value)}
            style={{ width: '100%' }}
          />
        </label>
      </div>

      <div className="map-display-option__segmented" role="group" aria-label="Route forecast actions" style={{ marginTop: '0.5rem' }}>
        <button
          type="button"
          className="map-display-option__btn"
          disabled={pointCount === 0 || routeForecastLoading}
          onClick={onUndoRoutePoint}
          title="Undo last route point"
          aria-label="Undo last route point"
        >
          <Undo2 size={13} />
        </button>
        <button
          type="button"
          className="map-display-option__btn"
          disabled={pointCount === 0 || routeForecastLoading}
          onClick={onClearRoute}
          title="Clear route"
          aria-label="Clear route"
        >
          <Trash2 size={13} />
        </button>
        <button
          type="button"
          className="map-display-option__btn"
          disabled={!canRun}
          onClick={onRunRouteForecast}
          style={{ flex: 1 }}
        >
          <Play size={13} style={{ marginRight: 5, verticalAlign: 'text-bottom' }} />
          {routeForecastLoading ? 'Running...' : 'Run forecast'}
        </button>
      </div>

      <div className="map-display-option__hint">
        {workflowHint}
      </div>

      {routeForecastError && (
        <div className="map-display-option__hint" style={{ color: '#fca5a5', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
          <span>{routeForecastError}</span>
          {retryable && (
            <button
              type="button"
              className="map-display-option__btn"
              onClick={onRunRouteForecast}
            >
              <RotateCcw size={12} style={{ marginRight: 5, verticalAlign: 'text-bottom' }} />
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default RouteForecastControls;
