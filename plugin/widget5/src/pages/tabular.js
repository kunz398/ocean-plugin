import React, { useEffect, useState } from "react";
import { zonedTableTimeParts } from "../utils/timeZoneFormat";

// Jet colormap: returns rgb string for value in [min, max]
function jetColor(value, min = 0, max = 4) {
  let v = Math.max(min, Math.min(max, value));
  v = (v - min) / (max - min);
  let r = Math.floor(255 * Math.max(Math.min(1.5 - Math.abs(4 * v - 3), 1), 0));
  let g = Math.floor(255 * Math.max(Math.min(1.5 - Math.abs(4 * v - 2), 1), 0));
  let b = Math.floor(255 * Math.max(Math.min(1.5 - Math.abs(4 * v - 1), 1), 0));
  if ([r, g, b].some(x => isNaN(x))) return "rgb(127,127,127)";
  return `rgb(${r},${g},${b})`;
}

function redColor(value, min = 0, max = 20) {
  let v = Math.max(min, Math.min(max, value));
  v = (v - min) / (max - min);
  const start = { r: 255, g: 229, b: 229 };
  const end = { r: 127, g: 0, b: 0 };
  const r = Math.round(start.r + (end.r - start.r) * v);
  const g = Math.round(start.g + (end.g - start.g) * v);
  const b = Math.round(start.b + (end.b - start.b) * v);
  return `rgb(${r},${g},${b})`;
}

function blueColor(value, min = 0, max = 4) {
  let v = Math.max(min, Math.min(max, value));
  v = (v - min) / (max - min);
  const start = { r: 232, g: 244, b: 255 };
  const end = { r: 0, g: 51, b: 102 };
  const r = Math.round(start.r + (end.r - start.r) * v);
  const g = Math.round(start.g + (end.g - start.g) * v);
  const b = Math.round(start.b + (end.b - start.b) * v);
  return `rgb(${r},${g},${b})`;
}

function isColorDark(colorString) {
  if (!colorString) return false;
  let r, g, b;
  const rgbMatch = colorString.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (rgbMatch) {
    [r, g, b] = rgbMatch.slice(1, 4).map(Number);
  } else {
    return false;
  }
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness < 128;
}

// Arrow SVG for direction
const ArrowSVG = ({ angle, isDarkMode }) => (
  <svg width="22" height="22" viewBox="0 0 22 22" style={{
    display: 'inline-block',
    transform: `rotate(${angle}deg)`,
    verticalAlign: "middle"
  }}>
    <line x1="11" y1="18" x2="11" y2="4" stroke={isDarkMode ? "#f1f5f9" : "#222"} strokeWidth="2"/>
    <polygon points="11,2 7,8 15,8" fill={isDarkMode ? "#f1f5f9" : "#222"} />
  </svg>
);

// Parse label config, detect {calc}, color type, range, decimal places (default 0)
function parseLabelConfig(label) {
  const configMatch = label.match(/\{([^}]*)\}/);
  let config = {};
  if (configMatch) {
    const configParts = configMatch[1].split('/');
    configParts.forEach(part => {
      const lower = part.trim().toLowerCase();
      if (lower === 'calc') config.calc = true;
      else if (['jet', 'dir', 'rd', 'bu'].includes(lower)) config.type = lower;
      else if (/^\d+\s*-\s*\d+$/.test(lower)) {
        const [min, max] = lower.split('-').map(Number);
        config.min = min;
        config.max = max;
      } else if (/^\d+$/.test(lower)) {
        config.decimalPlaces = parseInt(lower, 10);
      }
    });
  }
  if (typeof config.decimalPlaces !== "number") {
    config.decimalPlaces = 0;
  }
  const cleanLabel = label.replace(/\{[^}]*\}/, '').trim();
  return { ...config, cleanLabel };
}

