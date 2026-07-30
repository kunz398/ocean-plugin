import React, { useEffect, useMemo, useRef, useState } from 'react';
import WaterLevelChart from './WaterLevelChart';
import { getRiskThresholdOverride, saveRiskThresholdOverride } from '../../services/riskDataService';
import { formatZoned } from '../../utils/timeZoneFormat';
import './RiskDetailsPanel.css';

const RISK_COLORS = {
  0: '#3498db',
  1: '#f39c12',
  2: '#e74c3c'
};

const RISK_LABELS = {
  0: 'No Risk',
  1: 'Minor Risk',
  2: 'Moderate Risk'
};

const normalizeIsland = (value) => {
  if (typeof value === 'string') {
    return value.replace(/\0/g, '').trim();
  }

  if (Array.isArray(value)) {
    return value.join('').replace(/\0/g, '').trim();
  }

  if (value && typeof value === 'object' && typeof value.length === 'number') {
    try {
      return Array.from(value).join('').replace(/\0/g, '').trim();
    } catch (error) {
      return '';
    }
  }

  return '';
};

const parseThresholdInput = (value) => {
  if (typeof value !== 'string' || value.trim() === '') {
    return NaN;
  }

  return Number(value);
};

function RiskDetailsPanel({ data, isDarkMode = false, currentSliderDate, onTimeSelect, onThresholdsSaved, timeDisplayZone = 'Pacific/Rarotonga' }) {
  const point = data?.point || {};
  const details = data?.details || null;
  const metadata = details?.metadata || null;
  const islandName = normalizeIsland(point?.island);
  const thresholds = details?.thresholds || point?.thresholds || [];
  const wrapperClassName = isDarkMode ? 'risk-details-panel risk-panel-dark' : 'risk-details-panel';
  const minorThreshold = Number(thresholds[0]);
  const moderateThreshold = Number(thresholds[1]);
  const [minorInput, setMinorInput] = useState('');
  const [moderateInput, setModerateInput] = useState('');
  const [badgePulse, setBadgePulse] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const saveFlashTimerRef = useRef(null);

  const selectedIndex = useMemo(() => {
    const times = details?.time_10min;
    if (!Array.isArray(times) || !times.length || !currentSliderDate) return null;
    const targetMs = new Date(currentSliderDate).getTime();
    if (!Number.isFinite(targetMs)) return null;
    let best = -1;
    let smallest = Infinity;
    times.forEach((ts, i) => {
      const diff = Math.abs(new Date(ts).getTime() - targetMs);
      if (diff < smallest) { smallest = diff; best = i; }
    });
    return best >= 0 ? best : null;
  }, [details?.time_10min, currentSliderDate]);

  // Load saved thresholds for this point (server override, then local draft), falling
  // back to API values. getRiskThresholdOverride is the single source of truth shared
  // with the map marker's own color (see useZarrMap.js's refreshRiskMarkerColors).
  useEffect(() => {
    const pointId = point?.id;
    const override = getRiskThresholdOverride(pointId);
    if (override) {
      setMinorInput(String(override.minor));
      setModerateInput(String(override.moderate));
      return;
    }
    setMinorInput(Number.isFinite(minorThreshold) ? minorThreshold.toFixed(2) : '');
    setModerateInput(Number.isFinite(moderateThreshold) ? moderateThreshold.toFixed(2) : '');
  }, [point?.id, minorThreshold, moderateThreshold]);

  const editableThresholds = useMemo(() => {
    const editedMinor = parseThresholdInput(minorInput);
    const editedModerate = parseThresholdInput(moderateInput);

    return [
      Number.isFinite(editedMinor) ? editedMinor : minorThreshold,
      Number.isFinite(editedModerate) ? editedModerate : moderateThreshold
    ];
  }, [minorInput, moderateInput, minorThreshold, moderateThreshold]);

  const detailMaxTWL = Math.max(
    ...((details?.twl_10min || [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value)))
  );
  const maxTWL = Number.isFinite(point?.maxTWL) ? point.maxTWL : detailMaxTWL;
  const thresholdsValid = (
    editableThresholds.every((value) => Number.isFinite(value)) &&
    editableThresholds[0] < editableThresholds[1]
  );
  const derivedRiskLevel = (() => {
    const fallback = Number.isFinite(point?.riskLevel) ? point.riskLevel : Number(details?.riskLevel) || 0;
    if (!Number.isFinite(maxTWL) || !thresholdsValid) return fallback;
    if (maxTWL >= editableThresholds[1]) return 2;
    if (maxTWL >= editableThresholds[0]) return 1;
    return 0;
  })();
  const riskColor = RISK_COLORS[derivedRiskLevel] || RISK_COLORS[0];
  const riskLabel = RISK_LABELS[derivedRiskLevel] || RISK_LABELS[0];
  const previousRiskLevelRef = useRef(derivedRiskLevel);

  const formatCoord = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${numeric.toFixed(4)}°` : 'N/A';
  };

  const formatMetadataTimestamp = (value) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return formatZoned(date, timeDisplayZone);
  };

  const modelRunLabel = formatMetadataTimestamp(metadata?.model_run);
  const generatedAtLabel = formatMetadataTimestamp(metadata?.generated_at);

  useEffect(() => {
    if (previousRiskLevelRef.current === derivedRiskLevel) {
      return undefined;
    }

    previousRiskLevelRef.current = derivedRiskLevel;
    setBadgePulse(true);

    const timeoutId = window.setTimeout(() => {
      setBadgePulse(false);
    }, 340);

    return () => window.clearTimeout(timeoutId);
  }, [derivedRiskLevel]);

  const resetThresholds = () => {
    setMinorInput(Number.isFinite(minorThreshold) ? minorThreshold.toFixed(2) : '');
    setModerateInput(Number.isFinite(moderateThreshold) ? moderateThreshold.toFixed(2) : '');
  };

  const saveThresholds = async () => {
    const pointId = point?.id;
    if (pointId == null || isSaving) return;
    const [minor, moderate] = editableThresholds;

    setIsSaving(true);

    // Local draft first — guarantees this browser reflects the edit even if the
    // network save below fails (offline, server down, etc).
    try {
      localStorage.setItem(
        `risk-thresholds-${pointId}`,
        JSON.stringify({ minor: minorInput, moderate: moderateInput })
      );
    } catch {
      // storage unavailable — silent fail
    }

    try {
      await saveRiskThresholdOverride(pointId, minor, moderate);
    } catch (error) {
      console.error('Failed to save risk thresholds to server (kept as a local-only draft):', error);
    }

    setIsSaving(false);
    onThresholdsSaved?.(pointId);
    setSaveFlash(true);
    if (saveFlashTimerRef.current) clearTimeout(saveFlashTimerRef.current);
    saveFlashTimerRef.current = window.setTimeout(() => setSaveFlash(false), 1500);
  };

  if (data?.status === 'loading') {
    return (
      <div className={wrapperClassName}>
        <div className="risk-loading risk-skeleton">
          Loading coastal risk details...
        </div>
        <div className="risk-summary-compact">
          <div className="risk-summary-primary risk-skeleton risk-skeleton-block" />
          <div className="risk-summary-metric risk-skeleton risk-skeleton-block" />
          <div className="risk-summary-metric risk-skeleton risk-skeleton-block" />
        </div>
        <div className="risk-chart-card risk-skeleton risk-skeleton-chart" />
      </div>
    );
  }

  if (data?.status === 'error') {
    return null;
  }

  return (
    <div className={wrapperClassName}>
      <div className="risk-details-header">
        <div className="risk-details-title">
          <h3>Coastal Risk Details{islandName ? ` - ${islandName}` : ''}</h3>
          <p className="risk-details-subtitle">
            Point {point?.id ?? 'N/A'} · {formatCoord(point?.lat)}, {formatCoord(point?.lon)}
          </p>
        </div>
        <span
          className={`risk-status-badge${badgePulse ? ' risk-changed' : ''}`}
          style={{ backgroundColor: riskColor }}
        >
          {riskLabel}
        </span>
      </div>

      <div className="risk-summary-compact">
        <div className="risk-summary-primary risk-summary-card">
          <span className="risk-summary-label">Max TWL</span>
          <strong>{Number.isFinite(maxTWL) ? `${maxTWL.toFixed(2)} m` : 'N/A'}</strong>
        </div>
        <div className="risk-summary-metric risk-summary-card">
          <label className="risk-summary-label" htmlFor="risk-minor-threshold">Minor</label>
          <div className="risk-threshold-input-wrap">
            <input
              id="risk-minor-threshold"
              className="risk-threshold-input"
              type="number"
              min="0"
              step="0.01"
              value={minorInput}
              onChange={(event) => setMinorInput(event.target.value)}
              aria-label="Minor flood threshold in metres"
            />
            <span>m</span>
          </div>
        </div>
        <div className="risk-summary-metric risk-summary-card">
          <label className="risk-summary-label" htmlFor="risk-moderate-threshold">Moderate</label>
          <div className="risk-threshold-input-wrap">
            <input
              id="risk-moderate-threshold"
              className="risk-threshold-input"
              type="number"
              min="0"
              step="0.01"
              value={moderateInput}
              onChange={(event) => setModerateInput(event.target.value)}
              aria-label="Moderate flood threshold in metres"
            />
            <span>m</span>
          </div>
        </div>
      </div>

      <div className="risk-threshold-controls">
        {!thresholdsValid && (
          <span className="risk-threshold-warning">
            Moderate flood must be greater than minor flood.
          </span>
        )}
        <div className="risk-threshold-actions">
          <button type="button" className="risk-threshold-reset" onClick={resetThresholds}>
            Reset
          </button>
          <button
            type="button"
            className={`risk-threshold-save${saveFlash ? ' risk-threshold-save--flash' : ''}`}
            onClick={saveThresholds}
            disabled={!thresholdsValid || point?.id == null || isSaving}
            title={point?.id == null ? 'No point selected' : 'Save thresholds for this point'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15.2 3H19a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.8" />
              <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
              <path d="M7 3v4a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V3" />
            </svg>
            {isSaving ? 'Saving...' : saveFlash ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      <div className="risk-summary-meta">
        {/* <span>Strategy: {point?.type || 'detailed'}</span>
        <span>Thresholds: {thresholds.length}</span> */}
        {!!islandName && <span>Island: {islandName}</span>}
        {(modelRunLabel || generatedAtLabel) && (
          <span>
            THREDDS risk dataset
            {modelRunLabel ? ` · Model run: ${modelRunLabel}` : ''}
            {generatedAtLabel ? ` · Generated: ${generatedAtLabel}` : ''}
          </span>
        )}
      </div>

      <div className="risk-chart-card">
        {onTimeSelect && (
          <div style={{
            fontSize: 11,
            fontStyle: "italic",
            opacity: 0.55,
            textAlign: "right",
            marginBottom: 4,
            color: isDarkMode ? "#cbd5e1" : "#475569",
          }}>
            Click chart to jump slider
          </div>
        )}
        <WaterLevelChart
          timestamps={details?.time_10min || []}
          totalWaterLevel={details?.twl_10min || []}
          tideLevel={details?.tide_10min || []}
          surgeLevel={details?.sla_10min || []}
          thresholds={thresholdsValid ? editableThresholds : thresholds}
          now={new Date()}
          selectedIndex={selectedIndex}
          isDarkMode={isDarkMode}
          onTimeSelect={onTimeSelect}
          timeZone={timeDisplayZone}
        />
      </div>
    </div>
  );
}

export default RiskDetailsPanel;
