import React, { useState, useCallback, useRef } from 'react';
import { Clock, BarChart2, CalendarRange, Zap, Database } from 'lucide-react';
import { setRuntimeProvider, getRuntimeProviderId } from '../services/inundationProviderFactory';
import { fromZonedInputValue, toZonedInputValue, tzLabel } from '../utils/timeZoneFormat';

const ZARR_UI_ENABLED = process.env.REACT_APP_ENABLE_ZARR_INUNDATION === 'true';

const MODES = [
  { id: 'single', label: 'Timestep', Icon: Clock },
  { id: 'rolling-48h', label: '48h Max', Icon: BarChart2 },
  { id: 'custom', label: 'Custom Max', Icon: CalendarRange },
];

const PROVIDERS = [
  { id: 'fastapi', label: 'FastAPI', Icon: Zap },
  { id: 'zarr', label: 'Zarr', Icon: Database },
];

function findNearestIndex(timestamps, targetDate) {
  if (!timestamps?.length || !targetDate) return 0;
  const t = new Date(targetDate).getTime();
  let best = 0;
  let bestDiff = Infinity;
  timestamps.forEach((ts, i) => {
    const diff = Math.abs(ts.getTime() - t);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  });
  return best;
}

export default function InundationWindowControl({ rangeWindow, setRangeWindow, availableTimestamps, disabled, currentTime, timeDisplayZone = 'Pacific/Rarotonga' }) {
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [customError, setCustomError] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const applyTimerRef = useRef(null);
  const [activeProviderId, setActiveProviderId] = useState(() => getRuntimeProviderId());

  const committedMode = rangeWindow?.mode || 'single';
  // uiMode tracks which button is highlighted; may be 'custom' before Apply is hit
  const [uiMode, setUiMode] = useState(committedMode);

  // Keep uiMode in sync when parent resets to single externally
  const prevCommittedMode = useRef(committedMode);
  if (prevCommittedMode.current !== committedMode) {
    prevCommittedMode.current = committedMode;
    if (committedMode !== 'custom') setUiMode(committedMode);
    // rangeWindow updated → server request dispatched, clear applying spinner
    setIsApplying(false);
    clearTimeout(applyTimerRef.current);
  }

  const currentMode = uiMode;
  const isZarr = activeProviderId === 'zarr';

  const handleProviderChange = useCallback((id) => {
    setActiveProviderId(id);
    setRuntimeProvider(id);
    // Zarr doesn't support range-max modes — reset to single when switching to it
    if (id === 'zarr' && currentMode !== 'single') {
      setRangeWindow({ mode: 'single' });
    }
  }, [currentMode, setRangeWindow]);

  const handleModeSelect = useCallback((mode) => {
    setCustomError('');
    if (mode === 'single') {
      setUiMode('single');
      setRangeWindow({ mode: 'single' });
      return;
    }
    if (mode === 'rolling-48h') {
      setUiMode('rolling-48h');
      const endIndex = availableTimestamps ? availableTimestamps.length - 1 : 47;
      const startIndex = Math.max(0, endIndex - 47);
      setRangeWindow({ mode: 'rolling-48h', startIndex, endIndex });
      return;
    }
    if (mode === 'custom') {
      // Pre-fill date pickers but DON'T fetch yet — wait for the user to hit Apply
      const first = availableTimestamps?.[0] ?? null;
      const last  = availableTimestamps?.length ? availableTimestamps[availableTimestamps.length - 1] : null;
      const anchor = currentTime instanceof Date && !Number.isNaN(currentTime.getTime())
        ? currentTime
        : (first ?? new Date());
      const rawStart = new Date(Math.max(anchor.getTime(), first?.getTime() ?? -Infinity));
      const rawEnd   = new Date(Math.min(anchor.getTime() + 48 * 3600 * 1000, last?.getTime() ?? Infinity));
      const startIndex = findNearestIndex(availableTimestamps, rawStart);
      const endIndex   = findNearestIndex(availableTimestamps, rawEnd);
      const startTime  = availableTimestamps?.[startIndex] ?? rawStart;
      const endTime    = availableTimestamps?.[endIndex]   ?? rawEnd;
      if (!customStart) setCustomStart(toZonedInputValue(startTime, timeDisplayZone));
      if (!customEnd)   setCustomEnd(toZonedInputValue(endTime, timeDisplayZone));
      setUiMode('custom');
      // Keep rangeWindow in its current state — no fetch until Apply
    }
  }, [availableTimestamps, currentTime, customStart, customEnd, setRangeWindow, timeDisplayZone]);

  const handleCustomApply = useCallback(() => {
    setCustomError('');
    const start = customStart ? fromZonedInputValue(customStart, timeDisplayZone) : null;
    const end = customEnd ? fromZonedInputValue(customEnd, timeDisplayZone) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setCustomError('Please enter valid start and end times.');
      return;
    }
    if (start >= end) {
      setCustomError('Start must be before end.');
      return;
    }
    const startIndex = findNearestIndex(availableTimestamps, start);
    const endIndex = findNearestIndex(availableTimestamps, end);
    if (startIndex >= endIndex) {
      setCustomError('Start and end resolve to the same timestep — widen the range.');
      return;
    }
    setRangeWindow({ mode: 'custom', startIndex, endIndex, startTime: start, endTime: end });
    setUiMode('custom');
    setIsApplying(true);
    clearTimeout(applyTimerRef.current);
    // Keep spinner up until parent prop updates (or 20 s timeout)
    applyTimerRef.current = setTimeout(() => setIsApplying(false), 20000);
  }, [customStart, customEnd, availableTimestamps, setRangeWindow, timeDisplayZone]);

  return (
    <div className="iwc-root" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <style>{`@keyframes iwc-spin{to{transform:rotate(360deg)}}`}</style>

      {/* Provider selector — only visible when REACT_APP_ENABLE_ZARR_INUNDATION=true */}
      {ZARR_UI_ENABLED && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Data source
          </span>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {PROVIDERS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => handleProviderChange(id)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.3rem',
                  padding: '0.3rem 0.5rem',
                  fontSize: '0.75rem',
                  fontWeight: activeProviderId === id ? 700 : 400,
                  borderRadius: '5px',
                  border: activeProviderId === id
                    ? '1.5px solid rgba(251, 191, 36, 0.7)'
                    : '1px solid rgba(255,255,255,0.1)',
                  background: activeProviderId === id
                    ? 'rgba(251, 191, 36, 0.14)'
                    : 'rgba(255,255,255,0.03)',
                  color: activeProviderId === id ? '#fde68a' : 'rgba(255,255,255,0.45)',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon size={11} />
                {label}
              </button>
            ))}
          </div>
          {isZarr && (
            <div style={{ fontSize: '0.7rem', color: 'rgba(251,191,36,0.55)', fontStyle: 'italic' }}>
              Range-max modes unavailable with direct Zarr.
            </div>
          )}
        </div>
      )}

      {/* Mode selector */}
      <div className="iwc-mode-row" style={{ display: 'flex', gap: '0.4rem' }}>
        {MODES.map(({ id, label, Icon }) => {
          const isRangeMode = id !== 'single';
          const modeDisabled = disabled || (isZarr && isRangeMode);
          return (
            <button
              key={id}
              type="button"
              disabled={modeDisabled}
              onClick={() => handleModeSelect(id)}
              title={isZarr && isRangeMode ? 'Range-max not available with Zarr provider' : undefined}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.3rem',
                padding: '0.35rem 0.5rem',
                fontSize: '0.78rem',
                fontWeight: currentMode === id ? 700 : 400,
                borderRadius: '6px',
                border: currentMode === id
                  ? '1.5px solid rgba(14, 165, 233, 0.8)'
                  : '1px solid rgba(255,255,255,0.12)',
                background: currentMode === id
                  ? 'rgba(14, 165, 233, 0.18)'
                  : 'rgba(255,255,255,0.04)',
                color: modeDisabled
                  ? 'rgba(255,255,255,0.2)'
                  : currentMode === id ? '#7dd3fc' : 'rgba(255,255,255,0.6)',
                cursor: modeDisabled ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
                opacity: modeDisabled && !disabled ? 0.45 : 1,
              }}
            >
              <Icon size={12} />
              {label}
            </button>
          );
        })}
      </div>

      {currentMode === 'custom' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
            <div>
              <label style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '0.2rem' }}>{`Start (${tzLabel(timeDisplayZone)})`}</label>
              <input
                type="datetime-local"
                value={customStart}
                min={availableTimestamps?.[0] ? toZonedInputValue(availableTimestamps[0], timeDisplayZone) : undefined}
                max={availableTimestamps?.length ? toZonedInputValue(availableTimestamps[availableTimestamps.length - 1], timeDisplayZone) : undefined}
                onChange={e => setCustomStart(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.3rem 0.4rem',
                  fontSize: '0.72rem',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '5px',
                  color: '#e2e8f0',
                  colorScheme: 'dark',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '0.2rem' }}>{`End (${tzLabel(timeDisplayZone)})`}</label>
              <input
                type="datetime-local"
                value={customEnd}
                min={availableTimestamps?.[0] ? toZonedInputValue(availableTimestamps[0], timeDisplayZone) : undefined}
                max={availableTimestamps?.length ? toZonedInputValue(availableTimestamps[availableTimestamps.length - 1], timeDisplayZone) : undefined}
                onChange={e => setCustomEnd(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.3rem 0.4rem',
                  fontSize: '0.72rem',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '5px',
                  color: '#e2e8f0',
                  colorScheme: 'dark',
                }}
              />
            </div>
          </div>
          {customError && (
            <div style={{ fontSize: '0.72rem', color: '#f87171', padding: '0.2rem 0' }}>
              {customError}
            </div>
          )}
          <button
            type="button"
            onClick={handleCustomApply}
            disabled={isApplying}
            style={{
              padding: '0.35rem 0.75rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              borderRadius: '6px',
              border: `1px solid ${isApplying ? 'rgba(14,165,233,0.25)' : 'rgba(14,165,233,0.5)'}`,
              background: isApplying ? 'rgba(14,165,233,0.08)' : 'rgba(14,165,233,0.15)',
              color: isApplying ? 'rgba(125,211,252,0.5)' : '#7dd3fc',
              cursor: isApplying ? 'not-allowed' : 'pointer',
              alignSelf: 'flex-start',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              transition: 'all 0.15s ease',
            }}
          >
            {isApplying && (
              <svg
                width="11" height="11" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                aria-hidden="true"
                style={{ animation: 'iwc-spin 0.75s linear infinite', flexShrink: 0 }}
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
            )}
            {isApplying ? 'Applying…' : 'Apply'}
          </button>
        </div>
      )}

      {currentMode !== 'single' && (
        <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
          {currentMode === 'rolling-48h'
            ? 'Showing maximum depth over the 48-hour window. Time slider is paused.'
            : committedMode === 'custom'
              ? 'Showing maximum depth over the selected custom window. Time slider is paused.'
              : 'Set dates above and press Apply to compute range max.'}
        </div>
      )}
    </div>
  );
}
