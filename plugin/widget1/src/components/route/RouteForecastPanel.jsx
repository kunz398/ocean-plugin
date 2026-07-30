import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Compass, Download, Loader, RotateCcw, TriangleAlert } from 'lucide-react';
import { SUITABILITY_HAZARD_COLORS, SUITABILITY_HAZARD_LABELS, VESSEL_CLASSES, nearestSeaLevelStep, seaLevelHeightM } from '../../lib/NiueSuitabilityOverlay';
import {
  MAX_SCENARIOS,
  buildRouteAdvisoryBriefConfig,
  deriveRouteDecision,
  driverLabel,
  isScenarioStale,
  isScenarioSuperseded,
  suggestBetterVessel,
} from '../../services/scenarioService';
import { exportSuitabilityPDF } from '../../utils/SuitabilityPDFExporter';
import { formatZoned, tzLabel } from '../../utils/timeZoneFormat';
import './RouteForecastPanel.css';

// The endpoint-not-deployed message from routeForecastService.js — retrying
// won't help until the backend ships this route, so don't offer a Retry
// button for it (offering one implies the click will do something).
const NON_RETRYABLE_ERROR_PATTERN = /not available/i;

const TEXT_MUTED = 'rgba(203, 213, 225, 0.72)';

function fmtNumber(value, digits = 1, suffix = '') {
  return Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : '-';
}

