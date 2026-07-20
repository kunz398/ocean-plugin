import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js/dist/plotly-basic.min';
import { Download, Printer } from 'lucide-react';
import { SUITABILITY_HAZARD_LABELS } from '../lib/NiueSuitabilityOverlay';

const Plot = createPlotlyComponent(Plotly);
const CHART_HAZARD_COLORS = {
  0: '#14b8a6',
  1: '#f59e0b',
  2: '#ef4444',
};
const CHART_BAND_ALPHA_DARK = {
  0: 0.18,
  1: 0.14,
  2: 0.16,
};
const CHART_BAND_ALPHA_LIGHT = {
  0: 0.10,
  1: 0.09,
  2: 0.10,
};

// Categorical sibling of InundationTimeseries.jsx: same Plotly setup, PNG/SVG
// export pattern, and "now" vertical line, but the series is a 3-class
// suitable/caution/warning hazard_class per timestep instead of continuous
// depth, so the trace/shapes/axis all differ from the depth chart.

// Exported so LandingAreaDetailsPanel can independently derive the same
// "current step" for its header badge and metric cards, without this chart
// component having to lift nowStep out via a callback prop.
export function closestStep(steps, targetDate) {
  if (!targetDate || !steps?.length) return null;
  const target = new Date(targetDate).getTime();
  return steps.reduce((best, s) => {
    const diff = Math.abs(new Date(s.valid_time).getTime() - target);
    return diff < Math.abs(new Date(best.valid_time).getTime() - target) ? s : best;
  });
}

