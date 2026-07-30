import React, { useRef, useState, useEffect } from "react";
import Offcanvas from "react-bootstrap/Offcanvas";
import "./BottomOffCanvas.css";
import Tabular from "./tabular.js";
import Timeseries from "./timeseries.js";
import RiskDetailsPanel from "../components/risk/RiskDetailsPanel";
import SuitabilityDetailsPanel from "../components/suitability/SuitabilityDetailsPanel";
import InundationTimeseries from "./InundationTimeseries";
import LandingAreaDetailsPanel from "../components/landingArea/LandingAreaDetailsPanel";
import RouteForecastPanel from "../components/route/RouteForecastPanel";

// ---- Variables & config shared between modules ----
const variableDefs = [
  { key: "hs", label: "Wave{0-5/Bu/1}" },
  { key: "tm02", label: "Mean Period{0-20/Rd/0}" },
  { key: "tpeak", label: "Wave Period{0-20/Rd/0}" },
  { key: "dirm", label: "Mean wave direction{0/dir}" },
  { key: "dirp", label: "Wave direction{0/dir}" },
  { key: "transp_x", label: "Wave Energy{calc/0-100/jet/0}" },
  { key: "hs_p2", label: "Swell(m){0-5/Bu/1}" },
  { key: "tp_p2", label: "Swell Period{0-25/Rd/0}" },
  { key: "dirp_p2", label: "Swell Dir{0/dir}" },
  { key: "hs_p3", label: "2.Swell (m) {0-5/Bu/1}" },
  { key: "tp_p3", label: "2.Swell Period{0-25/Rd/0}" },
  { key: "dirp_p3", label: "2. Swell Dir{0-5/dir}" },
  { key: "hs_p1", label: "Wind wave(m){0-5/Bu/1}" },
  { key: "tp_p1", label: "Wind wave period{0-25/Rd/0}" },
  { key: "dirp_p1", label: "Wind wave dir{0-4/dir}" }
];

// ---- Centralized fetching helpers ----
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retries once after a short delay — this is a sequence of many independent
// per-variable requests to the same host, so a single transient network blip
// on any one of them shouldn't permanently blank that row.
async function fetchLayerTimeseries(layer, data, attempt = 0) {
  if (!data || !data.bbox || (data.x === undefined && data.i === undefined) || (data.y === undefined && data.j === undefined)) return null;
  let timeParam = "";
  if (data.timeDimension) {
    if (data.timeDimension.includes("/")) {
      timeParam = data.timeDimension;
    } else {
      try {
        const start = new Date(data.timeDimension);
        const end = new Date(start);
        end.setDate(start.getDate() + 7);
        timeParam = `${start.toISOString()}/${end.toISOString()}`;
      } catch {
        timeParam = data.timeDimension;
      }
    }
  }
  const x = data.x !== undefined ? data.x : data.i;
  const y = data.y !== undefined ? data.y : data.j;
  const url =
    "https://gemthreddshpc.spc.int/thredds/wms/POP/model/country/spc/forecast/hourly/NIU/ForecastNiue_latest.nc" +
    `?REQUEST=GetTimeseries` +
    `&LAYERS=${layer}` +
    `&QUERY_LAYERS=${layer}` +
    `&BBOX=${encodeURIComponent(data.bbox)}` +
    `&SRS=CRS:84` +
    `&FEATURE_COUNT=5` +
    `&HEIGHT=${data.height}` +
    `&WIDTH=${data.width}` +
    `&X=${x}` +
    `&Y=${y}` +
    `&STYLES=default/default` +
    `&VERSION=1.1.1` +
    (timeParam ? `&TIME=${encodeURIComponent(timeParam)}` : "") +
    `&INFO_FORMAT=text/json`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    if (attempt < 1) {
      await sleep(300);
      return fetchLayerTimeseries(layer, data, attempt + 1);
    }
    console.warn(`fetchLayerTimeseries: giving up on layer "${layer}" after retry`, err);
    return null;
  }
}

const MIN_HEIGHT = 100;
const MAX_HEIGHT = 800;

// A flat 500px default was cramped on shorter viewports (laptop windows,
// tablets in landscape) and left unused space on tall ones — scale with
// the viewport instead, still clamped to [MIN_HEIGHT, MAX_HEIGHT] and still
// freely drag-resizable afterward via the handle below.
function getDefaultHeight() {
  if (typeof window === 'undefined') return 500;
  return Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.min(window.innerHeight * 0.62, 620))));
}

const tabLabels = [
  { key: "tabular", label: "Tabular" },
  { key: "timeseries", label: "Timeseries" }
];

