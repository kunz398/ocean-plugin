import { useEffect, useRef, useState } from 'react';
import { Chart, ScatterController, PointElement, LinearScale, Tooltip } from 'chart.js';
import { loadDepthLevels, loadProfileAtPoint } from '../../../lib/crocoPointData';

Chart.register(ScatterController, PointElement, LinearScale, Tooltip);

const DEBOUNCE_MS = 600;

// Known water masses expected around Niue and their T-S signatures — ported
// from niu_current's TSDiagram.tsx.
const WATER_MASSES = [
  { key: 'SPTW', x: 35.6, y: 24, position: 'top' },
  { key: 'SPEW', x: 35.2, y: 21, position: 'top' },
  { key: 'AAIW', x: 34.4, y: 5, position: 'right' },
  { key: 'SAMW', x: 34.5, y: 8, position: 'top' },
  { key: 'PDW', x: 34.6, y: 2, position: 'left' },
  { key: 'LCDW', x: 34.7, y: 1.5, position: 'right' },
];

const WATER_MASS_NAMES = {
  SPTW: 'South Pacific Tropical Water',
  SPEW: 'South Pacific Eastern Water',
  AAIW: 'Antarctic Intermediate Water',
  SAMW: 'Subantarctic Mode Water',
  PDW: 'Pacific Deep Water',
  LCDW: 'Lower Circumpolar Deep Water',
};

const DEPTH_COLOR_MAP = {
  '-5': '#ef4444', '-10': '#f97316', '-20': '#eab308', '-30': '#22c55e',
  '-50': '#14b8a6', '-100': '#3b82f6', '-300': '#8b5cf6', '-500': '#ec4899', '-1000': '#94a3b8',
};
function depthColor(depth) { return DEPTH_COLOR_MAP[String(Math.round(depth))] ?? '#94a3b8'; }

function waterMassLabelsPlugin(labelColor) {
  return {
    id: 'waterMassLabels',
    afterDatasetsDraw(chart) {
      const { ctx, scales } = chart;
      const meta = chart.getDatasetMeta(1);
      if (!meta || meta.hidden) return;
      ctx.save();
      ctx.font = '10px sans-serif';
      ctx.fillStyle = labelColor;
      WATER_MASSES.forEach((wm) => {
        const x = scales.x.getPixelForValue(wm.x);
        const y = scales.y.getPixelForValue(wm.y);
        const [dx, dy, align] = wm.position === 'top' ? [0, -10, 'center']
          : wm.position === 'left' ? [-8, 3, 'right']
          : wm.position === 'right' ? [8, 3, 'left']
          : [0, 16, 'center'];
        ctx.textAlign = align;
        ctx.fillText(wm.key, x + dx, y + dy);
      });
      ctx.restore();
    },
  };
}

export default function TSDiagramChart({ lat, lon, timeIndex, datasetName, zarrBaseUrl, isDarkMode = false }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [points, setPoints] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (lat == null || lon == null || timeIndex == null) return undefined;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      Promise.all([
        loadDepthLevels(datasetName, zarrBaseUrl),
        loadProfileAtPoint(datasetName, 'temperature', { timeIndex, lon, lat }, zarrBaseUrl),
        loadProfileAtPoint(datasetName, 'salinity', { timeIndex, lon, lat }, zarrBaseUrl),
      ])
        .then(([depths, temperature, salinity]) => {
          if (cancelled) return;
          const merged = depths
            .map((d, i) => ({ depth: d, temperature: temperature[i], salinity: salinity[i] }))
            .filter((p) => Number.isFinite(p.temperature) && Number.isFinite(p.salinity));
          setPoints(merged);
          setError(null);
        })
        .catch((err) => { if (!cancelled) setError(err.message); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [lat, lon, timeIndex, datasetName, zarrBaseUrl]);

  useEffect(() => {
    if (!canvasRef.current || !points?.length) return undefined;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    const gridColor = isDarkMode ? 'rgba(148, 163, 184, 0.15)' : 'rgba(100, 116, 139, 0.12)';
    const tickColor = isDarkMode ? '#cbd5e1' : '#475569';
    const labelColor = isDarkMode ? '#cbd5e1' : '#334155';

    chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
      type: 'scatter',
      plugins: [waterMassLabelsPlugin(labelColor)],
      data: {
        datasets: [
          {
            label: 'Water column',
            data: points.map((p) => ({ x: p.salinity, y: p.temperature, depth: p.depth })),
            pointBackgroundColor: points.map((p) => depthColor(p.depth)),
            pointBorderColor: points.map((p) => depthColor(p.depth)),
            pointRadius: 5,
            showLine: false,
          },
          {
            label: 'Water masses',
            data: WATER_MASSES.map((wm) => ({ x: wm.x, y: wm.y })),
            pointBackgroundColor: isDarkMode ? '#0b1220' : '#f8fafc',
            pointBorderColor: labelColor,
            pointBorderWidth: 1.5,
            pointRadius: 4,
            showLine: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        scales: {
          x: {
            type: 'linear',
            min: 34, max: 37,
            title: { display: true, text: 'Salinity (PSU)', color: tickColor, font: { size: 10 } },
            ticks: { color: tickColor, font: { size: 10 } },
            grid: { color: gridColor },
          },
          y: {
            type: 'linear',
            min: 0, max: 32,
            title: { display: true, text: 'Temp (°C)', color: tickColor, font: { size: 10 } },
            ticks: { color: tickColor, font: { size: 10 } },
            grid: { color: gridColor },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item) => item.datasetIndex === 0,
            callbacks: {
              title: (items) => `Depth: ${items[0]?.raw?.depth ?? ''} m`,
              label: (item) => [`Temp: ${item.raw.y.toFixed(2)} °C`, `Salinity: ${item.raw.x.toFixed(2)} PSU`],
            },
          },
        },
      },
    });

    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [points, isDarkMode]);

  if (lat == null || lon == null) {
    return <div className="currents-chart-empty">Click the map to inspect a point</div>;
  }
  if (loading) return <div className="currents-chart-empty">Loading…</div>;
  if (error) return <div className="currents-chart-empty">{error}</div>;
  if (!points?.length) return <div className="currents-chart-empty">No T-S data</div>;

  return (
    <div className="currents-chart-shell currents-chart-shell--ts">
      <canvas ref={canvasRef} />
      <div className="currents-ts-glossary">
        {WATER_MASSES.map((wm, i) => (
          <span key={wm.key} title={WATER_MASS_NAMES[wm.key]}>
            {wm.key}{i < WATER_MASSES.length - 1 ? ', ' : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
