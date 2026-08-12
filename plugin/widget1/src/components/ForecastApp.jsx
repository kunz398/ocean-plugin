import { useEffect, useMemo, useState, useCallback } from 'react';
import './ForecastApp.css';
import '../styles/MapMarker.css';
import useMapInteraction from '../hooks/useMapInteraction';
import { UI_CONFIG } from '../config/UIConfig';
import { MARINE_CONFIG } from '../config/marineVariables';
import CompassRose from './CompassRose';
import BasemapSwitcher from './BasemapSwitcher';
import ForecastTimeline from './ForecastTimeline';
import InundationThresholdEditor from './InundationThresholdEditor';
import { isInundationLayer } from '../config/layerConfig';
import { buildBreakLegendConfig, buildInundationLegendBands, buildContinuousLegendConfig } from '../domain/inundation/legendBands';
import { getColormap } from '../lib/colormaps';
import {
  VESSEL_CLASSES,
  SUITABILITY_MAP_HAZARD_LABELS,
  SUITABILITY_HAZARD_COLORS,
  VESSEL_OPERATING_ENVELOPE,
  VESSEL_OPERATING_ENVELOPE_STATUS,
} from '../lib/NiueSuitabilityOverlay';
import AdvisoryPdfModal from './advisory/AdvisoryPdfModal';
import UserGuide from './UserGuide';
import LandingAreaPanel from './landingArea/LandingAreaPanel';
import RouteForecastControls from './route/RouteForecastControls';
import ScenarioComparisonPanel from './route/ScenarioComparisonPanel';
import {
  ControlGroup,
  VariableButtons,
  OpacityControl,
  DataInfo,
  //StatusBar
} from './shared/UIComponents';
import wmsStyleManager from '../utils/WMSStyleManager';
import { Waves, Wind, Navigation, Activity, Info, Settings, Timer, Triangle,  BadgeInfo , CloudRain, FastForward, SlidersHorizontal, FileDown, Crosshair, MapPin, Route as RouteIcon, FileText, Ship, HelpCircle } from 'lucide-react';
import FancyIcon from './FancyIcon';
import '../styles/fancyIcons.css';

const EPSILON = 1e-6;

// Rainbow wave height color palette (Blue → Cyan → Green → Yellow → Orange → Red)
const WAVE_HEIGHT_GRADIENT_RGB = [
  [0, 0, 143],      // Dark blue (0.0m)
  [0, 0, 255],      // Blue
  [0, 255, 255],    // Cyan (1.0m)
  [0, 255, 0],      // Green (2.0m)
  [255, 255, 0],    // Yellow (3.0m)
  [255, 127, 0],    // Orange
  [255, 0, 0]       // Red (4.0m+)
];

// Helper to interpolate wave height colors
const interpolateWaveHeight = (normalized) => {
  const t = Math.max(0, Math.min(1, normalized));
  const maxIndex = WAVE_HEIGHT_GRADIENT_RGB.length - 1;
  const index = t * maxIndex;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.min(Math.ceil(index), maxIndex);
  const fraction = index - lowerIndex;
  
  const lower = WAVE_HEIGHT_GRADIENT_RGB[lowerIndex];
  const upper = WAVE_HEIGHT_GRADIENT_RGB[upperIndex];
  
  const r = Math.round(lower[0] + (upper[0] - lower[0]) * fraction);
  const g = Math.round(lower[1] + (upper[1] - lower[1]) * fraction);
  const b = Math.round(lower[2] + (upper[2] - lower[2]) * fraction);
  
  return `rgb(${r}, ${g}, ${b})`;
};


const MEAN_PERIOD_METADATA = [
  { min: 0, max: 6, label: 'Wind Waves', value: '0–6 s', description: 'Locally generated wind waves with short periods', color: '#D53E4F' },
  { min: 6, max: 10, label: 'Young Swell', value: '6–10 s', description: 'Developing swell with moderate periods', color: '#FDAE61' },
  { min: 10, max: 14, label: 'Mature Swell', value: '10–14 s', description: 'Well-developed swell waves', color: '#ABDDA4' },
  { min: 14, max: 18, label: 'Long Swell', value: '14–18 s', description: 'Long-period swell from distant sources', color: '#66C2A5' },
  { min: 18, max: 20, label: 'Ultra-Long Swell', value: '18–20 s', description: 'Extreme long-period waves', color: '#5E4FA2' }
];

const PEAK_PERIOD_METADATA = [
  { min: 9, max: 10, label: 'Short Peak', value: '9–10 s', description: 'Short-period spectral peaks', color: '#46039F' },
  { min: 10, max: 11.5, label: 'Moderate Peak', value: '10–11.5 s', description: 'Moderate-period spectral concentration', color: '#7201A8' },
  { min: 11.5, max: 13, label: 'Long Peak', value: '11.5–13 s', description: 'Long-period dominant waves', color: '#CC4778' },
  { min: 13, max: 14, label: 'Extended Peak', value: '13–14 s', description: 'Extended long-period peaks', color: '#F0F921' }
];

// Dynamic inundation metadata generator - adapts to actual data range
const generateInundationMetadata = (maxValue) => {
  const categories = [
    { threshold: 0, label: 'Dry Ground', description: 'No surface water present', color: '#f7fbff' },
    { threshold: 0.15, label: 'Minor Ponding', description: 'Shallow nuisance water on low-lying surfaces', color: '#deebf7' },
    { threshold: 0.4, label: 'Shallow Flooding', description: 'Curb-deep flooding across roads and properties', color: '#c6dbef' },
    { threshold: 0.8, label: 'Significant Flooding', description: 'Knee-to-waist depth inundation impacting structures', color: '#6baed6' },
    { threshold: 1.2, label: 'Deep Flooding', description: 'Substantial inundation with unsafe currents', color: '#3182bd' },
    { threshold: 1.6, label: 'Extreme Flooding', description: 'Life-threatening inundation requiring evacuation', color: '#08519c' }
  ];
  
  const metadata = [];
  let prevThreshold = -0.05; // Start from dry ground
  
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const nextThreshold = i < categories.length - 1 ? categories[i + 1].threshold : maxValue;
    
    // Only add category if it's within the data range
    if (prevThreshold < maxValue) {
      const max = Math.min(nextThreshold, maxValue);
      const valueStr = i === 0 
        ? `≤ ${cat.threshold.toFixed(2)} m`
        : max >= maxValue && i === categories.length - 1
        ? `≥ ${cat.threshold.toFixed(2)} m`
        : `${cat.threshold.toFixed(2)}–${max.toFixed(2)} m`;
      
      metadata.push({
        min: prevThreshold,
        max: max,
        label: cat.label,
        value: valueStr,
        description: cat.description,
        color: cat.color
      });
      
      prevThreshold = nextThreshold;
      
      // Stop if we've reached the max value
      if (max >= maxValue) break;
    }
  }
  
  return metadata;
};

const DIRECTION_METADATA = [
  { value: 'N (↑)', label: 'North', description: 'Flowing toward the north', color: 'rgba(255, 255, 255, 0.3)' },
  { value: 'NE (↗)', label: 'Northeast', description: 'Flowing toward the northeast', color: 'rgba(255, 255, 255, 0.3)' },
  { value: 'E (→)', label: 'East', description: 'Flowing toward the east', color: 'rgba(255, 255, 255, 0.3)' },
  { value: 'SE (↘)', label: 'Southeast', description: 'Flowing toward the southeast', color: 'rgba(255, 255, 255, 0.3)' },
  { value: 'S (↓)', label: 'South', description: 'Flowing toward the south', color: 'rgba(255, 255, 255, 0.3)' },
  { value: 'SW (↙)', label: 'Southwest', description: 'Flowing toward the southwest', color: 'rgba(255, 255, 255, 0.3)' },
  { value: 'W (←)', label: 'West', description: 'Flowing toward the west', color: 'rgba(255, 255, 255, 0.3)' },
  { value: 'NW (↖)', label: 'Northwest', description: 'Flowing toward the northwest', color: 'rgba(255, 255, 255, 0.3)' }
];

