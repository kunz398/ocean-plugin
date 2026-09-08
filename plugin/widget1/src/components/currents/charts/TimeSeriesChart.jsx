import { useEffect, useRef, useState } from 'react';
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend } from 'chart.js';
import { loadDepthLevels, loadTimeSteps, loadTimeSeriesAtPoint, findNearestIndex } from '../../../lib/crocoPointData';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);

function formatLabel(iso, firstIso) {
  const diffH = Math.round((new Date(iso).getTime() - new Date(firstIso).getTime()) / 3_600_000);
  return `T+${diffH}h`;
}

export default function TimeSeriesChart({
  lat, lon, depth, datasetName, zarrBaseUrl,
  variable = 'temperature', label = 'Temp (°C)', showUV = false,
  isDarkMode = false,
}) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [points, setPoints] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (lat == null || lon == null || depth == null) return undefined;
    let cancelled = false;
    setLoading(true);

    Promise.all([loadDepthLevels(datasetName, zarrBaseUrl), loadTimeSteps(datasetName, zarrBaseUrl)])
      .then(([depths, times]) => {
        const depthIndex = findNearestIndex(depths, depth);
        const firstTime = times[0];
        const fetchVar = (v) => loadTimeSeriesAtPoint(datasetName, v, { depthIndex, lon, lat }, zarrBaseUrl);
        return Promise.all([fetchVar(showUV ? 'u' : variable), showUV ? fetchVar('v') : Promise.resolve(null)])
          .then(([primary, secondary]) => {
            if (cancelled) return;
            const merged = times.map((t, i) => ({
              label: formatLabel(t, firstTime),
              value: primary[i],
              value2: secondary ? secondary[i] : undefined,
            }));
            setPoints(merged);
            setError(null);
          });
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [lat, lon, depth, datasetName, zarrBaseUrl, variable, showUV]);

  useEffect(() => {
    if (!canvasRef.current || !points?.length) return undefined;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    const gridColor = isDarkMode ? 'rgba(148, 163, 184, 0.15)' : 'rgba(100, 116, 139, 0.12)';
    const tickColor = isDarkMode ? '#cbd5e1' : '#475569';

    chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
      type: 'line',
      data: {
        labels: points.map((p) => p.label),
        datasets: [
          {
            label: showUV ? 'U (m/s)' : label,
            data: points.map((p) => p.value),
            borderColor: '#ef4444',
            backgroundColor: '#ef4444',
            pointRadius: 0,
            borderWidth: 2,
            tension: 0.2,
          },
          ...(showUV ? [{
            label: 'V (m/s)',
            data: points.map((p) => p.value2),
            borderColor: '#60a5fa',
            backgroundColor: '#60a5fa',
            pointRadius: 0,
            borderWidth: 2,
            tension: 0.2,
          }] : []),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        scales: {
          x: {
            title: { display: true, text: 'Forecast time', color: tickColor, font: { size: 10 } },
            ticks: { color: tickColor, font: { size: 10 }, maxTicksLimit: 8, autoSkip: true },
            grid: { color: gridColor },
          },
          y: {
            title: { display: true, text: showUV ? 'Velocity (m/s)' : label, color: tickColor, font: { size: 10 } },
            ticks: { color: tickColor, font: { size: 10 } },
            grid: { color: gridColor },
          },
        },
        plugins: {
          legend: { display: showUV, labels: { color: tickColor, font: { size: 10 }, boxWidth: 10, boxHeight: 10 } },
          tooltip: {
            callbacks: {
              label: (item) => `${item.dataset.label}: ${item.raw?.toFixed?.(2) ?? item.raw}`,
            },
          },
        },
      },
    });

    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [points, showUV, label, isDarkMode]);

  if (lat == null || lon == null) {
    return <div className="currents-chart-empty">Click the map to inspect a point</div>;
  }
  if (loading) return <div className="currents-chart-empty">Loading…</div>;
  if (error) return <div className="currents-chart-empty">{error}</div>;
  if (!points?.length) return <div className="currents-chart-empty">No time series data</div>;

  return (
    <div className="currents-chart-shell">
      <canvas ref={canvasRef} />
    </div>
  );
}
