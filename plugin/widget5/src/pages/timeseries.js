import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Plot from 'react-plotly.js';
import { formatZoned, tzLabel } from "../utils/timeZoneFormat";

const TRACE_CONFIG = [
  { key: "hs",    label: "Wave Height", color: 'rgb(56,189,248)',  unit: 'm', yaxis: 'y',  mode: 'lines+markers' },
  { key: "tm02",  label: "Mean Period", color: 'rgb(34,197,94)',   unit: 's', yaxis: 'y2', mode: 'lines+markers' },
  { key: "tpeak", label: "Peak Period", color: 'rgb(251,146,60)',  unit: 's', yaxis: 'y2', mode: 'lines+markers' },
  { key: "dirm",  label: "Mean Wave Dir", color: 'rgb(167,139,250)', unit: '°', yaxis: 'y3', mode: 'markers' },
  { key: "dirp",  label: "Wave Dir",    color: 'rgb(167,139,250)', unit: '°', yaxis: 'y3', mode: 'markers' },
];

function extractTimeseries(json, variable) {
  if (!json?.domain?.axes?.t?.values || !json?.ranges?.[variable]?.values) return null;
  return {
    times: json.domain.axes.t.values.map(v => new Date(v)),
    values: json.ranges[variable].values,
  };
}

function closestIndex(times, targetDate) {
  if (!targetDate || !times?.length) return -1;
  const target = new Date(targetDate).getTime();
  let best = 0, bestDiff = Infinity;
  times.forEach((t, i) => {
    const diff = Math.abs(t.getTime() - target);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  });
  return best;
}

function StatBadge({ label, value, unit, color, isDarkMode }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
      padding: '5px 12px', borderRadius: 8, minWidth: 80,
      background: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
      borderLeft: `3px solid ${color}`,
    }}>
      <span style={{
        fontSize: 9, letterSpacing: '0.07em', textTransform: 'uppercase',
        color, fontWeight: 700, marginBottom: 1,
      }}>
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 800, color: isDarkMode ? '#f1f5f9' : '#0f172a', lineHeight: 1.1 }}>
        {value !== null ? value : '—'}
        <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, color: isDarkMode ? '#94a3b8' : '#64748b' }}>
          {unit}
        </span>
      </span>
    </div>
  );
}

