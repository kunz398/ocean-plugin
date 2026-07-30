import React, { useEffect, useRef } from 'react';
import { Play, RotateCcw, Route, Trash2, Undo2, Upload } from 'lucide-react';
import { fromZonedInputValue, toZonedInputValue, tzLabel } from '../../utils/timeZoneFormat';
import { parseAsUtcWallClock } from '../../services/routeForecastService';

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
  maxDepartureTime,
  minDepartureTime,
  timeDisplayZone = 'Pacific/Niue',
  onRunRouteForecast,
  onClearRoute,
  onUndoRoutePoint,
  onRouteImport,
}) {
  const fileInputRef = useRef(null);
  const pointCount = routePoints?.length ?? 0;

  // routeDepartureTime is always stored as a UTC-wall-clock string (no zone
  // designator, e.g. Home.jsx's currentSliderDate.toISOString().slice(0, 16))
  // — the same convention routeForecastService.js's parseAsUtcWallClock and
  // scenarioService.js rely on. These *Local values are that same canonical
  // format, used only for the clamp comparisons below; what the picker
  // actually *displays* is a separate zone-converted value further down, so
  // switching the NUT/UTC toggle never changes what gets sent to the backend.
  const maxDepartureLocal = maxDepartureTime instanceof Date && !Number.isNaN(maxDepartureTime.getTime())
    ? maxDepartureTime.toISOString().slice(0, 16)
    : undefined;
  const minDepartureLocal = minDepartureTime instanceof Date && !Number.isNaN(minDepartureTime.getTime())
    ? minDepartureTime.toISOString().slice(0, 16)
    : undefined;

  // Zone-aware display: the native datetime-local input can't take a
  // timezone parameter, so we convert the canonical UTC value/min/max into
  // wall-clock strings for whichever zone is currently selected, and convert
  // the user's edit straight back to UTC on change.
  const departureLocalDisplay = toZonedInputValue(parseAsUtcWallClock(routeDepartureTime), timeDisplayZone) ?? '';
  const maxDepartureDisplay = toZonedInputValue(maxDepartureTime, timeDisplayZone);
  const minDepartureDisplay = toZonedInputValue(minDepartureTime, timeDisplayZone);

  const handleDepartureChange = (value) => {
    const utcDate = fromZonedInputValue(value, timeDisplayZone);
    setRouteDepartureTime?.(utcDate ? utcDate.toISOString().slice(0, 16) : value);
  };

  // Belt-and-braces clamp: the input's min/max attributes stop new
  // out-of-range picks, but don't retroactively fix a value set before the
  // forecast window was known (e.g. right after a layer switch shifts it),
  // and not every browser enforces datetime-local's min/max the same way.
  useEffect(() => {
    if (!routeDepartureTime) return;
    if (maxDepartureLocal && routeDepartureTime > maxDepartureLocal) {
      console.warn(
        `[RouteForecastControls] Departure time ${routeDepartureTime} is beyond the forecast end (${maxDepartureLocal}) — clamping.`
      );
      setRouteDepartureTime?.(maxDepartureLocal);
    } else if (minDepartureLocal && routeDepartureTime < minDepartureLocal) {
      console.warn(
        `[RouteForecastControls] Departure time ${routeDepartureTime} is before the forecast start (${minDepartureLocal}) — clamping.`
      );
      setRouteDepartureTime?.(minDepartureLocal);
    }
  }, [routeDepartureTime, maxDepartureLocal, minDepartureLocal, setRouteDepartureTime]);

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
          {`Departure (${tzLabel(timeDisplayZone)})`}
          <input
            className="map-display-option__btn"
            type="datetime-local"
            value={departureLocalDisplay}
            min={minDepartureDisplay}
            max={maxDepartureDisplay}
            onChange={(e) => handleDepartureChange(e.target.value)}
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
        <div className="map-display-option__hint" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
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
