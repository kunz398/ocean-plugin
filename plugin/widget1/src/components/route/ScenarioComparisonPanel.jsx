import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Award, Copy, FileDown, ListChecks, Loader, Play, Trash2 } from 'lucide-react';
import { SUITABILITY_HAZARD_COLORS, SUITABILITY_HAZARD_LABELS, VESSEL_CLASSES } from '../../lib/NiueSuitabilityOverlay';
import {
  MAX_SCENARIOS,
  buildScenarioComparisonBriefConfig,
  driverLabel,
  isScenarioRouteStale,
  isScenarioSuperseded,
  rankScenarios,
} from '../../services/scenarioService';
import { exportSuitabilityPDF } from '../../utils/SuitabilityPDFExporter';
import './ScenarioComparisonPanel.css';

function vesselLabel(code) {
  return VESSEL_CLASSES.find((v) => v.value === code)?.label ?? code;
}

function statusText(scenario, decision, isRunning) {
  if (isRunning || scenario.status === 'running') return 'Running…';
  if (scenario.status === 'error') return scenario.error || 'Failed';
  if (scenario.status === 'draft') return 'Not run yet';
  if (!decision) return 'No result';
  return `${SUITABILITY_HAZARD_LABELS[decision.worstHazardClass] ?? 'Unknown'} · ${driverLabel(decision.primaryDriver)}`;
}

function statusColor(scenario, decision) {
  if (scenario.status === 'error') return '#f87171';
  if (scenario.status !== 'ready' || !decision) return 'rgba(180, 200, 230, 0.68)';
  return SUITABILITY_HAZARD_COLORS[decision.worstHazardClass] ?? '#94a3b8';
}

function fmtNumber(value, digits = 1, suffix = '') {
  return Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : '—';
}

