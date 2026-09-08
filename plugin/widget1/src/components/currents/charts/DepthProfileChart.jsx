import { useEffect, useRef, useState } from 'react';
import { Chart, LineController, LineElement, PointElement, LinearScale, Tooltip, Legend } from 'chart.js';
import { loadDepthLevels, loadProfileAtPoint } from '../../../lib/crocoPointData';

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend);

// Re-fetches on every playback tick (timeIndex changes ~every 700ms during
// animation) — debounce so a full profile fetch doesn't fire on every frame.
const DEBOUNCE_MS = 600;

export default function DepthProfileChart({
  lat, lon, timeIndex, datasetName, zarrBaseUrl,
  variable = 'temperature', label = 'Temp (°C)', showUV = false,
  isDarkMode = false,
}) {
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
        loadProfileAtPoint(datasetName, showUV ? 'u' : variable, { timeIndex, lon, lat }, zarrBaseUrl),
        showUV ? loadProfileAtPoint(datasetName, 'v', { timeIndex, lon, lat }, zarrBaseUrl) : Promise.resolve(null),
      ])
        .then(([depths, primary, secondary]) => {
          if (cancelled) return;
          const merged = depths
            .map((d, i) => ({ depth: d, value: primary[i], value2: secondary ? secondary[i] : undefined }))
            .filter((p) => Number.isFinite(p.value))
            .sort((a, b) => a.depth - b.depth);
          setPoints(merged);
          setError(null);
        })
        .catch((err) => { if (!cancelled) setError(err.message); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [lat, lon, timeIndex, datasetName, zarrBaseUrl, variable, showUV]);

  useEffect(() => {
    if (!canvasRef.current || !points?.length) return undefined;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    const gridColor = isDarkMode ? 'rgba(148, 163, 184, 0.15)' : 'rgba(100, 116, 139, 0.12)';
    const tickColor = isDarkMode ? '#cbd5e1' : '#475569';

    chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          {
            label: showUV ? 'U (m/s)' : label,
            data: points.map((p) => ({ x: p.value, y: p.depth })),
            borderColor: '#ef4444',
            backgroundColor: '#ef4444',
            pointRadius: 3,
            borderWidth: 2,
            showLine: true,
          },
          ...(showUV ? [{
            label: 'V (m/s)',
            data: points.map((p) => ({ x: p.value2, y: p.depth })),
            borderColor: '#60a5fa',
            backgroundColor: '#60a5fa',
            pointRadius: 3,
            borderWidth: 2,
            showLine: true,
          }] : []),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: showUV ? 'Velocity (m/s)' : label, color: tickColor, font: { size: 10 } },
            ticks: { color: tickColor, font: { size: 10 } },
            grid: { color: gridColor },
          },
          y: {
            type: 'linear',
            reverse: true,
            title: { display: true, text: 'Depth (m)', color: tickColor, font: { size: 10 } },
            ticks: { color: tickColor, font: { size: 10 } },
            grid: { color: gridColor },
          },
        },
        plugins: {
          legend: { display: showUV, labels: { color: tickColor, font: { size: 10 }, boxWidth: 10, boxHeight: 10 } },
          tooltip: {
            callbacks: {
              title: (items) => `${items[0]?.raw?.y ?? ''} m`,
              label: (item) => `${item.dataset.label}: ${item.raw.x?.toFixed(3)}`,
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
  if (!points?.length) return <div className="currents-chart-empty">No profile data</div>;

  return (
    <div className="currents-chart-shell">
      <canvas ref={canvasRef} />
    </div>
  );
}
