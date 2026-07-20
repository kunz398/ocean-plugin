import React, { useEffect, useState } from "react";
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const fixedColors = [
  'rgb(255, 99, 132)',   // 0: hs
  'rgb(54, 162, 235)',   // 1: tpeak
  'rgb(255, 206, 86)',   // 2: dirp
  'rgb(75, 192, 192)',
  'rgb(153, 102, 255)',
];

function extractCoverageTimeseries(json, variable) {
  if (
    !json ||
    !json.domain ||
    !json.domain.axes ||
    !json.domain.axes.t ||
    !json.domain.axes.t.values ||
    !json.ranges ||
    !json.ranges[variable] ||
    !json.ranges[variable].values
  )
    return null;
  const rawTimes = json.domain.axes.t.values;
  const rawValues = json.ranges[variable].values;
  const times = Array.isArray(rawTimes) ? rawTimes : Array.from(rawTimes);
  const values = Array.isArray(rawValues) ? rawValues : Array.from(rawValues);
  return { times, values };
}

function Timeseries({ perVariableData }) {
  const [chartData, setChartData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!perVariableData) {
      setChartData(null);
      setError("No timeseries data available.");
      return;
    }

    try {
      const layers = perVariableData.depth
        ? [{ key: "depth", label: "Inundation Depth (m)", colorIdx: 1, yAxisID: 'y' }]
        : [
            { key: "hs", label: "Significant Wave Height (m)", colorIdx: 0, yAxisID: 'y' },
            { key: "tm02", label: "Mean Wave Period (s)", colorIdx: 1, yAxisID: 'y1' },
            { key: "tpeak", label: "Peak Wave Period (s)", colorIdx: 3, yAxisID: 'y1' },
            { key: "dirm", label: "Mean Wave Direction (°)", colorIdx: 2, yAxisID: 'y2' },
            { key: "dirp", label: "Peak Wave Direction (°)", colorIdx: 4, yAxisID: 'y2' },
          ];

      let labels = [];
      const datasets = [];

      for (let idx = 0; idx < layers.length; idx++) {
        const { key, label, colorIdx, yAxisID } = layers[idx];
        const color = fixedColors[colorIdx % fixedColors.length];
        const tsJson = perVariableData[key];
        const ts = extractCoverageTimeseries(tsJson, key);

        if (ts && Array.isArray(ts.times) && ts.times.length > 0 && Array.isArray(ts.values)) {
          if (labels.length === 0) {
            labels = ts.times.map(v =>
              typeof v === "string" && v.length > 15 ? v.substring(0, 16).replace("T", " ") : v
            );
          }
          datasets.push({
            label: label,
            data: ts.values,
            borderColor: color,
            backgroundColor: color,
            yAxisID: yAxisID,
            pointRadius: 3,
            pointHoverRadius: 5,
            borderWidth: 2,
            tension: 0.1,
          });
        }
      }

      if (datasets.length === 0) {
        setError("No timeseries data returned.");
        setChartData(null);
      } else {
        setError("");
        setChartData({ labels, datasets });
      }
    } catch (e) {
      setError(e?.message || "Failed to process timeseries data.");
      setChartData(null);
    }
  }, [perVariableData]);

  if (!perVariableData) return <div>No data available.</div>;
  if (error) return <div style={{ color: "red" }}>{error}</div>;
  if (!chartData) return <div>No timeseries data.</div>;

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: '#1e293b',
          boxWidth: 12,
          padding: 10,
        },
      },
      title: {
        display: false,
      },
      tooltip: {
        enabled: true,
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        titleColor: '#1e293b',
        bodyColor: '#1e293b',
        borderColor: '#e2e8f0',
        borderWidth: 1,
      }
    },
    scales: {
      x: {
        ticks: {
          color: '#1e293b',
          maxRotation: 45,
          minRotation: 45,
        },
        grid: {
          color: '#e2e8f0',
        },
      },
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        title: {
          display: true,
          text: 'Height (m)',
          color: '#1e293b',
        },
        ticks: {
          color: '#1e293b',
        },
        grid: {
          color: '#e2e8f0',
        },
        beginAtZero: true,
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        title: {
          display: true,
          text: 'Period (s)',
          color: '#1e293b',
        },
        ticks: {
          color: '#1e293b',
        },
        grid: {
          drawOnChartArea: false,
        },
        beginAtZero: true,
      },
      y2: {
        type: 'linear',
        display: false,
        position: 'right',
        min: 0,
        max: 360,
        grid: {
          drawOnChartArea: false,
        },
      },
    },
  };

  return (
    <div style={{
      width: "100%",
      height: "100%",
      minHeight: "300px",
      backgroundColor: '#ffffff',
      padding: '10px',
      borderRadius: '4px',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <Line options={options} data={chartData} />
      </div>
    </div>
  );
}

export default Timeseries;