// Arrow-key roving navigation for segmented radiogroup/tablist controls
// (role="radiogroup"/"tablist" wrapping role="radio"/"tab" buttons) — the
// WAI-ARIA APG expects Left/Right/Home/End to move both focus and selection
// between options. Plain <button> elements only give free Tab-stop +
// Enter/Space activation, not this roving behaviour, so every segmented
// control in this file (wave motion, particle detail, swell sources, vessel
// class, suitability tabs) wires this in via onKeyDown on its container.
function handleSegmentedKeyDown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const items = Array.from(
    event.currentTarget.querySelectorAll('[role="radio"], [role="tab"]')
  ).filter((el) => !el.disabled);
  if (!items.length) return;

  const currentIndex = items.indexOf(document.activeElement);
  let nextIndex;
  if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = items.length - 1;
  else {
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const baseIndex = currentIndex === -1 ? 0 : currentIndex;
    nextIndex = (baseIndex + delta + items.length) % items.length;
  }

  event.preventDefault();
  items[nextIndex].focus();
  items[nextIndex].click();
}

// The suitability side panel used to stack vessel class, PDF export,
// landing-area picker, and route planner as flat siblings under one
// "Display Options" heading — functional, but the user had to visually
// parse four competing workflows at once. Splitting them into tabs keeps
// vessel class (shared by all of them) visible while making each workflow
// a deliberate choice.
const SUITABILITY_TABS = [
  { id: 'point', label: 'Point', short: 'Inspect', icon: Crosshair },
  { id: 'landing', label: 'Landing', short: 'Launch', icon: MapPin },
  { id: 'route', label: 'Route', short: 'Transit', icon: RouteIcon },
  { id: 'advisory', label: 'Advisory', short: 'PDF', icon: FileText },
];

const VESSEL_SELECTOR_ICON_STEMS = {
  traditional_craft: 'Vaka',
  very_small_motorised_craft: 'Fishing Boat',
  small_craft: 'Ferry',
  larger_vessels: 'Container Ship',
};

const VESSEL_SELECTOR_ICON_COLORS = {
  0: 'Green',
  1: 'Amber',
  2: 'Red',
};

const toFiniteNumberOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normaliseVesselSummaryForIcon = (raw) => {
  if (!raw) return null;
  return {
    hazard_class: toFiniteNumberOrNull(raw.hazard_class ?? raw.overall_hazard_class),
    warning_percent: toFiniteNumberOrNull(raw.warning_percent ?? raw.percentages?.warning),
    caution_percent: toFiniteNumberOrNull(raw.caution_percent ?? raw.percentages?.caution),
    suitable_percent: toFiniteNumberOrNull(raw.suitable_percent ?? raw.percentages?.suitable),
  };
};

const deriveVesselIconHazard = (raw) => {
  const summary = normaliseVesselSummaryForIcon(raw);
  if (!summary) return 0;
  if (summary.hazard_class !== null) {
    return Math.max(0, Math.min(2, Math.round(summary.hazard_class)));
  }
  if ((summary.warning_percent ?? 0) > 0) return 2;
  if ((summary.caution_percent ?? 0) > 0) return 1;
  return 0;
};

const getVesselSelectorIconSrc = (vesselCode, hazardClass = 0) => {
  const stem = VESSEL_SELECTOR_ICON_STEMS[vesselCode];
  if (!stem) return null;
  const color = VESSEL_SELECTOR_ICON_COLORS[hazardClass] ?? 'Green';
  const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  return `${base}/vessels/${encodeURIComponent(`${stem} ${color}.svg`)}`;
};

// Advanced wave controls belong on the advanced-features branch. Keep the
// implementation here dormant so this branch exposes only the core controls.
const SHOW_ADVANCED_WAVE_CONTROLS = false;

const stationColor = (station) => station.type === 'tide-gauge'
  ? '#f59e0b'
  : station.highlight ? '#22c55e' : '#0ea5e9';

const OceanStationsLegend = ({ stations, onSelect }) => {
  if (!stations?.length) return null;
  return (
    <div className="marine-legend-stations">
      <div className="marine-legend-stations__title">Ocean Stations &middot; Niue</div>
      <div className="marine-legend-stations__list">
        {stations.map((station) => {
          const color = stationColor(station);
          return (
            <button
              key={station.id}
              type="button"
              className="marine-legend-station"
              style={{ '--station-color': color, '--station-background': `${color}1f` }}
              onClick={() => onSelect?.(station)}
            >
              <span className="marine-legend-station__name">
                <span className="marine-legend-station__dot" />
                {station.label ?? station.id}
              </span>
              <span className="marine-legend-station__type">
                {station.type === 'tide-gauge' ? 'Tide gauge' : station.highlight ? 'Buoy + model' : 'Live buoy'}
              </span>
            </button>
          );
        })}
      </div>
      <div className="marine-legend-stations__footer">Click a station for live data</div>
    </div>
  );
};

