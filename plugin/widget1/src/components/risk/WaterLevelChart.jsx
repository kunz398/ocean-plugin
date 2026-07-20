import React, { useEffect, useMemo, useRef } from 'react';
import {
  Chart,
  CategoryScale,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip
} from 'chart.js';

Chart.register(
  CategoryScale,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip
);

const formatTickLabel = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

const buildAnnotationPlugin = ({ thresholds, nowIndexRef, selectedIndexRef, isDarkMode }) => ({
  id: 'riskThresholdAnnotations',
  afterDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    const yScale = scales.y;
    const xScale = scales.x;

    if (!chartArea || !yScale || !xScale) {
      return;
    }

    const nowIndex = nowIndexRef.current;

    const thresholdConfigs = [
      {
        index: 0,
        label: 'Minor flood',
        color: 'rgb(222, 222, 95)'
      },
      {
        index: 1,
        label: 'Moderate flood',
        color: 'rgb(255, 105, 41)'
      }
    ];

    ctx.save();
    ctx.font = '12px Arial';

    thresholdConfigs.forEach(({ index, label, color }) => {
      const value = thresholds[index];
      if (!Number.isFinite(value)) {
        return;
      }

      const y = yScale.getPixelForValue(value);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.fillText(`${label} (${value.toFixed(2)}m)`, chartArea.left + 6, y - 6);
    });

    if (Number.isInteger(nowIndex) && nowIndex >= 0) {
      const x = xScale.getPixelForValue(nowIndex);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.lineWidth = 2;
      ctx.strokeStyle = isDarkMode ? '#cbd5e1' : '#64748b';
      ctx.stroke();

      ctx.fillStyle = isDarkMode ? '#e2e8f0' : '#475569';
      ctx.font = 'bold 12px Arial';
      ctx.fillText('Now', x + 6, chartArea.top + 16);
    }

    const selIndex = selectedIndexRef.current;
    if (Number.isInteger(selIndex) && selIndex >= 0 && selIndex !== nowIndex) {
      const x = xScale.getPixelForValue(selIndex);
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#38bdf8';
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 11px Arial';
      ctx.fillText('Selected', x + 4, chartArea.top + 32);
    }

    ctx.restore();
  }
});