function ScenarioComparisonPanel({
  scenarios,
  currentInputs,
  currentModelRunStart,
  runningScenarioIds = [],
  onSaveCurrent,
  onDuplicate,
  onRemove,
  onRun,
  onRunAll,
  highlightScenarioId = null,
}) {
  const { entries, recommendedId } = useMemo(() => rankScenarios(scenarios), [scenarios]);
  const readyCount = scenarios.filter((s) => s.status === 'ready').length;
  const canSaveCurrent = (currentInputs?.routePoints?.length ?? 0) >= 2 && scenarios.length < MAX_SCENARIOS;
  const canRunAll = scenarios.length > 0 && runningScenarioIds.length === 0;

  // "Confirm & compare" (in the route-forecast results panel, elsewhere on
  // screen) creates a scenario here silently — scroll to it and pulse it
  // briefly so the result of that click is actually visible to the user.
  const [pulseId, setPulseId] = useState(null);
  const cardRefs = useRef({});
  useEffect(() => {
    if (!highlightScenarioId) return undefined;
    setPulseId(highlightScenarioId);
    cardRefs.current[highlightScenarioId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = setTimeout(() => setPulseId(null), 2200);
    return () => clearTimeout(timer);
  }, [highlightScenarioId]);

  const [exportingBrief, setExportingBrief] = useState(false);
  const [exportError, setExportError] = useState('');

  const handleExportComparisonBrief = useCallback(async () => {
    if (exportingBrief) return;
    setExportingBrief(true);
    setExportError('');
    try {
      const readyScenarios = entries.filter((e) => e.scenario.status === 'ready').map((e) => e.scenario);
      await exportSuitabilityPDF({
        advisoryConfig: buildScenarioComparisonBriefConfig({
          scenarios: readyScenarios,
          recommendedId,
          vesselLabelFor: vesselLabel,
        }),
      });
    } catch (err) {
      setExportError(err.message || 'Scenario comparison brief failed.');
    } finally {
      setExportingBrief(false);
    }
  }, [entries, exportingBrief, recommendedId]);

  return (
    <div className="map-display-option">
      <div className="map-display-option__label">Scenario comparison</div>
      <div className="map-display-option__hint">
        Save the current route as a scenario, duplicate it with a different vessel, speed, or departure time, and compare up to {MAX_SCENARIOS} side by side.
      </div>

      <div className="map-display-option__segmented" role="group" aria-label="Scenario comparison actions" style={{ marginTop: '0.5rem' }}>
        <button type="button" className="map-display-option__btn" onClick={onSaveCurrent} disabled={!canSaveCurrent}>
          Save current
        </button>
        <button type="button" className="map-display-option__btn" onClick={onRunAll} disabled={!canRunAll}>
          <ListChecks size={13} style={{ marginRight: 5, verticalAlign: 'text-bottom' }} />
          Run all
        </button>
      </div>

      {scenarios.length === 0 && (
        <div className="map-display-option__hint" style={{ marginTop: '0.5rem' }}>
          No scenarios saved yet. Draw a route above, then "Save current" to start comparing.
        </div>
      )}

      {entries.map(({ scenario, decision }) => {
        const isRunning = runningScenarioIds.includes(scenario.id) || scenario.status === 'running';
        const isRecommended = scenario.id === recommendedId;
        const stale = isScenarioRouteStale(scenario, currentInputs?.routePoints);
        const superseded = isScenarioSuperseded(scenario, currentModelRunStart);
        return (
          <div
            key={scenario.id}
            ref={(el) => { cardRefs.current[scenario.id] = el; }}
            className={`scenario-card${isRecommended ? ' scenario-card--recommended' : ''}${pulseId === scenario.id ? ' scenario-card--pulse' : ''}`}
          >
            <div className="scenario-card__header">
              <span className="scenario-card__name">{scenario.name}</span>
              {isRecommended && (
                <span className="scenario-card__badge">
                  <Award size={11} />
                  Recommended
                </span>
              )}
            </div>
            <div className="scenario-card__meta">
              {vesselLabel(scenario.vessel)} · {fmtNumber(Number(scenario.speedKt), 1, ' kt')} · {scenario.routePoints?.length ?? 0} pts
            </div>
            <div className="scenario-card__status" style={{ color: statusColor(scenario, decision) }}>
              {statusText(scenario, decision, isRunning)}
            </div>
            {stale && <div className="scenario-card__note">Route changed since this was run — re-run recommended.</div>}
            {superseded && <div className="scenario-card__note">Superseded by a newer forecast run.</div>}
            <div className="scenario-card__actions">
              <button type="button" onClick={() => onRun(scenario.id)} disabled={isRunning}>
                {isRunning ? <Loader size={12} /> : <Play size={12} />}
                Run
              </button>
              <button type="button" onClick={() => onDuplicate(scenario.id)} disabled={scenarios.length >= MAX_SCENARIOS}>
                <Copy size={12} />
                Duplicate
              </button>
              <button type="button" onClick={() => onRemove(scenario.id)} aria-label={`Remove ${scenario.name}`}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        );
      })}

      {readyCount >= 2 && (
        <>
          <div className="scenario-compare-table-wrap">
            <table className="scenario-compare-table">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Worst</th>
                  <th>Caution+Avoid</th>
                  <th>Unavailable</th>
                  <th>Duration</th>
                  <th>Driver</th>
                </tr>
              </thead>
              <tbody>
                {entries.filter((e) => e.scenario.status === 'ready').map(({ scenario, decision }) => {
                  const recommendedRow = scenario.id === recommendedId;
                  // Hazard-severity color, matching statusColor() on the cards
                  // above — Worst and Driver render as one hazard-colored
                  // reading up there, so the table's Worst/Driver columns
                  // should agree, rather than the table using its own
                  // unrelated "is this the recommended row" color rule (see
                  // scenario-compare-table__recommended-row below: that's now
                  // a row background wash, not a text color, specifically so
                  // it can't be confused with a hazard reading).
                  const hazardTextColor = decision ? SUITABILITY_HAZARD_COLORS[decision.worstHazardClass] : undefined;
                  return (
                    <tr key={scenario.id} className={recommendedRow ? 'scenario-compare-table__recommended-row' : undefined}>
                      <td>{scenario.name}{recommendedRow ? ' ★' : ''}</td>
                      <td style={{ color: hazardTextColor }}>{decision ? (SUITABILITY_HAZARD_LABELS[decision.worstHazardClass] ?? '—') : '—'}</td>
                      <td>{fmtNumber((decision?.cautionPercent ?? 0) + (decision?.warningPercent ?? 0), 0, '%')}</td>
                      <td>{decision?.unavailableSamples ?? '—'}</td>
                      <td>{fmtNumber(decision?.durationHours, 1, ' h')}</td>
                      <td style={{ color: hazardTextColor }}>{decision ? driverLabel(decision.primaryDriver) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="map-display-option__btn"
            style={{ marginTop: '0.5rem', width: '100%' }}
            onClick={handleExportComparisonBrief}
            disabled={exportingBrief}
          >
            <FileDown size={13} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
            {exportingBrief ? 'Generating…' : 'Generate Scenario Comparison Brief'}
          </button>
          {exportError && <div className="map-display-option__hint" style={{ color: '#f87171' }}>{exportError}</div>}
        </>
      )}
    </div>
  );
}

export default ScenarioComparisonPanel;
