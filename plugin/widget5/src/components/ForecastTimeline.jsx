import React, { useMemo } from 'react';
import './ForecastTimeline.css';

const SPEED_OPTIONS = [
  { label: '0.5×', ms: 1400 },
  { label: '1×',   ms: 700  },
  { label: '2×',   ms: 350  },
];

function formatThumbLabel(date, tz) {
  if (!date) return '—';
  const tzLabel = tz === 'UTC' ? 'UTC' : 'CKT';
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${formatted} ${tzLabel}`;
}

export default function ForecastTimeline({
  sliderIndex,
  totalSteps,
  minIndex = 0,
  currentSliderDate,
  capTime,
  isPlaying,
  playSpeedMs = 700,
  timeDisplayZone = 'Pacific/Rarotonga',
  disabled = false,
  inline = false,
  showInPanel = false,
  onTogglePanel,
  onTimeIndexChange,
  onPlayPause,
  onPrevious,
  onNext,
  onSpeedChange,
  onTimezoneChange,
}) {
  const range = Math.max(1, totalSteps - minIndex);
  const rawPct = ((sliderIndex - minIndex) / range) * 100;

  const dayMarkers = useMemo(() => {
    const timestamps = capTime?.availableTimestamps;
    if (!timestamps?.length) return [];
    const markers = [];
    let lastDay = null;
    timestamps.forEach((ts, i) => {
      if (!ts) return;
      const day = ts.toLocaleDateString('en-GB', {
        timeZone: timeDisplayZone,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
      if (day !== lastDay) {
        markers.push({
          index: i,
          label: day,
          pct: (i / Math.max(1, timestamps.length - 1)) * 100,
        });
        lastDay = day;
      }
    });
    // Suppress any marker that sits within 9 % of the NEXT one.
    // This handles partial first days (e.g. forecast starts at 20:00 Wednesday —
    // "Wed" covers only 4h while "Thu" starts at 2 % and they would overlap).
    // We prefer the later day so the label pins cleanly to the left edge via CSS.
    return markers.filter((m, i) => {
      const next = markers[i + 1];
      return !next || next.pct - m.pct >= 9;
    });
  }, [capTime?.availableTimestamps, timeDisplayZone]);

  const thumbLabel = formatThumbLabel(currentSliderDate, timeDisplayZone);
  const loading = !!capTime?.loading;
  // capTime.loading is the same flag the active overlay flips true→false on
  // *every* timestep fetch, including each Play advance (see UgridOverlay.js
  // onLoadingChange calls) — so disabling on it unconditionally made the
  // slider and Prev/Play/Next buttons gray out and re-enable every tick
  // while playing, i.e. visibly flicker in sync with playback. Only let it
  // disable controls when not already playing (initial load / manual step),
  // where a brief disable is expected rather than a repeating flash.
  const isDisabled = disabled || (loading && !isPlaying);

  return (
    <div className={`ft-root${inline ? ' ft-root--inline' : ''}`} aria-label="Forecast timeline">
      {/* Stale forecast chip */}
      {capTime?.isStale && (
        <div className="ft-stale-chip" role="alert">
          ⚠ Forecast data may be outdated — model run is {Math.round(capTime.modelRunAgeHours)}h old
        </div>
      )}

      {/* Day tick marks */}
      <div className="ft-day-row" aria-hidden="true">
        <div className="ft-day-track">
          {dayMarkers.map((m) => (
            <button
              key={m.index}
              className="ft-day-marker"
              style={{ left: `${m.pct}%` }}
              onClick={() => !isDisabled && onTimeIndexChange?.(m.index)}
              tabIndex={-1}
              title={`Jump to ${m.label}`}
            >
              <span className="ft-day-tick" />
              <span className="ft-day-label">{m.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Slider track */}
      <div className="ft-slider-wrap">
        <input
          type="range"
          className="ft-slider"
          style={{ '--ft-pct': `${rawPct}%` }}
          min={minIndex}
          max={totalSteps}
          value={sliderIndex}
          step={1}
          onChange={(e) => onTimeIndexChange?.(Number(e.target.value))}
          disabled={isDisabled}
          aria-label="Forecast time"
          aria-valuetext={thumbLabel}
        />
      </div>

      {/* Controls row — left: nav+speed, centre: current time, right: timezone */}
      <div className="ft-controls">
        <div className="ft-controls__left">
          {/* Prev / Play / Next */}
          <div className="ft-nav">
            <button
              className="ft-btn ft-nav-btn"
              onClick={onPrevious}
              disabled={isDisabled || sliderIndex <= minIndex}
              aria-label="Previous timestep"
              title="Previous timestep"
            >
              ‹ Prev
            </button>
            <button
              className={`ft-btn ft-play-btn${isPlaying ? ' ft-play-btn--active' : ''}`}
              onClick={onPlayPause}
              disabled={isDisabled}
              aria-label={isPlaying ? 'Pause forecast animation' : 'Play forecast animation'}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              <span className="ft-play-icon">{isPlaying ? '❚❚' : '▶'}</span>
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              className="ft-btn ft-nav-btn"
              onClick={onNext}
              disabled={isDisabled || sliderIndex >= totalSteps}
              aria-label="Next timestep"
              title="Next timestep"
            >
              Next ›
            </button>
          </div>

          {/* Speed */}
          <div className="ft-speed">
            <span className="ft-group-label">Speed</span>
            {SPEED_OPTIONS.map((opt) => (
              <button
                key={opt.ms}
                className={`ft-btn ft-chip${playSpeedMs === opt.ms ? ' ft-chip--active' : ''}`}
                onClick={() => onSpeedChange?.(opt.ms)}
                aria-pressed={playSpeedMs === opt.ms}
                title={`Playback speed ${opt.label}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Current valid time — fills the centre gap, reads as a deliberate readout */}
        <div className="ft-thumb-label" aria-live="polite" aria-atomic="true">{thumbLabel}</div>

        {/* Timezone */}
        <div className="ft-tz">
          <button
            className={`ft-btn ft-chip${timeDisplayZone === 'Pacific/Rarotonga' ? ' ft-chip--active' : ''}`}
            onClick={() => onTimezoneChange?.('Pacific/Rarotonga')}
            aria-pressed={timeDisplayZone === 'Pacific/Rarotonga'}
            title="Display in Cook Islands Time"
          >
            CKT
          </button>
          <button
            className={`ft-btn ft-chip${timeDisplayZone === 'UTC' ? ' ft-chip--active' : ''}`}
            onClick={() => onTimezoneChange?.('UTC')}
            aria-pressed={timeDisplayZone === 'UTC'}
            title="Display in UTC"
          >
            UTC
          </button>
        </div>

        {/* Sidebar pin toggle — only shown on the bottom bar, not the inline copy */}
        {!inline && onTogglePanel && (
          <button
            type="button"
            className={`ft-btn ft-pin-btn${showInPanel ? ' ft-pin-btn--active' : ''}`}
            onClick={onTogglePanel}
            aria-pressed={showInPanel}
            title={showInPanel ? 'Unpin from sidebar' : 'Pin to sidebar'}
          >
            {showInPanel ? '⊠' : '⊞'}
          </button>
        )}
      </div>
    </div>
  );
}