function BottomOffCanvas({
  show, onHide, data, currentSliderDate, timeDisplayZone, onTimeSelect, landingAreaTimeseries, seaLevelTimeseries, onRunRouteForecast,
  suitabilityApiBase, currentTimeIndex,
  currentRouteInputs, currentModelRunStart,
  scenarioCount, onConfirmVesselSuggestion,
  departureSuggestionLoading, departureSuggestionProgress, departureSuggestionResult, departureSuggestionError,
  onSuggestBetterDeparture, onApplyDepartureSuggestion, onSaveDepartureSuggestionAsScenario,
}) {
  const isRiskMode = data?.mode === "risk";
  const isSuitabilityMode = data?.mode === "suitability";
  const isInundationMode = data?.mode === "inundation";
  const isLandingAreaMode = data?.mode === "landing-area";
  const isRouteForecastMode = data?.mode === "route-forecast";
  const [height, setHeight] = useState(getDefaultHeight);
  const [activeTab, setActiveTab] = useState("tabular");
  const [perVariableData, setPerVariableData] = useState({});
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(false);

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

  // Drag handle logic
  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(500);
  const onMouseDown = (e) => {
    dragging.current = true;
    startY.current = e.clientY;
    startHeight.current = height;
    document.body.style.cursor = "ns-resize";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };
  const onMouseMove = (e) => {
    if (!dragging.current) return;
    let newHeight = startHeight.current - (e.clientY - startY.current);
    newHeight = Math.min(Math.max(newHeight, MIN_HEIGHT), MAX_HEIGHT);
    setHeight(newHeight);
  };
  const onMouseUp = () => {
    dragging.current = false;
    document.body.style.cursor = "";
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };

  // Centralized network fetching
  useEffect(() => {
    let isMounted = true;
    if (isRiskMode || isSuitabilityMode || isInundationMode || isLandingAreaMode || isRouteForecastMode) {
      setLoading(false);
      setFetchError("");
      return;
    }
    if (data?.loading) {
      setPerVariableData({});
      setFetchError("");
      setLoading(true);
      return () => { isMounted = false; };
    }
    if (data?.perVariableData) {
      setPerVariableData(data.perVariableData);
      setFetchError("");
      setLoading(false);
      return () => { isMounted = false; };
    }

    if (!data || !data.bbox || (data.x === undefined && data.i === undefined) || (data.y === undefined && data.j === undefined)) {
      setPerVariableData({});
      if (data?.error) console.error('[BottomOffCanvas] timeseries error:', data.error);
      setFetchError(data?.error || "No data available");
      return;
    }
    setLoading(true);
    setFetchError("");
    (async () => {
      // Fire every variable's request concurrently instead of one at a time —
      // sequentially awaiting ~13 round trips to the same host left a long
      // window where a single transient network failure on any one request
      // would permanently blank that row (and everything after it looked
      // fine only by luck of having resolved earlier in the chain).
      const layerKeys = variableDefs
        .map(({ key }) => key)
        .flatMap((key) => (key === "transp_x" ? ["transp_x", "transp_y"] : key === "transp_y" ? [] : [key]));

      const results = await Promise.allSettled(
        layerKeys.map((key) => fetchLayerTimeseries(key, data))
      );

      if (!isMounted) return;

      const out = {};
      layerKeys.forEach((key, idx) => {
        out[key] = results[idx].status === "fulfilled" ? results[idx].value : null;
      });

      setPerVariableData(out);
      setLoading(false);
      if (Object.values(out).every(x => !x)) {
        console.error('[BottomOffCanvas] all variable timeseries requests failed for', data);
        setFetchError("No data returned from server.");
      }
    })();
    return () => { isMounted = false; };
  }, [data, isRiskMode, isSuitabilityMode, isInundationMode, isLandingAreaMode, isRouteForecastMode]);

  // Inundation-mode timeseries errors are dev/ops signal, not something to
  // alarm the end user with — log to console instead of the red banner this
  // used to render.
  useEffect(() => {
    if (data?.error) console.error('[BottomOffCanvas] inundation timeseries error:', data.error);
  }, [data?.error]);

  return (
    <Offcanvas
      show={show}
      onHide={onHide}
      placement="bottom"
      className="bottom-offcanvas"
      style={{
        height: height,
        minHeight: height,
        maxHeight: height,
        zIndex: 15000,
        background: isDarkMode ? "rgba(63, 72, 84, 0.98)" : "rgba(255,255,255,0.98)",
        color: isDarkMode ? "#f1f5f9" : "#1e293b",
        overflow: "visible",
        transition: "height 0.1s",
        borderTop: `1px solid ${isDarkMode ? "#44454a" : "#e2e8f0"}`,
        // Override Bootstrap Offcanvas flex behavior
        display: "block",
        flex: "none",
        flexGrow: 0,
        flexShrink: 0,
        flexBasis: "auto",
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
      }}
      backdrop={false}
      scroll={true}
    >
      {/* Drag Handle */}
      <div
        className="drag-handle"
        style={{
          height: 22,
          display: "flex",
          alignItems: "center",
          cursor: "ns-resize",
          background: isDarkMode ? "#44454a" : "#e0e0e0",
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          textAlign: "center",
          userSelect: "none",
          margin: "-8px 0 0 0",
          position: "relative",
          zIndex: 1000,
        }}
        onMouseDown={onMouseDown}
        title="Drag to resize"
      >
        <div
          style={{
            width: 44,
            height: 4,
            background: isDarkMode ? "#a1a1aa" : "#aaa",
            borderRadius: 999,
            margin: "0 auto",
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
        <div style={{ display: "flex", flex: 1, paddingTop: 10 }} role="tablist">
          {!isRiskMode && !isSuitabilityMode && !isInundationMode && !isLandingAreaMode && !isRouteForecastMode && tabLabels.map(tab => (
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
      <Offcanvas.Body className={isInundationMode ? "bottom-offcanvas__body--inundation" : undefined} style={{ 
        paddingTop: 16,
        // 70 = drag handle (22px, was 12) + the tab/close-button row above this body.
        height: `${height - 70}px`,
        maxHeight: `${height - 70}px`,
        overflow: 'auto',
        position: 'relative'
      }}>
        {isRiskMode
          ? <RiskDetailsPanel data={data} isDarkMode={isDarkMode} currentSliderDate={currentSliderDate} onTimeSelect={onTimeSelect} timeDisplayZone={timeDisplayZone} />
          : isSuitabilityMode
          ? <SuitabilityDetailsPanel data={data} timeDisplayZone={timeDisplayZone} />
          : isLandingAreaMode
          ? (
            <LandingAreaDetailsPanel
              timeDisplayZone={timeDisplayZone}
              landingArea={{
                ...(data?.landingArea ?? {}),
                statistics_basis: landingAreaTimeseries?.data?.statistics_basis,
                fallback_reason: landingAreaTimeseries?.data?.fallback_reason,
                radiusKm: landingAreaTimeseries?.data?.radius_km ?? data?.landingArea?.radiusKm,
                face_count: landingAreaTimeseries?.data?.face_count,
                used_nearest_face_fallback: landingAreaTimeseries?.data?.used_nearest_face_fallback,
                available: landingAreaTimeseries?.data?.available,
                unavailable_reason: landingAreaTimeseries?.data?.unavailable_reason,
                land_or_off_mesh: landingAreaTimeseries?.data?.land_or_off_mesh,
              }}
              selectedVessel={data?.selectedVessel}
              steps={landingAreaTimeseries?.data?.steps}
              loading={landingAreaTimeseries?.loading}
              error={landingAreaTimeseries?.error}
              currentSliderDate={currentSliderDate}
              isDarkMode={isDarkMode}
              apiBase={suitabilityApiBase}
              seaLevelTimeseries={seaLevelTimeseries}
            />
          )
          : isRouteForecastMode
          ? (
            <RouteForecastPanel
              data={data}
              timeDisplayZone={timeDisplayZone}
              onRetry={onRunRouteForecast}
              canRetry={(data?.routePoints?.length ?? 0) >= 2 && !data?.loading}
              currentRouteInputs={currentRouteInputs}
              currentModelRunStart={currentModelRunStart}
              scenarioCount={scenarioCount}
              onConfirmVesselSuggestion={onConfirmVesselSuggestion}
              departureSuggestionLoading={departureSuggestionLoading}
              departureSuggestionProgress={departureSuggestionProgress}
              departureSuggestionResult={departureSuggestionResult}
              departureSuggestionError={departureSuggestionError}
              onSuggestBetterDeparture={onSuggestBetterDeparture}
              onApplyDepartureSuggestion={onApplyDepartureSuggestion}
              onSaveDepartureSuggestionAsScenario={onSaveDepartureSuggestionAsScenario}
              seaLevelTimeseries={seaLevelTimeseries}
              apiBase={suitabilityApiBase}
              currentTimeIndex={currentTimeIndex}
            />
          )
          : isInundationMode
          ? data?.loading
            ? <div style={{ textAlign: "center", padding: "2rem" }}>Loading depth timeseries...</div>
            : data?.noData
              ? (
                <div style={{
                  textAlign: "center",
                  padding: "2rem",
                  color: "rgba(255,255,255,0.55)",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}>
                  <strong>No flood depth at this location</strong>
                  <div style={{ marginTop: "0.4rem", fontSize: 12 }}>
                    This area is not projected to flood during the forecast window.
                    <br />
                    Click on a coloured area of the inundation layer to see depth data.
                  </div>
                </div>
              )
              : data?.error
                ? null
                : <InundationTimeseries
                    timeseries={data?.timeseries}
                    categories={data?.categories}
                    rangeWindow={data?.rangeWindow}
                    isDarkMode={isDarkMode}
                    currentSliderDate={currentSliderDate}
                    onTimeSelect={onTimeSelect}
                    seaLevelTimeseries={seaLevelTimeseries}
                  />
          : loading
          ? <div style={{ textAlign: "center", padding: "2rem" }}>Loading data...</div>
          : fetchError
              ? null
              : <>
                  {activeTab === "tabular" && <Tabular perVariableData={perVariableData} timeDisplayZone={timeDisplayZone} />}
                  {activeTab === "timeseries" && <Timeseries perVariableData={perVariableData} timeDisplayZone={timeDisplayZone} />}

                </>
        }
      </Offcanvas.Body>
    </Offcanvas>
  );
}

export default BottomOffCanvas;
