import React, { useCallback, useMemo, useState } from 'react';
import { FileDown, Loader, X } from 'lucide-react';
import { exportSuitabilityPDF, exportSuitabilityPoster } from '../../utils/SuitabilityPDFExporter';
import { bboxFromPointRadius } from '../../lib/geoBbox';
import { LANDING_AREA_PRESETS } from '../../config/landingAreaPresets';
import './AdvisoryPdfModal.css';

const LANDING_AREA_RADIUS_KM = 0.5;

// ── Constants ─────────────────────────────────────────────────────────────────

// Matches VESSEL_CLASSES in SuitabilityPDFExporter.js (self-contained there
// too) — kept local instead of importing the old SuitabilityApiService.js,
// which this port intentionally leaves behind.
const VESSEL_CLASSES = [
  { code: 'traditional_craft',          label: 'Traditional' },
  { code: 'very_small_motorised_craft', label: 'Very Small Motor' },
  { code: 'small_craft',                label: 'Small Craft' },
  { code: 'larger_vessels',             label: 'Larger Vessels' },
];

const TIME_FRAMES = [
  { value: 'seven_day', label: '7-day outlook',        hours: 168 },
  { value: 'next_72h',  label: 'Next 72 hours',         hours: 72  },
  { value: 'current',   label: 'Current timestep only', hours: 0   },
];

