// SwellSourceArcOverlay.js — deck.gl ArcLayer showing swell arrival directions.
// Arcs radiate from the swell source direction back to the clicked point.
// Source points are projected a fixed display distance in the "coming from" bearing
// so the arc clearly shows direction without implying a specific storm location.
// Tooltip labels each partition with height, period and direction.
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ArcLayer } from '@deck.gl/layers';

const DISPLAY_DIST_KM = 3000;

// Partition display colours (match severity palette used elsewhere)
const PART_COLORS = {
  p1: [56, 189, 248, 220],   // cyan  — primary
  p2: [250, 204, 21,  200],  // gold  — secondary
  p3: [251, 146, 60,  180],  // amber — tertiary
};

const PART_LABELS = { p1: 'Primary swell', p2: 'Secondary swell', p3: 'Tertiary swell' };

// Spherical projection: given a start point, bearing (°) and distance (km),
// return the destination [lng, lat]. Bearing 0=N, 90=E, 180=S, 270=W.
function projectPoint(lng, lat, bearingDeg, distKm) {
  const R  = 6371;
  const d  = distKm / R;
  const br = bearingDeg * (Math.PI / 180);
  const φ1 = lat * (Math.PI / 180);
  const λ1 = lng * (Math.PI / 180);
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(br),
  );
  const λ2 = λ1 + Math.atan2(
    Math.sin(br) * Math.sin(d) * Math.cos(φ1),
    Math.cos(d) - Math.sin(φ1) * Math.sin(φ2),
  );
  return [λ2 * (180 / Math.PI), φ2 * (180 / Math.PI)];
}

export class SwellSourceArcOverlay {
  constructor(map) {
    this.map     = map;
    this.mounted = true;

    this.overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
      getTooltip: ({ object }) => {
        if (!object?.tooltip) return null;
        return { html: object.tooltip, style: { fontSize: '12px', background: 'rgba(10,20,40,0.9)', color: '#e0f2fe', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(56,189,248,0.4)' } };
      },
    });
    map.addControl(this.overlay);
  }

  // partitions: [{id:'p1'|'p2'|'p3', hs, dir, tp}]
  setSwellPoint({ lat, lng, partitions }) {
    if (!this.mounted || !partitions?.length) { this.clear(); return; }

    const arcData = partitions
      .filter((p) => p.hs > 0.05 && Number.isFinite(p.dir))
      .map((p) => {
        const [srcLng, srcLat] = projectPoint(lng, lat, p.dir, DISPLAY_DIST_KM);
        const color = PART_COLORS[p.id] ?? [128, 128, 128, 180];
        const periodStr = Number.isFinite(p.tp) ? `${p.tp.toFixed(0)} s` : '—';
        return {
          id: p.id,
          sourcePosition: [srcLng, srcLat],
          targetPosition: [lng, lat],
          color,
          width: Math.max(2, p.hs * 4),
          tooltip:
            `<b>${PART_LABELS[p.id] ?? p.id}</b><br/>` +
            `Height: <b>${p.hs.toFixed(2)} m</b><br/>` +
            `Period: <b>${periodStr}</b><br/>` +
            `Direction: <b>${p.dir.toFixed(0)}° (from)</b><br/>` +
            `<span style="opacity:0.6;font-size:10px">Estimated arrival direction — not a confirmed storm location</span>`,
        };
      });

    if (!arcData.length) { this.clear(); return; }

    const layer = new ArcLayer({
      id: 'swell-source-arcs',
      data: arcData,
      pickable: true,
      getSourcePosition: (d) => d.sourcePosition,
      getTargetPosition: (d) => d.targetPosition,
      getSourceColor:    (d) => d.color,
      getTargetColor:    (d) => d.color,
      getWidth:          (d) => d.width,
      getHeight: 0.25,
      widthUnits: 'pixels',
    });

    this.overlay.setProps({ layers: [layer] });
  }

  clear() {
    if (!this.mounted) return;
    this.overlay.setProps({ layers: [] });
  }

  destroy() {
    this.mounted = false;
    try { this.map.removeControl(this.overlay); } catch { /* already removed */ }
  }
}