const ForecastApp = ({
  WAVE_FORECAST_LAYERS,
  ALL_LAYERS,
  selectedWaveForecast,
  setSelectedWaveForecast,
  opacity,
  setOpacity,
  sliderIndex,
  setSliderIndex,
  totalSteps,
  isPlaying,
  setIsPlaying,
  playSpeedMs = 700,
  setPlaySpeedMs,
  currentSliderDate,
  capTime,
  forecastEndTime,
  forecastStartTime,
  setActiveLayers,
  mapRef,
  mapInstance,
  setBasemap,
  setBottomCanvasData,
  setShowBottomCanvas,
  minIndex,
  enableLegacyMapInteraction = true,
  waveParticleMode = 'off',
  setWaveParticleMode,
  particleQuality = 'balanced',
  setParticleQuality,
  swellSourcesEnabled = false,
  setSwellSourcesEnabled,
  selectedVessel = 'traditional_craft',
  setSelectedVessel,
  landingArea = null,
  setLandingArea,
  landingAreaPickMode = false,
  setLandingAreaPickMode,
  routePoints = [],
  routePickMode = false,
  setRoutePickMode,
  routeSpeedKt = 8,
  setRouteSpeedKt,
  routeDepartureTime = '',
  setRouteDepartureTime,
  routeForecastLoading = false,
  routeForecastError = '',
  onRunRouteForecast,
  onClearRoute,
  onUndoRoutePoint,
  onRouteImport,
  scenarios = [],
  confirmedScenarioId = null,
  runningScenarioIds = [],
  currentModelRunStart = null,
  overlayStats = null,
  onSaveCurrentAsScenario,
  onDuplicateScenario,
  onRemoveScenario,
  onRunScenario,
  onRunAllScenarios,
  inundationThresholds,
  inundationRenderMode,
  setInundationRenderMode,
  oceanStations = [],
  onOceanStationSelect,
  timeDisplayZone,
  setTimeDisplayZone,
}) => {
  const [showTimelineInPanel, setShowTimelineInPanel] = useState(false);
  const [showThresholdEditor, setShowThresholdEditor] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [showUserGuide, setShowUserGuide] = useState(false);
  const [suitabilityTab, setSuitabilityTab] = useState('point');
  const [vesselIconHazards, setVesselIconHazards] = useState({});
  const [vesselSuitabilitySummaries, setVesselSuitabilitySummaries] = useState({});
  const [showSuitabilityHazardInfo, setShowSuitabilityHazardInfo] = useState(false);
  const selectedLayerConfig = ALL_LAYERS.find((l) => l.value === selectedWaveForecast);
  const isInundationSelected = isInundationLayer(selectedWaveForecast);
  const isSwanLayer = selectedLayerConfig?.type === 'ugrid';
  const isSuitabilitySelected = selectedLayerConfig?.sourceType === 'niue-suitability-raster';
  const suitabilityApiBase = isSuitabilitySelected ? (selectedLayerConfig?.apiBase ?? '') : '';
  const selectedVesselMeta = VESSEL_CLASSES.find((v) => v.value === selectedVessel) ?? VESSEL_CLASSES[0];
  const selectedVesselEnvelope = VESSEL_OPERATING_ENVELOPE[selectedVessel] ?? null;

  // A dominant single-class summary renders most/all of the raster tile as one
  // flat color (e.g. mostly "Avoid"), which can read as visually indistinguishable
  // from a broken/no-data layer. Surface the underlying percentage so it reads
  // as confirmed hazard rather than a rendering glitch. The stats are domain-wide
  // (not just the visible viewport) and the tile only uses 3 discrete colors with
  // no gradient, so even a ~80% dominant class can visually look "flat" to a
  // viewer — the threshold is set well below 100% to match that perception.
  const DOMINANT_HAZARD_THRESHOLD_PERCENT = 75;
  const selectedVesselSummary = vesselSuitabilitySummaries[selectedVessel] ?? null;
  const dominantSuitabilityHazard = (() => {
    if (!selectedVesselSummary) return null;
    const { warning_percent: warn, caution_percent: caution, suitable_percent: suitable } = selectedVesselSummary;
    const entries = [
      [2, warn],
      [1, caution],
      [0, suitable],
    ].filter(([, pct]) => Number.isFinite(pct));
    if (!entries.length) return null;
    const [hazardVal, pct] = entries.reduce((max, entry) => (entry[1] > max[1] ? entry : max));
    return pct >= DOMINANT_HAZARD_THRESHOLD_PERCENT ? { hazardVal, pct } : null;
  })();

  useEffect(() => {
    if (!isSuitabilitySelected || !suitabilityApiBase) {
      setVesselIconHazards({});
      setVesselSuitabilitySummaries({});
      return undefined;
    }

    let cancelled = false;
    const base = suitabilityApiBase.replace(/\/$/, '');

    const fetchJson = async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Suitability summary ${response.status}`);
      return response.json();
    };

    const loadIconHazards = async () => {
      try {
        const summaryUrl = `${base}/niue/suitability/summary/${sliderIndex}`;
        const summary = await fetchJson(summaryUrl);
        let vessels = summary?.vessels ?? null;

        if (!vessels) {
          const perVessel = await Promise.all(
            VESSEL_CLASSES.map(async (vessel) => {
              try {
                const data = await fetchJson(`${summaryUrl}?vessel=${vessel.value}`);
                return [vessel.value, data];
              } catch (_) {
                return [vessel.value, null];
              }
            })
          );
          vessels = Object.fromEntries(perVessel);
        }

        const nextHazards = {};
        const nextSummaries = {};
        VESSEL_CLASSES.forEach((vessel) => {
          const entry = vessels?.[vessel.value] ?? (summary?.vessel === vessel.value ? summary : null);
          nextHazards[vessel.value] = deriveVesselIconHazard(entry);
          nextSummaries[vessel.value] = normaliseVesselSummaryForIcon(entry);
        });

        if (!cancelled) {
          setVesselIconHazards(nextHazards);
          setVesselSuitabilitySummaries(nextSummaries);
        }
      } catch (_) {
        if (!cancelled) {
          setVesselIconHazards({});
          setVesselSuitabilitySummaries({});
        }
      }
    };

    loadIconHazards();
    return () => {
      cancelled = true;
    };
  }, [isSuitabilitySelected, sliderIndex, suitabilityApiBase]);

  const handlePreviousTimestamp = useCallback(() => {
    setSliderIndex((prev) => Math.max(minIndex ?? 0, prev - 1));
  }, [setSliderIndex, minIndex]);

  const handleNextTimestamp = useCallback(() => {
    setSliderIndex((prev) => Math.min(totalSteps, prev + 1));
  }, [setSliderIndex, totalSteps]);
  // Dynamic marine legend configuration - RESPONDS TO ACTUAL DATA
  const getLegendConfig = (variable, layerData) => {
    const varLower = variable.toLowerCase();
    
    // Parse dynamic ranges from layer data
    const colorRange = layerData ? parseColorRange(layerData.colorscalerange) : null;
    const dynamicMax = layerData?.activeBeaufortMax;

    // Layers with fixed color-bin breakpoints (hs, tm02, tpeak) render discrete
    // bands on the map (see UgridOverlay.js bandColors) — the legend must use
    // the same breaks/colormap so it stays a single source of truth.
    if (layerData?.colorBreaks?.length > 1) {
      return buildBreakLegendConfig({
        colorBreaks: layerData.colorBreaks,
        colorLabels: layerData.colorLabels,
        colorRange: { min: layerData.colorRange?.min ?? 0, max: layerData.colorRange?.max ?? 5 },
        units: layerData.units ?? '',
        colormapFn: getColormap(layerData.colormap),
      });
    }

    if (varLower.includes('hs')) {
      // DYNAMIC DATA RANGE - Updates with actual wave height data (Rainbow palette)
      const minVal = colorRange?.min ?? 0;
      const maxVal = Number.isFinite(dynamicMax) ? dynamicMax : (colorRange?.max ?? 4);
      const tickCount = 5;
      const ticks = Array.from({length: tickCount}, (_, i) => 
        Number((minVal + (maxVal - minVal) * i / (tickCount - 1)).toFixed(1))
      );
      
      // Generate smooth rainbow gradient using interpolation
      const valueSpan = Math.max(maxVal - minVal, 0);
      const gradientStopCount = Math.max(2, Math.min(128, Math.ceil(Math.max(valueSpan, 1) * 32)));
      
      const waveHeightGradient = [];
      for (let i = 0; i < gradientStopCount; i++) {
        const normalized = i / (gradientStopCount - 1);
        waveHeightGradient.push(interpolateWaveHeight(normalized));
      }
      
      const denominator = Math.max(waveHeightGradient.length - 1, 1);
      const gradientStops = waveHeightGradient.map((color, index) => {
        const percent = (index / denominator) * 100;
        return `${color} ${percent.toFixed(2)}%`;
      });
      
      const gradient = `linear-gradient(to top, ${gradientStops.join(', ')})`;
      
      return {
        gradient,
        min: minVal,
        max: maxVal,
        units: 'm',
        ticks: ticks
      };
    }
    
    if (varLower.includes('tm02')) {
      // DYNAMIC DATA RANGE - Updates with actual mean period data
      const minVal = colorRange?.min ?? 0;
      const maxVal = colorRange?.max ?? 20;
      const ticks = [minVal, maxVal * 0.25, maxVal * 0.5, maxVal * 0.75, maxVal].map(v => Number(v.toFixed(1)));
      
      return {
        gradient: 'linear-gradient(to top, rgb(0, 0, 255), rgb(0, 255, 255), rgb(0, 255, 0), rgb(255, 255, 0), rgb(255, 0, 0))',
        min: minVal,
        max: maxVal,
        units: 's',
        ticks: ticks
      };
    }
    
    if (varLower.includes('tpeak')) {
      // DYNAMIC DATA RANGE - Updates with actual peak period data
      const minVal = colorRange?.min ?? 10.0;
      const maxVal = colorRange?.max ?? 13.7;
      const range = maxVal - minVal;
      const ticks = Array.from({length: 5}, (_, i) => 
        Number((minVal + range * i / 4).toFixed(1))
      );
      
      return {
        gradient: 'linear-gradient(to top, rgb(255, 255, 178), rgb(254, 204, 92), rgb(253, 141, 60), rgb(240, 59, 32), rgb(189, 0, 38))',
        min: minVal,
        max: maxVal,
        units: 's',
        ticks: ticks
      };
    }
    
    if (varLower.includes('inun')) {
      if (inundationRenderMode === 'continuous') {
        return buildContinuousLegendConfig({
          colorRange: { min: layerData?.colorRange?.min ?? colorRange?.min ?? 0.05, max: layerData?.colorRange?.max ?? colorRange?.max ?? 6.0 },
          colormapFn: getColormap('turbo'),
          units: 'm',
        });
      }
      // Bands, colors, and the visible-depth cutoff come from the live
      // inundationThresholds editor state — not the raw WMS colorscalerange —
      // so the legend always matches what the raster/chart are actually showing.
      return {
        ...buildInundationLegendBands({
          categories: inundationThresholds?.categories,
          minVisibleDepth: inundationThresholds?.minVisibleDepth,
          colorscalerange: layerData?.colorscalerange,
          rasterMinDepth: colorRange?.min,
          rasterMaxDepth: colorRange?.max,
        }),
        units: 'm',
      };
    }
    
    if (varLower.includes('dirm')) {
      // Wave direction - Static compass (doesn't change with data)
      return {
        gradient: 'conic-gradient(from 0deg, transparent)',
        min: 0,
        max: 360,
        units: '°',
        ticks: [0, 90, 180, 270, 360]
      };
    }
    
    return null;
  };

  const selectedLegendLayer = useMemo(() => {
    if (!selectedWaveForecast) return null;

    const findLayerByValue = (layers, value) => {
      if (!Array.isArray(layers)) return null;
      for (const layer of layers) {
        if (layer?.value === value) {
          return layer;
        }
        if (layer?.composite && Array.isArray(layer.layers)) {
          const match = findLayerByValue(layer.layers, value);
          if (match) return match;
        }
      }
      return null;
    };

    const dynamicMatch = findLayerByValue(WAVE_FORECAST_LAYERS, selectedWaveForecast);
    const baseLayer = dynamicMatch || findLayerByValue(ALL_LAYERS, selectedWaveForecast);
    if (!baseLayer) {
      return null;
    }

    if (!baseLayer.composite) {
      return baseLayer;
    }

    const PRIORITY_VARIABLES = ['hs', 'wave_height', 'tm02', 'tpeak', 'period', 'inun', 'flood'];
    const { layers } = baseLayer;
    if (!Array.isArray(layers)) {
      return baseLayer;
    }

    const directMatch = layers.find(subLayer => subLayer?.value === selectedWaveForecast);
    if (directMatch) {
      return directMatch;
    }

    for (const key of PRIORITY_VARIABLES) {
      const match = layers.find(subLayer => subLayer?.value?.toLowerCase().includes(key));
      if (match) {
        return match;
      }
    }

    return layers[0] || baseLayer;
  }, [ALL_LAYERS, WAVE_FORECAST_LAYERS, selectedWaveForecast]);

  const parseColorRange = (rangeString) => {
    if (!rangeString) return null;
    const parts = rangeString.split(',');
    if (parts.length !== 2) return null;
    const min = Number(parts[0]);
    const max = Number(parts[1]);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return null;
    }
    return { min, max };
  };

  // eslint-disable-next-line no-unused-vars
  const metadataRanges = useMemo(() => {
    if (!selectedLegendLayer) {
      return [];
    }

    const variable = selectedLegendLayer.value?.toLowerCase() || '';

    if (variable.includes('hs') || variable.includes('wave_height')) {
      // Parse actual WMS data range
      const colorRange = parseColorRange(selectedLegendLayer.colorscalerange);
      const dataMin = colorRange?.min ?? 0.17; // Niue minimum
      const dataMax = colorRange?.max ?? 1.66; // Niue maximum
      
      const effectiveMax = Number.isFinite(selectedLegendLayer.activeBeaufortMax)
        ? selectedLegendLayer.activeBeaufortMax
        : dataMax;
      
      // Generate actual Viridis colors based on real data range
      const generateViridisColor = (value, min, max) => {
        const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)));
        // Viridis color interpolation (accurate to WMS server)
        if (normalized <= 0.25) {
          const t = normalized / 0.25;
          return `rgb(${Math.round(68 + (59-68)*t)}, ${Math.round(1 + (82-1)*t)}, ${Math.round(84 + (139-84)*t)})`;
        } else if (normalized <= 0.5) {
          const t = (normalized - 0.25) / 0.25;
          return `rgb(${Math.round(59 + (31-59)*t)}, ${Math.round(82 + (158-82)*t)}, ${Math.round(139 + (137-139)*t)})`;
        } else if (normalized <= 0.75) {
          const t = (normalized - 0.5) / 0.25;
          return `rgb(${Math.round(31 + (176-31)*t)}, ${Math.round(158 + (202-158)*t)}, ${Math.round(137 + (99-137)*t)})`;
        } else {
          const t = (normalized - 0.75) / 0.25;
          return `rgb(${Math.round(176 + (253-176)*t)}, ${Math.round(202 + (231-202)*t)}, ${Math.round(99 + (37-99)*t)})`;
        }
      };
      
      // Create appropriate number of color stops based on data range
      const numStops = Math.max(2, Math.min(5, Math.ceil(effectiveMax * 2))); // Adaptive number of stops
      const colorStops = [];
      
      for (let i = 0; i < numStops; i++) {
        const value = dataMin + (effectiveMax - dataMin) * (i / (numStops - 1));
        colorStops.push({
          value: value,
          color: generateViridisColor(value, dataMin, effectiveMax)
        });
      }

      const ranges = [];
      let previous = 0;

      for (const stop of colorStops) {
        if (!Number.isFinite(stop.value)) {
          continue;
        }
        const upper = Math.min(stop.value, effectiveMax);
        if (upper <= previous + EPSILON) {
          continue;
        }

        ranges.push({
          min: previous,
          max: upper,
          label: wmsStyleManager.getWaveHeightLabel(upper),
          value: `${wmsStyleManager.formatWaveHeightValue(previous)}–${wmsStyleManager.formatWaveHeightValue(upper)} m`,
          description: wmsStyleManager.getWaveHeightDescription(previous, upper, { 
            dataMax: effectiveMax,
            location: 'Niue'
          }),
          color: stop.color
        });

        previous = upper;

        if (stop.value >= effectiveMax - EPSILON) {
          break;
        }
      }

      if (effectiveMax > previous + EPSILON) {
        const lastColor = colorStops[colorStops.length - 1]?.color || '#ffffff';
        ranges.push({
          min: previous,
          max: effectiveMax,
          label: wmsStyleManager.getWaveHeightLabel(effectiveMax),
          value: `${wmsStyleManager.formatWaveHeightValue(previous)}–${wmsStyleManager.formatWaveHeightValue(effectiveMax)} m`,
          description: wmsStyleManager.getWaveHeightDescription(previous, effectiveMax, { 
            dataMax: effectiveMax,
            location: 'Niue'
          }),
          color: lastColor
        });
      }

      return ranges;
    }

    if (variable.includes('tm02')) {
      return MEAN_PERIOD_METADATA.map(range => ({ ...range }));
    }

    if (variable.includes('tpeak')) {
      return PEAK_PERIOD_METADATA.map(range => ({ ...range }));
    }

    if (variable.includes('inun') || variable.includes('flood')) {
      // Parse actual WMS data range for dynamic metadata
      const colorRange = parseColorRange(selectedLegendLayer.colorscalerange);
      const maxVal = colorRange?.max ?? 3.0; // Default to 3m if no data available
      return generateInundationMetadata(maxVal);
    }

    if (variable.includes('dirm') || variable.includes('direction')) {
      return DIRECTION_METADATA.map(range => ({ ...range }));
    }

    return [];
  }, [selectedLegendLayer]);

  // Function to get fancy icons for different variable types
  const getVariableIcon = (layer) => {
    const value = layer.value?.toLowerCase() || '';
    const label = layer.label?.toLowerCase() || '';
    
    if (value.includes('hs') || label.includes('Significantwave height')) {
      return <FancyIcon icon={Waves} animationType="wave" size={14} color="#00bcd4" style={{ marginRight: '8px' }} />;
    }
    if (value.includes('tm02') || (label.includes('mean') && label.includes('period'))) {
      return <FancyIcon icon={Timer} animationType="pulse" size={14} color="#ff9800" style={{ marginRight: '8px' }} />;
    }
    if (value.includes('tpeak') || (label.includes('peak') && label.includes('period'))) {
      return <FancyIcon icon={Triangle} animationType="bounce" size={14} color="#4caf50" style={{ marginRight: '8px' }} />;
    }
    if (value.includes('dirm') || label.includes('direction')) {
      return <FancyIcon icon={Navigation} animationType="spin" size={14} color="#9c27b0" style={{ marginRight: '8px' }} />;
    }
    if (value.includes('inun') || label.includes('inundation')) {
      return <FancyIcon icon={CloudRain} animationType="shimmer" size={14} color="#2196f3" style={{ marginRight: '8px' }} />;
    }
    if (value.includes('suitab') || label.includes('suitability')) {
      return <FancyIcon icon={Ship} animationType="pulse" size={14} color="#00bcd4" style={{ marginRight: '8px' }} />;
    }
    if (value.includes('wind') || label.includes('wind')) {
      return <FancyIcon icon={Wind} animationType="wave" size={14} color="#795548" style={{ marginRight: '8px' }} />;
    }
    
    // Default icon for unknown variables
    return <FancyIcon icon={Activity} animationType="pulse" size={14} color="#607d8b" style={{ marginRight: '8px' }} />;
  };

  // Effect to handle initial composite layer selection.


  const handleVariableChange = useCallback((layerValue) => {
    // Check if this is a placeholder layer
    const selectedLayer = ALL_LAYERS.find(l => l.value === layerValue);
    if (selectedLayer?.isPlaceholder) {
      alert(selectedLayer.placeholderMessage || 'This data is not currently available.');
      return; // Don't change the selection for placeholder layers
    }
    
    setSelectedWaveForecast(layerValue);
    setActiveLayers(prev => ({ ...prev, waveForecast: true }));
  }, [ALL_LAYERS, setActiveLayers, setSelectedWaveForecast]);

  const handleUserGuideAction = useCallback((action) => {
    if (!action) return;
    if (action.type === 'timeline') {
      setShowTimelineInPanel(true);
      setShowUserGuide(false);
      return;
    }
    if (action.type === 'layer') {
      handleVariableChange(action.value);
      if (action.value === 'suitability') setSuitabilityTab('point');
      setShowUserGuide(false);
      return;
    }
    if (action.type === 'suitabilityTab') {
      handleVariableChange('suitability');
      setSuitabilityTab(action.value);
      setShowUserGuide(false);
    }
  }, [handleVariableChange]);

  const handlePlayToggle = () => {
    setIsPlaying(!isPlaying);
  };

  const handleSliderChange = (value) => {
    setSliderIndex(parseInt(value));
  };

  // Clean map interaction using service-based architecture. Disabled for the
  // MapLibre/Zarr runtime because useZarrMap owns click/timeseries handling.
  useMapInteraction({
    mapInstance,
    currentSliderDate,
    setBottomCanvasData,
    setShowBottomCanvas,
    debugMode: true,
    enabled: enableLegacyMapInteraction
  });

  return (
    <div className="forecast-app">
      <div className="main-container">
        <div className="map-section">
          <div ref={mapRef} id="map" className="forecast-map"></div>

          <BasemapSwitcher
            mapInstance={mapInstance}
            setBasemap={setBasemap}
            position="top-left"
          />

          {/* Enhanced Professional Compass Rose */}
          <CompassRose 
            position="top-right" 
            size={90} 
            responsive={true}
            mapRotation={0} 
          />
          
          {selectedLegendLayer && selectedLegendLayer.sourceType === 'niue-suitability-raster' && (
            <div className="marine-legend marine-legend--suitability">
              <div
                className="marine-legend-title"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}
              >
                <span>{selectedLegendLayer.label}</span>
                {dominantSuitabilityHazard && (
                  <button
                    type="button"
                    onClick={() => setShowSuitabilityHazardInfo((v) => !v)}
                    aria-expanded={showSuitabilityHazardInfo}
                    aria-label={showSuitabilityHazardInfo ? 'Hide dominant hazard details' : 'Show dominant hazard details'}
                    title={showSuitabilityHazardInfo ? 'Hide details' : 'Why is this all one color?'}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '14px',
                      height: '14px',
                      padding: 0,
                      border: 'none',
                      borderRadius: '50%',
                      background: showSuitabilityHazardInfo ? 'var(--legend-accent)' : 'rgba(255,255,255,0.2)',
                      color: showSuitabilityHazardInfo ? '#062b30' : 'rgba(255,255,255,0.85)',
                      fontSize: '9px',
                      lineHeight: 1,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    <i className="bi bi-info-lg" aria-hidden="true"></i>
                  </button>
                )}
              </div>
              <div className="marine-legend-content marine-legend-content--suitability">
                {[0, 1, 2].map((hazardVal) => (
                  <div key={hazardVal} className="marine-legend-suitability-row">
                    <span
                      className="marine-legend-suitability-swatch"
                      style={{ background: SUITABILITY_HAZARD_COLORS[hazardVal] }}
                    />
                    <span>{SUITABILITY_MAP_HAZARD_LABELS[hazardVal]}</span>
                  </div>
                ))}
              </div>
              {dominantSuitabilityHazard && showSuitabilityHazardInfo && (
                <div
                  className="marine-legend-suitability-note"
                  style={{
                    marginTop: '8px',
                    paddingTop: '8px',
                    borderTop: '1px solid rgba(255,255,255,0.15)',
                    fontSize: '0.72rem',
                    lineHeight: 1.3,
                    color: 'rgba(255,255,255,0.85)',
                  }}
                >
                  Confirmed forecast: {Math.round(dominantSuitabilityHazard.pct)}% of the visible area is{' '}
                  <strong style={{ color: SUITABILITY_HAZARD_COLORS[dominantSuitabilityHazard.hazardVal] }}>
                    {SUITABILITY_MAP_HAZARD_LABELS[dominantSuitabilityHazard.hazardVal]}
                  </strong>{' '}
                  for {selectedVesselMeta?.label ?? 'this vessel'} — this is model data, not a display error.
                </div>
              )}
              <OceanStationsLegend stations={oceanStations} onSelect={onOceanStationSelect} />
            </div>
          )}

          {selectedLegendLayer && selectedLegendLayer.sourceType !== 'niue-suitability-raster' && (
            <div className="marine-legend">
              {(() => {
                const legendConfig = getLegendConfig(selectedLegendLayer.value, selectedLegendLayer);
                if (!legendConfig) return null;

                // Position by actual value, not index — required for colorBreaks
                // legends (tm02/tpeak) whose breakpoints aren't evenly spaced.
                const range = legendConfig.max - legendConfig.min;
                const toPos = (val) => (range > 0 ? ((legendConfig.max - val) / range) * 100 : 0);

                return (
                  <>
                    <div className="marine-legend-title">{selectedLegendLayer.label}</div>
                    <div className="marine-legend-content">
                      <div
                        className="marine-legend-gradient"
                        style={{ background: legendConfig.gradient }}
                      />
                      <div className="marine-legend-scale">
                        {legendConfig.ticks.map((tick) => {
                          const band = legendConfig.tickBands?.[tick];
                          return (
                            <div
                              key={`legend-tick-${tick}`}
                              className={`marine-legend-tick${band ? ' marine-legend-tick--labeled' : ''}`}
                              style={{
                                top: `${toPos(tick)}%`,
                                transform: 'translateY(-50%)', // Center the tick on its position
                                left: '0px'
                              }}
                            >
                              {band && (
                                <span
                                  className="marine-legend-tick__swatch"
                                  style={{ background: band.color }}
                                />
                              )}
                              <span className="marine-legend-tick__value">{tick}{legendConfig.units}</span>
                              {band && (
                                <span className="marine-legend-tick__severity">
                                  <strong>{band.label}</strong>
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                );
              })()}
              <OceanStationsLegend stations={oceanStations} onSelect={onOceanStationSelect} />
            </div>
          )}
          
          {/* Metadata Panel - Bottom Left */}
          {/* <button
            type="button"
            className="metadata-toggle"
            onClick={() => setMetadataVisible(prev => !prev)}
            title={metadataVisible ? "Hide Range Info" : "Show Range Info"}
            aria-label={metadataVisible ? "Hide Range Info" : "Show Range Info"}
          >
            <FancyIcon 
              icon={BadgeInfo} 
              animationType="pulse" 
              size={16} 
              color="#00bcd4" 
            />
            {metadataVisible ? " Hide" : " Info"}
          </button> */}
          
          {/* {metadataVisible && selectedLayer && metadataRanges.length > 0 && (
            <div className="range-metadata-panel">
              <h4>
                <FancyIcon 
                  icon={getLayerIcon(selectedLayer).icon} 
                  animationType="wave" 
                  size={18} 
                  color={getLayerIcon(selectedLayer).color} 
                />
                {selectedLayer.label || 'Wave Data'}
                <span className="wmo-code">({layerMetadata.wmoCode})</span>
              </h4>
              
              {metadataRanges.map((range, index) => (
                <div
                  key={`${range.label}-${index}`}
                  className="range-item"
                >
                  <div className="range-item-left">
                    <div
                      className="range-color"
                      style={{ backgroundColor: range.color || 'rgba(255, 255, 255, 0.2)' }}
                    ></div>
                    <div className="range-content">
                      <span className="range-label">{range.label}</span>
                      <span className="range-description">{range.description}</span>
                    </div>
                  </div>
                  <span className="range-value">{range.value}</span>
                </div>
              ))}
              
              {/* Essential Info Summary *_/}
              <div className="metadata-section">
                <div className="metadata-summary">
                  <div className="metadata-item">
                    <span className="metadata-label">Source:</span>
                    <span className="metadata-value">{layerMetadata.provider}</span>
                  </div>
                  <div className="metadata-item">
                    <span className="metadata-label">Coverage:</span>
                    <span className="metadata-value">{layerMetadata.coverage}</span>
                  </div>
                  <div className="metadata-item">
                    <span className="metadata-label">Units:</span>
                    <span className="metadata-value">{layerMetadata.units}</span>
                  </div>
                </div>
                
                <button 
                  className="metadata-details-toggle"
                  onClick={() => setDetailedMetadataVisible(prev => !prev)}
                  title={detailedMetadataVisible ? "Hide Technical Details" : "Show Technical Details"}
                  aria-label={detailedMetadataVisible ? "Hide Technical Details" : "Show Technical Details"}
                >
                  <FancyIcon 
                    icon={Settings} 
                    animationType="spin" 
                    size={14} 
                    color="#9c27b0" 
                  />
                  {detailedMetadataVisible ? " Less" : " Details"}
                </button>
                
                {detailedMetadataVisible && (
                  <div className="metadata-details">
                    <div className="metadata-item">
                      <span className="metadata-label">Model:</span>
                      <span className="metadata-value">{layerMetadata.model}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Resolution:</span>
                      <span className="metadata-value">{layerMetadata.resolution}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Schedule:</span>
                      <span className="metadata-value">{layerMetadata.schedule}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Valid Time:</span>
                      <span className="metadata-value">{layerMetadata.validTime}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">WMO Standard:</span>
                      <span className="metadata-value">
                        {layerMetadata.wmoCode}
                        <span className={`confidence-indicator confidence-${layerMetadata.confidence.toLowerCase()}`}></span>
                      </span>
                    </div>
                    {layerMetadata.period && (
                      <div className="metadata-item">
                        <span className="metadata-label">Wave Period:</span>
                        <span className="metadata-value">{layerMetadata.period}</span>
                      </div>
                    )}
                    {layerMetadata.direction && (
                      <div className="metadata-item">
                        <span className="metadata-label">Direction:</span>
                        <span className="metadata-value">{layerMetadata.direction}</span>
                      </div>
                    )}
                    {layerMetadata.components && (
                      <div className="metadata-item">
                        <span className="metadata-label">Components:</span>
                        <span className="metadata-value">{layerMetadata.components}</span>
                      </div>
                    )}
                    {layerMetadata.datum && (
                      <div className="metadata-item">
                        <span className="metadata-label">Datum:</span>
                        <span className="metadata-value">{layerMetadata.datum}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )} */}

          {/* Bottom timeline overlay — hidden while pinned to the side panel */}
          {!showTimelineInPanel && (
            <ForecastTimeline
              sliderIndex={sliderIndex}
              totalSteps={totalSteps}
              minIndex={minIndex}
              currentSliderDate={currentSliderDate}
              capTime={capTime}
              isPlaying={isPlaying}
              playSpeedMs={playSpeedMs}
              timeDisplayZone={timeDisplayZone}
              onTimeIndexChange={handleSliderChange}
              onPlayPause={handlePlayToggle}
              onPrevious={handlePreviousTimestamp}
              onNext={handleNextTimestamp}
              onSpeedChange={setPlaySpeedMs}
              onTimezoneChange={setTimeDisplayZone}
              showInPanel={showTimelineInPanel}
              onTogglePanel={() => setShowTimelineInPanel((v) => !v)}
            />
          )}
        </div>

        <div className="controls-panel">
          <div className="forecast-controls">
            <button
              type="button"
              className="user-guide-trigger"
              onClick={() => setShowUserGuide(true)}
              aria-haspopup="dialog"
            >
              <span className="user-guide-trigger__main">
                <HelpCircle size={17} />
                User guide
              </span>
              <span className="user-guide-trigger__hint">Optional help</span>
            </button>

            <ControlGroup
              icon={<FancyIcon icon={Activity} animationType="shimmer" color="#00bcd4" />}
              title={UI_CONFIG.SECTIONS.FORECAST_VARIABLES.title}
              ariaLabel={UI_CONFIG.SECTIONS.FORECAST_VARIABLES.ariaLabel}
            >
              <VariableButtons
                layers={ALL_LAYERS}
                selectedValue={selectedWaveForecast}
                onVariableChange={handleVariableChange}
                labelMap={UI_CONFIG.VARIABLE_LABELS}
                ariaLabel={UI_CONFIG.ARIA_LABELS.variableButton}
                getVariableIcon={getVariableIcon}
              />
            </ControlGroup>

            {showTimelineInPanel && (
              <ControlGroup
                icon={<FancyIcon icon={FastForward} animationType="bounce" color="#ff9800" />}
                title={UI_CONFIG.SECTIONS.FORECAST_TIME.title}
                ariaLabel={UI_CONFIG.SECTIONS.FORECAST_TIME.ariaLabel}
              >
                <ForecastTimeline
                  inline
                  sliderIndex={sliderIndex}
                  totalSteps={totalSteps}
                  minIndex={minIndex}
                  currentSliderDate={currentSliderDate}
                  capTime={capTime}
                  isPlaying={isPlaying}
                  playSpeedMs={playSpeedMs}
                  timeDisplayZone={timeDisplayZone}
                  onTimeIndexChange={handleSliderChange}
                  onPlayPause={handlePlayToggle}
                  onPrevious={handlePreviousTimestamp}
                  onNext={handleNextTimestamp}
                  onSpeedChange={setPlaySpeedMs}
                  onTimezoneChange={setTimeDisplayZone}
                  showInPanel={showTimelineInPanel}
                  onTogglePanel={() => setShowTimelineInPanel((v) => !v)}
                />

                {/* ✅ Warm-up Period Notice */}
                {MARINE_CONFIG.SHOW_WARMUP_NOTICE && capTime.warmupSkipped && (
                <div style={{
                  marginTop: '0.75rem',
                  padding: '0.5rem 0.75rem',
                  background: 'rgba(33, 150, 243, 0.1)',
                  border: '1px solid rgba(33, 150, 243, 0.3)',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  color: '#90caf9',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <FancyIcon icon={BadgeInfo} animationType="pulse" size={16} color="#2196f3" />
                  <span>
                    Showing reliable forecast data (excluding {capTime.warmupDays}-day model initialization)
                  </span>
                </div>
                )}
              </ControlGroup>
            )}

            {isInundationSelected && (
              <ControlGroup
                icon={<FancyIcon icon={SlidersHorizontal} animationType="pulse" color="#90caf9" />}
                title="Dynamic Inundation Visualization"
                ariaLabel="Inundation threshold configuration"
              >
                <div className="inundation-threshold-trigger">
                  <button
                    type="button"
                    className={`inundation-threshold-trigger__btn${inundationThresholds.isDirty ? ' inundation-threshold-trigger__btn--dirty' : ''}`}
                    onClick={() => setShowThresholdEditor(true)}
                    title="Customise depth bands and severity labels"
                  >
                    <SlidersHorizontal size={14} />
                    Edit Thresholds
                    {inundationThresholds.isDirty && (
                      <span className="inundation-threshold-trigger__badge" title="Unsaved changes">●</span>
                    )}
                  </button>
                  <span className="inundation-threshold-trigger__count">
                    {`${inundationThresholds.categories.length} bands`}
                  </span>
                </div>
                <div className="inundation-threshold-trigger__hint">
                  Refine depth bands and severity descriptions. Changes apply live to the map raster, legend, and popup.
                </div>
              </ControlGroup>
            )}

            <ControlGroup
              icon={<FancyIcon icon={Settings} animationType="spin" color="#9c27b0" />}
              title={UI_CONFIG.SECTIONS.DISPLAY_OPTIONS.title}
              ariaLabel={UI_CONFIG.SECTIONS.DISPLAY_OPTIONS.ariaLabel}
            >
              <OpacityControl
                opacity={opacity}
                onOpacityChange={setOpacity}
                formatPercent={UI_CONFIG.FORMATS.opacityPercent}
                ariaLabel={UI_CONFIG.ARIA_LABELS.overlayOpacity}
              />

              {/* ── Wave motion (particles) ── only for SWAN UGRID layers */}
              {SHOW_ADVANCED_WAVE_CONTROLS && isSwanLayer && (
                <div className="map-display-option">
                  <div className="map-display-option__label">Wave motion</div>
                  <div className="map-display-option__segmented" role="radiogroup" aria-label="Wave motion mode" onKeyDown={handleSegmentedKeyDown}>
                    {['off', 'particles', 'particles+raster'].map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`map-display-option__btn${waveParticleMode === mode ? ' map-display-option__btn--active' : ''}`}
                        role="radio"
                        aria-checked={waveParticleMode === mode}
                        onClick={() => setWaveParticleMode?.(mode)}
                      >
                        {mode === 'off' ? 'Off' : mode === 'particles' ? 'Particles' : 'Particles + raster'}
                      </button>
                    ))}
                  </div>
                  {waveParticleMode !== 'off' && (
                    <>
                      <div className="map-display-option__segmented" role="radiogroup" aria-label="Particle detail" style={{ marginTop: '0.4rem' }} onKeyDown={handleSegmentedKeyDown}>
                        {['balanced', 'high'].map((q) => (
                          <button
                            key={q}
                            type="button"
                            className={`map-display-option__btn${particleQuality === q ? ' map-display-option__btn--active' : ''}`}
                            role="radio"
                            aria-checked={particleQuality === q}
                            onClick={() => setParticleQuality?.(q)}
                          >
                            {q === 'balanced' ? 'Balanced' : 'High detail'}
                          </button>
                        ))}
                      </div>
                      <div className="map-display-option__hint">
                        {waveParticleMode === 'particles'
                          ? 'Particle flow only — raster dimmed. Colours show wave height.'
                          : 'Particles overlaid on the wave height raster.'}
                        {particleQuality === 'high' ? ' High detail uses ~262 k particles.' : ' Balanced uses ~37 k particles.'}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Swell source arcs ── only for SWAN UGRID layers */}
              {SHOW_ADVANCED_WAVE_CONTROLS && isSwanLayer && (
                <div className="map-display-option">
                  <div className="map-display-option__label">Swell sources</div>
                  <div className="map-display-option__segmented" role="radiogroup" aria-label="Swell source arcs" onKeyDown={handleSegmentedKeyDown}>
                    <button
                      type="button"
                      className={`map-display-option__btn${!swellSourcesEnabled ? ' map-display-option__btn--active' : ''}`}
                      role="radio"
                      aria-checked={!swellSourcesEnabled}
                      onClick={() => setSwellSourcesEnabled?.(false)}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      className={`map-display-option__btn${swellSourcesEnabled ? ' map-display-option__btn--active' : ''}`}
                      role="radio"
                      aria-checked={swellSourcesEnabled}
                      onClick={() => setSwellSourcesEnabled?.(true)}
                    >
                      On
                    </button>
                  </div>
                  <div className="map-display-option__hint">
                    {swellSourcesEnabled
                      ? 'Click anywhere on the wave layer to draw swell arrival direction arcs. Arc width scales with height.'
                      : 'Shows primary / secondary / tertiary swell directions for a clicked point.'}
                  </div>
                </div>
              )}

              {/* ── Vessel class ── shared by every suitability workflow below, so it
                   stays visible above the tabs rather than living inside one of them. */}
              {isSuitabilitySelected && (
                <>
                <div className="map-display-option suitability-control-card suitability-control-card--vessel">
                  <div className="suitability-control-card__header">
                    <div>
                      <div className="map-display-option__label">Vessel class</div>
                      {selectedVesselEnvelope && (
                        <div className="suitability-control-card__subtext">
                          {selectedVesselEnvelope.advisoryLevel} · {selectedVesselEnvelope.cautionWindKt}-{selectedVesselEnvelope.maxWindKt} kt · {selectedVesselEnvelope.waveText}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="map-display-option__segmented suitability-vessel-grid" role="radiogroup" aria-label="Vessel class" onKeyDown={handleSegmentedKeyDown}>
                    {VESSEL_CLASSES.map((v) => {
                      const iconHazard = vesselIconHazards[v.value] ?? 0;
                      const iconSrc = getVesselSelectorIconSrc(v.value, iconHazard);
                      return (
                      <button
                        key={v.value}
                        type="button"
                        className={`map-display-option__btn${selectedVessel === v.value ? ' map-display-option__btn--active' : ''}`}
                        role="radio"
                        aria-checked={selectedVessel === v.value}
                        onClick={() => setSelectedVessel?.(v.value)}
                      >
                        <span className="suitability-vessel-card__top">
                          {iconSrc ? (
                            <img
                              src={iconSrc}
                              alt=""
                              aria-hidden="true"
                              className="suitability-vessel-card__icon"
                            />
                          ) : (
                            <Ship size={13} />
                          )}
                          {v.label}
                        </span>
                      </button>
                    );})}
                  </div>
                  <div className="suitability-forecast-classes">
                    <span className="suitability-forecast-classes__label">Forecast classes</span>
                    <div className="suitability-hazard-key" aria-label="Forecast classes">
                      {[0, 1, 2].map((hazardVal) => (
                        <span key={hazardVal} className="suitability-hazard-key__item">
                          <span
                            className="suitability-hazard-key__swatch"
                            style={{ background: SUITABILITY_HAZARD_COLORS[hazardVal] }}
                          />
                          {SUITABILITY_MAP_HAZARD_LABELS[hazardVal]}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="suitability-control-card__footnote">
                    {VESSEL_OPERATING_ENVELOPE_STATUS}
                  </div>
                </div>
                </>
              )}

              {/* ── Suitability workflow tabs ── Point (default map click) / Landing
                   Area / Route / Advisory used to be four flat, always-visible blocks
                   competing for attention; splitting them into tabs makes "which
                   workflow am I doing" an explicit choice instead of something the
                   user has to scan for. */}
              {isSuitabilitySelected && (
                <div className="map-display-option suitability-control-card suitability-control-card--tools">
                  <div className="suitability-control-card__header">
                    <div className="map-display-option__label">Suitability tools</div>
                  </div>
                  <div
                    className="map-display-option__segmented map-display-option__segmented--tabs suitability-tool-tabs"
                    role="tablist"
                    aria-label="Suitability workflow"
                    onKeyDown={handleSegmentedKeyDown}
                  >
                    {SUITABILITY_TABS.map((tab) => (
                      (() => {
                        const TabIcon = tab.icon;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            id={`suitability-tab-${tab.id}`}
                            className={`map-display-option__btn${suitabilityTab === tab.id ? ' map-display-option__btn--active' : ''}`}
                            role="tab"
                            aria-selected={suitabilityTab === tab.id}
                            aria-controls={`suitability-tabpanel-${tab.id}`}
                            onClick={() => setSuitabilityTab(tab.id)}
                          >
                            <span className="suitability-tool-tab__icon"><TabIcon size={14} /></span>
                            <span className="suitability-tool-tab__text">{tab.label}</span>
                            <span className="suitability-tool-tab__short">{tab.short}</span>
                          </button>
                        );
                      })()
                    ))}
                  </div>

                  <div
                    id="suitability-tabpanel-point"
                    role="tabpanel"
                    aria-labelledby="suitability-tab-point"
                    hidden={suitabilityTab !== 'point'}
                    className="suitability-tool-panel"
                  >
                    <div className="map-display-option__hint suitability-tool-panel__hint">
                      Click the map to inspect the current forecast suitability class for {selectedVesselMeta?.label ?? 'the selected vessel'} at a specific point.
                    </div>
                  </div>

                  <div
                    id="suitability-tabpanel-landing"
                    role="tabpanel"
                    aria-labelledby="suitability-tab-landing"
                    hidden={suitabilityTab !== 'landing'}
                    className="suitability-tool-panel"
                  >
                    <LandingAreaPanel
                      landingArea={landingArea}
                      setLandingArea={setLandingArea}
                      landingAreaPickMode={landingAreaPickMode}
                      setLandingAreaPickMode={setLandingAreaPickMode}
                    />
                  </div>

                  <div
                    id="suitability-tabpanel-route"
                    role="tabpanel"
                    aria-labelledby="suitability-tab-route"
                    hidden={suitabilityTab !== 'route'}
                    className="suitability-tool-panel"
                  >
                    <RouteForecastControls
                      routePoints={routePoints}
                      routePickMode={routePickMode}
                      setRoutePickMode={setRoutePickMode}
                      routeSpeedKt={routeSpeedKt}
                      setRouteSpeedKt={setRouteSpeedKt}
                      routeDepartureTime={routeDepartureTime}
                      setRouteDepartureTime={setRouteDepartureTime}
                      routeForecastLoading={routeForecastLoading}
                      routeForecastError={routeForecastError}
                      maxDepartureTime={forecastEndTime ?? null}
                      minDepartureTime={forecastStartTime ?? null}
                      timeDisplayZone={timeDisplayZone}
                      onRunRouteForecast={onRunRouteForecast}
                      onClearRoute={onClearRoute}
                      onUndoRoutePoint={onUndoRoutePoint}
                      onRouteImport={onRouteImport}
                    />
                    <ScenarioComparisonPanel
                      scenarios={scenarios}
                      highlightScenarioId={confirmedScenarioId}
                      currentInputs={{ vessel: selectedVessel, routePoints, departureTime: routeDepartureTime, speedKt: routeSpeedKt }}
                      currentModelRunStart={currentModelRunStart}
                      runningScenarioIds={runningScenarioIds}
                      onSaveCurrent={onSaveCurrentAsScenario}
                      onDuplicate={onDuplicateScenario}
                      onRemove={onRemoveScenario}
                      onRun={onRunScenario}
                      onRunAll={onRunAllScenarios}
                    />
                  </div>

                  <div
                    id="suitability-tabpanel-advisory"
                    role="tabpanel"
                    aria-labelledby="suitability-tab-advisory"
                    hidden={suitabilityTab !== 'advisory'}
                    className="suitability-tool-panel"
                  >
                    <div className="map-display-option__hint suitability-tool-panel__hint">
                      Generate a PDF advisory for {selectedVesselMeta?.label ?? 'the selected vessel'} using the current forecast window.
                    </div>
                    <button
                      type="button"
                      className="map-display-option__btn suitability-advisory-action"
                      onClick={() => setShowPdfModal(true)}
                    >
                      <FileDown size={13} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
                      Generate Advisory Brief
                    </button>
                  </div>
                </div>
              )}
            </ControlGroup>

            <ControlGroup
              icon={<FancyIcon icon={Info} animationType="pulse" color="#2196f3" />}
              title={UI_CONFIG.SECTIONS.DATA_INFO.title}
              ariaLabel={UI_CONFIG.SECTIONS.DATA_INFO.ariaLabel}
            >
              <DataInfo
                source={UI_CONFIG.DATA_SOURCE.source}
                /*model={UI_CONFIG.DATA_SOURCE.model}*/
                /*resolution={UI_CONFIG.DATA_SOURCE.resolution}*/
                updateFrequency={UI_CONFIG.DATA_SOURCE.updateFrequency}
                /*coverage={UI_CONFIG.DATA_SOURCE.coverage}*/
              />
            </ControlGroup>
          </div>
        </div>
      </div>

      <InundationThresholdEditor
        isOpen={showThresholdEditor}
        onClose={() => setShowThresholdEditor(false)}
        categories={inundationThresholds.categories}
        paletteId={inundationThresholds.paletteId}
        minVisibleDepth={inundationThresholds.minVisibleDepth}
        validationErrors={inundationThresholds.validationErrors}
        isDirty={inundationThresholds.isDirty}
        savedAt={inundationThresholds.savedAt}
        saveError={inundationThresholds.saveError}
        canUndo={inundationThresholds.canUndo}
        canRedo={inundationThresholds.canRedo}
        updateRow={inundationThresholds.updateRow}
        addRow={inundationThresholds.addRow}
        removeRow={inundationThresholds.removeRow}
        moveRow={inundationThresholds.moveRow}
        updateMinVisibleDepth={inundationThresholds.updateMinVisibleDepth}
        undo={inundationThresholds.undo}
        redo={inundationThresholds.redo}
        applyPalette={inundationThresholds.applyPalette}
        save={inundationThresholds.save}
        resetToDefaults={inundationThresholds.resetToDefaults}
        exportJson={inundationThresholds.exportJson}
        importJson={inundationThresholds.importJson}
        renderMode={inundationRenderMode}
        setRenderMode={setInundationRenderMode}
      />

      <AdvisoryPdfModal
        isOpen={showPdfModal}
        onClose={() => setShowPdfModal(false)}
        timeIndex={sliderIndex}
        validTime={currentSliderDate?.toISOString?.() ?? null}
        selectedVessel={selectedVessel}
        suitabilityBaseUrl={ALL_LAYERS.find((l) => l.sourceType === 'niue-suitability-raster')?.apiBase ?? ''}
        mapInstance={mapInstance}
        landingArea={landingArea}
        setLandingArea={setLandingArea}
      />

      <UserGuide
        isOpen={showUserGuide}
        onClose={() => setShowUserGuide(false)}
        onAction={handleUserGuideAction}
      />
    </div>
  );
};

export default ForecastApp;
