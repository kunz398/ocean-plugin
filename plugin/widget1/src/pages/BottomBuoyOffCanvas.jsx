import React, { useState, useEffect, useRef } from "react";
import { Offcanvas } from "react-bootstrap";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import 'chartjs-adapter-date-fns';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale
);

const BUOY_COLORS = [
  '#0288D1', // Vivid Blue
  '#FFC107', // Vivid Amber
  '#D32F2F', // Vivid Red
];

const MODEL_COLORS = [
  '#004D40', // Deep Teal
  '#F4511E', // Vivid Orange
  '#43A047', // Vivid Green
];

const MIN_HEIGHT = 100;
const MAX_HEIGHT_FALLBACK = 800; // used if window size unavailable

const TIDE_COLOR = '#f59e0b';
const INSITU_API_BASE = 'https://ocean-obs-api.spc.int/insitu';

const MODEL_VARIABLES = ["hs_p1", "tp_p1", "dirp_p1"];
const LATEST_CAPABILITY_URL = "https://gemthreddshpc.spc.int/thredds/wms/POP/model/country/spc/forecast/hourly/NIU/ForecastNiue_latest.nc?service=WMS&version=1.3.0&request=GetCapabilities";
const PREVIOUS_CAPABILITY_URL = "https://gemthreddshpc.spc.int/thredds/wms/POP/model/country/spc/forecast/hourly/NIU/ForecastNiue_latest_01.nc?service=WMS&version=1.3.0&request=GetCapabilities";

// Time parsing functions from NiueForecast.js
function parseTimeDimensionFromCapabilities(xml, layerName) {
  const parser = new window.DOMParser();
  const dom = parser.parseFromString(xml, "text/xml");
  const layers = Array.from(dom.getElementsByTagName("Layer"));
  let targetLayer = null;
  for (const l of layers) {
    const nameNode = l.getElementsByTagName("Name")[0];
    if (nameNode && nameNode.textContent === layerName) {
      targetLayer = l;
      break;
    }
  }
  if (!targetLayer) return null;
  const dimensionNodes = Array.from(targetLayer.getElementsByTagName("Dimension"));
  for (const dim of dimensionNodes) {
    if (dim.getAttribute("name") === "time") {
      return dim.textContent.trim();
    }
  }
  const extentNodes = Array.from(targetLayer.getElementsByTagName("Extent"));
  for (const ext of extentNodes) {
    if (ext.getAttribute("name") === "time") {
      return ext.textContent.trim();
    }
  }
  return null;
}

function getTimeRangeFromDimension(dimStr) {
  if (!dimStr) return null;
  if (dimStr.includes("/")) {
    const [start, end, step] = dimStr.split("/");
    return {
      start: new Date(start),
      end: new Date(end),
      step: step || "PT1H"
    };
  }
  const times = dimStr.split(",").map(s => new Date(s));
  if (times.length > 1) {
    const stepMs = times[1] - times[0];
    return {
      start: times[0],
      end: times[times.length - 1],
      step: `PT${Math.round(stepMs / 1000 / 60 / 60)}H`
    };
  }
  return null;
}

function formatDateISOString(date) {
  return date.toISOString().split(".")[0] + ".000Z";
}

// New functions for fetching forecast data
async function fetchCapabilities(url) {
  //console.log(`Fetching capabilities from: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch capabilities from ${url}`);
  const xml = await res.text();
  //console.log("URL::" + url);
  return xml;
}

async function fetchForecastData(baseUrl, layer, timeRange) {
  const timeParam = `${formatDateISOString(timeRange.start)}/${formatDateISOString(timeRange.end)}`;
  // Point query at SPOT-30979C's mooring (-169.92995,-19.05343) — the live
  // Niue buoy per api.sofarocean.com / the SPC Ocean Portal. The old
  // SPOT-31091C mooring this used to point at has been dark since redeployment.
  const url = `${baseUrl}?REQUEST=GetTimeseries&LAYERS=${layer}&QUERY_LAYERS=${layer}&BBOX=-169.92995,-19.05343,-169.92985,-19.05333&SRS=CRS:84&FEATURE_COUNT=5&HEIGHT=1&WIDTH=1&X=0&Y=0&STYLES=default/default&VERSION=1.1.1&TIME=${timeParam}&INFO_FORMAT=text/json`;

  console.log(`Fetching forecast data from: ${url}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch forecast data from ${baseUrl}`);
  const json = await res.json();

  //console.log(`Forecast data response for ${baseUrl} [${layer}]:`, json);
  //console.log(`Time range: ${timeParam}`);
  //console.log(`Data points: ${json.domain?.axes?.t?.values?.length || 0}`);

  return json;
}