function WaterLevelChart({
  timestamps = [],
  totalWaterLevel = [],
  tideLevel = [],
  surgeLevel = [],
  thresholds = [],
  now = new Date(),
  selectedIndex = null,
  isDarkMode = false,
  onTimeSelect
}) {
  const canvasRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const onTimeSelectRef = useRef(onTimeSelect);
  onTimeSelectRef.current = onTimeSelect;
  const selectedIndexRef = useRef(selectedIndex);

  const chartData = useMemo(() => {
    if (!timestamps.length || !totalWaterLevel.length) {
      return null;
    }

    const labels = timestamps.map(formatTickLabel);
    const oceanWaterLevel = timestamps.map((timestamp, index) => ({
      timestamp,
      value: (Number(tideLevel[index]) || 0) + (Number(surgeLevel[index]) || 0)
    }));
    const astronomicalTide = timestamps.map((timestamp, index) => ({
      timestamp,
      value: Number(tideLevel[index]) || 0
    }));
    const twl = timestamps.map((timestamp, index) => ({
      timestamp,
      value: Number(totalWaterLevel[index]) || 0
    }));

    return {
      labels,
      // Keep raw ISO strings for date math — labels are localized display strings
      // that cannot be reliably re-parsed with new Date()
      rawTimestamps: timestamps,
      twl,
      oceanWaterLevel,
      astronomicalTide
    };
  }, [timestamps, totalWaterLevel, tideLevel, surgeLevel]);

  const nowIndex = useMemo(() => {
    if (!chartData) return -1;
    const nowTime = new Date(now).getTime();
    let best = -1;
    let smallestDiff = Number.POSITIVE_INFINITY;
    chartData.rawTimestamps.forEach((ts, index) => {
      const diff = Math.abs(new Date(ts).getTime() - nowTime);
      if (diff < smallestDiff) { smallestDiff = diff; best = index; }
    });
    return best;
  }, [chartData, now]);

  const nowIndexRef = useRef(nowIndex);

  useEffect(() => {
    nowIndexRef.current = nowIndex;
    if (chartInstanceRef.current) {
      chartInstanceRef.current.update('none');
    }
  }, [nowIndex]);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
    if (chartInstanceRef.current) {
      chartInstanceRef.current.update('none');
    }
  }, [selectedIndex]);

  useEffect(() => {
    if (!canvasRef.current || !chartData) {
      return undefined;
    }

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }

    const numericValues = [
      ...chartData.twl.map((entry) => entry.value),
      ...chartData.oceanWaterLevel.map((entry) => entry.value),
      ...chartData.astronomicalTide.map((entry) => entry.value),
      ...thresholds.filter((value) => Number.isFinite(value))
    ];
    const yMin = Math.min(...numericValues) - 0.3;
    const yMax = Math.max(...numericValues) + 0.3;

    chartInstanceRef.current = new Chart(canvasRef.current.getContext('2d'), {
      type: 'line',
      plugins: [buildAnnotationPlugin({ thresholds, nowIndexRef, selectedIndexRef, isDarkMode })],
      data: {
        labels: chartData.labels,
        datasets: [
          {
            label: 'Total water level',
            data: chartData.twl.map((entry) => entry.value),
            borderColor: 'rgba(100, 149, 237, 1)',
            backgroundColor: 'rgba(100, 149, 237, 0.25)',
            pointBackgroundColor: 'rgba(100, 149, 237, 1)',
            pointBorderColor: 'rgba(255, 255, 255, 0.9)',
            pointStyle: 'circle',
            borderWidth: 2,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.25
          },
          {
            label: 'Ocean water level',
            data: chartData.oceanWaterLevel.map((entry) => entry.value),
            borderColor: 'rgba(0, 206, 209, 1)',
            backgroundColor: 'rgba(0, 206, 209, 0.2)',
            pointBackgroundColor: 'rgba(0, 206, 209, 1)',
            pointBorderColor: 'rgba(255, 255, 255, 0.9)',
            pointStyle: 'circle',
            borderWidth: 2,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.25
          },
          {
            label: 'Astronomical tide',
            data: chartData.astronomicalTide.map((entry) => entry.value),
            borderColor: 'rgba(148, 163, 184, 1)',
            pointBackgroundColor: 'rgba(148, 163, 184, 1)',
            pointBorderColor: 'rgba(255, 255, 255, 0.9)',
            pointStyle: 'line',
            borderWidth: 2,
            borderDash: [6, 4],
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_event, elements, chart) => {
          if (!onTimeSelectRef.current) return;
          const idx = elements?.[0]?.index ?? chart?.tooltip?.dataPoints?.[0]?.dataIndex;
          if (idx == null) return;
          const ts = chartData.rawTimestamps[idx];
          if (ts) onTimeSelectRef.current(new Date(ts));
        },
        onHover: (event) => {
          if (onTimeSelectRef.current) event.native.target.style.cursor = 'pointer';
        },
        animation: {
          duration: 700,
          easing: 'easeOutQuart'
        },
        transitions: {
          active: {
            animation: {
              duration: 200
            }
          }
        },
        interaction: {
          mode: 'index',
          intersect: false
        },
        scales: {
          x: {
            ticks: {
              color: isDarkMode ? '#cbd5e1' : '#475569',
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 8
            },
            grid: {
              color: isDarkMode ? 'rgba(148, 163, 184, 0.15)' : 'rgba(100, 116, 139, 0.12)'
            }
          },
          y: {
            min: yMin,
            max: yMax,
            title: {
              display: true,
              text: 'Water Level (m)',
              color: isDarkMode ? '#e2e8f0' : '#334155'
            },
            ticks: {
              color: isDarkMode ? '#cbd5e1' : '#475569'
            },
            grid: {
              color: isDarkMode ? 'rgba(148, 163, 184, 0.15)' : 'rgba(100, 116, 139, 0.12)'
            }
          }
        },
        plugins: {
          legend: {
            labels: {
              color: isDarkMode ? '#e2e8f0' : '#334155',
              usePointStyle: true,
              boxWidth: 10,
              boxHeight: 10
            }
          },
          tooltip: {
            backgroundColor: isDarkMode ? 'rgba(15, 23, 42, 0.94)' : 'rgba(255, 255, 255, 0.96)',
            titleColor: isDarkMode ? '#f8fafc' : '#0f172a',
            bodyColor: isDarkMode ? '#e2e8f0' : '#1e293b',
            borderColor: isDarkMode ? '#334155' : '#cbd5e1',
            borderWidth: 1,
            usePointStyle: true
          }
        }
      }
    });

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [chartData, thresholds, isDarkMode]);

  if (!chartData) {
    return <div className="risk-chart-empty">No chart data available.</div>;
  }

  return (
    <div className="risk-chart-shell">
      <canvas ref={canvasRef} />
    </div>
  );
}

export default WaterLevelChart;
