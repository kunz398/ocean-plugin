import React, { useMemo, useState } from 'react';
import { CircleCheck, TriangleAlert, OctagonAlert, Wind, Waves, Compass, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  VESSEL_CLASSES,
  SUITABILITY_HAZARD_COLORS,
  SUITABILITY_HAZARD_LABELS,
  deriveSuitabilityDriver,
  nearestSeaLevelStepWithTrend,
} from '../../lib/NiueSuitabilityOverlay';
import LandingAreaTimeseries, { closestStep } from '../../pages/LandingAreaTimeseries';
import LandingAreaComparisonHeatmap from './LandingAreaComparisonHeatmap';
import { useLandingAreaComparison } from '../../hooks/useLandingAreaComparison';
import './LandingAreaDetailsPanel.css';

const HAZARD_ICONS = {
  0: CircleCheck,
  1: TriangleAlert,
  2: OctagonAlert,
};

const DRIVER_LABELS = { none: 'None exceeded', wind: 'Wind', waves: 'Waves', wind_and_waves: 'Wind + waves' };

const TEXT_PRIMARY = '#f8fafc';
const TEXT_MUTED = 'rgba(203, 213, 225, 0.65)';

const NUT_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Pacific/Niue',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

// Wraps LandingAreaTimeseries with the header/metrics/verification-notice
// chrome the bottom-sheet needs — kept separate from the chart component so
// the chart stays a reusable "just render this series" piece (mirrors
// RiskDetailsPanel/SuitabilityDetailsPanel's split for the other two modes
// BottomOffCanvas renders).
function LandingAreaDetailsPanel({ landingArea, selectedVessel, steps, loading, error, currentSliderDate, apiBase, seaLevelTimeseries }) {
  const vesselLabel = VESSEL_CLASSES.find((v) => v.value === selectedVessel)?.label ?? selectedVessel;

  // 'location' = this one site over time (existing chart); 'compare' = every
  // preset site at once (the heatmap matrix — see LandingAreaComparisonHeatmap
  // and drawLandingAreaHeatmapPage in SuitabilityPDFExporter.js, its PDF
  // equivalent). The comparison fetch is gated on this tab being active — it
  // hits the backend for 4-5 sites at once, so it shouldn't run just because
  // the panel is open.
  const [activeTab, setActiveTab] = useState('location');
  const comparison = useLandingAreaComparison(selectedVessel, apiBase, activeTab === 'compare', landingArea);

  // Preset landing points come from LANDING_AREA_PRESETS (placeholder,
  // stakeholder-unconfirmed coordinates — see that file); map-clicked points
  // (source: 'click', set in Home.jsx) are a real point the user chose, not
  // a placeholder, so only presets get the verification notice.
  const isUnverified = landingArea?.source === 'preset' && landingArea?.verificationStatus !== 'verified';
  const displayName = landingArea?.name ?? landingArea?.label ?? 'Landing area';
  const basis = landingArea?.statistics_basis;
  const isAreaBasis = basis === 'area_500m';
  const isNearestFaceFallback = basis === 'nearest_face_area_fallback';
  const basisLabel = isAreaBasis
    ? '500 m area'
    : isNearestFaceFallback
      ? 'Nearest face fallback'
      : basis === 'nearest_pixel_fallback' ? 'Nearest pixel fallback' : 'Landing area';

  const nowStep = useMemo(() => closestStep(steps, currentSliderDate), [steps, currentSliderDate]);
  const sampleCount = nowStep?.sample_count ?? nowStep?.face_count ?? nowStep?.sampleCount
    ?? nowStep?.total_points ?? nowStep?.area_sample_count ?? landingArea?.face_count;
  const nowTide = useMemo(() => (
    nearestSeaLevelStepWithTrend(seaLevelTimeseries?.data?.timesteps, currentSliderDate)
  ), [seaLevelTimeseries?.data?.timesteps, currentSliderDate]);
  // Explainability only — forecast hazard_class stays authoritative, this
  // just names which parameter drove it (see NiueSuitabilityOverlay.js).
  const nowDriver = useMemo(() => (
    nowStep && selectedVessel ? deriveSuitabilityDriver(selectedVessel, nowStep.wind_speed_kt ?? 0, nowStep.wave_height_m ?? 0) : null
  ), [nowStep, selectedVessel]);

  const hazardColor = nowStep ? (SUITABILITY_HAZARD_COLORS[nowStep.hazard_class] ?? '#94a3b8') : '#94a3b8';
  const hazardLabel = nowStep ? (SUITABILITY_HAZARD_LABELS[nowStep.hazard_class] ?? 'Unknown') : null;
  const HazardIcon = nowStep ? (HAZARD_ICONS[nowStep.hazard_class] ?? TriangleAlert) : null;

  const validTimeLabel = nowStep?.valid_time
    ? `Valid ${NUT_TIME_FORMATTER.format(new Date(nowStep.valid_time))} NUT`
    : null;

  // This panel sits directly on the offcanvas's permanently dark-navy
  // background, so its own text is hardcoded light regardless of isDarkMode
  // (see BottomOffCanvas.css) — LandingAreaTimeseries below is forced into
  // its isDarkMode=true palette for the same reason, now that it renders
  // inside the always-dark .landing-panel__chart-frame card.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', color: TEXT_PRIMARY, fontFamily: 'inherit', padding: '0.5rem 0' }}>
      <div className="landing-panel__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: TEXT_MUTED }}>
            Landing assessment
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, lineHeight: 1.3, marginTop: 2 }}>{displayName}</div>
          <div style={{ fontSize: '0.78rem', color: TEXT_MUTED, marginTop: 2 }}>
            {vesselLabel}
            {Number.isFinite(landingArea?.lat) && Number.isFinite(landingArea?.lon)
              ? ` · ${landingArea.lat.toFixed(4)}, ${landingArea.lon.toFixed(4)}`
              : ''}
            {` · ${basisLabel}`}
          </div>
        </div>
        {hazardLabel && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
              padding: '0.32rem 0.7rem', borderRadius: 999, fontSize: '0.78rem', fontWeight: 700,
              color: hazardColor, background: `${hazardColor}22`, border: `1px solid ${hazardColor}55`,
              whiteSpace: 'nowrap',
            }}>
              <HazardIcon size={13} strokeWidth={2.25} />
              {hazardLabel.toUpperCase()}
            </span>
            {validTimeLabel && (
              <div style={{ fontSize: '0.68rem', color: TEXT_MUTED, marginTop: 4 }}>{validTimeLabel}</div>
            )}
          </div>
        )}
      </div>

      <div role="tablist" aria-label="Landing view" style={{ display: 'flex', gap: 6 }}>
        {[
          { key: 'location', label: 'This location' },
          { key: 'compare', label: 'Compare all' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '0.32rem 0.75rem', borderRadius: 999, fontSize: '0.74rem', fontWeight: 600,
              cursor: 'pointer', border: `1px solid ${activeTab === tab.key ? 'rgba(96, 165, 250, 0.5)' : 'rgba(255, 255, 255, 0.12)'}`,
              background: activeTab === tab.key ? 'rgba(96, 165, 250, 0.16)' : 'rgba(255, 255, 255, 0.04)',
              color: activeTab === tab.key ? '#93c5fd' : TEXT_MUTED,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'location' && isUnverified && (
        <div className="landing-panel__warning" style={{ color: '#fcd34d', fontSize: '0.76rem' }}>
          <TriangleAlert size={14} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong>Unverified location.</strong> {landingArea?.sourceNote ?? 'This landing point is a placeholder for testing and has not been operationally validated.'}
          </div>
        </div>
      )}

      {activeTab === 'location' && basis === 'nearest_pixel_fallback' && (
        <div className="landing-panel__warning landing-panel__warning--info" style={{ color: '#bae6fd', fontSize: '0.76rem' }}>
          <TriangleAlert size={14} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong>500 m area endpoint unavailable.</strong> Showing nearest-pixel fallback for this deployment.
          </div>
        </div>
      )}

      {activeTab === 'location' && isNearestFaceFallback && (
        <div className="landing-panel__warning landing-panel__warning--info" style={{ color: '#bae6fd', fontSize: '0.76rem' }}>
          <TriangleAlert size={14} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong>No model faces inside 500 m.</strong> The area endpoint used the nearest valid model face for this location.
          </div>
        </div>
      )}

      {activeTab === 'compare' ? (
        <LandingAreaComparisonHeatmap
          rows={comparison.rows}
          loading={comparison.loading}
          error={comparison.error}
          vesselLabel={vesselLabel}
        />
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: TEXT_MUTED }}>Loading suitability timeseries…</div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#f87171' }}>{error}</div>
      ) : (
        <>
          {nowStep && (
            <div className="landing-panel__stat-grid">
              {[
                { icon: Waves, label: 'Significant Wave height', value: Number.isFinite(nowStep.wave_height_m) ? `${nowStep.wave_height_m.toFixed(1)} m` : '—' },
                { icon: Wind, label: 'Wind speed', value: Number.isFinite(nowStep.wind_speed_kt) ? `${nowStep.wind_speed_kt.toFixed(1)} kt` : '—' },
                { icon: CircleCheck, label: 'Basis', value: sampleCount ? `${basisLabel} · ${sampleCount} cells` : basisLabel, color: (isAreaBasis || isNearestFaceFallback) ? '#38bdf8' : '#fbbf24' },
                { icon: HazardIcon ?? TriangleAlert, label: 'Suitability', value: hazardLabel ?? '—', color: hazardColor },
                { icon: Compass, label: 'Main driver', value: nowDriver ? (DRIVER_LABELS[nowDriver] ?? nowDriver) : '—' },
                {
                  // Always rendered (unlike the conditional spread this used
                  // to be) — the tile disappearing entirely when tide data is
                  // merely loading/unavailable was indistinguishable from
                  // "this app has no tide feature," unlike every other stat
                  // here, which shows an explicit '—' instead of vanishing.
                  icon: nowTide?.trend === 'rising' ? TrendingUp : nowTide?.trend === 'falling' ? TrendingDown : Minus,
                  label: 'Tide',
                  value: Number.isFinite(nowTide?.tide_m) ? `${nowTide.tide_m.toFixed(2)} m` : '—',
                  color: '#38bdf8',
                },
              ].map(({ icon: Icon, label, value, color }) => {
                const isEmpty = value === '—';
                return (
                  <div key={label} className="landing-panel__stat-card">
                    <div className="landing-panel__stat-label">
                      <Icon size={12} strokeWidth={2.25} />
                      {label}
                    </div>
                    <div
                      className={`landing-panel__stat-value${isEmpty ? ' landing-panel__stat-value--empty' : ''}`}
                      style={{ color: isEmpty ? TEXT_PRIMARY : (color ?? TEXT_PRIMARY) }}
                    >
                      {value}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="landing-panel__chart-frame">
            <LandingAreaTimeseries
              steps={steps}
              vessel={selectedVessel}
              vesselLabel={vesselLabel}
              currentSliderDate={currentSliderDate}
              isDarkMode
            />
          </div>
        </>
      )}
    </div>
  );
}

export default LandingAreaDetailsPanel;
