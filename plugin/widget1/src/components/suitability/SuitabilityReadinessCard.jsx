import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, RadioTower, TriangleAlert } from 'lucide-react';
import './SuitabilityReadinessCard.css';

const PROBE_POINT = { lon: -169.9367, lat: -19.1211 };

function statusMeta(status) {
  if (status === 'ready') return { label: 'Ready', icon: CheckCircle2, className: 'is-ready' };
  if (status === 'checking') return { label: 'Checking', icon: Clock3, className: 'is-checking' };
  if (status === 'fallback') return { label: 'Fallback', icon: TriangleAlert, className: 'is-fallback' };
  return { label: 'Unavailable', icon: TriangleAlert, className: 'is-down' };
}

export default function SuitabilityReadinessCard({ apiBase, selectedVessel, forecastTimeLabel }) {
  const [areaStatus, setAreaStatus] = useState({ status: apiBase ? 'checking' : 'down', detail: '' });

  useEffect(() => {
    if (!apiBase) {
      setAreaStatus({ status: 'down', detail: 'Suitability API base is not configured.' });
      return undefined;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      lon: String(PROBE_POINT.lon),
      lat: String(PROBE_POINT.lat),
      radius_m: '500',
      vessel: selectedVessel || 'traditional_craft',
    });
    const url = `${apiBase.replace(/\/$/, '')}/niue/suitability/area/timeseries?${params}`;
    setAreaStatus({ status: 'checking', detail: 'Checking 500 m area endpoint.' });

    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (response.ok) {
          const body = await response.json().catch(() => null);
          const faceCount = Number(body?.face_count);
          const suffix = Number.isFinite(faceCount) ? ` ${faceCount} model cells sampled at probe site.` : '';
          setAreaStatus({
            status: body?.used_nearest_face_fallback ? 'fallback' : 'ready',
            detail: body?.used_nearest_face_fallback
              ? `Endpoint exists, but probe site used nearest-face fallback.${suffix}`
              : `500 m area endpoint is responding.${suffix}`,
          });
          return;
        }
        if (response.status === 404) {
          setAreaStatus({
            status: 'fallback',
            detail: '500 m area endpoint is not deployed; landing tools use nearest-pixel fallback.',
          });
          return;
        }
        setAreaStatus({
          status: 'down',
          detail: `500 m area endpoint returned HTTP ${response.status}.`,
        });
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setAreaStatus({
          status: 'down',
          detail: '500 m area endpoint could not be checked from this browser.',
        });
      });

    return () => controller.abort();
  }, [apiBase, selectedVessel]);

  const areaMeta = statusMeta(areaStatus.status);
  const AreaIcon = areaMeta.icon;
  const productionReady = areaStatus.status === 'ready';
  const readinessText = useMemo(() => (
    productionReady
      ? 'Landing, route, point, and advisory workflows can be used with clear analytical basis labels.'
      : 'Use for review/testing with fallback labels visible; do not treat landing-area analytics as final production evidence yet.'
  ), [productionReady]);

  return (
    <div className={`suitability-readiness ${productionReady ? 'suitability-readiness--ready' : 'suitability-readiness--caution'}`}>
      <div className="suitability-readiness__header">
        <div>
          <div className="suitability-readiness__eyebrow">Operational readiness</div>
          <div className="suitability-readiness__title">
            <RadioTower size={15} />
            Suitability setup
          </div>
        </div>
        <span className={`suitability-readiness__badge ${areaMeta.className}`}>
          <AreaIcon size={13} />
          {areaMeta.label}
        </span>
      </div>

      <div className="suitability-readiness__grid">
        <div>
          <span>Forecast time</span>
          <strong>{forecastTimeLabel || 'Selected timestep'}</strong>
        </div>
        <div>
          <span>500 m landing areas</span>
          <strong>{areaStatus.status === 'ready' ? 'Area endpoint' : areaStatus.status === 'fallback' ? 'Fallback labelled' : 'Needs check'}</strong>
        </div>
      </div>

      <div className="suitability-readiness__detail">{areaStatus.detail}</div>
      <div className="suitability-readiness__note">{readinessText}</div>
    </div>
  );
}