async function fetchCombinedForecastData() {
  try {
    // Fetch capabilities from both forecasts
    const [latestCapabilities, previousCapabilities] = await Promise.all([
      fetchCapabilities(LATEST_CAPABILITY_URL),
      fetchCapabilities(PREVIOUS_CAPABILITY_URL)
    ]);

    // Parse time dimensions
    const latestTimeDim = parseTimeDimensionFromCapabilities(latestCapabilities, "hs_p1");
    const previousTimeDim = parseTimeDimensionFromCapabilities(previousCapabilities, "hs_p1");
    console.log("latestTimeDim:: " + latestTimeDim);

    //console.log('Parsed time dimensions:');
    //console.log('Latest time dimension:', latestTimeDim);
    //console.log('Previous time dimension:', previousTimeDim);

    if (!latestTimeDim || !previousTimeDim) {
      throw new Error("Could not parse time dimensions from capabilities");
    }

    const latestTimeRange = getTimeRangeFromDimension(latestTimeDim);
    const previousTimeRange = getTimeRangeFromDimension(previousTimeDim);

    //console.log('Parsed time ranges:');
    //console.log('Latest time range:', latestTimeRange);
    //console.log('Previous time range:', previousTimeRange);

    if (!latestTimeRange || !previousTimeRange) {
      throw new Error("Could not parse time ranges");
    }

    // Calculate time ranges for each forecast
    const sevenAndHalfDaysAgo = new Date(latestTimeRange.end.getTime() - (7.5 * 24 * 60 * 60 * 1000));
    const latestStart = sevenAndHalfDaysAgo;
    const latestEnd = latestTimeRange.end;
    const previousStart = previousTimeRange.start;
    const previousEnd = latestTimeRange.start;

    //console.log('Time ranges:', {
    //   latest: { start: latestStart, end: latestEnd },
    //   previous: { start: previousStart, end: previousEnd }
    // });

    // For each variable, fetch latest and previous separately, then combine
    const combinedRanges = {};
    let combinedDomain = null;
    let combinedParameters = {};
    for (const v of MODEL_VARIABLES) {
      // Fetch both latest and previous for this variable
      const [latestData, previousData] = await Promise.all([
        fetchForecastData(
          "https://gemthreddshpc.spc.int/thredds/wms/POP/model/country/spc/forecast/hourly/NIU/ForecastNiue_latest.nc",
          v,
          { start: latestStart, end: latestEnd }
        ),
        fetchForecastData(
          "https://gemthreddshpc.spc.int/thredds/wms/POP/model/country/spc/forecast/hourly/NIU/ForecastNiue_latest_01.nc",
          v,
          { start: previousStart, end: previousEnd }
        )
      ]);
      console.log(previousData)
      // // Debug: print the full JSON for tp_p1 and dirp_p1
      // if (v === "tp_p1" || v === "dirp") {
      //   //console.log(`Full latestData for ${v}:`, latestData);
      //   //console.log(`Full previousData for ${v}:`, previousData);
      // }
      // For the first variable, set the domain and parameters
      if (!combinedDomain) {
        combinedDomain = {
          axes: {
            t: {
              values: [
                ...previousData.domain.axes.t.values,
                ...latestData.domain.axes.t.values
              ]
            }
          }
        };
      }
      combinedParameters = {
        ...combinedParameters,
        ...previousData.parameters,
        ...latestData.parameters
      };
      combinedRanges[v] = {
        values: [
          ...(previousData.ranges?.[v]?.values || []),
          ...(latestData.ranges?.[v]?.values || [])
        ]
      };
      // //console.log(`Sample ${v} values:`, combinedRanges[v].values.slice(0, 5));
      // //console.log(`Combined ${v} values length:`, combinedRanges[v].values.length);
    }

    const combinedData = {
      domain: combinedDomain,
      parameters: combinedParameters,
      ranges: combinedRanges
    };

    // //console.log('Combined forecast data:', combinedData);
    // //console.log('Total combined data points:', combinedData.domain.axes.t.values.length);
    // //console.log('Sample time values:', combinedData.domain.axes.t.values.slice(0, 5));

    return combinedData;
  } catch (error) {
    console.error('Error fetching combined forecast data:', error);
    throw error;
  }
}