// Variables & labels with config strings for Cook Islands
const variableDefs = [
  { key: "hs", label: "Wave Height{0-5/Bu/1}" },
  { key: "tpeak", label: "Peak Period{0-20/Rd/0}" },
  { key: "tm02", label: "Mean Period{0-20/Rd/0}" },
  { key: "dirm", label: "Wave Direction{0/dir}" },
  { key: "hs_p1", label: "Wind Wave(m){0-5/Bu/1}" },
  { key: "tp_p1", label: "Wind Wave Period{0-25/Rd/0}" },
  { key: "dirp_p1", label: "Wind Wave Dir{0/dir}" },
  { key: "hs_p2", label: "Swell(m){0-5/Bu/1}" },
  { key: "tp_p2", label: "Swell Period{0-25/Rd/0}" },
  { key: "dirp_p2", label: "Swell Dir{0/dir}" },
  { key: "hs_p3", label: "2nd Swell(m){0-5/Bu/1}" },
  { key: "tp_p3", label: "2nd Swell Period{0-25/Rd/0}" },
  { key: "dirp_p3", label: "2nd Swell Dir{0/dir}" }
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
  const times = json.domain.axes.t.values;
  const values = json.ranges[variable].values;
  return { times, values };
}

const formatSmart = (value, decimalPlaces) => {
  if (value === null || value === undefined || value === "") return '—';
  if (typeof value !== "number") {
    let num = Number(value);
    if (isNaN(num)) return String(value).slice(0, 2);
    value = num;
  }
  if (typeof decimalPlaces !== "number") decimalPlaces = 0;
  return value.toFixed(decimalPlaces);
};

function filterToSixHourly(times, values) {
  const filteredTimes = [];
  const filteredValues = [];
  if (!times.length) return { times: filteredTimes, values: filteredValues };
  let firstIdx = -1;
  for (let i = 0; i < times.length; i++) {
    const date = new Date(times[i]);
    if (date.getUTCHours() % 6 === 0) {
      firstIdx = i;
      break;
    }
  }
  if (firstIdx !== -1) {
    for (let i = firstIdx; i < times.length; i += 6) {
      filteredTimes.push(times[i]);
      filteredValues.push(values[i]);
    }
  }
  return { times: filteredTimes, values: filteredValues };
}

function formatTableTime(time, timeZone) {
  const date = new Date(time);
  const { dayCode, dayNum, hour } = zonedTableTimeParts(date, timeZone);
  return (
    <>
      {dayCode} <br />
      {dayNum} <br />
      {hour}
    </>
  );
}