function hexToRgba(hex, alpha) {
  const h = (hex || '#888888').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function LandingAreaTimeseries({ steps, vessel, vesselLabel, currentSliderDate, isDarkMode }) {
  const [plotHeight, setPlotHeight] = useState(260);
  const chartRef = useRef(null);
  const resizeFrameRef = useRef(null);
  const plotlyDivRef = useRef(null);

  const schedulePlotResize = useCallback(() => {
    if (resizeFrameRef.current) cancelAnimationFrame(resizeFrameRef.current);
    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      const el = chartRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setPlotHeight((cur) => (cur === rect.height ? cur : Math.max(160, rect.height)));
      if (plotlyDivRef.current) Plotly.Plots.resize(plotlyDivRef.current);
    });
  }, []);

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return undefined;
    schedulePlotResize();
    window.addEventListener('resize', schedulePlotResize);
    const obs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedulePlotResize) : null;
    obs?.observe(el);
    return () => {
      window.removeEventListener('resize', schedulePlotResize);
      obs?.disconnect();
      if (resizeFrameRef.current) cancelAnimationFrame(resizeFrameRef.current);
    };
  }, [schedulePlotResize]);

  const handleExportPNG = useCallback(() => {
    if (!plotlyDivRef.current) return;
    Plotly.downloadImage(plotlyDivRef.current, {
      format: 'png', width: 1200, height: 500, scale: 2, filename: 'landing-area-suitability',
    });
  }, []);

  // Prints just this chart via the browser's print dialog (which can "Save
  // as PDF") — distinct from the full multi-page Landing Area Suitability
  // report (exportLandingAreaSuitabilityPDF in SuitabilityPDFExporter.js,
  // reachable from "Generate Advisory Brief"). Both used to say "PDF" next
  // to each other, which read as two ways to get the same document; this
  // one only ever produces a single chart image.
  const handlePrintChart = useCallback(() => {
    if (!plotlyDivRef.current) return;
    Plotly.toImage(plotlyDivRef.current, { format: 'svg', width: 1200, height: 500 }).then((svgDataUrl) => {
      const win = window.open('', '_blank', 'width=960,height=720');
      if (!win) return;
      win.document.write(`<!DOCTYPE html><html><head>
        <title>Landing Area Suitability</title>
        <style>
          body { margin: 20px; font-family: Inter, system-ui, sans-serif; color: #0f172a; }
          h2 { margin: 0 0 4px; font-size: 16px; }
          img { max-width: 100%; margin-top: 12px; display: block; }
          .footer { margin-top: 12px; font-size: 11px; color: #94a3b8; }
          @media print { body { margin: 0; } }
        </style>
      </head><body>
        <h2>Landing Area Suitability${vesselLabel ? ` — ${vesselLabel}` : ''}</h2>
        <img src="${svgDataUrl}" alt="Landing area suitability chart" />
        <div class="footer">Generated ${new Date().toLocaleString('en-NZ', { timeZone: 'UTC' })} UTC · Nearest-pixel, not a 500 m area average</div>
        <script>window.onload = function() { window.print(); };</script>
      </body></html>`);
      win.document.close();
    });
  }, [vesselLabel]);

  const scoredSteps = useMemo(() => (
    (steps || []).filter((s) => Number.isFinite(s?.hazard_class))
  ), [steps]);
  const times = useMemo(() => scoredSteps.map((s) => new Date(s.valid_time)), [scoredSteps]);
  const hazardClasses = useMemo(() => scoredSteps.map((s) => s.hazard_class), [scoredSteps]);
  const hoverLabels = useMemo(() => hazardClasses.map((h) => SUITABILITY_HAZARD_LABELS[h] ?? 'Unknown'), [hazardClasses]);

  // Line only, no per-point markers — a marker on every observation (the
  // previous mode: 'lines+markers') reads as a dense row of dots for a
  // 72h/hourly series. hovertemplate still works on hover with mode:
  // 'lines' (Plotly snaps to the nearest point along the line), so this
  // loses no information, just the visual clutter.
  const trace = useMemo(() => ({
    type: 'scatter',
    x: times,
    y: hazardClasses,
    mode: 'lines',
    line: { shape: 'hv', color: isDarkMode ? 'rgba(226,232,240,0.78)' : 'rgba(15,23,42,0.62)', width: 2.4 },
    customdata: hoverLabels,
    hovertemplate: '<b>%{x|%b %d %H:%M UTC}</b><br>%{customdata}<extra></extra>',
  }), [times, hazardClasses, hoverLabels, isDarkMode]);

  // nowStep/nowDriver for the header badge + metric cards now live in
  // LandingAreaDetailsPanel (the parent) — this component only needs
  // nowStep itself, to position the selected-time marker trace below.
  const nowStep = useMemo(() => closestStep(steps, currentSliderDate), [steps, currentSliderDate]);

  // Selected-time marker — the one point on the whole series worth calling
  // out. A separate trace (not part of the line trace's markers) since it's
  // one highlighted point, not per-observation clutter.
  const selectedTrace = useMemo(() => {
    if (!nowStep || !Number.isFinite(nowStep.hazard_class)) return null;
    return {
      type: 'scatter',
      x: [new Date(nowStep.valid_time)],
      y: [nowStep.hazard_class],
      mode: 'markers',
      marker: {
        size: 13,
        color: CHART_HAZARD_COLORS[nowStep.hazard_class] ?? '#94a3b8',
        line: { color: isDarkMode ? '#f8fafc' : '#0f172a', width: 2.6 },
      },
      hoverinfo: 'skip',
      showlegend: false,
    };
  }, [nowStep, isDarkMode]);

  // Background hazard bands, one filled rect per class across the full x-range.
  const bandShapes = useMemo(() => {
    if (!times.length) return [];
    const x0 = times[0];
    const x1 = times[times.length - 1];
    const alphas = isDarkMode ? CHART_BAND_ALPHA_DARK : CHART_BAND_ALPHA_LIGHT;
    return [0, 1, 2].map((h) => ({
      type: 'rect', xref: 'x', yref: 'y',
      x0, x1, y0: h - 0.5, y1: h + 0.5,
      fillcolor: hexToRgba(CHART_HAZARD_COLORS[h], alphas[h]),
      line: { width: 0 },
      layer: 'below',
    }));
  }, [times, isDarkMode]);

  const nowShape = useMemo(() => {
    if (!currentSliderDate || !times.length) return null;
    const t = new Date(currentSliderDate);
    return {
      type: 'line', xref: 'x', yref: 'paper',
      x0: t, x1: t, y0: 0, y1: 1,
      line: { color: isDarkMode ? 'rgba(248,250,252,0.58)' : 'rgba(15,23,42,0.32)', width: 1.6, dash: 'dashdot' },
    };
  }, [currentSliderDate, times, isDarkMode]);

  const grid = isDarkMode ? 'rgba(203,213,225,0.09)' : 'rgba(15,23,42,0.07)';
  const tick = isDarkMode ? '#a8b5c7' : '#64748b';
  const muted = isDarkMode ? '#94a3b8' : '#64748b';

  if (!steps?.length) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 2rem', color: isDarkMode ? '#475569' : '#94a3b8', fontSize: 14 }}>
        No suitability data at this landing area.
      </div>
    );
  }

  if (!scoredSteps.length) {
    return (
      <div className="landing-area-timeseries">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: isDarkMode ? '#f1f5f9' : '#0f172a' }}>
              Landing suitability unavailable
            </div>
            <div style={{ fontSize: '0.72rem', color: muted, marginTop: 1 }}>
              {vesselLabel ? `Forecast for ${vesselLabel}` : 'Forecast'}
            </div>
          </div>
        </div>
        <div style={{
          border: `1px solid ${isDarkMode ? 'rgba(148,163,184,0.18)' : 'rgba(100,116,139,0.18)'}`,
          background: isDarkMode ? 'rgba(15,23,42,0.52)' : 'rgba(241,245,249,0.72)',
          borderRadius: 12,
          padding: '1rem 1.2rem',
          color: muted,
          fontSize: 13,
          lineHeight: 1.55,
        }}>
          This landing point has no scored suitability samples in the current deployment. It may be on land, outside the marine mesh, or too far from a valid model cell.
        </div>
      </div>
    );
  }

  return (
    <div className="landing-area-timeseries">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: isDarkMode ? '#f1f5f9' : '#0f172a' }}>
            72-hour landing suitability
          </div>
          <div style={{ fontSize: '0.72rem', color: muted, marginTop: 1 }}>
            {vesselLabel ? `Forecast for ${vesselLabel}` : 'Forecast'}
          </div>
        </div>
        <div className="landing-area-timeseries__controls" style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button type="button" className="inundation-timeseries__export-btn" onClick={handleExportPNG} title="Download chart as PNG">
            <Download size={12} strokeWidth={2} />PNG
          </button>
          <button type="button" className="inundation-timeseries__export-btn" onClick={handlePrintChart} title="Print this chart (or save as PDF from the print dialog)">
            <Printer size={12} strokeWidth={2} />Print chart
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.68rem', color: muted, marginBottom: 6 }}>
        {[0, 1, 2].map((h) => (
          <span key={h} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: CHART_HAZARD_COLORS[h], display: 'inline-block' }} />
            {SUITABILITY_HAZARD_LABELS[h]}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', border: `2px solid ${muted}`, display: 'inline-block', boxSizing: 'border-box' }} />
          Selected time
        </span>
      </div>

      <div className="landing-area-timeseries__chart" ref={chartRef} style={{ height: 'clamp(260px, 38vh, 360px)' }}>
        <Plot
          data={selectedTrace ? [trace, selectedTrace] : [trace]}
          layout={{
            autosize: true,
            height: plotHeight,
            margin: { l: 70, r: 18, t: 8, b: 36 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: isDarkMode ? 'rgba(8,14,30,0.20)' : 'rgba(248,250,252,0.55)',
            xaxis: {
              tickfont: { color: tick, size: 10.5, family: 'Inter, system-ui, sans-serif' },
              gridcolor: grid, linecolor: 'transparent', zerolinecolor: 'transparent',
              tickformat: '%b %d\n%H:%M', type: 'date', showgrid: true,
              ticks: 'outside', ticklen: 4, tickcolor: 'transparent',
            },
            yaxis: {
              tickvals: [0, 1, 2],
              ticktext: [SUITABILITY_HAZARD_LABELS[0], SUITABILITY_HAZARD_LABELS[1], SUITABILITY_HAZARD_LABELS[2]],
              range: [-0.5, 2.5],
              tickfont: { color: tick, size: 10.5, family: 'Inter, system-ui, sans-serif' },
              gridcolor: grid, linecolor: 'transparent', zerolinecolor: 'transparent',
              ticks: 'outside', ticklen: 4, tickcolor: 'transparent',
            },
            showlegend: false,
            dragmode: false,
            shapes: [...bandShapes, ...(nowShape ? [nowShape] : [])],
            hoverlabel: {
              bgcolor: isDarkMode ? '#1e293b' : '#ffffff',
              bordercolor: isDarkMode ? '#334155' : '#e2e8f0',
              font: { color: isDarkMode ? '#f1f5f9' : '#0f172a', size: 12, family: 'Inter, system-ui, sans-serif' },
            },
            hovermode: 'closest',
          }}
          config={{ displayModeBar: false, responsive: true, doubleClick: false, scrollZoom: false }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
          onInitialized={(fig, div) => { plotlyDivRef.current = div; schedulePlotResize(); }}
          onUpdate={(fig, div) => { plotlyDivRef.current = div; }}
        />
      </div>
    </div>
  );
}

export default LandingAreaTimeseries;