const AREA_OPTIONS = [
  { value: 'model_domain',     label: 'Niue coastal waters (full model domain)' },
  { value: 'current_map_view', label: 'Current map view' },
  { value: 'landing_area',     label: 'Landing area (500 m area)' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatUtcDisplay(isoString) {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (!Number.isFinite(d.getTime())) return null;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day = String(d.getUTCDate());
  const mon = months[d.getUTCMonth()];
  const yr  = d.getUTCFullYear();
  const hr  = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${mon} ${yr}  ${hr}:${min} UTC`;
}

function readMapBounds(mapInstance) {
  try {
    const map = mapInstance?.current ?? mapInstance;
    if (!map || typeof map.getBounds !== 'function') return null;
    const b = map.getBounds();
    return {
      west:  parseFloat(b.getWest().toFixed(4)),
      south: parseFloat(b.getSouth().toFixed(4)),
      east:  parseFloat(b.getEast().toFixed(4)),
      north: parseFloat(b.getNorth().toFixed(4)),
    };
  } catch { return null; }
}

function readMapElement(mapInstance) {
  try {
    const map = mapInstance?.current ?? mapInstance;
    if (!map || typeof map.getContainer !== 'function') return null;
    return map.getContainer();
  } catch {
    return null;
  }
}

function buildAdvisoryConfig({ vesselCode, vesselLabel, areaType, mapBounds, timeFrameType, timeIndex, validTime, landingArea }) {
  const tf = TIME_FRAMES.find(t => t.value === timeFrameType) ?? TIME_FRAMES[0];
  const isMapView = areaType === 'current_map_view';
  const isLanding = areaType === 'landing_area';
  const bounds    = isLanding
    ? (landingArea ? bboxFromPointRadius(landingArea.lon, landingArea.lat, LANDING_AREA_RADIUS_KM) : null)
    : (isMapView ? (mapBounds ?? null) : null);

  return {
    vesselType:  vesselCode,
    vesselLabel,
    area: {
      type:            areaType,
      // landingArea.label carries the web dropdown's "⚠ ... — unverified
      // placeholder" warning text (landingAreaPresets.js) — fine for a
      // <select> option, but drawLandingAreaPage renders this as an
      // unwrapped header subtitle with no width guard. .name is the bare
      // place name; the placeholder caveat still reaches the PDF via that
      // page's own narrative line, so nothing is lost by preferring it here.
      label:           isLanding ? (landingArea?.name ?? landingArea?.label ?? 'Landing area') : (isMapView ? 'Current map view' : 'Niue coastal waters'),
      bounds,
      source:          isLanding ? (landingArea?.source ?? null) : null,
      id:              isLanding ? (landingArea?.id ?? null) : null,
      point:           isLanding && landingArea ? { lon: landingArea.lon, lat: landingArea.lat, radiusKm: landingArea.radiusKm ?? LANDING_AREA_RADIUS_KM, source: landingArea.source ?? null } : null,
      statisticsBasis: isLanding ? 'area_500m' : (isMapView ? 'centroid_filtered_faces' : 'full_model_domain'),
      statisticsNote:  isLanding
        ? 'Suitability statistics are aggregated across model cells inside the 500 m landing-area boundary when supported by the backend; older deployments fall back to nearest-pixel and label that fallback.'
        : (isMapView
          ? 'Maps and statistics use model-face centroids inside the current map bounds. Coverage is reported explicitly; this is not polygon area-weighted analysis.'
          : null),
    },
    timeFrame: {
      type:       tf.value,
      hours:      tf.hours,
      startIndex: timeIndex ?? 0,
      endIndex:   tf.hours > 0 ? (timeIndex ?? 0) + tf.hours : (timeIndex ?? 0),
      label:      tf.label,
    },
    validTime: {
      timeIndex: timeIndex ?? 0,
      utc: validTime ?? null,
    },
  };
}

// ── Modal component ───────────────────────────────────────────────────────────

export default function AdvisoryPdfModal({
  isOpen,
  onClose,
  timeIndex          = 0,
  validTime          = null,
  runId              = null,
  selectedVessel     = 'small_craft',
  suitabilityBaseUrl = '',
  mapInstance,
  landingArea        = null,
  setLandingArea,
}) {
  // null = "use current app vessel"
  const [localVessel,   setLocalVessel]   = useState(null);
  const [areaType,      setAreaType]      = useState('model_domain');
  const [timeFrameType, setTimeFrameType] = useState('seven_day');
  const [busy,          setBusy]          = useState(false);
  const [statusMsg,     setStatusMsg]     = useState('');
  const [errorMsg,      setErrorMsg]      = useState('');

  const effectiveVesselCode = localVessel ?? selectedVessel;
  const effectiveVesselLabel = useMemo(
    () => VESSEL_CLASSES.find(vc => vc.code === effectiveVesselCode)?.label ?? effectiveVesselCode,
    [effectiveVesselCode],
  );

  const mapBounds = useMemo(
    () => isOpen && areaType === 'current_map_view' ? readMapBounds(mapInstance) : null,
    // Re-read on every modal opening. mapInstance is a stable ref, so without
    // isOpen this memo retained the previous viewport after the user panned or
    // zoomed the map between exports.
    [areaType, mapInstance, isOpen],
  );

  const advisoryConfig = useMemo(() => buildAdvisoryConfig({
    vesselCode:    effectiveVesselCode,
    vesselLabel:   effectiveVesselLabel,
    areaType,
    mapBounds,
    timeFrameType,
    timeIndex,
    validTime,
    landingArea,
  }), [effectiveVesselCode, effectiveVesselLabel, areaType, mapBounds, timeFrameType, timeIndex, validTime, landingArea]);

  const isLandingAreaType = areaType === 'landing_area';
  const canExport = (!isLandingAreaType || LANDING_AREA_PRESETS.length > 0)
    && (areaType !== 'current_map_view' || Boolean(mapBounds));

  const handleExport = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErrorMsg('');
    setStatusMsg('Starting…');
    try {
      // Capture bounds again at the moment Generate is pressed. The map ref is
      // stable across pans/zooms, so a memoized value alone can be stale.
      const exportAdvisoryConfig = buildAdvisoryConfig({
        vesselCode: effectiveVesselCode,
        vesselLabel: effectiveVesselLabel,
        areaType,
        mapBounds: areaType === 'current_map_view' ? readMapBounds(mapInstance) : null,
        timeFrameType,
        timeIndex,
        validTime,
        landingArea,
      });
      await exportSuitabilityPDF({
        timeIndex,
        validTime,
        runId,
        mapElement: readMapElement(mapInstance),
        mapVessel: selectedVessel,
        suitabilityBaseUrl,
        selectedVessel: effectiveVesselCode,
        publicUrl: process.env.PUBLIC_URL ?? '',
        onProgress: setStatusMsg,
        advisoryConfig: exportAdvisoryConfig,
      });
      setBusy(false);
      onClose();
    } catch (err) {
      console.error('PDF export failed:', err);
      setErrorMsg(err?.message || 'Export failed — see console for details');
      setBusy(false);
    }
  }, [busy, timeIndex, validTime, runId, suitabilityBaseUrl, selectedVessel, effectiveVesselCode, effectiveVesselLabel, areaType, timeFrameType, landingArea, mapInstance, onClose]);

  // Poster ignores the vessel/area/timeframe controls above entirely — it
  // auto-picks whichever vessel class shows the most cross-class variation
  // at the best-contrast timestep, by design (a communications artifact,
  // not a per-vessel operational brief), so it's a separate action rather
  // than another "Area definition" option feeding the same export call.
  const handleExportPoster = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErrorMsg('');
    setStatusMsg('Starting…');
    try {
      await exportSuitabilityPoster({
        timeIndex,
        validTime,
        suitabilityBaseUrl,
        onProgress: setStatusMsg,
      });
      setBusy(false);
      onClose();
    } catch (err) {
      console.error('Poster export failed:', err);
      setErrorMsg(err?.message || 'Export failed — see console for details');
      setBusy(false);
    }
  }, [busy, timeIndex, validTime, suitabilityBaseUrl, onClose]);

  const handleOverlayClick = useCallback(e => {
    if (e.target === e.currentTarget && !busy) onClose();
  }, [busy, onClose]);

  if (!isOpen) return null;

  const validTimeDisplay = formatUtcDisplay(validTime);
  const currentVesselLabel = VESSEL_CLASSES.find(vc => vc.code === selectedVessel)?.label ?? selectedVessel;

  return (
    <div className="advisory-overlay" onClick={handleOverlayClick} role="presentation">
      <div className="advisory-modal" role="dialog" aria-modal="true" aria-labelledby="advisory-modal-title">

        {/* ── Header ── */}
        <div className="advisory-modal-hdr">
          <div>
            <div className="advisory-modal-title" id="advisory-modal-title">Marine Advisory Brief</div>
            <div className="advisory-modal-sub">Configure and generate the advisory brief</div>
          </div>
          <button className="advisory-close-btn" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={13} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="advisory-modal-body">

          {/* 1. Vessel type */}
          <div className="advisory-section">
            <div className="advisory-section-lbl">Advisory vessel type</div>
            <div className="advisory-radio-group">
              <label className={`advisory-radio-item${localVessel === null ? ' is-sel' : ''}`}>
                <input type="radio" name="vessel" checked={localVessel === null} onChange={() => setLocalVessel(null)} />
                <span className="advisory-radio-txt">
                  Current selected
                  <span className="advisory-radio-dim">{currentVesselLabel}</span>
                </span>
              </label>
              {VESSEL_CLASSES.map(vc => (
                <label key={vc.code} className={`advisory-radio-item${localVessel === vc.code ? ' is-sel' : ''}`}>
                  <input type="radio" name="vessel" checked={localVessel === vc.code} onChange={() => setLocalVessel(vc.code)} />
                  <span className="advisory-radio-txt">{vc.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 2. Area definition */}
          <div className="advisory-section">
            <div className="advisory-section-lbl">Area definition</div>
            <div className="advisory-radio-group">
              {AREA_OPTIONS.map(opt => (
                <label key={opt.value} className={`advisory-radio-item${areaType === opt.value ? ' is-sel' : ''}`}>
                  <input type="radio" name="area" checked={areaType === opt.value} onChange={() => setAreaType(opt.value)} />
                  <span className="advisory-radio-txt">{opt.label}</span>
                </label>
              ))}
            </div>
            {areaType === 'current_map_view' && mapBounds && (
              <div className="advisory-bounds">
                W {mapBounds.west} · S {mapBounds.south} · E {mapBounds.east} · N {mapBounds.north}
              </div>
            )}
            {areaType === 'current_map_view' && !mapBounds && (
              <div className="advisory-bounds advisory-bounds-warn">
                Map bounds unavailable — a current-map-view brief cannot be generated.
              </div>
            )}
            {areaType === 'current_map_view' && (
              <div className="advisory-stats-note">
                All advisory maps and Suitable / Caution / Avoid statistics will use model-face centroids inside these bounds. The PDF reports classified-face and raster scope coverage.
              </div>
            )}
            {isLandingAreaType && (
              <>
                <select
                  className="advisory-select"
                  style={{ width: '100%', marginTop: '0.5rem' }}
                  value={landingArea?.source === 'preset' ? landingArea.id : ''}
                  onChange={(e) => {
                    const preset = LANDING_AREA_PRESETS.find(p => p.id === e.target.value);
                    if (preset) setLandingArea?.({ ...preset, source: 'preset' });
                  }}
                  aria-label="Select a landing area preset"
                >
                  <option value="">Select a launch area…</option>
                  {LANDING_AREA_PRESETS.map(preset => (
                    <option key={preset.id} value={preset.id}>{preset.label}</option>
                  ))}
                </select>
                {landingArea ? (
                  <div className="advisory-bounds">
                    {landingArea.label} — {landingArea.lat.toFixed(4)}, {landingArea.lon.toFixed(4)}
                  </div>
                ) : (
                  <div className="advisory-bounds advisory-bounds-warn">
                    No single landing area selected — the brief will still include the preset landing-area heatmap.
                  </div>
                )}
                <div className="advisory-stats-note">
                  Landing-area advisories use 500 m area aggregation when the backend endpoint is available; older deployments fall back to nearest-pixel and label that fallback in the PDF. Preset coordinates remain example/unverified until confirmed.
                </div>
              </>
            )}
          </div>

          {/* 3. Forecast window */}
          <div className="advisory-section">
            <div className="advisory-section-lbl">Forecast window</div>
            <div className="advisory-radio-group">
              {TIME_FRAMES.map(tf => (
                <label key={tf.value} className={`advisory-radio-item${timeFrameType === tf.value ? ' is-sel' : ''}`}>
                  <input type="radio" name="timeframe" checked={timeFrameType === tf.value} onChange={() => setTimeFrameType(tf.value)} />
                  <span className="advisory-radio-txt">{tf.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Advisory scope summary */}
          <div className="advisory-scope">
            <div className="advisory-scope-title">Advisory scope</div>
            <div className="advisory-scope-grid">
              <span className="advisory-scope-key">Vessel</span>
              <span className="advisory-scope-val">{effectiveVesselLabel}</span>

              <span className="advisory-scope-key">Area</span>
              <span className="advisory-scope-val">{advisoryConfig.area.label}</span>

              <span className="advisory-scope-key">Valid time</span>
              <span className="advisory-scope-val">
                {validTimeDisplay ?? '—'}
                <span className="advisory-scope-step">step {timeIndex}</span>
              </span>

              <span className="advisory-scope-key">Forecast window</span>
              <span className="advisory-scope-val">{advisoryConfig.timeFrame.label}</span>

              <span className="advisory-scope-key">Statistics basis</span>
              <span className="advisory-scope-val">
                {advisoryConfig.area.statisticsBasis === 'area_500m'
                  ? '500 m landing area'
                  : advisoryConfig.area.statisticsBasis === 'centroid_filtered_faces'
                    ? 'Current bounds · centroid-filtered faces'
                  : advisoryConfig.area.statisticsBasis === 'nearest_pixel' || advisoryConfig.area.statisticsBasis === 'nearest_pixel_fallback'
                    ? 'Nearest pixel (landing area)'
                    : 'Full model domain'}
              </span>
            </div>
          </div>

          {/* 4. Public poster — separate artifact, ignores the controls above */}
          <div className="advisory-section">
            <div className="advisory-section-lbl">Public communications poster</div>
            <div className="advisory-stats-note">
              A3 "Same Ocean, Different Risk" poster comparing all vessel classes at once. Auto-selects
              whichever vessel shows the most contrast for visual impact — ignores the vessel/area/forecast
              window settings above.
            </div>
            <button
              className="advisory-btn-cancel"
              style={{ marginTop: '0.5rem' }}
              onClick={handleExportPoster}
              disabled={busy}
            >
              {busy
                ? <><Loader size={13} className="advisory-spin" />{statusMsg || 'Exporting…'}</>
                : <><FileDown size={13} />Export poster (A3)</>
              }
            </button>
          </div>

        </div>

        {/* ── Footer ── */}
        <div className="advisory-modal-ftr">
          {errorMsg && <span className="advisory-error">{errorMsg}</span>}
          <button className="advisory-btn-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="advisory-btn-export" onClick={handleExport} disabled={busy || !canExport}>
            {busy
              ? <><Loader size={13} className="advisory-spin" />{statusMsg || 'Exporting…'}</>
              : <><FileDown size={13} />Generate Advisory Brief</>
            }
          </button>
        </div>

      </div>
    </div>
  );
}
