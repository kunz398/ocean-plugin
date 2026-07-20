import React from 'react';
import { LANDING_AREA_PRESETS } from '../../config/landingAreaPresets';

// Landing-area selector: preset dropdown + click-to-place toggle, rendered
// alongside the vessel-class control when the suitability layer is active.
// Reuses the existing .map-display-option* classes (see ForecastApp.jsx's
// swell-source/vessel-class blocks) so it looks native to that panel without
// needing its own stylesheet.
export default function LandingAreaPanel({
  landingArea,
  setLandingArea,
  landingAreaPickMode,
  setLandingAreaPickMode,
}) {
  const selectedPresetId = landingArea?.source === 'preset' ? landingArea.id : '';

  const handlePresetChange = (e) => {
    const preset = LANDING_AREA_PRESETS.find((p) => p.id === e.target.value);
    if (preset) setLandingArea({ ...preset, source: 'preset' });
  };

  return (
    <div className="map-display-option">
      <div className="map-display-option__label">Landing area</div>

      <select
        className="map-display-option__btn map-display-option__select"
        style={{ width: '100%', marginBottom: '0.5rem' }}
        value={selectedPresetId}
        onChange={handlePresetChange}
        aria-label="Select a landing area preset"
      >
        <option value="">Select a launch area…</option>
        {LANDING_AREA_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>{preset.label}</option>
        ))}
      </select>

      <div className="map-display-option__segmented" role="group" aria-label="Landing area actions">
        <button
          type="button"
          className={`map-display-option__btn${landingAreaPickMode ? ' map-display-option__btn--active' : ''}`}
          aria-pressed={landingAreaPickMode}
          onClick={() => setLandingAreaPickMode((v) => !v)}
        >
          {landingAreaPickMode ? 'Click the map…' : 'Click to place on map'}
        </button>
        <button
          type="button"
          className="map-display-option__btn"
          disabled={!landingArea}
          onClick={() => { setLandingArea(null); setLandingAreaPickMode(false); }}
        >
          Clear
        </button>
      </div>

      <div className="map-display-option__hint">
        {landingAreaPickMode
          ? 'Click the map to drop a flag.'
          : landingArea
            ? `${landingArea.label} — ${landingArea.lat.toFixed(4)}, ${landingArea.lon.toFixed(4)}`
            : 'Choose a preset, or click the map to mark a launch point.'}
      </div>

      {/* Repeats the caveat outside the <select> — once a preset is chosen,
          the dropdown text isn't visible anymore, so this is the only
          persistent warning a user seeing an assessment result actually sees. */}
      {landingArea?.source === 'preset' && (
        <div className="map-display-option__hint" style={{ color: '#fbbf24' }}>
          ⚠ Placeholder coordinates — not verified for operational use.
        </div>
      )}
    </div>
  );
}
