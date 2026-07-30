import React, { useMemo } from 'react';
import { SUITABILITY_HAZARD_COLORS, SUITABILITY_HAZARD_LABELS } from '../../lib/NiueSuitabilityOverlay';
import { selectHeatmapSteps, findMatchingStep } from '../../utils/SuitabilityPDFExporter';
import { formatZoned, tzLabel } from '../../utils/timeZoneFormat';

const TEXT_PRIMARY = '#f8fafc';
const TEXT_MUTED = 'rgba(203, 213, 225, 0.65)';
const UNAVAILABLE_COLOR = '#475569';

const formatColumnTime = (date, timeZone) => formatZoned(date, timeZone, {
  withLabel: false, year: undefined, month: 'short', day: '2-digit',
});
const formatCellTime = (date, timeZone) => formatZoned(date, timeZone, {
  withLabel: false, year: undefined, month: 'short', day: '2-digit', weekday: 'short',
});

// Web equivalent of SuitabilityPDFExporter.js's drawLandingAreaHeatmapPage —
// same source data shape (rows of {name, steps}), same selectHeatmapSteps
// column-sampling, so "which sites look best over the next week" reads the
// same way whether you're looking at the PDF or the live panel.
function LandingAreaComparisonHeatmap({ rows, loading, vesselLabel, timeDisplayZone = 'Pacific/Niue' }) {
  const referenceSteps = useMemo(() => (
    rows.reduce((best, row) => (row.steps.length > (best?.length ?? 0) ? row.steps : best), null) ?? []
  ), [rows]);

  // windowHours: 168 (7 days) matches the PDF's default and this app's other
  // "next 7 days" framing elsewhere (AdvisoryPdfModal's seven_day option).
  const heatmapSteps = useMemo(() => selectHeatmapSteps(referenceSteps, 168), [referenceSteps]);
  const hasAreaBasis = rows.some((row) => row.statistics_basis === 'area_500m');
  const hasNearestFaceFallback = rows.some((row) => row.statistics_basis === 'nearest_face_area_fallback');
  const hasFallbackBasis = rows.some((row) => row.statistics_basis === 'nearest_pixel_fallback');

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem', color: TEXT_MUTED }}>Loading landing area comparison…</div>;
  }
  if (!rows.length || !heatmapSteps.length) {
    return <div style={{ textAlign: 'center', padding: '2rem', color: TEXT_MUTED }}>No comparison data available.</div>;
  }

  return (
    <div>
      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: TEXT_PRIMARY }}>Landing area comparison</div>
      <div style={{ fontSize: '0.72rem', color: TEXT_MUTED, marginTop: 1, marginBottom: 10 }}>
        {vesselLabel ? `${vesselLabel} · next 7 days` : 'Next 7 days'}
        {' · '}
        {hasAreaBasis ? '500 m area' : hasNearestFaceFallback ? 'nearest-face fallback' : hasFallbackBasis ? 'nearest-pixel fallback' : 'landing area'}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: `104px repeat(${heatmapSteps.length}, minmax(30px, 1fr))`,
          gap: 3,
          minWidth: 104 + heatmapSteps.length * 32,
        }}>
          <div />
          {heatmapSteps.map((hs, i) => (
            <div
              key={hs.time_index ?? i}
              style={{ fontSize: '0.6rem', color: TEXT_MUTED, textAlign: 'center', lineHeight: 1.25, whiteSpace: 'pre-line' }}
            >
              {formatColumnTime(new Date(hs.time), timeDisplayZone).replace(', ', '\n')}
            </div>
          ))}

          {rows.map((row) => (
            <React.Fragment key={row.id ?? row.label}>
              <div style={{
                fontSize: '0.72rem', color: TEXT_PRIMARY, fontWeight: 600,
                display: 'flex', alignItems: 'center', paddingRight: 6,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {row.name ?? row.label}
              </div>
              {heatmapSteps.map((hs, i) => {
                const matched = findMatchingStep(row.steps, hs);
                // Explicit null-check, not `hazard ?? 0` — a landing area with
                // no matching step at this column is unavailable, not a
                // silently-fabricated "Suitable" reading (the same masking
                // bug fixed earlier in routeForecastService.js's toNumber).
                const hazard = matched && Number.isFinite(matched.hazard_class) ? matched.hazard_class : null;
                const color = hazard === null ? UNAVAILABLE_COLOR : (SUITABILITY_HAZARD_COLORS[hazard] ?? UNAVAILABLE_COLOR);
                const label = hazard === null ? 'Unavailable' : (SUITABILITY_HAZARD_LABELS[hazard] ?? 'Unknown');
                const sampleCount = matched?.sample_count ?? matched?.face_count ?? matched?.total_points ?? matched?.area_sample_count ?? row.face_count;
                return (
                  <div
                    key={hs.time_index ?? i}
                    title={`${row.name ?? row.label}: ${label}${sampleCount ? ` · ${sampleCount} cells` : ''} — ${formatCellTime(new Date(hs.time), timeDisplayZone)} ${tzLabel(timeDisplayZone)}`}
                    style={{ height: 18, borderRadius: 3, background: color }}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.68rem', color: TEXT_MUTED, marginTop: 10 }}>
        {[0, 1, 2].map((h) => (
          <span key={h} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: SUITABILITY_HAZARD_COLORS[h], display: 'inline-block' }} />
            {SUITABILITY_HAZARD_LABELS[h]}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: UNAVAILABLE_COLOR, display: 'inline-block' }} />
          Unavailable
        </span>
      </div>
    </div>
  );
}

export default LandingAreaComparisonHeatmap;