function RouteForecastPanel({
  data, onRetry, canRetry, currentRouteInputs, currentModelRunStart,
  scenarioCount = 0, onConfirmVesselSuggestion,
  departureSuggestionLoading, departureSuggestionProgress, departureSuggestionResult, departureSuggestionError,
  onSuggestBetterDeparture, onApplyDepartureSuggestion, onSaveDepartureSuggestionAsScenario,
  seaLevelTimeseries, apiBase, currentTimeIndex,
  timeDisplayZone = 'Pacific/Niue',
}) {
  function fmtTime(value, withLabel = true) {
    if (!value) return '-';
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return '-';
    return formatZoned(d, timeDisplayZone, { withLabel, year: undefined, month: 'short', day: 'numeric' });
  }

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [confirmingVessel, setConfirmingVessel] = useState(false);
  const [confirmedScenarioName, setConfirmedScenarioName] = useState('');
  const confirmedClearTimerRef = useRef(null);
  const result = data?.result;
  const summary = result?.summary;
  const samples = useMemo(() => (Array.isArray(result?.samples) ? result.samples : []), [result]);
  const sampleTides = useMemo(() => (
    samples.map((sample) => nearestSeaLevelStep(seaLevelTimeseries?.data?.timesteps, sample.eta))
  ), [samples, seaLevelTimeseries?.data?.timesteps]);
  const vesselLabel = VESSEL_CLASSES.find((v) => v.value === data?.selectedVessel)?.label ?? data?.selectedVessel;
  // worst_hazard_class is only null when every sample was unavailable (out
  // of the model domain) — defaulting it to 0 here would paint that state
  // with the same green "Suitable" badge as a real all-clear route.
  const hazard = summary?.worst_hazard_class;
  const hazardColor = SUITABILITY_HAZARD_COLORS[hazard] ?? '#94a3b8';

  const decision = useMemo(() => (
    result ? deriveRouteDecision(result, data?.selectedVessel) : null
  ), [result, data?.selectedVessel]);

  // Free, client-side estimate — no network call. See suggestBetterVessel's
  // own header comment for why this must never be presented as
  // route-checked; "Confirm & compare" below is what actually verifies it.
  const vesselSuggestion = useMemo(() => (
    result ? suggestBetterVessel(result, data?.selectedVessel) : null
  ), [result, data?.selectedVessel]);

  const handleConfirmVesselSuggestion = useCallback(async () => {
    if (!vesselSuggestion || confirmingVessel) return;
    setConfirmingVessel(true);
    try {
      const created = await onConfirmVesselSuggestion?.(vesselSuggestion.vessel);
      if (created?.name) {
        setConfirmedScenarioName(created.name);
        clearTimeout(confirmedClearTimerRef.current);
        confirmedClearTimerRef.current = setTimeout(() => setConfirmedScenarioName(''), 5000);
      }
    } finally {
      setConfirmingVessel(false);
    }
  }, [vesselSuggestion, confirmingVessel, onConfirmVesselSuggestion]);

  useEffect(() => () => clearTimeout(confirmedClearTimerRef.current), []);

  // This result's own inputs, snapshotted at fetch time (see
  // handleRunRouteForecast in Home.jsx) — compared against the live
  // routePoints/vessel/speed/departure state to detect edits made after the
  // result was already shown. Reuses scenarioService's stale/superseded
  // checks by wrapping this single result in the same {status, ...} shape
  // a saved scenario has, rather than duplicating the comparison logic.
  const resultAsPseudoScenario = useMemo(() => ({
    status: result ? 'ready' : 'draft',
    vessel: data?.selectedVessel,
    speedKt: data?.speedKt,
    departureTime: data?.departureTime,
    routePoints: data?.routePoints,
    modelRunStartAtRun: data?.modelRunStartAtFetch,
  }), [result, data]);
  const stale = isScenarioStale(resultAsPseudoScenario, currentRouteInputs);
  const superseded = isScenarioSuperseded(resultAsPseudoScenario, currentModelRunStart);

  const handleExport = useCallback(async () => {
    if (!result || exporting) return;
    setExporting(true);
    setExportError('');
    try {
      await exportSuitabilityPDF({
        selectedVessel: data?.selectedVessel,
        suitabilityBaseUrl: apiBase,
        advisoryConfig: buildRouteAdvisoryBriefConfig({
          vesselType: data?.selectedVessel,
          vesselLabel,
          routePoints: data?.routePoints ?? [],
          speedKt: data?.speedKt,
          departureTime: data?.departureTime,
          result,
          decision,
          provenance: {
            generatedAt: data?.generatedAt,
            modelRunStart: data?.modelRunStartAtFetch,
          },
          vesselSuggestion,
          departureSuggestion: departureSuggestionResult,
          seaLevel: seaLevelTimeseries?.data ?? null,
          mapTimeIndex: currentTimeIndex,
        }),
      });
    } catch (err) {
      console.error('[RouteForecastPanel] Advisory brief export failed:', err);
      setExportError(err.message || 'Route advisory brief failed.');
    } finally {
      setExporting(false);
    }
  }, [data, decision, exporting, result, vesselLabel, vesselSuggestion, departureSuggestionResult, seaLevelTimeseries?.data, apiBase, currentTimeIndex]);

  const wrapperStyle = {
    paddingTop: '0.25rem',
    paddingRight: '0.4rem',
    paddingBottom: '1rem',
    paddingLeft: '0.4rem',
    color: '#f8fafc',
    fontFamily: 'inherit',
  };

  if (data?.loading) {
    return <div style={{ ...wrapperStyle, textAlign: 'center', paddingTop: '2rem' }}>Running route forecast...</div>;
  }

  if (data?.error) {
    const retryable = onRetry && canRetry !== false && !NON_RETRYABLE_ERROR_PATTERN.test(data.error);
    return (
      <div style={wrapperStyle}>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div style={{ color: '#f87171', marginBottom: retryable ? 12 : 0 }}>{data.error}</div>
          {retryable && (
            <button
              type="button"
              className="inundation-timeseries__export-btn"
              onClick={onRetry}
            >
              <RotateCcw size={13} />
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div style={wrapperStyle}>
        <div style={{ textAlign: 'center', color: TEXT_MUTED, padding: '2rem' }}>
          Draw or import a route, then run the route forecast.
        </div>
      </div>
    );
  }

  const hazardCounts = samples.reduce((acc, sample) => {
    if (sample.hazard_class === 0) acc.suitable += 1;
    else if (sample.hazard_class === 1) acc.caution += 1;
    else if (sample.hazard_class === 2) acc.avoid += 1;
    else acc.unavailable += 1;
    return acc;
  }, { suitable: 0, caution: 0, avoid: 0, unavailable: 0 });
  const stripSummary = samples.length
    ? `Route hazard progression, in order of travel: ${hazardCounts.suitable} suitable, ${hazardCounts.caution} caution, ${hazardCounts.avoid} avoid`
      + (hazardCounts.unavailable ? `, ${hazardCounts.unavailable} unavailable` : '') + ' segments.'
    : 'Route hazard progression: no samples available.';

  return (
    <div style={wrapperStyle}>
      <div className="route-forecast-stats">
        <div style={{
          border: `1px solid ${hazardColor}66`,
          background: `linear-gradient(135deg, ${hazardColor}2b, rgba(255,255,255,0.04))`,
          borderRadius: 8,
          padding: '0.75rem 0.85rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: hazardColor, fontWeight: 800 }}>
            <TriangleAlert size={17} />
            {summary?.recommendation ?? 'Route forecast'}
          </div>
          <div style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 4 }}>{vesselLabel}</div>
        </div>
        <Stat label="Distance" value={fmtNumber(summary?.distance_nm, 1, ' nm')} />
        <Stat label="Duration" value={fmtNumber(summary?.duration_hours, 1, ' h')} />
        <Stat label="Speed" value={fmtNumber(Number(data?.speedKt), 1, ' kt')} />
      </div>

      {stale && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#fbbf24', fontSize: 12, marginBottom: '0.5rem' }}>
          <AlertTriangle size={13} />
          Route, vessel, speed, or departure changed since this result — re-run recommended.
        </div>
      )}
      {superseded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#fbbf24', fontSize: 12, marginBottom: '0.5rem' }}>
          <Clock3 size={13} />
          Superseded by a newer forecast run — re-run for current conditions.
        </div>
      )}

      <div style={{ position: 'relative', marginBottom: '0.8rem' }}>
        <div
          role="img"
          aria-label={stripSummary}
          style={{ display: 'flex', height: 14, overflow: 'hidden', borderRadius: 4, border: '1px solid rgba(255,255,255,0.12)' }}
        >
          {samples.length ? samples.map((sample, index) => (
            <span
              key={`${sample.sample_index}-${index}`}
              title={`${fmtTime(sample.eta)} · ${sample.hazard_label}`}
              style={{
                flex: 1,
                background: SUITABILITY_HAZARD_COLORS[sample.hazard_class] ?? '#64748b',
              }}
            />
          )) : (
            <span style={{ flex: 1, background: '#64748b' }} />
          )}
        </div>
      </div>

      {samples.length === 0 && (
        <div style={{ color: '#fbbf24', fontSize: 12, marginBottom: '0.7rem' }}>
          No route samples were returned. The route may be outside the model domain.
        </div>
      )}

      {decision && (
        <div style={{
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.04)',
          borderRadius: 8,
          padding: '0.6rem 0.75rem',
          marginBottom: '0.6rem',
          fontSize: 12,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Why</div>
          <div style={{ color: TEXT_MUTED }}>
            Worst conditions reach <strong style={{ color: '#f8fafc' }}>{SUITABILITY_HAZARD_LABELS[decision.worstHazardClass] ?? 'Unavailable'}</strong>,
            {' '}<strong style={{ color: '#f8fafc' }}>{driverLabel(decision.primaryDriver)}</strong>-driven
            {decision.worstTime ? <> around <strong style={{ color: '#f8fafc' }}>{fmtTime(decision.worstTime)}</strong></> : null}.
            {' '}Confidence: <strong style={{ color: '#f8fafc' }}>{decision.confidenceLabel}</strong>
            {decision.unavailableSamples > 0 ? ` (${decision.unavailableSamples} of ${decision.totalSamples} samples outside the model domain)` : ''}.
          </div>
        </div>
      )}

      {vesselSuggestion && (
        <div style={{
          border: '1px dashed rgba(255,255,255,0.18)', borderRadius: 8,
          padding: '0.6rem 0.75rem', marginBottom: '0.6rem', fontSize: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 4 }}>
            <Compass size={13} />
            Suggestion
          </div>
          <div style={{ color: TEXT_MUTED, fontStyle: 'italic' }}>
            <strong style={{ color: '#f8fafc', fontStyle: 'normal' }}>{vesselSuggestion.vesselLabel}</strong> would reduce worst conditions from{' '}
            <strong style={{ color: '#f8fafc', fontStyle: 'normal' }}>{SUITABILITY_HAZARD_LABELS[vesselSuggestion.currentWorstHazardClass]}</strong> to{' '}
            <strong style={{ color: '#f8fafc', fontStyle: 'normal' }}>{SUITABILITY_HAZARD_LABELS[vesselSuggestion.estimatedWorstHazardClass]}</strong> for this same route and time
            {' '}(threshold estimate — confirm before changing vessel class).
          </div>
          <button
            type="button"
            className="inundation-timeseries__export-btn"
            style={{ marginTop: 6 }}
            onClick={handleConfirmVesselSuggestion}
            disabled={confirmingVessel || scenarioCount >= MAX_SCENARIOS}
            title={scenarioCount >= MAX_SCENARIOS ? `Remove a scenario first — up to ${MAX_SCENARIOS} at a time` : 'Confirm & compare'}
          >
            {confirmingVessel ? <Loader size={13} /> : <Compass size={13} />}
            {confirmingVessel ? 'Confirming...' : 'Confirm & compare'}
          </button>
          {confirmedScenarioName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#4ade80', fontSize: 12, marginTop: 6 }}>
              <CheckCircle2 size={13} />
              Added as {confirmedScenarioName} — see Scenario comparison in the sidebar.
            </div>
          )}
        </div>
      )}

      <div style={{
        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
        padding: '0.6rem 0.75rem', marginBottom: '0.6rem', fontSize: 12,
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
            <Clock3 size={13} />
            Better departure?
          </div>
          <button
            type="button"
            className="inundation-timeseries__export-btn"
            onClick={onSuggestBetterDeparture}
            disabled={departureSuggestionLoading}
          >
            {departureSuggestionLoading ? <Loader size={12} /> : <Clock3 size={12} />}
            {departureSuggestionLoading
              ? `Checking +${departureSuggestionProgress?.offsetHours}h... (${(departureSuggestionProgress?.index ?? 0) + 1}/${departureSuggestionProgress?.total ?? '?'})`
              : 'Suggest better departure'}
          </button>
        </div>
        {departureSuggestionError && <div style={{ color: '#f87171' }}>{departureSuggestionError}</div>}
        {departureSuggestionResult && (
          <div style={{ color: TEXT_MUTED }}>
            Leaving <strong style={{ color: '#f8fafc' }}>+{departureSuggestionResult.offsetHours}h</strong> later
            ({fmtTime(departureSuggestionResult.departureTime)}) would be{' '}
            <strong style={{ color: '#f8fafc' }}>{SUITABILITY_HAZARD_LABELS[departureSuggestionResult.worstHazardClass]}</strong>
            {departureSuggestionResult.allClear ? '' : ' (best of the offsets checked)'} — checked against the route forecast.
            {departureSuggestionResult.failedOffsets?.length > 0 && (
              <> {departureSuggestionResult.failedOffsets.length === 1 ? 'One offset' : `${departureSuggestionResult.failedOffsets.length} offsets`} (+{departureSuggestionResult.failedOffsets.join('h, +')}h) could not be checked.</>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button type="button" className="inundation-timeseries__export-btn" onClick={onApplyDepartureSuggestion}>Apply</button>
              <button
                type="button"
                className="inundation-timeseries__export-btn"
                onClick={onSaveDepartureSuggestionAsScenario}
                disabled={scenarioCount >= MAX_SCENARIOS}
              >
                Save as scenario
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: '0.6rem' }}>
        Model: SWAN · Generated: {fmtTime(data?.generatedAt)}
        {data?.modelRunStartAtFetch ? ` · Forecast window from: ${fmtTime(data.modelRunStartAtFetch)}` : ''}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ color: TEXT_MUTED, fontSize: 12 }}>
          {fmtTime(result.departure_time)} departure · {samples.length} sample{samples.length === 1 ? '' : 's'}
        </div>
        <button
          type="button"
          className="inundation-timeseries__export-btn"
          onClick={handleExport}
          disabled={exporting}
          title="Generate Route Advisory Brief"
        >
          {exporting ? <Loader size={13} /> : <Download size={13} />}
          {exporting ? 'Brief...' : 'Brief'}
        </button>
      </div>
      {exportError && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 8 }}>{exportError}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: TEXT_MUTED, textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
              <th style={thStyle}>{`ETA (${tzLabel(timeDisplayZone)})`}</th>
              <th style={thStyle}>Distance</th>
              <th style={thStyle}>Hazard</th>
              <th style={thStyle}>Wave</th>
              <th style={thStyle}>Wind</th>
              <th style={thStyle}>Tide</th>
              <th style={thStyle}>Position</th>
            </tr>
          </thead>
          <tbody>
            {samples.map((sample, index) => {
              const tideM = seaLevelHeightM(sampleTides[index]);
              return (
              <tr key={sample.sample_index} style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <td style={tdStyle}>{fmtTime(sample.eta, false)}</td>
                <td style={tdStyle}>{fmtNumber(sample.distance_nm, 1, ' nm')}</td>
                <td style={{ ...tdStyle, color: SUITABILITY_HAZARD_COLORS[sample.hazard_class] ?? '#e2e8f0', fontWeight: 700 }}>
                  {sample.hazard_label}
                </td>
                <td style={tdStyle}>{fmtNumber(sample.wave_height_m, 2, ' m')}</td>
                <td style={tdStyle}>{fmtNumber(sample.wind_speed_kt, 1, ' kt')}</td>
                <td style={tdStyle}>{Number.isFinite(tideM) ? `${tideM.toFixed(2)} m` : '-'}</td>
                <td style={tdStyle}>{sample.lat?.toFixed(4)}, {sample.lon?.toFixed(4)}</td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle = { padding: '0.4rem 0.5rem', fontWeight: 700, whiteSpace: 'nowrap' };
const tdStyle = { padding: '0.45rem 0.5rem', color: '#f8fafc', whiteSpace: 'nowrap' };

function Stat({ label, value }) {
  return (
    <div style={{
      border: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(255,255,255,0.05)',
      borderRadius: 8,
      padding: '0.75rem 0.85rem',
    }}>
      <div style={{ color: TEXT_MUTED, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontWeight: 800, marginTop: 3 }}>{value}</div>
    </div>
  );
}

export default RouteForecastPanel;