function Timeseries({ perVariableData, currentSliderDate, onTimeSelect, timeDisplayZone = 'Pacific/Rarotonga' }) {
  const [plotData, setPlotData] = useState([]);
  const [error, setError] = useState("");
  const [parentHeight, setParentHeight] = useState(undefined);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const rawTimes = useRef([]);
  const onTimeSelectRef = useRef(onTimeSelect);
  onTimeSelectRef.current = onTimeSelect;

  useEffect(() => {
    const check = () => setIsDarkMode(document.body.classList.contains('dark-mode'));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = document.querySelector('.offcanvas-body');
    if (!el) return;
    setParentHeight(el.clientHeight - 36);
    const obs = new ResizeObserver(() => setParentHeight(el.clientHeight - 36));
    obs.observe(el);
    return () => obs.disconnect();
  }, [perVariableData]);

  useEffect(() => {
    if (!perVariableData) { setPlotData([]); setError("No timeseries data available."); return; }

    const traces = [];
    rawTimes.current = [];

    for (const cfg of TRACE_CONFIG) {
      const ts = extractTimeseries(perVariableData[cfg.key], cfg.key);
      if (!ts) continue;
      if (!rawTimes.current.length) rawTimes.current = ts.times;
      traces.push({
        x: ts.times,
        y: ts.values,
        name: cfg.label,
        type: 'scatter',
        mode: cfg.mode,
        marker: { color: cfg.color, size: 4 },
        line: { color: cfg.color, width: 2 },
        yaxis: cfg.yaxis,
        hovertemplate: `<b>%{y:.1f} ${cfg.unit}</b><extra>${cfg.label}</extra>`,
      });
    }

    setPlotData(traces);
    if (traces.length === 0) console.error('[timeseries] No timeseries data returned for', perVariableData);
    setError(traces.length === 0 ? "No timeseries data returned." : "");
  }, [perVariableData]);

  // Index of the closest timestep to the current map slider position
  const nowIdx = useMemo(
    () => closestIndex(rawTimes.current, currentSliderDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentSliderDate, plotData]
  );
  const nowTime = rawTimes.current[nowIdx] ?? null;

  // Live values at the current slider position
  const nowValues = useMemo(() => {
    if (nowIdx < 0 || !plotData.length) return {};
    return Object.fromEntries(
      TRACE_CONFIG.map(cfg => {
        const trace = plotData.find(t => t.name === cfg.label);
        return [cfg.key, trace ? (trace.y[nowIdx] ?? null) : null];
      })
    );
  }, [nowIdx, plotData]);

  // Vertical "now" line + timestamp annotation
  const { nowShape, nowAnnotation } = useMemo(() => {
    if (!nowTime || !plotData.length) return {};
    const lineColor = isDarkMode ? 'rgba(255,255,255,0.30)' : 'rgba(15,23,42,0.22)';
    const accentColor = isDarkMode ? '#60a5fa' : '#3b82f6';
    const label = formatZoned(nowTime, timeDisplayZone, { withLabel: false, year: undefined, month: 'short', day: 'numeric' });
    return {
      nowShape: {
        type: 'line', xref: 'x', yref: 'paper',
        x0: nowTime, x1: nowTime, y0: 0, y1: 1,
        line: { color: lineColor, width: 1.5, dash: 'dashdot' },
      },
      nowAnnotation: {
        x: nowTime, y: 1, xref: 'x', yref: 'paper',
        text: `<b>${label} ${tzLabel(timeDisplayZone)}</b>`,
        showarrow: true, arrowhead: 0,
        arrowcolor: accentColor,
        ax: 0, ay: -24,
        font: { size: 9, color: accentColor, family: 'Inter, system-ui, sans-serif' },
        bgcolor: isDarkMode ? 'rgba(18,20,26,0.9)' : 'rgba(255,255,255,0.9)',
        borderpad: 3, bordercolor: accentColor, borderwidth: 1,
      },
    };
  }, [nowTime, plotData, isDarkMode, timeDisplayZone]);

  // Plotly div + click handler refs — imperative attachment survives layout updates
  const plotlyDivRef = useRef(null);
  const plotlyClickHandlerRef = useRef(null);

  const attachClickHandler = useCallback((graphDiv) => {
    if (!graphDiv) return;
    // Remove any previous handler first to avoid duplicates
    if (plotlyDivRef.current && plotlyClickHandlerRef.current) {
      try { plotlyDivRef.current.removeListener('plotly_click', plotlyClickHandlerRef.current); } catch {}
    }
    plotlyDivRef.current = graphDiv;
    const handler = (data) => {
      const ptIdx = data.points?.[0]?.pointIndex;
      const t = rawTimes.current[ptIdx];
      if (t == null || !onTimeSelectRef.current) return;
      // Use the original Date object — avoids Plotly's "YYYY-MM-DD HH:mm:ss" local-time parse
      onTimeSelectRef.current(t);
    };
    plotlyClickHandlerRef.current = handler;
    graphDiv.on('plotly_click', handler);
  }, []);

  if (!perVariableData) return <div>No data available.</div>;
  if (error || plotData.length === 0) return <div>No timeseries data.</div>;

  const grid = isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const tick = { color: isDarkMode ? '#475569' : '#94a3b8', size: 10, family: 'Inter, system-ui, sans-serif' };
  const axisTitle = { color: isDarkMode ? '#64748b' : '#94a3b8', size: 10.5 };

  const BADGE_HEIGHT = nowTime ? 58 : 0;
  const chartHeight = parentHeight ? Math.max(180, parentHeight - BADGE_HEIGHT) : 340;

  const layout = {
    autosize: true,
    height: chartHeight,
    margin: { t: 18, l: 52, r: 90, b: 50 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Inter, system-ui, sans-serif', color: isDarkMode ? '#94a3b8' : '#64748b' },
    hovermode: 'x unified',
    hoverlabel: {
      bgcolor: isDarkMode ? '#1e293b' : '#ffffff',
      bordercolor: isDarkMode ? '#334155' : '#e2e8f0',
      font: { color: isDarkMode ? '#f1f5f9' : '#0f172a', size: 12, family: 'Inter, system-ui, sans-serif' },
      align: 'left',
    },
    legend: {
      orientation: 'h', y: -0.22,
      font: { color: isDarkMode ? '#cbd5e1' : '#334155', size: 11 },
      bgcolor: 'rgba(0,0,0,0)',
    },
    xaxis: {
      type: 'date',
      tickformat: '%b %d\n%H:%M',
      tickangle: 0,
      showgrid: true,
      gridcolor: grid,
      tickfont: tick,
      linecolor: 'transparent',
      zerolinecolor: 'transparent',
      // Vertical crosshair spike line
      showspikes: true,
      spikemode: 'across',
      spikedash: 'solid',
      spikethickness: 1,
      spikecolor: isDarkMode ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.14)',
    },
    yaxis: {
      title: { text: 'Height (m)', font: axisTitle, standoff: 8 },
      side: 'left', showgrid: true, gridcolor: grid,
      tickfont: tick, linecolor: 'transparent', zerolinecolor: grid,
    },
    yaxis2: {
      title: { text: 'Period (s)', font: axisTitle, standoff: 8 },
      overlaying: 'y', side: 'right', showgrid: false, tickfont: tick,
    },
    yaxis3: {
      title: { text: 'Dir (°)', font: axisTitle, standoff: 6 },
      overlaying: 'y', side: 'right', position: 1, showgrid: false, tickfont: tick,
    },
    showlegend: true,
    clickmode: 'event',
    shapes: nowShape ? [nowShape] : [],
    annotations: nowAnnotation ? [nowAnnotation] : [],
  };

  return (
    <div style={{ width: '100%', height: parentHeight ? `${parentHeight}px` : '100%', display: 'flex', flexDirection: 'column' }}>

      {/* Live stat badges at the current map slider time */}
      {nowTime && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px 4px', flexWrap: 'wrap' }}>
          {TRACE_CONFIG.filter(cfg => cfg.key !== 'dirp' && cfg.key !== 'dirm').map(cfg => (
            <StatBadge
              key={cfg.key}
              label={cfg.label}
              value={nowValues[cfg.key] != null ? parseFloat(nowValues[cfg.key]).toFixed(1) : null}
              unit={cfg.unit}
              color={cfg.color}
              isDarkMode={isDarkMode}
            />
          ))}
          {onTimeSelect && (
            <span style={{
              marginLeft: 'auto', fontSize: 10, fontStyle: 'italic',
              color: isDarkMode ? '#64748b' : '#94a3b8',
            }}>
              Click chart to jump slider
            </span>
          )}
        </div>
      )}

      <Plot
        data={plotData}
        layout={layout}
        useResizeHandler
        style={{ width: '100%', flex: 1, cursor: onTimeSelect ? 'pointer' : 'crosshair' }}
        config={{
          responsive: true,
          displayModeBar: false,
          // Disable double-click autorange so rapid clicks all fire plotly_click
          doubleClick: false,
        }}
        onInitialized={(_figure, graphDiv) => attachClickHandler(graphDiv)}
        onUpdate={(_figure, graphDiv) => attachClickHandler(graphDiv)}
      />
    </div>
  );
}

export default Timeseries;