function Tabular({ perVariableData, timeDisplayZone = 'Pacific/Rarotonga' }) {
  const [tableRows, setTableRows] = useState([]);
  const [times, setTimes] = useState([]);
  const [error, setError] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Check for dark mode
  useEffect(() => {
    const checkTheme = () => {
      const isDark = document.body.classList.contains('dark-mode') || 
                     document.documentElement.classList.contains('dark') ||
                     window.matchMedia('(prefers-color-scheme: dark)').matches;
      setIsDarkMode(isDark);
    };
    
    checkTheme();
    
    // Listen for theme changes
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let allRows = [];
    let timesArr = [];
    
    for (let j = 0; j < variableDefs.length; j++) {
      const { key, label } = variableDefs[j];
      const config = parseLabelConfig(label);
      
      const json = perVariableData[key];
      const ts = extractCoverageTimeseries(json, key);
      
      if (ts && ts.values) {
        const filtered = filterToSixHourly(ts.times, ts.values);
        if (!timesArr.length && filtered.times) timesArr = filtered.times;
        allRows.push({
          key,
          label: config.cleanLabel,
          config,
          values: filtered.values
        });
      } else {
        // Add empty row for missing data
        allRows.push({
          key,
          label: config.cleanLabel,
          config,
          values: []
        });
      }
    }
    
    setTableRows(allRows);
    setTimes(timesArr || []);
    
    if (allRows.every(s => !s.values.length)) {
      console.error('[tabular] No tabular timeseries data returned for', perVariableData);
      setError("No tabular timeseries data returned.");
    } else {
      setError("");
    }
  }, [perVariableData]);

  if (!perVariableData) return <div>No data available.</div>;
  if (error || !times.length || !tableRows.length) return <div>No tabular timeseries data available.</div>;

  // Check if all values are null
  const allValuesNull = tableRows.every(row => 
    row.values.every(val => val === null || val === undefined)
  );

  // Table CSS with dark mode support
  const thFirstCol = {
    textAlign: 'center',
    fontWeight: 'normal',
    backgroundColor: isDarkMode ? '#3f4854' : '#eeeeee',
    color: isDarkMode ? '#f1f5f9' : 'black',
    border: `1px solid ${isDarkMode ? '#44454a' : '#E5E4E2'}`,
    whiteSpace: 'nowrap',
    maxWidth: '240px',
    width: 'max-content',
  };
  
  const thOtherCols = {
    fontWeight: 'normal',
    textAlign: 'center',
    backgroundColor: isDarkMode ? '#3f4854' : '#eeeeee',
    color: isDarkMode ? '#f1f5f9' : 'black',
    border: `1px solid ${isDarkMode ? '#44454a' : '#E5E4E2'}`,
    padding: '0 4px',
    minWidth: 32,
    maxWidth: 48,
    width: 38,
    whiteSpace: 'nowrap',
  };
  
  const tdFirstCol = {
    fontWeight: 'normal',
    textAlign: 'left',
    padding: '2px 6px',
    border: `1px solid ${isDarkMode ? '#44454a' : '#E5E4E2'}`,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '240px',
    width: 'max-content',
    backgroundColor: isDarkMode ? '#3f4854' : '#eeeeee',
    color: isDarkMode ? '#f1f5f9' : 'black',
  };
  
  const tdOtherCols = {
    fontWeight: 'normal',
    textAlign: 'center',
    padding: '0 6px',
    border: `1px solid ${isDarkMode ? '#44454a' : '#E5E4E2'}`,
    minWidth: 32,
    maxWidth: 48,
    width: 38,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    transition: 'background 0.2s, color 0.2s',
    backgroundColor: isDarkMode ? '#2e2f33' : 'white',
    color: isDarkMode ? '#9ca3af' : '#6b7280', // Slightly brighter gray for em dashes
  };

  return (
    <div style={{ overflowX: "auto", maxWidth: "100%" }}>
      {allValuesNull && (
        <div style={{ 
          padding: '12px', 
          margin: '8px 0', 
          backgroundColor: isDarkMode ? '#422006' : '#fef3c7',
          color: isDarkMode ? '#fbbf24' : '#92400e',
          border: `1px solid ${isDarkMode ? '#78350f' : '#fbbf24'}`,
          borderRadius: '4px',
          fontSize: '13px',
          textAlign: 'center'
        }}>
          ⚠️ No forecast data available for this location. Please click on ocean areas within the Cook Islands domain.
        </div>
      )}
      <table
        style={{
          borderCollapse: 'collapse',
          textAlign: 'center',
          fontSize: 14,
          border: `1px solid ${isDarkMode ? '#44454a' : '#fff'}`,
          tableLayout: 'auto',
          width: 'auto',
          minWidth: 0,
          maxWidth: '100vw',
          backgroundColor: isDarkMode ? '#2e2f33' : 'white',
          color: isDarkMode ? '#f1f5f9' : 'black',
        }}
        className="table table-bordered"
      >
        <thead>
          <tr>
            <th style={thFirstCol}>Parameter</th>
            {times.map((t) => (
              <th key={t} style={thOtherCols}>
                {formatTableTime(t, timeDisplayZone)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableRows.map((row) => (
            <tr key={row.key}>
              <td style={tdFirstCol}>{row.label}</td>
              {row.values.map((value, colIdx) => {
                let cellStyle = { ...tdOtherCols };
                const { min=0, max=5, type="bu", decimalPlaces } = row.config || {};
                let colorText = isDarkMode ? "#f1f5f9" : "#000";
                let colorBg = "";
                
                if ((type === "jet" || type === "rd" || type === "bu") && typeof value === "number") {
                  if (type === "jet") colorBg = jetColor(value, min, max);
                  else if (type === "rd") colorBg = redColor(value, min, max);
                  else if (type === "bu") colorBg = blueColor(value, min, max);
                  
                  colorText = isColorDark(colorBg) ? "#eeeeee" : "#000";
                  cellStyle = { ...cellStyle, backgroundColor: colorBg, color: colorText };
                }
                
                const isDirection = type === "dir";
                
                return (
                  <td key={colIdx} style={cellStyle}>
                    {isDirection && typeof value === "number"
                      ? <ArrowSVG angle={value + 180} isDarkMode={isDarkMode} />
                      : formatSmart(value, decimalPlaces)
                    }
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default Tabular;