async function fetchAllModelVariables() {
  try {
    const combinedData = await fetchCombinedForecastData();
    return [{ layer: "combined", json: combinedData }];
  } catch (error) {
    throw error;
  }
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error in Chart component:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: 'red', padding: '1rem' }}>
          <p>Error rendering chart: {this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function BottomBuoyOffCanvas({ show, onHide, buoyId, buoyType, buoyLabel }) {
  const [height, setHeight] = useState(650);
  const offRef = useRef(null);
  const [activeTab, setActiveTab] = useState("buoy");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(false);
  const isTideGauge = buoyType === "tide-gauge";

  // Tide gauge state (station_id-keyed insitu API — sea level, not wave data)
  const [tideData, setTideData] = useState(null);
  const [tideLoading, setTideLoading] = useState(false);
  const [tideError, setTideError] = useState("");

  // Check for dark mode
  useEffect(() => {
    const checkTheme = () => {
      const theme = document.documentElement.getAttribute('data-theme');
      const isDark = theme === 'dark' || document.body.classList.contains('dark-mode');
      setIsDarkMode(isDark);
    };

    checkTheme();

    // Listen for theme changes
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });

    return () => observer.disconnect();
  }, []);

  // Model state
  const [modelData, setModelData] = useState(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState("");

  // Add this new state to track if we've loaded data
  const [hasLoadedData, setHasLoadedData] = useState({
    buoy: false,
    model: false
  });

  // Drag handle logic (mouse + touch) with dynamic viewport clamp
  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(650);
  const currentDragHeight = useRef(650);

  const getMaxHeight = () => {
    const vh = typeof window !== 'undefined' ? window.innerHeight : MAX_HEIGHT_FALLBACK;
    // Leave a small margin so header doesn't get trapped off-screen
    return Math.max(Math.min(vh - 60, 1200), MIN_HEIGHT);
  };

  const applyHeightToDom = (h) => {
    try {
      const el = document.getElementById('bottom-buoy-offcanvas');
      if (el) {
        el.style.setProperty('--bs-offcanvas-height', `${h}px`);
        el.style.setProperty('height', `${h}px`, 'important');
        el.style.setProperty('max-height', `${h}px`);
      }
    } catch (_) {}
  };

  const applyDrag = (clientY) => {
    if (!dragging.current) return;
    let newHeight = startHeight.current - (clientY - startY.current);
    const maxH = getMaxHeight();
    if (Number.isFinite(newHeight)) {
      newHeight = Math.min(Math.max(newHeight, MIN_HEIGHT), maxH);
      currentDragHeight.current = newHeight;
      applyHeightToDom(newHeight);
    }
  };

  const onMouseMove = (e) => applyDrag(e.clientY);
  const onTouchMove = (e) => {
    if (e.touches && e.touches[0]) applyDrag(e.touches[0].clientY);
  };

  const endDrag = () => {
    dragging.current = false;
    document.body.style.cursor = "";
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", endDrag);
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("touchend", endDrag);
    
    setHeight(currentDragHeight.current);
    const el = document.getElementById('bottom-buoy-offcanvas');
    if (el) el.style.transition = '';
  };

  const beginDrag = (clientY, setCursor = true) => {
    dragging.current = true;
    startY.current = clientY;
    startHeight.current = height;
    currentDragHeight.current = height;
    
    const el = document.getElementById('bottom-buoy-offcanvas');
    if (el) el.style.transition = 'none';

    if (setCursor) document.body.style.cursor = "ns-resize";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", endDrag);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", endDrag);
  };

  const onMouseDown = (e) => { beginDrag(e.clientY, true); };
  // Ensure height is applied to the real offcanvas element (RB/Bootstrap sometimes relies on CSS var)
  useEffect(() => {
    const apply = () => {
      const el = document.getElementById('bottom-buoy-offcanvas');
      if (el) {
        try {
          el.style.setProperty('height', `${height}px`, 'important');
          el.style.setProperty('--bs-offcanvas-height', `${height}px`);
          el.style.setProperty('max-height', `${height}px`);
        } catch (_) {}
      }
    };
    
    if (show) {
      // Apply immediately
      apply();
      // Apply repeatedly to fight Bootstrap's CSS transitions/animations
      const t1 = setTimeout(apply, 50);
      const t2 = setTimeout(apply, 150);
      const t3 = setTimeout(apply, 350);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [height, show]);
  const onTouchStart = (e) => {
    if (e.touches && e.touches[0]) { beginDrag(e.touches[0].clientY, false); }
  };

  // Fetch Sofarocean data when buoyId changes and panel is open
  useEffect(() => {
    if (!show || !buoyId || isTideGauge) return;
    setLoading(true);
    setFetchError("");
    setData(null);
    const token = "2a348598f294c6b0ce5f7e41e5c0f5";
    const url = `https://api.sofarocean.com/api/wave-data?spotterId=${buoyId}&token=${token}&includeWindData=false&includeDirectionalMoments=true&includeSurfaceTempData=true&limit=100&includeTrack=true`;
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error("API error");
        return res.json();
      })
      .then(json => {
        setData(json.data);
        setLoading(false);
        setHasLoadedData(prev => ({ ...prev, buoy: true }));
      })
      .catch(e => {
        setFetchError("Failed to fetch buoy data");
        setLoading(false);
        setHasLoadedData(prev => ({ ...prev, buoy: false }));
      });
  }, [buoyId, show, isTideGauge]);

  // Fetch tide gauge timeseries (sea level, not wave data — separate provider/schema)
  useEffect(() => {
    if (!show || !buoyId || !isTideGauge) return;
    setTideLoading(true);
    setTideError("");
    setTideData(null);
    const url = `${INSITU_API_BASE}/get_data/station/${buoyId}?limit=500`;
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error("API error");
        return res.json();
      })
      .then(json => {
        setTideData(Array.isArray(json.data) ? json.data : []);
        setTideLoading(false);
      })
      .catch(() => {
        setTideError("Failed to fetch tide gauge data");
        setTideLoading(false);
      });
  }, [buoyId, show, isTideGauge]);

  // Fetch model data for all variables in parallel (wave-buoy stations only —
  // there's no wave model to compare a tide gauge's sea-level reading against)
  useEffect(() => {
    if (!show || isTideGauge) return;
    setModelLoading(true);
    setModelError("");
    setModelData(null);

    fetchAllModelVariables()
      .then(results => {
        // Use the first result's domain as base (all should match)
        const domain = results[0].json.domain;
        const parameters = results[0].json.parameters;
        const ranges = results[0].json.ranges;
        setModelData({ domain, parameters, ranges });
        setModelLoading(false);
        setHasLoadedData(prev => ({ ...prev, model: true }));
      })
      .catch(e => {
        console.error('Error fetching model data:', e);
        setModelError("Failed to fetch model data: " + e.message);
        setModelLoading(false);
        setHasLoadedData(prev => ({ ...prev, model: false }));
      });
  }, [show, isTideGauge]);

  // Switch to appropriate tab based on the selected station
  useEffect(() => {
    if (isTideGauge) {
      setActiveTab("tide");
    } else if (buoyId === "SPOT-30979C") {
      setActiveTab("combination");
    } else {
      setActiveTab("buoy");
    }
  }, [buoyId, isTideGauge]);

  // Common Chart.js options generator
  const createCommonOptions = (title) => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    stacked: false,
    plugins: {
      title: {
        display: true,
        text: title,
      },
      legend: {
        position: 'bottom',
        labels: {
          color: isDarkMode ? '#f1f5f9' : '#1e293b',
          generateLabels: (chart) => {
            const original = ChartJS.defaults.plugins.legend.labels.generateLabels(chart);
            return original.map(label => {
              const dataset = chart.data.datasets[label.datasetIndex];
              if (dataset.borderDash && dataset.borderDash.length > 0) {
                return {
                  ...label,
                  fillStyle: 'rgba(0,0,0,0)', // Transparent fill
                  strokeStyle: dataset.borderColor,
                  lineWidth: 2,
                  lineDash: dataset.borderDash,
                  lineDashOffset: dataset.borderDashOffset || 0,
                };
              }
              return label;
            });
          }
        }
      },
    },
    scales: {
      x: {
        type: 'time',
        time: {
          unit: 'day',
          displayFormats: {
            day: 'MMM d'
          },
          tooltipFormat: 'MMM d, yyyy HH:mm'
        },
        title: {
          display: true,
          text: 'Time (UTC)',
          color: isDarkMode ? '#f1f5f9' : '#1e293b'
        },
        ticks: {
          color: isDarkMode ? '#f1f5f9' : '#1e293b'
        },
        grid: {
          color: isDarkMode ? '#44454a' : '#e2e8f0'
        }
      },
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        title: {
          display: true,
          text: 'Height (m)',
          color: isDarkMode ? '#f1f5f9' : '#1e293b'
        },
        ticks: {
          color: isDarkMode ? '#f1f5f9' : '#1e293b'
        },
        grid: {
          color: isDarkMode ? '#44454a' : '#e2e8f0'
        }
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        grid: {
          drawOnChartArea: false,
        },
        title: {
          display: true,
          text: 'Period (s)',
          color: isDarkMode ? '#f1f5f9' : '#1e293b'
        },
        ticks: {
          color: isDarkMode ? '#f1f5f9' : '#1e293b'
        }
      },
      y2: {
        type: 'linear',
        display: true,
        position: 'right',
        grid: {
          drawOnChartArea: false,
        },
        title: {
          display: true,
          text: 'Direction (°)',
          color: isDarkMode ? '#f1f5f9' : '#1e293b'
        },
        ticks: {
          color: isDarkMode ? '#f1f5f9' : '#1e293b'
        },
        min: 0,
        max: 360
      },
    },
  });

  // Prepare chart data for buoy
  let buoyChartData = null;
  let buoyChartOptions = {};

  if (activeTab === "buoy" && !loading && !fetchError && data?.waves?.length > 0) {
    const waves = data.waves;
    // Sort by timestamp
    waves.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    buoyChartData = {
      labels: waves.map(w => w.timestamp),
      datasets: [
        {
          label: 'Significant Wave Height (m)',
          data: waves.map(w => w.significantWaveHeight),
          borderColor: BUOY_COLORS[0],
          backgroundColor: BUOY_COLORS[0],
          yAxisID: 'y',
          tension: 0.1,
          pointRadius: 2
        },
        {
          label: 'Peak Period (s)',
          data: waves.map(w => w.peakPeriod),
          borderColor: BUOY_COLORS[1],
          backgroundColor: BUOY_COLORS[1],
          yAxisID: 'y1',
          tension: 0.1,
          pointRadius: 2
        },
        {
          label: 'Mean Direction (°)',
          data: waves.map(w => w.meanDirection),
          borderColor: BUOY_COLORS[2],
          backgroundColor: BUOY_COLORS[2],
          yAxisID: 'y2',
          tension: 0.1,
          pointRadius: 2,
          borderDash: [5, 5]
        }
      ]
    };

    buoyChartOptions = createCommonOptions(`Buoy Data: ${buoyId}`);
  }

  // Prepare chart data for model
  let modelChartData = null;
  let modelChartOptions = {};
  let modelMissingVars = [];

  if (activeTab === "model" && modelData && modelData.domain && modelData.domain.axes && modelData.domain.axes.t) {
    const variables = MODEL_VARIABLES;
    modelMissingVars = variables.filter(v => !modelData.ranges || !modelData.ranges[v]);

    const timeValues = modelData.domain.axes.t.values;

    modelChartData = {
      labels: timeValues,
      datasets: [
        {
          label: 'Significant Wave Height (m)',
          data: modelData.ranges?.hs_p1?.values || [],
          borderColor: MODEL_COLORS[0],
          backgroundColor: MODEL_COLORS[0],
          yAxisID: 'y',
          tension: 0.1,
          pointRadius: 2,
          borderDash: [5, 5]
        },
        {
          label: 'Wind Wave Period (s)',
          data: modelData.ranges?.tp_p1?.values || [],
          borderColor: MODEL_COLORS[1],
          backgroundColor: MODEL_COLORS[1],
          yAxisID: 'y1',
          tension: 0.1,
          pointRadius: 2,
          borderDash: [5, 5]
        },
        {
          label: 'Wind Wave Direction (°)',
          data: modelData.ranges?.dirp_p1?.values || [],
          borderColor: MODEL_COLORS[2],
          backgroundColor: MODEL_COLORS[2],
          yAxisID: 'y2',
          tension: 0.1,
          pointRadius: 2,
          borderDash: [5, 5]
        }
      ]
    };

    modelChartOptions = createCommonOptions('Model Forecast');
  }

  // Prepare chart data for combination
  let combinationChartData = null;
  let combinationChartOptions = {};

  if (activeTab === "combination" && hasLoadedData.buoy && hasLoadedData.model) {
    const buoyWaves = data?.waves || [];
    // Sort buoy waves by timestamp
    buoyWaves.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Buoy Datasets
    const buoyDatasets = [
      {
        label: 'Significant Wave Height (Buoy)',
        data: buoyWaves.map(w => ({ x: w.timestamp, y: w.significantWaveHeight })),
        borderColor: BUOY_COLORS[0],
        backgroundColor: BUOY_COLORS[0],
        yAxisID: 'y',
        tension: 0.1,
        pointRadius: 2
      },
      {
        label: 'Peak Period (Buoy)',
        data: buoyWaves.map(w => ({ x: w.timestamp, y: w.peakPeriod })),
        borderColor: BUOY_COLORS[1],
        backgroundColor: BUOY_COLORS[1],
        yAxisID: 'y1',
        tension: 0.1,
        pointRadius: 2
      },
      {
        label: 'Mean Direction (Buoy)',
        data: buoyWaves.map(w => ({ x: w.timestamp, y: w.meanDirection })),
        borderColor: BUOY_COLORS[2],
        backgroundColor: BUOY_COLORS[2],
        yAxisID: 'y2',
        tension: 0.1,
        pointRadius: 2,
        borderDash: [5, 5]
      }
    ];

    // Model Datasets
    let modelDatasets = [];
    if (modelData && modelData.domain && modelData.domain.axes && modelData.domain.axes.t) {
      const timeValues = modelData.domain.axes.t.values;

      modelDatasets = [
        {
          label: 'Significant Wave Height (Model)',
          data: (modelData.ranges?.hs_p1?.values || []).map((v, i) => ({ x: timeValues[i], y: v })),
          borderColor: MODEL_COLORS[0],
          backgroundColor: MODEL_COLORS[0],
          yAxisID: 'y',
          tension: 0.1,
          pointRadius: 2,
          borderDash: [2, 2] // Dotted line for model
        },
        {
          label: 'Wind Wave Period (Model)',
          data: (modelData.ranges?.tp_p1?.values || []).map((v, i) => ({ x: timeValues[i], y: v })),
          borderColor: MODEL_COLORS[1],
          backgroundColor: MODEL_COLORS[1],
          yAxisID: 'y1',
          tension: 0.1,
          pointRadius: 2,
          borderDash: [2, 2]
        },
        {
          label: 'Wind Wave Direction (Model)',
          data: (modelData.ranges?.dirp_p1?.values || []).map((v, i) => ({ x: timeValues[i], y: v })),
          borderColor: MODEL_COLORS[2],
          backgroundColor: MODEL_COLORS[2],
          yAxisID: 'y2',
          tension: 0.1,
          pointRadius: 2,
          borderDash: [2, 2]
        }
      ];
    }

    combinationChartData = {
      datasets: [...modelDatasets, ...buoyDatasets]
    };

    combinationChartOptions = createCommonOptions('Model vs Buoy: All Variables');
    if (buoyWaves.length > 0) {
      combinationChartOptions.scales.x.min = buoyWaves[0].timestamp;
    }
  }

  // Prepare chart data for the tide gauge (single series: sea level)
  let tideChartData = null;
  let tideChartOptions = {};

  if (isTideGauge && !tideLoading && !tideError && tideData?.length > 0) {
    const readings = [...tideData].sort((a, b) => new Date(a.time) - new Date(b.time));
    tideChartData = {
      labels: readings.map(r => r.time),
      datasets: [
        {
          label: 'Sea Level (m)',
          data: readings.map(r => r["sea_level (m)"]),
          borderColor: TIDE_COLOR,
          backgroundColor: TIDE_COLOR,
          yAxisID: 'y',
          tension: 0.1,
          pointRadius: 2,
        },
      ],
    };
    tideChartOptions = createCommonOptions(buoyLabel || `Tide Gauge: ${buoyId}`);
    // Single series — drop the unused period/direction axes from the shared options.
    delete tideChartOptions.scales.y1;
    delete tideChartOptions.scales.y2;
    tideChartOptions.scales.y.title.text = 'Sea Level (m)';
  }

  let tabLabels = [];

  if (isTideGauge) {
    tabLabels = [
      { key: "tide", label: buoyLabel || `Tide Gauge: ${buoyId || ""}` }
    ];
  } else if (buoyId === "SPOT-30979C") {
    tabLabels = [
      { key: "combination", label: "Buoy vs Model" },
      { key: "buoy", label: "Wave buoy" }
    ];
  } else {
    tabLabels = [
      { key: "buoy", label: `Buoy: ${buoyId || ""}` }
    ];
  }

  return (
  <>
  <Offcanvas
    id="bottom-buoy-offcanvas"
    ref={offRef}
    show={show}
    onHide={onHide}
    placement="bottom"
    style={{
      height: height,
      zIndex: 12000,
      background: isDarkMode ? "rgba(63, 72, 84, 0.98)" : "rgba(255,255,255,0.98)",
      color: isDarkMode ? "#f1f5f9" : "#1e293b",
      overflow: "visible",
      borderTop: `1px solid ${isDarkMode ? "#44454a" : "#e2e8f0"}`,
    }}
    backdrop={false}
    scroll={true}
  >
    {/* Drag Handle */}
    <div
      onMouseDown={(e) => { e.preventDefault(); onMouseDown(e); }}
      onTouchStart={onTouchStart}
      title="Drag to resize"
      style={{
        height: 12,
        cursor: "ns-resize",
        background: isDarkMode ? "#44454a" : "#e0e0e0",
        borderTopLeftRadius: 8,
        borderTopRightRadius: 8,
        textAlign: "center",
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: "none",
        margin: "-8px 0 0 0",
      }}
    >
      <div
        style={{
          width: 40,
          height: 4,
          background: isDarkMode ? "#a1a1aa" : "#aaa",
          borderRadius: 2,
          margin: "4px auto",
        }}
      />
    </div>
    <div style={{
      display: "flex",
      alignItems: "center",
      borderBottom: `1px solid ${isDarkMode ? "#44454a" : "#eee"}`,
      padding: "0 1rem 0 0.5rem"
    }}>
      {/* Custom CSS Tabs */}
      <div style={{ display: "flex", flex: 1, paddingTop: 10 }}>
        {tabLabels.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              border: "none",
              borderBottom: activeTab === tab.key ? `2px solid ${isDarkMode ? "#60a5fa" : "#007bff"}` : "2px solid transparent",
              background: "none",
              padding: "8px 20px",
              marginRight: 8,
              fontWeight: activeTab === tab.key ? "bold" : "normal",
              color: activeTab === tab.key ? (isDarkMode ? "#60a5fa" : "#007bff") : (isDarkMode ? "#a1a1aa" : "#555"),
              cursor: "pointer",
              fontSize: 16,
              transition: "border-bottom 0.1s"
            }}
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-controls={`tab-panel-${tab.key}`}
            tabIndex={activeTab === tab.key ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <button
        onClick={onHide}
        type="button"
        aria-label="Close"
        style={{
          border: "none",
          background: "none",
          fontSize: 26,
          marginLeft: 8,
          color: isDarkMode ? "#a1a1aa" : "#666",
          cursor: "pointer",
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
    <Offcanvas.Body style={{ paddingTop: 16, height: 'calc(100% - 60px)' }}>
      {activeTab === "buoy" && loading && <div style={{ textAlign: "center", padding: "2rem" }}>Loading buoy data...</div>}
      {activeTab === "buoy" && fetchError && <div style={{ color: "red", textAlign: "center" }}>{fetchError}</div>}
      {activeTab === "buoy" && !loading && !fetchError && data?.waves?.length > 0 && (
        <div style={{
          width: "100%",
          height: "100%",
          minHeight: '300px',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
          padding: '10px',
          borderRadius: '8px'
        }}>
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            <ErrorBoundary>
              <Line data={buoyChartData} options={buoyChartOptions} />
            </ErrorBoundary>
          </div>
        </div>
      )}
      {activeTab === "buoy" && !loading && !fetchError && data && (!data.waves || data.waves.length === 0) && (
        <div style={{ textAlign: "center", color: "#999" }}>No data available for this buoy.</div>
      )}
      {activeTab === "tide" && tideLoading && <div style={{ textAlign: "center", padding: "2rem" }}>Loading tide gauge data...</div>}
      {activeTab === "tide" && tideError && <div style={{ color: "red", textAlign: "center" }}>{tideError}</div>}
      {activeTab === "tide" && !tideLoading && !tideError && tideData?.length > 0 && (
        <div style={{
          width: "100%",
          height: "100%",
          minHeight: '300px',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
          padding: '10px',
          borderRadius: '8px'
        }}>
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            <ErrorBoundary>
              <Line data={tideChartData} options={tideChartOptions} />
            </ErrorBoundary>
          </div>
        </div>
      )}
      {activeTab === "tide" && !tideLoading && !tideError && tideData && tideData.length === 0 && (
        <div style={{ textAlign: "center", color: "#999" }}>No data available for this tide gauge.</div>
      )}
      {activeTab === "model" && modelLoading && (
        <div style={{ textAlign: "center", padding: "2rem" }}>Loading model data...</div>
      )}
      {activeTab === "model" && modelError && (
        <div style={{ color: "red", textAlign: "center" }}>{modelError}</div>
      )}
      {activeTab === "model" && !modelLoading && !modelError && (
        <div style={{
          width: "100%",
          height: "100%",
          minHeight: '300px',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
          padding: '10px',
          borderRadius: '8px'
        }}>
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            <ErrorBoundary>
              <Line data={modelChartData} options={modelChartOptions} />
            </ErrorBoundary>
          </div>
          {modelMissingVars.length > 0 && (
            <div style={{ color: "orange", textAlign: "center", paddingTop: 10 }}>
              No model data for: {modelMissingVars.join(', ')}
            </div>
          )}
        </div>
      )}
      {activeTab === "model" && !modelLoading && !modelError && !modelChartData && (
        <div style={{ textAlign: "center", color: "#999" }}>No model data available.</div>
      )}
      {activeTab === "combination" && (
        <div style={{
          width: "100%",
          height: "100%",
          minHeight: '300px',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
          padding: '10px',
          borderRadius: '8px'
        }}>
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            <ErrorBoundary>
              {(!hasLoadedData.buoy || !hasLoadedData.model) ? (
                <div style={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  height: '100%',
                  color: '#666',
                  flexDirection: 'column',
                  gap: '10px'
                }}>
                  <div>Loading data for comparison...</div>
                  <div style={{ fontSize: '0.9em', color: '#999' }}>
                    {!hasLoadedData.buoy && 'Loading buoy data...'}
                    {!hasLoadedData.model && ' Loading model data...'}
                  </div>
                </div>
              ) : (
                combinationChartData && <Line data={combinationChartData} options={combinationChartOptions} />
              )}
            </ErrorBoundary>
            {hasLoadedData.buoy && hasLoadedData.model && (
              (() => {
                // Check if all traces are empty
                // eslint-disable-next-line no-unused-vars
                const hasModel = modelData?.ranges?.hs_p1?.values?.length > 0;
                const hasBuoy = data?.waves?.length > 0;
                if (!hasModel && !hasBuoy) {
                  return (
                    <div style={{
                      textAlign: 'center',
                      color: 'orange',
                      padding: '10px',
                      backgroundColor: '#fff8e1',
                      marginTop: '10px',
                      borderRadius: '4px'
                    }}>
                      No data available for comparison. Please check if both buoy and model data are available.
                    </div>
                  );
                }
                return null;
              })()
            )}
          </div>
        </div>
      )}
    </Offcanvas.Body>
  </Offcanvas>
  </>
);
}

export default BottomBuoyOffCanvas;