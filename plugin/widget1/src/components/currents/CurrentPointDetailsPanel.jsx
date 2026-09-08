import { useState } from 'react';
import DepthProfileChart from './charts/DepthProfileChart';
import TimeSeriesChart from './charts/TimeSeriesChart';
import TSDiagramChart from './charts/TSDiagramChart';
import './CurrentPointDetailsPanel.css';

function formatCoord(lat, lng) {
  const latStr = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}`;
  const lngStr = `${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
  return `${latStr}, ${lngStr}`;
}

// Strips anything that can't be part of a signed decimal as the user types,
// rather than validating after the fact — a leading "-" and a single "."
// are kept, everything else (letters, extra dots/minuses) is dropped.
function sanitizeNumericInput(raw) {
  const negative = raw.trim().startsWith('-');
  const digitsAndDot = raw.replace(/[^0-9.]/g, '');
  const firstDot = digitsAndDot.indexOf('.');
  const deduped = firstDot === -1
    ? digitsAndDot
    : digitsAndDot.slice(0, firstDot + 1) + digitsAndDot.slice(firstDot + 1).replace(/\./g, '');
  return (negative ? '-' : '') + deduped;
}

// Double-click the coordinate readout to type a lat/lon and jump the map
// there — mirrors niu_current's BottomPanel coordinate bar exactly.
function CoordBar({ lat, lng, onGoToLocation }) {
  const [editing, setEditing] = useState(false);
  const [editLat, setEditLat] = useState('');
  const [editLon, setEditLon] = useState('');

  const startEditing = () => {
    setEditLat(lat.toFixed(4));
    setEditLon(lng.toFixed(4));
    setEditing(true);
  };
  const cancelEditing = () => setEditing(false);
  const submitEditing = () => {
    const latVal = parseFloat(editLat);
    const lonVal = parseFloat(editLon);
    if (!Number.isFinite(latVal) || !Number.isFinite(lonVal) || latVal < -90 || latVal > 90 || lonVal < -180 || lonVal > 180) {
      return;
    }
    onGoToLocation?.(lonVal, latVal);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="currents-point-panel__coords currents-point-panel__coords--editing">
        <input
          autoFocus
          type="text"
          inputMode="decimal"
          name="currents-goto-lat"
          value={editLat}
          onChange={(e) => setEditLat(sanitizeNumericInput(e.target.value))}
          onKeyDown={(e) => { if (e.key === 'Enter') submitEditing(); if (e.key === 'Escape') cancelEditing(); }}
          placeholder="Lat"
          aria-label="Latitude"
          className="currents-point-panel__coord-input"
        />
        <input
          type="text"
          inputMode="decimal"
          name="currents-goto-lon"
          value={editLon}
          onChange={(e) => setEditLon(sanitizeNumericInput(e.target.value))}
          onKeyDown={(e) => { if (e.key === 'Enter') submitEditing(); if (e.key === 'Escape') cancelEditing(); }}
          placeholder="Lon"
          aria-label="Longitude"
          className="currents-point-panel__coord-input"
        />
        <button type="button" onClick={submitEditing} className="currents-point-panel__coord-btn">OK</button>
        <button type="button" onClick={cancelEditing} aria-label="Cancel" className="currents-point-panel__coord-cancel">×</button>
      </div>
    );
  }

  return (
    <div
      className="currents-point-panel__coords"
      onDoubleClick={onGoToLocation ? startEditing : undefined}
      title={onGoToLocation ? 'Double-click to go to a coordinate' : undefined}
    >
      {formatCoord(lat, lng)}
    </div>
  );
}

// Mirrors niu_current's BottomPanel: a per-click point-inspection panel with
// three charts (Depth Profile, Time Series, T-S Diagram) for whichever
// currents layer is selected — "velocity" swaps to U & V component charts
// since current_speed alone (the raster) hides direction/reversal.
export default function CurrentPointDetailsPanel({ data, currentDepth, timeIndex, isDarkMode = false, onGoToLocation }) {
  const layerCfg = data?.layerCfg;
  const lat = data?.lat;
  const lng = data?.lng;

  if (!layerCfg || lat == null || lng == null) return null;

  if (!layerCfg.hasDepth) {
    return (
      <div className={`currents-point-panel${isDarkMode ? ' currents-point-panel--dark' : ''}`}>
        <CoordBar lat={lat} lng={lng} onGoToLocation={onGoToLocation} />
        <div className="currents-point-panel__disabled">
          <p className="currents-point-panel__eyebrow">{layerCfg.label}</p>
          <p>Depth-based charts aren't available for {layerCfg.label.toLowerCase()} — it has no depth axis.</p>
        </div>
      </div>
    );
  }

  const showUV = layerCfg.value === 'velocity';
  const label = `${layerCfg.label} (${layerCfg.units})`;
  const commonProps = {
    lat, lon: lng,
    datasetName: layerCfg.datasetName,
    zarrBaseUrl: layerCfg.zarrBaseUrl,
    variable: layerCfg.variable,
    label,
    showUV,
    isDarkMode,
  };
  const subtitle = showUV ? 'U & V velocity' : layerCfg.label;

  return (
    <div className={`currents-point-panel${isDarkMode ? ' currents-point-panel--dark' : ''}`}>
      <CoordBar lat={lat} lng={lng} onGoToLocation={onGoToLocation} />
      <div className="currents-point-panel__grid">
        <div className="currents-point-panel__col">
          <p className="currents-point-panel__eyebrow">Depth Profile</p>
          <p className="currents-point-panel__subtitle">{subtitle} vs depth</p>
          <div className="currents-point-panel__body">
            <DepthProfileChart {...commonProps} timeIndex={timeIndex} />
          </div>
        </div>
        <div className="currents-point-panel__col">
          <p className="currents-point-panel__eyebrow">Time Series</p>
          <p className="currents-point-panel__subtitle">{subtitle} · forecast window</p>
          <div className="currents-point-panel__body">
            <TimeSeriesChart {...commonProps} depth={currentDepth} />
          </div>
        </div>
        <div className="currents-point-panel__col">
          <p className="currents-point-panel__eyebrow">T-S Diagram</p>
          <p className="currents-point-panel__subtitle">Water mass · all depths</p>
          <div className="currents-point-panel__body">
            <TSDiagramChart
              lat={lat}
              lon={lng}
              timeIndex={timeIndex}
              datasetName={layerCfg.datasetName}
              zarrBaseUrl={layerCfg.zarrBaseUrl}
              isDarkMode={isDarkMode}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
