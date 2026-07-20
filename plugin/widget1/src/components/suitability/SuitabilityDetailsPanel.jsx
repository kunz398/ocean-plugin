import React from 'react';
import { CircleCheck, TriangleAlert, OctagonAlert, Ship, Timer, Wind, Waves, MapPin } from 'lucide-react';
import { VESSEL_CLASSES, SUITABILITY_HAZARD_COLORS, SUITABILITY_HAZARD_LABELS } from '../../lib/NiueSuitabilityOverlay';

const HAZARD_ICONS = {
  0: CircleCheck,
  1: TriangleAlert,
  2: OctagonAlert,
};

const TEXT_PRIMARY = '#f8fafc';
const TEXT_MUTED = 'rgba(203, 213, 225, 0.65)';

// Single-point vessel-suitability reading — driven by the Niue suitability
// API's /niue/suitability/point endpoint, which returns one hazard reading
// at the current time index (no batch timeseries endpoint exists yet, unlike
// the Cook Islands inundation API).
function SuitabilityDetailsPanel({ data }) {
  const loading = data?.loading;
  const error = data?.error;
  const result = data?.result;

  // This panel always renders on the bottom offcanvas's fixed dark-navy
  // background (forced via !important in ForecastApp.css), independent of
  // the app-wide light/dark theme toggle — so its palette is fixed light-on-dark
  // rather than switching on isDarkMode.
  const wrapperStyle = {
    padding: '1rem 1.25rem 1.25rem',
    color: TEXT_PRIMARY,
    fontFamily: 'inherit',
  };

  if (loading) {
    return <div style={{ ...wrapperStyle, textAlign: 'center' }}>Loading suitability…</div>;
  }
  if (error) {
    return <div style={{ ...wrapperStyle, color: '#f87171', textAlign: 'center' }}>{error}</div>;
  }
  if (!result) {
    return <div style={{ ...wrapperStyle, textAlign: 'center', color: TEXT_MUTED }}>No suitability data at this location.</div>;
  }

  const hazardAvailable = result.available !== false && Number.isFinite(result.hazard_class);
  const hazardColor = hazardAvailable ? (SUITABILITY_HAZARD_COLORS[result.hazard_class] ?? '#94a3b8') : '#94a3b8';
  const hazardLabel = hazardAvailable ? (SUITABILITY_HAZARD_LABELS[result.hazard_class] ?? result.hazard_label ?? 'Unknown') : 'Unavailable';
  const HazardIcon = HAZARD_ICONS[result.hazard_class] ?? TriangleAlert;
  const vesselLabel = VESSEL_CLASSES.find((v) => v.value === result.vessel)?.label ?? result.vessel;
  const nearestLat = Number(result.nearest_face_lat);
  const nearestLon = Number(result.nearest_face_lon);
  const hasNearestPoint = Number.isFinite(nearestLat) && Number.isFinite(nearestLon);

  const stats = [
    { icon: Ship, label: 'Vessel class', value: vesselLabel },
    { icon: Timer, label: 'Valid time', value: result.valid_time ? new Date(result.valid_time).toLocaleString() : '—' },
    { icon: Wind, label: 'Wind speed', value: Number.isFinite(result.wind_speed_kt) ? `${result.wind_speed_kt.toFixed(1)} kt` : '—' },
    { icon: Waves, label: 'Significant Wave height', value: Number.isFinite(result.wave_height_m) ? `${result.wave_height_m.toFixed(2)} m` : '—' },
  ];

  return (
    <div style={wrapperStyle}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.7rem',
        padding: '0.6rem 0.9rem', borderRadius: 12,
        background: `linear-gradient(135deg, ${hazardColor}26, ${hazardColor}0d)`,
        border: `1px solid ${hazardColor}55`,
        marginBottom: '1rem',
      }}>
        <span style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
          background: `${hazardColor}26`,
        }}>
          <HazardIcon size={19} color={hazardColor} strokeWidth={2.25} />
        </span>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '0.01em' }}>{hazardLabel}</div>
          <div style={{ fontSize: '0.72rem', color: TEXT_MUTED }}>Vessel suitability</div>
        </div>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem',
      }}>
        {stats.map(({ icon: Icon, label, value }) => (
          <div key={label} style={{
            display: 'flex', flexDirection: 'column', gap: '0.3rem',
            padding: '0.65rem 0.8rem', borderRadius: 10,
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em',
              color: TEXT_MUTED,
            }}>
              <Icon size={13} strokeWidth={2} />
              {label}
            </div>
            <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.35rem',
        marginTop: '0.9rem', fontSize: '0.72rem', color: TEXT_MUTED,
      }}>
        <MapPin size={12} strokeWidth={2} />
        {hasNearestPoint
          ? (
            <>
              Nearest model point: {nearestLat.toFixed(4)}, {nearestLon.toFixed(4)}
              {Number.isFinite(result.distance_deg) && ` (~${(result.distance_deg * 111).toFixed(1)} km away)`}
            </>
          )
          : (result.unavailable_reason || 'No valid model point available for this location.')}
      </div>
    </div>
  );
}

export default SuitabilityDetailsPanel;
