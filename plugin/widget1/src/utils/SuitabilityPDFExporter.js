// SuitabilityPDFExporter.js
// Generates a vessel suitability advisory PDF from the current widget state.
//
// Pages produced:
//   1. Executive advisory — backend-rendered overall map + vessel status cards
//   2. Continuous vessel outlook — full-resolution Suitable/Caution/Avoid area shares
//   3. Vessel × time heatmap + enlarged tide/total-sea-level context chart
//   4. Four-vessel comparison — real rendered PNG maps from zarr-api
//   5. Forecast timeline — selected vessel at 6 daily timesteps
//   6. Forecast trend chart — selected-vessel domain shares over the full window
//   7. Methodology & transparency — model, thresholds, data sources, limitations
//
// Map images for Pages 3 & 4 come from:
//   GET /niue/suitability/operational-map/{vessel}/{time_index}
// Honest dissolved polygons — no smoothing, no clipping, all classes visible.
//
// Dependencies: jspdf (dynamic import), html2canvas (dynamic import fallback)

import {
  VESSEL_OPERATING_ENVELOPE,
  VESSEL_OPERATING_ENVELOPE_STATUS,
  deriveSuitabilityDriver,
  fetchSeaLevelTimeseries,
  nearestSeaLevelStep,
  seaLevelHeightM,
} from '../lib/NiueSuitabilityOverlay';

const VESSEL_CLASSES = [
  { code: 'traditional_craft',          label: 'Traditional Craft', short: 'Trad.', initials: 'TRAD' },
  { code: 'very_small_motorised_craft', label: 'Very Small Motorised Craft', short: 'VSM', initials: 'VSM' },
  { code: 'small_craft',                label: 'Small Craft',    short: 'SC',    initials: 'SC'   },
  { code: 'larger_vessels',             label: 'Larger Vessels', short: 'LV',    initials: 'LV'   },
];

// O(1) lookup instead of VESSEL_CLASSES.find(...) at every call site.
const VESSEL_BY_CODE = Object.fromEntries(VESSEL_CLASSES.map(vc => [vc.code, vc]));

// Unified palette — matches the operational-map backend exactly.
const HAZARD = {
  suitable: '#2A9D8F',
  caution:  '#F4A261',
  avoid:    '#E76F51',
};

const HAZARD_META = {
  0: { label: 'Suitable', key: 'suitable', light: [220, 243, 240], text: [25,   94,  89]  },
  1: { label: 'Caution',  key: 'caution',  light: [255, 249, 196], text: [150,  95,  10]  },  // more yellow vs avoid
  2: { label: 'Avoid',    key: 'avoid',    light: [255, 215, 210], text: [185,  35,  35]  },  // more red vs caution
};

// Display text for deriveSuitabilityDriver's output — was copy-pasted
// identically into Page 1, the route brief, and the scenario brief; each
// call site keeps its own fallback-for-unrecognized-value convention below.
const DRIVER_LABELS = { none: 'None', wind: 'Wind', waves: 'Waves', wind_and_waves: 'Wind + Waves' };

// Per-vessel wind/wave thresholds now live in NiueSuitabilityOverlay.js as
// VESSEL_OPERATING_ENVELOPE (the shared source also used by scenarioService.js
// for explainability) — aliased here under the old local names so the rest
// of this file (Page 7 methodology table, etc.) doesn't need to change.
// Field names differ (cWind/aWind/cHs/aHs → cautionWindKt/maxWindKt/
// cautionWaveHeightM/maxWaveHeightM); see usage sites below.
const VESSEL_THRESHOLDS = VESSEL_OPERATING_ENVELOPE;
export const deriveDriverForVessel = deriveSuitabilityDriver;

const PAGE_BG   = [248, 249, 250];
const HEADER_BG = [30,  58,  138];
const TEXT_LT   = [255, 255, 255];
const TEXT_MD   = [66,  66,  66];
const TEXT_DK   = [33,  33,  33];
const GRID_CLR  = [224, 224, 224];
const NO_DATA_GREY = [150, 150, 150];

// ── Helpers ───────────────────────────────────────────────────────────────────

// jsPDF's raw canvas-style drawing (everything in this file) produces an
// untagged PDF no matter what — there's no jsPDF API to add real structure
// tags for screen readers. Document title + declared language are the two
// pieces of real metadata jsPDF *does* support, so a PDF reader / screen
// reader at least knows what the document is and what language to read it
// in, rather than an untitled, unlabeled "en-US-assumed" blob. Not full
// accessibility — worth being honest about that — but a genuine improvement
// over having neither set at all, which was the previous state on every one
// of these five exports.
function setPdfMetadata(doc, { title, subject }) {
  doc.setProperties({ title, subject, creator: 'Niue Marine Forecast System', author: 'Pacific Community (SPC)' });
  doc.setLanguage('en');
}

function setFill(doc, rgb)   { doc.setFillColor(...rgb); }
function setDraw(doc, rgb)   { doc.setDrawColor(...rgb); }
function setFont(doc, rgb, size, style = 'normal') {
  doc.setTextColor(...rgb);
  doc.setFontSize(size);
  doc.setFont('helvetica', style);
}

function rect(doc, x, y, w, h, fill, draw, lw = 0.1) {
  setFill(doc, fill);
  if (draw) { setDraw(doc, draw); doc.setLineWidth(lw); }
  doc.rect(x, y, w, h, draw ? 'FD' : 'F');
}

function hexToRgb(hex) {
  const raw = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(raw.slice(i, i + 2), 16));
}

function hazardColor(h) {
  const key = HAZARD_META[h]?.key ?? HAZARD_META[0].key;
  return hexToRgb(HAZARD[key]);
}
function hazardLight(h) { return HAZARD_META[h]?.light   ?? HAZARD_META[0].light; }
function hazardText(h)  { return HAZARD_META[h]?.text    ?? HAZARD_META[0].text;  }
function hazardLabel(h) { return HAZARD_META[h]?.label   ?? 'Unknown'; }

function drawFailurePanel(doc, x, y, w, h, title, detail = '') {
  rect(doc, x, y, w, h, [255, 248, 235], hazardColor(1), 0.45);
  setFont(doc, hazardColor(2), Math.min(8, Math.max(5.5, h * 0.15)), 'bold');
  // No leading icon glyph — jsPDF's default fonts only support WinAnsi
  // (Latin-1-ish) encoding; '⚠' silently rendered as '& ' (confirmed by
  // rendering it directly), not a missing-box placeholder, so it read as a
  // typo rather than a failed icon. The tinted/bordered panel + bold red
  // text already signal "problem" without needing a symbol.
  doc.text(title, x + w / 2, y + h * 0.45, { align: 'center' });
  if (detail) {
    setFont(doc, hazardText(1), Math.min(6.5, Math.max(4.5, h * 0.11)));
    doc.text(detail, x + w / 2, y + h * 0.62, { align: 'center' });
  }
}

function drawVesselFallbackIcon(doc, x, y, vc, size = 9) {
  const initials = vc?.initials ?? 'VES';
  rect(doc, x, y, size, size, [238, 244, 246], [150, 165, 175], 0.25);
  setFont(doc, TEXT_DK, initials.length > 3 ? 4.2 : 5.2, 'bold');
  doc.text(initials, x + size / 2, y + size * 0.62, { align: 'center' });
}

// Restored vessel artwork uses human-readable filenames in public/vessels,
// e.g. "Vaka Green.svg" and "Fishing Boat Amber.svg".
const VESSEL_ICON_FILE_STEM = {
  traditional_craft: 'Vaka',
  very_small_motorised_craft: 'Fishing Boat',
  small_craft: 'Ferry',
  larger_vessels: 'Container Ship',
};
const HAZARD_ICON_COLOR = { 0: 'Green', 1: 'Amber', 2: 'Red' };

async function loadVesselSvgIcon(vesselCode, hazardClass) {
  const stem = VESSEL_ICON_FILE_STEM[vesselCode];
  if (!stem) return null;
  const color = HAZARD_ICON_COLOR[hazardClass] ?? 'Green';
  const base  = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  const src   = `${base}/vessels/${encodeURIComponent(`${stem} ${color}.svg`)}`;
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const svgText = await res.text();
    const blob    = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const objUrl  = URL.createObjectURL(blob);
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        // Rasterise at 2× SVG natural size for crisp print output
        const canvas = document.createElement('canvas');
        canvas.width  = 576;   // 2 × 288
        canvas.height = 192;   // 2 × 96
        canvas.getContext('2d').drawImage(img, 0, 0, 576, 192);
        URL.revokeObjectURL(objUrl);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => { URL.revokeObjectURL(objUrl); resolve(null); };
      img.src = objUrl;
    });
  } catch { return null; }
}

// Neutral-colored landing-area flag marker (not hazard-colored — marks a
// place, not a reading), used only by the landing-area PDF export path.
let _flagIconCache = null;
async function loadFlagIcon() {
  if (_flagIconCache) return _flagIconCache;
  const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  const src  = `${base}/vessels/landing_flag.svg`;
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const svgText = await res.text();
    const blob    = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const objUrl  = URL.createObjectURL(blob);
    _flagIconCache = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = 192;
        canvas.height = 192;
        canvas.getContext('2d').drawImage(img, 0, 0, 192, 192);
        URL.revokeObjectURL(objUrl);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => { URL.revokeObjectURL(objUrl); resolve(null); };
      img.src = objUrl;
    });
    return _flagIconCache;
  } catch { return null; }
}

function formatUtcTiny(dateLike) {
  const d   = new Date(dateLike);
  const dd  = String(d.getUTCDate()).padStart(2, '0');
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const hh  = String(d.getUTCHours()).padStart(2, '0');
  const mm  = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd} ${mon} ${hh}:${mm} UTC`;
}

// Local time-of-day paired with UTC, for a specific matched forecast step.
// selectDailyTimelineSteps matches each day's step within a 4h tolerance of
// its 06:00-local/17:00-UTC target, so a real matched step's actual time
// can drift from that target by up to 4h — a hardcoded "06:00 local · 17:00
// UTC" caption would misrepresent it. Callers pass either the real matched
// step's valid_time, or (for beyond-horizon placeholder panels) the target
// time itself, so both cases render from one formatter instead of a literal.
function formatLocalUtcTimePair(dateLike) {
  const utc = new Date(dateLike);
  const local = new Date(utc.getTime() - 11 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())} local · ${pad(utc.getUTCHours())}:${pad(utc.getUTCMinutes())} UTC`;
}

// Niue local date label: UTC-11, so display the local calendar day at a given UTC time.
function formatDayLocal(dateLike) {
  const d = new Date(new Date(dateLike).getTime() - 11 * 3600 * 1000);
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${DAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2,'0')} ${MONS[d.getUTCMonth()]}`;
}

function domainHazard(warn, caution) {
  if (warn >= 20) return 2;              // significant Avoid coverage warrants AVOID advisory
  if (warn > 0 || caution > 0) return 1; // any hazard → advisory flag
  return 0;
}

function outlookDurationHours(timeSeriesData = []) {
  if (!timeSeriesData.length) return null;
  const first = new Date(timeSeriesData[0]?.time).getTime();
  const last = new Date(timeSeriesData[timeSeriesData.length - 1]?.time).getTime();
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return null;
  return Math.round((last - first) / 36e5);
}

function outlookLabel(timeSeriesData = []) {
  const hours = outlookDurationHours(timeSeriesData);
  if (!hours) return 'forecast';
  if (hours >= 70 && hours <= 74) return '72-hour';
  if (hours < 48) return `${hours}-hour`;
  return `${Math.round(hours / 24)}-day`;
}

// Infer model output interval from the first two timestep strings.
function inferStepHours(timestepsList = []) {
  if (timestepsList.length < 2) return 1;
  const t0 = new Date(timestepsList[0]).getTime();
  const t1 = new Date(timestepsList[1]).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return 1;
  return (t1 - t0) / 3_600_000;
}

function formatRunId(runId) {
  if (!runId) return null;
  // 8-digit YYYYMMDDHH compact format → "2024-01-05 12:00 UTC"
  const m = String(runId).match(/^(\d{4})(\d{2})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:00 UTC`;
  // ISO 8601 string (e.g. "2024-01-05T12:00:00") — first timestep from tsMeta
  const dt = new Date(runId);
  if (!isNaN(dt.getTime())) return dt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  return null;
}

export function selectHeatmapSteps(timeSeriesData = [], windowHours = 168) {
  if (!Array.isArray(timeSeriesData) || timeSeriesData.length === 0) return [];
  if (windowHours === 0 || timeSeriesData.length === 1) {
    const step = timeSeriesData[0];
    return [{ time_index: step.time_index ?? 0, time: step.time ?? step.valid_time, sourceIndex: 0 }];
  }

  const targetHours = windowHours <= 72 ? 6 : 12;
  const selected = new Map();
  const firstMs = new Date(timeSeriesData[0]?.time ?? timeSeriesData[0]?.valid_time).getTime();
  const lastIndex = timeSeriesData.length - 1;
  const add = (index) => {
    const safeIndex = Math.max(0, Math.min(lastIndex, index));
    const step = timeSeriesData[safeIndex];
    if (!step) return;
    selected.set(safeIndex, {
      time_index: step.time_index ?? safeIndex,
      time: step.time ?? step.valid_time,
      sourceIndex: safeIndex,
    });
  };

  add(0);
  if (Number.isFinite(firstMs)) {
    const lastMs = new Date(timeSeriesData[lastIndex]?.time ?? timeSeriesData[lastIndex]?.valid_time).getTime();
    const endMs = Number.isFinite(lastMs)
      ? Math.min(lastMs, firstMs + windowHours * 3_600_000)
      : firstMs + windowHours * 3_600_000;
    for (let targetMs = firstMs + targetHours * 3_600_000; targetMs < endMs; targetMs += targetHours * 3_600_000) {
      let best = 0;
      let bestDelta = Infinity;
      timeSeriesData.forEach((step, index) => {
        const ms = new Date(step.time ?? step.valid_time).getTime();
        if (!Number.isFinite(ms) || ms > endMs) return;
        const delta = Math.abs(ms - targetMs);
        if (delta < bestDelta) {
          best = index;
          bestDelta = delta;
        }
      });
      add(best);
    }
  } else {
    const approxStepHours = windowHours / Math.max(1, timeSeriesData.length - 1);
    const stride = Math.max(1, Math.round(targetHours / approxStepHours));
    for (let i = stride; i < timeSeriesData.length - 1; i += stride) add(i);
  }
  add(lastIndex);

  return Array.from(selected.values()).sort((a, b) => a.sourceIndex - b.sourceIndex);
}

// hazard: null (not 0) when this row/step genuinely has no data — callers
// (drawHazardHeatmapMatrix) must render that as NO_DATA_GREY, not fall
// through hazardColor()'s own null->Suitable default, or a vessel/site
// with a gap in coverage silently paints as a real "Suitable" reading with
// no way to tell it apart from a scored 0%.
export function vesselHeatmapCell(vesselData) {
  const hasData = vesselData && (
    Number.isFinite(vesselData.warning_percent)
    || Number.isFinite(vesselData.caution_percent)
    || Number.isFinite(vesselData.suitable_percent)
  );
  if (!hasData) return { hazard: null, text: '', sortValue: -1 };
  const warn = vesselData.warning_percent ?? 0;
  const caution = vesselData.caution_percent ?? 0;
  return {
    hazard: domainHazard(warn, caution),
    text: warn >= 0.5 ? `${Math.round(warn)}%` : '',
    sortValue: warn,
  };
}

export function pointHeatmapCell(step) {
  const hazard = Number.isFinite(step?.hazard_class) ? step.hazard_class : null;
  const labels = { 0: 'OK', 1: 'CAU', 2: 'AVD' };
  return {
    hazard,
    text: hazard === null ? '' : (labels[hazard] ?? '-'),
    sortValue: hazard ?? -1,
  };
}

function heatmapTimeLabel(dateLike, previousDateLike = null) {
  const d = new Date(dateLike);
  if (!Number.isFinite(d.getTime())) return '-';
  const prev = previousDateLike ? new Date(previousDateLike) : null;
  const dayChanged = !prev || d.getUTCDate() !== prev.getUTCDate() || d.getUTCMonth() !== prev.getUTCMonth();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  if (dayChanged) {
    const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    return `${d.getUTCDate()} ${mon}\n${hh}Z`;
  }
  return `${hh}Z`;
}

function drawHazardHeatmapMatrix(doc, {
  x, y, w, rowH = 11, labelW = 40, summaryW = 34, rows = [], heatmapSteps = [],
  title = '', subtitle = '', cellForRowStep, summaryForRow,
}) {
  const n = heatmapSteps.length;
  const headerH = title || subtitle ? 13 : 8;
  const timeH = 9;
  const matrixH = headerH + timeH + rows.length * rowH;
  const gridW = Math.max(20, w - labelW - summaryW);
  const cellW = n > 0 ? gridW / n : gridW;

  if (title) {
    setFont(doc, HEADER_BG, 8.5, 'bold');
    doc.text(title, x, y + 4);
  }
  if (subtitle) {
    setFont(doc, TEXT_MD, 5.5);
    doc.text(subtitle, x, y + 8.5, { maxWidth: w });
  }

  const gridY = y + headerH;
  setFill(doc, [238, 242, 250]);
  doc.rect(x, gridY, w, timeH, 'F');
  setDraw(doc, GRID_CLR);
  doc.setLineWidth(0.2);
  doc.rect(x, gridY, w, timeH + rows.length * rowH, 'S');

  setFont(doc, TEXT_MD, 4.4, 'bold');
  heatmapSteps.forEach((step, i) => {
    const cx = x + labelW + i * cellW;
    const label = heatmapTimeLabel(step.time, heatmapSteps[i - 1]?.time).split('\n');
    doc.text(label, cx + cellW / 2, gridY + 3.2, { align: 'center' });
    setDraw(doc, [210, 218, 230]);
    doc.setLineWidth(0.1);
    doc.line(cx, gridY, cx, gridY + timeH + rows.length * rowH);
  });

  rows.forEach((row, ri) => {
    const ry = gridY + timeH + ri * rowH;
    const rowFill = ri % 2 === 0 ? [255, 255, 255] : [248, 250, 252];
    rect(doc, x, ry, labelW, rowH, rowFill, GRID_CLR, 0.12);
    setFont(doc, TEXT_DK, 6.2, 'bold');
    doc.text(row.label, x + 2, ry + rowH * 0.6, { maxWidth: labelW - 4 });

    heatmapSteps.forEach((step, ci) => {
      const cell = cellForRowStep(row, step) ?? { hazard: null, text: '' };
      const cx = x + labelW + ci * cellW;
      // hazardColor(null) itself falls back to Suitable/green — a missing
      // cell must be drawn as NO_DATA_GREY explicitly, not routed through
      // that default, or it's indistinguishable from a real "Suitable" cell.
      setFill(doc, cell.hazard === null || cell.hazard === undefined ? NO_DATA_GREY : hazardColor(cell.hazard));
      doc.rect(cx, ry, Math.max(0.2, cellW), rowH, 'F');
      setDraw(doc, [255, 255, 255]);
      doc.setLineWidth(0.12);
      doc.rect(cx, ry, Math.max(0.2, cellW), rowH, 'S');
      if (cell.text) {
        setFont(doc, [255, 255, 255], cellW < 7 ? 4.2 : 5.2, 'bold');
        doc.text(cell.text, cx + cellW / 2, ry + rowH * 0.62, { align: 'center' });
      }
    });

    rect(doc, x + labelW + gridW, ry, summaryW, rowH, rowFill, GRID_CLR, 0.12);
    const summary = summaryForRow?.(row);
    if (summary) {
      // `?? 0` here painted an unavailable landing-area row's summary text
      // in Suitable-green (landingAreaRowSummary's `hazard` is null, not 0,
      // for a row with no scored samples — see landingAreaStats).
      setFont(doc, summary.hazard === null || summary.hazard === undefined ? NO_DATA_GREY : hazardColor(summary.hazard), 5.3, 'bold');
      doc.text(summary.primary, x + labelW + gridW + 2, ry + 4.3, { maxWidth: summaryW - 4 });
      setFont(doc, TEXT_MD, 4.4);
      doc.text(summary.secondary, x + labelW + gridW + 2, ry + 8.4, { maxWidth: summaryW - 4 });
    }
  });

  setFont(doc, TEXT_MD, 4.8, 'italic');
  doc.text('Cell colour = summary hazard class. Labels show Avoid% for vessel rows and class code for landing-area rows.', x, gridY + timeH + rows.length * rowH + 4);

  return { height: matrixH + 6, bottom: gridY + timeH + rows.length * rowH + 6 };
}

function drawSeaLevelStrip(doc, {
  x,
  y,
  w,
  chartX = x + 42,
  chartW = w - 90,
  seaLevelData,
  t0,
  t1,
  chartH = 7.5,
  large = false,
}) {
  const t0ms = new Date(t0).getTime();
  const t1ms = new Date(t1).getTime();
  const tRangeMs = t1ms - t0ms;
  if (!Array.isArray(seaLevelData?.timesteps) || seaLevelData.timesteps.length < 2 ||
      !Number.isFinite(t0ms) || !Number.isFinite(t1ms) || tRangeMs <= 0) {
    return { drawn: false, height: 0 };
  }

  const topInset = large ? 11 : 4;
  const bottomInset = large ? 6 : 0;
  const stripH = chartH + topInset + bottomInset;
  const topY = y + topInset;
  const botY = topY + chartH;
  rect(doc, x, y, w, stripH, [238, 242, 250], GRID_CLR, 0.1);

  setFont(doc, TEXT_DK, large ? 8 : 5.5, 'bold');
  doc.text(large ? 'TIDE & TOTAL SEA LEVEL' : 'Sea level context', x + 2.5, y + (large ? 4.8 : 2.8));
  setFont(doc, TEXT_MD, large ? 5.2 : 3.8);
  if (large) {
    doc.text('Context only — the vessel suitability classes on this report use wind and waves.', x + 2.5, y + 8.4);
    doc.text('Total = astronomical tide + inverse barometer + sea-level anomaly', x + w - 2.5, y + 8.4, { align: 'right' });

    const legendY = y + 5.2;
    const legendX = x + w - 82;
    setDraw(doc, [41, 98, 255]);
    doc.setLineWidth(0.7);
    doc.line(legendX, legendY, legendX + 9, legendY);
    setFont(doc, [41, 98, 255], 5.2, 'bold');
    doc.text('Total sea level', legendX + 11, legendY + 1.1);
    setDraw(doc, [120, 125, 138]);
    doc.setLineWidth(0.45);
    doc.setLineDashPattern([1.2, 1.2], 0);
    doc.line(legendX + 42, legendY, legendX + 51, legendY);
    doc.setLineDashPattern([], 0);
    setFont(doc, [105, 110, 124], 5.2);
    doc.text('Astronomical tide', legendX + 53, legendY + 1.1);
  } else {
    doc.text('Context only; suitability uses wind + waves.', x + w / 2, y + 2.8, { align: 'center' });
    doc.text('Total = tide + inverse barometer + SLA', x + w - 2, y + 2.8, { align: 'right' });
  }

  const totalPoints = [];
  const tidePoints = [];
  for (const step of seaLevelData.timesteps) {
    const tMs = new Date(step.valid_time_utc ?? step.valid_time ?? step.time ?? step.time_utc).getTime();
    if (!Number.isFinite(tMs) || tMs < t0ms || tMs > t1ms) continue;
    const px = chartX + (tMs - t0ms) / tRangeMs * chartW;
    const totalM = step?.total_sea_level_m === null || step?.total_sea_level_m === undefined
      ? null
      : Number(step.total_sea_level_m);
    if (Number.isFinite(totalM)) totalPoints.push({ x: px, v: totalM });
    // This trace is explicitly labelled "astronomical tide", so use only the
    // API contract's tide_m field. Generic sea_level_m/water_level_m aliases
    // can represent total water level and must not silently appear as tide.
    const tideM = step?.tide_m === null || step?.tide_m === undefined ? null : Number(step.tide_m);
    if (Number.isFinite(tideM)) tidePoints.push({ x: px, v: tideM });
  }

  if (totalPoints.length < 2) return { drawn: false, height: stripH };
  const totalVals = totalPoints.map(p => p.v);
  const tideVals = tidePoints.map(p => p.v);
  const allVals = totalVals.concat(tideVals);
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 0.001;
  const toY = (v) => botY - ((v - min) / range) * chartH;

  if (large) {
    [min, min + range / 2, max].forEach((value) => {
      const gy = toY(value);
      setDraw(doc, [204, 213, 226]);
      doc.setLineWidth(0.15);
      doc.line(chartX, gy, chartX + chartW, gy);
      setFont(doc, TEXT_MD, 4.8);
      doc.text(`${value.toFixed(2)} m`, chartX - 2.5, gy + 1.2, { align: 'right' });
    });

    const tickCount = 6;
    for (let i = 0; i < tickCount; i++) {
      const fraction = i / (tickCount - 1);
      const tMs = t0ms + fraction * tRangeMs;
      const tx = chartX + fraction * chartW;
      setDraw(doc, [215, 222, 232]);
      doc.setLineWidth(0.12);
      doc.line(tx, topY, tx, botY);
      setFont(doc, TEXT_MD, 4.6);
      const tick = new Date(tMs);
      const day = String(tick.getUTCDate()).padStart(2, '0');
      const month = tick.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
      const hour = String(tick.getUTCHours()).padStart(2, '0');
      doc.text(`${day} ${month} ${hour}Z`, tx, botY + 4.1, {
        align: i === 0 ? 'left' : i === tickCount - 1 ? 'right' : 'center',
      });
    }
  }

  if (min <= 0 && max >= 0) {
    setDraw(doc, [180, 180, 180]);
    doc.setLineWidth(0.1);
    doc.setLineDashPattern([1.5, 1.5], 0);
    doc.line(chartX, toY(0), chartX + chartW, toY(0));
    doc.setLineDashPattern([], 0);
  }

  if (tidePoints.length >= 2) {
    setDraw(doc, large ? [105, 110, 124] : [150, 150, 160]);
    doc.setLineWidth(large ? 0.65 : 0.3);
    doc.setLineDashPattern([1, 1], 0);
    for (let i = 1; i < tidePoints.length; i++) {
      doc.line(tidePoints[i - 1].x, toY(tidePoints[i - 1].v), tidePoints[i].x, toY(tidePoints[i].v));
    }
    doc.setLineDashPattern([], 0);
    const lastTide = tidePoints[tidePoints.length - 1];
    if (!large) {
      setFont(doc, [130, 130, 140], 3.2, 'italic');
      doc.text('tide', lastTide.x + 1, toY(lastTide.v) + 1);
    }
  }

  setDraw(doc, [41, 98, 255]);
  doc.setLineWidth(large ? 0.8 : 0.35);
  for (let i = 1; i < totalPoints.length; i++) {
    doc.line(totalPoints[i - 1].x, toY(totalPoints[i - 1].v), totalPoints[i].x, toY(totalPoints[i].v));
  }
  const lastTotal = totalPoints[totalPoints.length - 1];
  if (!large) {
    setFont(doc, [41, 98, 255], 3.2, 'bold');
    doc.text('total', lastTotal.x + 1, toY(lastTotal.v) - 0.8);
  }

  const totalMax = Math.max(...totalVals);
  const totalMin = Math.min(...totalVals);
  if (!large) {
    setFont(doc, [150, 150, 150], 3.5);
    doc.text(`H ${totalMax.toFixed(2)}m`, x + 30.2, toY(totalMax) + 0.5, { align: 'right' });
    doc.text(`L ${totalMin.toFixed(2)}m`, x + 30.2, toY(totalMin) + 1.0, { align: 'right' });
  }

  let hiIdx = 0, loIdx = 0;
  totalVals.forEach((v, i) => { if (v > totalVals[hiIdx]) hiIdx = i; if (v < totalVals[loIdx]) loIdx = i; });
  if (hiIdx !== loIdx) {
    [hiIdx, loIdx].forEach((idx) => {
      setFill(doc, [41, 98, 255]);
      doc.circle(totalPoints[idx].x, toY(totalPoints[idx].v), 0.7, 'F');
    });
  }

  return { drawn: true, height: stripH };
}

// Standard page-header band height (navy strip). Was previously re-declared
// as a local `const HDR_H = 18` in every drawPageN function.
const HDR_H = 18;

// Truncates text to fit maxWidth at doc's CURRENT font/size (call setFont
// first) — for single-line labels (badges, headings, header text) where
// wrapping to a second line would break a fixed-height layout, unlike
// doc.text's own maxWidth option, which wraps rather than truncates. Binary
// searches for the longest prefix + ellipsis that still fits, rather than
// guessing a character count, since this app already renders proportional
// (non-monospace) fonts at several different sizes.
function fitTextToWidth(doc, text, maxWidth) {
  const str = String(text ?? '');
  if (!str || maxWidth <= 0 || doc.getTextWidth(str) <= maxWidth) return str;
  const ellipsis = '…';
  if (doc.getTextWidth(ellipsis) > maxWidth) return '';
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = str.slice(0, mid).trimEnd() + ellipsis;
    if (doc.getTextWidth(candidate) <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return lo === 0 ? ellipsis : str.slice(0, lo).trimEnd() + ellipsis;
}

// Draws the navy header band + title/subtitle (left) + two right-aligned
// lines (typically "Valid: ..." / "Issued: ... | Page N") shared by every
// advisory page. Callers that need extra header content (badges, notices,
// legends) draw it after calling this — this only owns the common band.
// rightLine1/rightLine2 are passed pre-formatted so this can't silently
// change any page's date formatting.
//
// title/subtitle are truncated against whatever width the right-hand lines
// actually leave available — previously each side was drawn independently
// with no maxWidth and no awareness of the other, so a long site name/run id
// on one side could run straight into the other.
function drawHeaderBand(doc, { title, subtitle = '', rightLine1 = '', rightLine2 = '', titleSize = 14, subtitleSize = 8.5, topFrac = 0.55, bottomFrac = 0.85 }) {
  const W = doc.internal.pageSize.getWidth();
  rect(doc, 0, 0, W, HDR_H, HEADER_BG);

  setFont(doc, TEXT_LT, 8);
  const rightLine1W = rightLine1 ? doc.getTextWidth(rightLine1) : 0;
  setFont(doc, TEXT_LT, 7.5);
  const rightLine2W = rightLine2 ? doc.getTextWidth(rightLine2) : 0;
  const rightW = Math.max(rightLine1W, rightLine2W);
  const leftMaxWidth = W - 10 - (rightW > 0 ? rightW + 6 : 0);

  setFont(doc, TEXT_LT, titleSize, 'bold');
  doc.text(fitTextToWidth(doc, title, leftMaxWidth), 5, HDR_H * topFrac);
  if (subtitle) {
    setFont(doc, TEXT_LT, subtitleSize);
    doc.text(fitTextToWidth(doc, subtitle, leftMaxWidth), 5, HDR_H * bottomFrac);
  }
  if (rightLine1) {
    setFont(doc, TEXT_LT, 8);
    doc.text(rightLine1, W - 5, HDR_H * topFrac, { align: 'right' });
  }
  if (rightLine2) {
    setFont(doc, TEXT_LT, 7.5);
    doc.text(rightLine2, W - 5, HDR_H * bottomFrac, { align: 'right' });
  }
}

// Model disclaimer footer — was a copy-pasted literal string on 5 different
// pages; a wording fix previously required editing all 5 in lockstep.
// The one place this specific caveat used to appear consistently was a tiny
// note on the landing area's Space/Boat/Time card and the tail of the route
// brief's disclaimer — never on the six-page advisory itself, where the
// threshold table (Page 7) and every hazard classification it drives are
// presented with no validation-status caveat in sight. Folded into this
// shared disclaimer instead of adding a new element, since it's already
// drawn on every page that needs it (was a copy-pasted literal string on 5
// pages before that got the same lockstep-editing treatment).
const MODEL_DISCLAIMER = 'SWAN wave model guidance — mesh resolution may not capture all local sea state variability. Vessel thresholds are planning defaults. Use alongside official warnings.';
function drawModelDisclaimer(doc, { size = 5.5, bottomOffset = 2.5 } = {}) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  setFont(doc, TEXT_MD, size, 'italic');
  doc.text(fitTextToWidth(doc, MODEL_DISCLAIMER, W - 10), W / 2, H - bottomOffset, { align: 'center' });
}

// Same fix as MODEL_DISCLAIMER above, scoped to the route/scenario briefs:
// exportRouteForecastPDF and exportScenarioComparisonPDF each had their own
// copy of this exact sentence (only their lead-in sentence differs), so a
// wording change to the shared caveat required editing both in lockstep.
const ROUTE_ADVISORY_DISCLAIMER_TAIL = 'Vessel operating envelope thresholds are advisory defaults. Not navigation advice; use alongside official warnings and local seamanship.';

// True only when the backend actually returned an entry for this vessel
// class. Used to render "No data" instead of a misleading "0% Avoid" when a
// vessel is genuinely missing from the response, distinct from a vessel that
// legitimately has 0% Avoid/Caution — see fetchBestContrastTimestep's
// comment above for a case where this exact ambiguity previously hid a bug.
export function hasVesselData(vessels, code) {
  const v = vessels?.[code];
  if (!v) return false;
  const values = [v.suitable_percent, v.caution_percent, v.warning_percent]
    .filter(value => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(Number.isFinite);
  // Presence, not positivity: a vessel legitimately at 0% Caution/Avoid
  // (100% Suitable) is real data, not a missing entry — requiring some
  // value > 0 rejected that exact case, contradicting the whole point of
  // this function (see header comment above).
  return values.length > 0;
}

// Matches a heatmap column (identified by time_index, falling back to
// nearest valid_time) against a specific row's own step array. Landing-area
// rows are fetched independently per point (see exportLandingAreaSuitabilityPDF)
// and can come back with different lengths/gaps than the reference row the
// heatmap's column times were chosen from — indexing by raw array position
// (sourceIndex) would then silently read a different row's timestep than the
// column header claims. Matching by identity avoids that misalignment.
export function findMatchingStep(steps, heatmapStep) {
  if (!steps?.length || !heatmapStep) return null;
  const byIndex = steps.find(s => s.time_index === heatmapStep.time_index);
  if (byIndex) return byIndex;
  const targetMs = new Date(heatmapStep.time).getTime();
  if (!Number.isFinite(targetMs)) return null;
  let best = null;
  let bestDelta = Infinity;
  for (const s of steps) {
    const ms = new Date(s.valid_time ?? s.time).getTime();
    if (!Number.isFinite(ms)) continue;
    const delta = Math.abs(ms - targetMs);
    if (delta < bestDelta) { bestDelta = delta; best = s; }
  }
  return best;
}

// Shared map legend — three coloured squares with labels, centred on cx.
// includeUnavailable defaults to false — this legend is reused at several
// call sites, at least one of them (Page 4's header-anchored legend, offset
// from the right edge rather than page-centered) is already tight enough
// that a 4th item would push its right edge past the page boundary. Opt in
// only where there's confirmed room and an actual grey/unavailable cell on
// the page (the landing area heatmap matrix).
function drawSharedLegend(doc, cx, y, { includeUnavailable = false } = {}) {
  const ITEMS = [
    { color: hazardColor(0), label: 'Suitable' },
    { color: hazardColor(1), label: 'Caution'  },
    { color: hazardColor(2), label: 'Avoid'    },
    ...(includeUnavailable ? [{ color: NO_DATA_GREY, label: 'Unavailable' }] : []),
  ];
  const SQ = 2.8;
  const ITEM_W = 22;
  const totalW = ITEMS.length * ITEM_W;
  const x0 = cx - totalW / 2;
  ITEMS.forEach((item, i) => {
    const ix = x0 + i * ITEM_W;
    setFill(doc, item.color);
    doc.rect(ix, y - SQ / 2, SQ, SQ, 'F');
    setFont(doc, TEXT_MD, 6);
    doc.text(item.label, ix + SQ + 1.5, y + 0.8);
  });
}

// ── Fetch data ────────────────────────────────────────────────────────────────

const DEFAULT_SUITABILITY_BASE_URL = process.env.REACT_APP_SUITABILITY_BASE_URL || '/suitability';

function getLocalhostSuitabilityFallback() {
  if (typeof window === 'undefined') return null;

  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  return isLocalhost ? 'http://localhost:8000' : null;
}

function joinApiUrl(baseUrl, path) {
  return `${String(baseUrl || '').replace(/\/$/, '')}${path}`;
}

// Exported so scenarioService.js's early-exit probe (findBetterDeparture)
// can pace its own sequential loop with the same rate-limit delay, without
// a second copy-pasted timer helper.
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs `fn` over `items` with at most `limit` calls in flight at once, and
// (if delayMs is set) a real pause after each one before that worker starts
// its next item. The Step-4 time-series build fetches one summary per
// forecast timestep, each of which itself fans out into ~5 requests against
// a backend with no bundled-all-vessels shape (see fetchSummary) — for a full
// 7-day outlook that's a lot of requests fired in a short window.
//
// Capping concurrency alone (no delay) was NOT enough: every single request
// still failed, all reporting "blocked by CORS policy" in near-lockstep —
// ~85 consecutive summary calls failed within ~720ms (~8ms apart), far too
// fast to be real round trips to a Cloudflare-fronted server failing one by
// one. Isolated requests against the same endpoints, spaced out, return a
// correct origin-specific Access-Control-Allow-Origin header every time
// (verified directly) — so this reads as a volume/rate-based block tripping
// at the edge (Cloudflare or similar), not a real CORS misconfiguration, and
// not simply "too many simultaneous connections" either, since the failures
// persisted even after connections were capped. Only an actual pause between
// requests — not just a concurrency ceiling — reduces the request *rate*.
// Exported so scenarioService.js's "run all scenarios" can reuse the same
// rate-limit discipline documented above, instead of firing N concurrent
// /niue/suitability/route calls via Promise.all and rediscovering the same
// edge-block behaviour this function exists to avoid.
export async function mapWithConcurrency(items, limit, fn, delayMs = 0) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
      if (delayMs > 0 && nextIndex < items.length) await sleep(delayMs);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Tuning for mapWithConcurrency call sites — kept as named constants rather
// than inline literals so the rate-limit rationale documented above stays
// attached to the numbers that implement it, instead of being re-guessed
// at each call site.
const SUMMARY_FETCH_CONCURRENCY = 4;
const SUMMARY_FETCH_DELAY_MS = 120;
const LANDING_FETCH_CONCURRENCY = 3;
const LANDING_FETCH_DELAY_MS = 120;

async function fetchJsonEndpoint(path, baseUrl, label) {
  const url = joinApiUrl(baseUrl, path);
  const res = await fetch(url);
  const contentType = res.headers.get('content-type') || '';
  const body = await res.text();

  if (!res.ok) {
    throw new Error(`${label} failed at ${url}: HTTP ${res.status}`);
  }

  if (!contentType.includes('application/json')) {
    const looksLikeHtml = body.trimStart().startsWith('<');
    throw new Error(
      `${label} returned ${looksLikeHtml ? 'HTML' : contentType || 'non-JSON'} from ${url}. ` +
      `Check suitabilityBaseUrl / reverse proxy routing.`
    );
  }

  return JSON.parse(body);
}

async function resolveSuitabilityApi(baseUrl) {
  const candidates = [];
  const addCandidate = (candidate) => {
    if (!candidates.includes(candidate)) candidates.push(candidate);
  };

  if (baseUrl) addCandidate(baseUrl);
  addCandidate(DEFAULT_SUITABILITY_BASE_URL);
  const localhostFallback = getLocalhostSuitabilityFallback();
  if (localhostFallback) addCandidate(localhostFallback);
  addCandidate('');

  const errors = [];
  for (const candidate of candidates) {
    try {
      const timesteps = await fetchJsonEndpoint(
        '/niue/suitability/timesteps',
        candidate,
        'Suitability timesteps'
      );
      // The requested baseUrl silently falling through to a different
      // candidate (env default, localhost, same-origin) is exactly the kind
      // of dev/prod backend drift that's hard to notice from the PDF output
      // alone — surface it so a wrong-looking report can be traced.
      if (baseUrl && candidate !== baseUrl) {
        console.warn(`Suitability API at "${baseUrl}" was unreachable; using fallback "${candidate || '(same-origin)'}" instead.`);
      }
      return { baseUrl: candidate, timesteps };
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(`Unable to reach suitability API. Tried: ${candidates.join(', ')}. ${errors.join(' | ')}`);
}

// Adapts /niue/suitability/summary/{time_index} to the {vessels: {...}} shape
// this exporter expects, across two backend response shapes:
//   - bundled (all vessel classes in one call, has a top-level "vessels" key)
//   - per-vessel (one vessel per call via ?vessel=, shape {percentages, wind_speed_kt, wave_height_m})
// Bundled is preferred (1 request); per-vessel backends need 4 parallel requests.
function normaliseSummaryVessel(raw) {
  if (!raw) return null;
  // Some backend versions return 0.0 for every class when a non-empty bbox
  // contains no classifiable faces. Treat the explicit zero classified count
  // as unavailable so the PDF cannot turn "no data" into a green result.
  if (Number(raw.classified_face_count) === 0 || Number(raw.total_points) === 0) return null;
  const finiteOrNull = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  return {
    warning_percent:   finiteOrNull(raw?.percentages?.warning),
    caution_percent:   finiteOrNull(raw?.percentages?.caution),
    suitable_percent:  finiteOrNull(raw?.percentages?.suitable),
    max_wind_kt:       finiteOrNull(raw?.wind_speed_kt?.max),
    max_wave_height_m: finiteOrNull(raw?.wave_height_m?.max),
    main_driver:       raw?.main_driver ?? 'none',
  };
}

// Adapts a single raw vessel entry to the flat canonical shape regardless of
// which of the two known shapes it arrives in — the bundled backend already
// returns flat fields directly, other endpoints (e.g. best-contrast-timestep)
// may return the same nested {percentages, wind_speed_kt, wave_height_m} shape
// normaliseSummaryVessel exists to unwrap. Detecting per-entry (rather than
// assuming one shape for a whole endpoint) means any endpoint sharing either
// shape is handled correctly without its own bespoke adapter.
function normaliseVesselEntry(raw) {
  if (!raw) return null;
  const looksFlat = raw.suitable_percent !== undefined
    || raw.warning_percent !== undefined
    || raw.caution_percent !== undefined;
  return looksFlat ? raw : normaliseSummaryVessel(raw);
}

function normaliseVesselsMap(rawVessels) {
  const out = {};
  VESSEL_CLASSES.forEach((vc) => {
    const normalised = normaliseVesselEntry(rawVessels?.[vc.code]);
    if (normalised) out[vc.code] = normalised;
  });
  return out;
}

// Backfills a missing/incorrectly-"none" main_driver for any vessel that IS
// actually hazarded, deriving it from the wind/wave numbers already present
// instead of letting a backend gap render as a false "Primary driver: None"
// next to a 100% Avoid reading (see Page 1 conditions bar).
function backfillDrivers(vessels) {
  VESSEL_CLASSES.forEach((vc) => {
    const v = vessels[vc.code];
    if (!v) return;
    const hazard = domainHazard(v.warning_percent ?? 0, v.caution_percent ?? 0);
    if (hazard > 0 && (!v.main_driver || v.main_driver === 'none')) {
      const derived = deriveDriverForVessel(vc.code, v.max_wind_kt ?? 0, v.max_wave_height_m ?? 0);
      if (derived && derived !== 'none') v.main_driver = derived;
    }
  });
  return vessels;
}

export function canonicalSuitabilityBounds(bounds) {
  if (!bounds) return null;
  const canonical = {
    west: Number(bounds.west),
    south: Number(bounds.south),
    east: Number(bounds.east),
    north: Number(bounds.north),
  };
  if (!Object.values(canonical).every(Number.isFinite)) return null;
  if (canonical.west >= canonical.east || canonical.south >= canonical.north) return null;
  return canonical;
}

function suitabilityQuery(bounds, extras = {}) {
  const params = new URLSearchParams(extras);
  const canonical = canonicalSuitabilityBounds(bounds);
  if (bounds && !canonical) throw new Error('Current map bounds are invalid or incomplete.');
  if (canonical) Object.entries(canonical).forEach(([key, value]) => params.set(key, String(value)));
  return params;
}

export function assertBoundedStatisticsResponse(data, bounds, endpointLabel) {
  const requested = canonicalSuitabilityBounds(bounds);
  if (!requested) return;
  if (data?.statistics_basis !== 'centroid_filtered_faces') {
    throw new Error(`${endpointLabel} did not apply current-map bounds (statistics_basis=${data?.statistics_basis ?? 'missing'}).`);
  }
  const echoed = data?.requested_bounds;
  const echoedCanonical = canonicalSuitabilityBounds(echoed);
  const matches = echoedCanonical && Object.keys(requested).every(
    key => Math.abs(echoedCanonical[key] - requested[key]) <= 1e-6
  );
  if (!matches || !data?.applied_bounds) {
    throw new Error(`${endpointLabel} did not echo the requested and applied map bounds.`);
  }
}

async function fetchSummary(timeIndex, baseUrl, bounds = null) {
  const query = suitabilityQuery(bounds);
  const queryString = query.toString();
  const base = await fetchJsonEndpoint(
    `/niue/suitability/summary/${timeIndex}${queryString ? `?${queryString}` : ''}`,
    baseUrl,
    `Suitability summary t${timeIndex}`
  );
  assertBoundedStatisticsResponse(base, bounds, `Suitability summary t${timeIndex}`);

  if (base?.vessels) {
    return { ...base, vessels: backfillDrivers(normaliseVesselsMap(base.vessels)) };
  }

  // Per-vessel backend: base is already one vessel's data (whichever the
  // default/"all" call returned) — fetch the remaining three in parallel
  // and assemble the bundled shape the rest of this file expects.
  const perVessel = await Promise.all(
    VESSEL_CLASSES.map(vc =>
      fetchJsonEndpoint(
        `/niue/suitability/summary/${timeIndex}?${suitabilityQuery(bounds, { vessel: vc.code })}`,
        baseUrl,
        `Suitability summary t${timeIndex} (${vc.code})`
      ).then((data) => {
        assertBoundedStatisticsResponse(data, bounds, `Suitability summary t${timeIndex} (${vc.code})`);
        return data;
      }).catch((error) => {
        if (bounds) throw error;
        return null;
      })
    )
  );

  const vessels = {};
  VESSEL_CLASSES.forEach((vc, i) => {
    const normalised = normaliseSummaryVessel(perVessel[i] ?? (base?.vessel === vc.code ? base : null));
    if (normalised) vessels[vc.code] = normalised;
  });

  return { ...base, vessels: backfillDrivers(vessels) };
}

// ── Capture map ───────────────────────────────────────────────────────────────

async function captureMap(mapElement) {
  const h2c = await import('html2canvas');
  const canvas = await h2c.default(mapElement, {
    useCORS:         true,
    allowTaint:      true,
    backgroundColor: '#0a1628',
    scale:           1.5,
    logging:         false,
    // This app uses MapLibre GL JS, not Leaflet — 'leaflet-control' never
    // matches anything here (confirmed: no Leaflet import anywhere in this
    // codebase), so zoom/compass/attribution controls were never actually
    // excluded from this fallback screenshot despite the apparent intent.
    // MapLibre wraps each control group in a 'maplibregl-ctrl' class.
    ignoreElements:  el => el.classList?.contains('maplibregl-ctrl'),
  });
  return canvas.toDataURL('image/jpeg', 0.88);
}

// ── Page 1 — Executive advisory ───────────────────────────────────────────────

async function drawPage1(doc, { mapDataUrl, summary, validTime, runId, selectedVessel = 'small_craft', timeSeriesData = [], vesselIcons = {}, advisoryConfig = null, mapExtentSource = 'model_domain' }) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  rect(doc, 0, 0, W, H, PAGE_BG);

  // ── Header ────────────────────────────────────────────────────────────────
  const validStr = validTime ? formatUtcTiny(validTime) : '—';
  const issuedStr1 = formatRunId(runId);
  drawHeaderBand(doc, {
    title: 'NIUE COASTAL WATERS',
    subtitle: 'MARINE VESSEL SUITABILITY ADVISORY',
    rightLine1: `Valid: ${validStr}`,
    rightLine2: issuedStr1 ? `Issued: ${issuedStr1}  ·  SWAN  |  Page 1 of 7` : 'SWAN  |  Page 1 of 7',
  });

  // ── Selected vessel badge (centre of header) ──────────────────────────────
  const vessels   = summary?.vessels ?? {};
  const vcKeys    = VESSEL_CLASSES.map(v => v.code);
  const overallHaz = Math.max(
    ...vcKeys.map(vc => domainHazard(vessels[vc]?.warning_percent ?? 0, vessels[vc]?.caution_percent ?? 0))
  );
  const vesselVc    = VESSEL_BY_CODE[selectedVessel];
  const vesselLabel = vesselVc?.label ?? selectedVessel.replaceAll('_', ' ');
  const selectedData = vessels[selectedVessel] ?? {};
  const selectedHaz  = domainHazard(selectedData.warning_percent ?? 0, selectedData.caution_percent ?? 0);

  const badgeW = 60, badgeX = W / 2 - badgeW / 2;
  setFill(doc, hazardColor(selectedHaz));
  doc.roundedRect(badgeX, 1.5, badgeW, HDR_H - 3, 1.5, 1.5, 'F');
  setFont(doc, [255, 255, 255], 8, 'bold');
  doc.text(
    fitTextToWidth(doc, `${vesselLabel.toUpperCase()} — ${hazardLabel(selectedHaz).toUpperCase()}`, badgeW - 6),
    W / 2, HDR_H * 0.68, { align: 'center' }
  );

  // ── Summary sentence strip ────────────────────────────────────────────────
  // Light hazard-tinted band: one sentence describing the selected vessel outlook.
  const SUM_H = 10;
  const SUM_Y = HDR_H;
  rect(doc, 0, SUM_Y, W, SUM_H, hazardLight(selectedHaz));
  const selectedAvoid   = Math.round(selectedData.warning_percent   ?? 0);
  const selectedCaution = Math.round(selectedData.caution_percent   ?? 0);
  const page1Finding = (() => {
    if (!summary || !vesselVc) {
      return !summary
        ? 'Forecast summary unavailable — vessel percentages and drivers could not be loaded.'
        : 'Suitability data unavailable for selected vessel.';
    }
    if (selectedAvoid >= 20)   return `${vesselLabel} faces ${selectedAvoid}% Avoid waters — check conditions before departure.`;
    if (selectedCaution >= 20) return `${vesselLabel} is mostly operable, but ${selectedCaution}% of waters require caution.`;
    if (selectedCaution > 0) {
      return overallHaz > selectedHaz
        ? `${vesselLabel} suitable with minor caution zones — smaller vessel classes face greater restrictions.`
        : `${vesselLabel} has mostly Suitable conditions — ${selectedCaution}% of waters are Caution.`;
    }
    return overallHaz > selectedHaz
      ? `All modelled waters are Suitable for ${vesselLabel} — restrictions apply for smaller vessel classes.`
      : `All modelled waters are Suitable for ${vesselLabel} — safe conditions for departure.`;
  })();
  setFont(doc, summary ? hazardText(selectedHaz) : hazardColor(2), 8, 'bold');
  doc.text(fitTextToWidth(doc, page1Finding, W - 20), W / 2, SUM_Y + SUM_H * 0.64, { align: 'center' });

  // ── Layout constants ──────────────────────────────────────────────────────
  const COND_H   = 11;
  const FOOT_H   = 6;
  const MAP_Y    = SUM_Y + SUM_H + 1.5;
  const MAP_W    = W * 0.60;
  const PAGE_BTM = H - COND_H - FOOT_H - 1;   // hard bottom limit for map + cards
  const MAP_H    = PAGE_BTM - MAP_Y;            // total right+left height band
  const MAX_IMG_H = MAP_H - 6;                  // 6 mm reserved for caption + legend
  let IMG_H = MAX_IMG_H;
  if (advisoryConfig?.area?.type === 'current_map_view' && mapDataUrl) {
    try {
      const properties = doc.getImageProperties(mapDataUrl);
      const sourceAspect = properties.width / properties.height;
      if (Number.isFinite(sourceAspect) && sourceAspect > 1) {
        // Preserve the live viewport's wide composition. The old fixed-height
        // slot forced a wide current view into a tall box, creating the large
        // navy bands seen above and below the actual map.
        IMG_H = Math.max(72, Math.min(MAX_IMG_H, (MAP_W - 4) / sourceAspect));
      }
    } catch { /* retain the standard map height */ }
  }
  const CARD_X0  = MAP_W + 4;
  const CARD_W   = W - CARD_X0 - 3;
  const CARD_GAP = 2.5;
  const FLEET_H  = 8;                           // reserved for secondary fleet note
  // CARD_H is clamped so all 4 cards + 3 gaps + fleet note always fit within MAP_H
  const CARD_H   = Math.min(38, Math.max(18, (MAP_H - FLEET_H - CARD_GAP * 3) / 4));
  const BAR_H    = Math.max(5, CARD_H * 0.21);  // thick status bar height

  // ── Map ───────────────────────────────────────────────────────────────────
  if (mapDataUrl) {
    setDraw(doc, [200, 200, 200]);
    doc.setLineWidth(0.5);
    doc.rect(2.5, MAP_Y - 0.5, MAP_W - 3, IMG_H + 1, 'S');
    const mapFormat = mapDataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
    const boxX = 3;
    const boxW = MAP_W - 4;
    let imageX = boxX;
    let imageY = MAP_Y;
    let imageW = boxW;
    let imageH = IMG_H;
    try {
      const properties = doc.getImageProperties(mapDataUrl);
      const sourceAspect = properties.width / properties.height;
      const boxAspect = boxW / IMG_H;
      if (Number.isFinite(sourceAspect) && sourceAspect > 0) {
        if (sourceAspect > boxAspect) {
          imageH = boxW / sourceAspect;
          imageY += (IMG_H - imageH) / 2;
        } else {
          imageW = IMG_H * sourceAspect;
          imageX += (boxW - imageW) / 2;
        }
      }
    } catch { /* retain full box if image metadata cannot be read */ }
    setFill(doc, [9, 24, 42]);
    doc.rect(boxX, MAP_Y, boxW, IMG_H, 'F');
    doc.addImage(mapDataUrl, mapFormat, imageX, imageY, imageW, imageH, 'p1_advisory_map', 'FAST');
  } else {
    drawFailurePanel(
      doc,
      3,
      MAP_Y,
      MAP_W - 4,
      IMG_H,
      'Map data unavailable for this panel',
      'Map unavailable - data could not be loaded'
    );
  }
  // Caption and shared legend below map image
  setFont(doc, TEXT_MD, 6, 'italic');
  const p1AreaNote = advisoryConfig?.area?.type === 'current_map_view'
    ? mapExtentSource.startsWith('current_map_view')
      ? '  ·  Map + statistics: current view  ·  Centroid-filtered faces'
      : '  ·  Current-view map unavailable'
    : '';
  doc.text(`${vesselLabel} — current conditions${p1AreaNote}`, 5, MAP_Y + IMG_H + 3);
  drawSharedLegend(doc, MAP_W / 2, MAP_Y + IMG_H + 4.5);

  // A wide live viewport leaves useful space beneath the map. Turn that into
  // a transparent scope card instead of padding the map with empty colour.
  if (advisoryConfig?.area?.type === 'current_map_view') {
    const scopeY = MAP_Y + IMG_H + 8;
    const scopeH = PAGE_BTM - scopeY;
    if (scopeH >= 24) {
      rect(doc, 3, scopeY, MAP_W - 4, scopeH, [248, 250, 253], GRID_CLR, 0.25);
      setFont(doc, HEADER_BG, 7, 'bold');
      doc.text('CURRENT-VIEW ANALYSIS SCOPE', 7, scopeY + 5.5);
      const bounds = advisoryConfig?.area?.bounds;
      const classified = summary?.classified_face_count;
      const eligible = summary?.eligible_face_count;
      const classificationCoverage = summary?.classification_coverage_percent;
      const rasterCoverage = summary?.spatial_scope_coverage_percent;
      setFont(doc, TEXT_MD, 5.8);
      const scopeLines = [
        bounds
          ? `Bounds  W ${bounds.west}  ·  S ${bounds.south}  ·  E ${bounds.east}  ·  N ${bounds.north}`
          : 'Bounds unavailable',
        `Classified faces  ${classified ?? '—'} / ${eligible ?? '—'}  ·  Classification coverage ${classificationCoverage ?? '—'}%`,
        `Renderable raster coverage inside requested view  ${rasterCoverage ?? '—'}%`,
        'Statistics use face centroids inside the bounds; they are not polygon area-weighted.',
      ];
      scopeLines.forEach((line, index) => {
        doc.text(fitTextToWidth(doc, line, MAP_W - 14), 7, scopeY + 11 + index * 4.2);
      });
    }
  }

  // ── Vessel data cards (right column) ─────────────────────────────────────
  // Each card: vessel name + Avoid% | HAZARD label + Caution% | thick status bar
  for (let ci = 0; ci < VESSEL_CLASSES.length; ci++) {
    const vc    = VESSEL_CLASSES[ci];
    // A vessel genuinely absent from the backend response must not render
    // identically to one confirmed at 0% Avoid/Caution (green "SUITABLE") —
    // see fetchBestContrastTimestep's comment for a case where exactly
    // this ambiguity hid a real bug.
    const dataPresent = hasVesselData(vessels, vc.code);
    const vdata = vessels[vc.code] ?? {};
    const warn  = vdata.warning_percent  ?? 0;
    const caut  = vdata.caution_percent  ?? 0;
    const haz   = domainHazard(warn, caut);
    const cardColor = dataPresent ? hazardColor(haz) : NO_DATA_GREY;
    const cy    = MAP_Y + ci * (CARD_H + CARD_GAP);

    // Layout assertion: skip card if it would overflow the bottom limit
    if (cy + CARD_H > PAGE_BTM + 0.5) break;

    // Card background — white with full-saturation hazard accent bar on left edge
    setFill(doc, [255, 255, 255]);
    setDraw(doc, cardColor);
    doc.setLineWidth(0.6);
    doc.roundedRect(CARD_X0, cy, CARD_W, CARD_H, 2, 2, 'FD');
    setFill(doc, cardColor);
    doc.rect(CARD_X0, cy + 1, 3.5, CARD_H - 2, 'F');

    // Vessel icon — SVG rasterised at hazard colour; fallback to initials box
    const ICON_W = 11;   // mm — kept small so it accents, not dominates
    const ICON_H = 4.0;  // mm
    const ICON_X = CARD_X0 + 6;
    const ICON_Y = cy + 1.5;
    const icon   = vesselIcons[vc.code];
    if (icon) {
      doc.addImage(icon, 'PNG', ICON_X, ICON_Y, ICON_W, ICON_H, 'vessel_icon_' + vc.code, 'FAST');
    } else {
      drawVesselFallbackIcon(doc, ICON_X, ICON_Y, vc, ICON_H);
    }
    const LABEL_X = ICON_X + ICON_W + 3;   // text column starts just right of icon

    // Row 1: vessel name (left) + Avoid % (right)
    const row1Y = cy + CARD_H * 0.24;
    setFont(doc, dataPresent ? hazardText(haz) : TEXT_MD, 8.5, 'bold');
    doc.text(vc.label, LABEL_X, row1Y);

    // Row 2: HAZARD status (left, large) + Caution % (right, muted)
    const row2Y = cy + CARD_H * 0.50;
    if (dataPresent) {
      setFont(doc, hazardColor(haz), 8, 'bold');
      doc.text(`${Math.round(warn)}% Avoid`, CARD_X0 + CARD_W - 3.5, row1Y, { align: 'right' });
      setFont(doc, hazardColor(haz), 10, 'bold');
      doc.text(hazardLabel(haz).toUpperCase(), LABEL_X, row2Y);
      setFont(doc, TEXT_MD, 7);
      doc.text(`${Math.round(caut)}% Caution`, CARD_X0 + CARD_W - 3.5, row2Y, { align: 'right' });
    } else {
      setFont(doc, NO_DATA_GREY, 10, 'bold');
      doc.text('NO DATA', LABEL_X, row2Y);
      setFont(doc, TEXT_MD, 6.5, 'italic');
      doc.text('unavailable this timestep', CARD_X0 + CARD_W - 3.5, row2Y, { align: 'right' });
    }

    // Thick status bar at bottom of card
    // Layout: [Avoid (coral)] [Caution (amber)] [Suitable (teal)] — left to right
    const barY = cy + CARD_H - BAR_H - 1;
    const barX = CARD_X0 + 2;
    const barW = CARD_W - 4;
    if (dataPresent) {
      const warnFrac = Math.min(1, warn / 100);
      const cautFrac = Math.min(1 - warnFrac, caut / 100);
      setFill(doc, hazardColor(0));  // teal base (suitable)
      doc.roundedRect(barX, barY, barW, BAR_H, 1.5, 1.5, 'F');
      if (warnFrac + cautFrac > 0) {
        setFill(doc, hazardColor(1));  // amber: caution + avoid zone
        doc.roundedRect(barX, barY, barW * (warnFrac + cautFrac), BAR_H, 1.5, 1.5, 'F');
      }
      if (warnFrac > 0) {
        setFill(doc, hazardColor(2));  // coral: avoid zone
        doc.roundedRect(barX, barY, barW * warnFrac, BAR_H, 1.5, 1.5, 'F');
      }
    } else {
      setFill(doc, [225, 225, 225]);
      doc.roundedRect(barX, barY, barW, BAR_H, 1.5, 1.5, 'F');
    }
  }

  // Fleet advisory note (secondary): only shown when fleet status is worse than selected vessel
  if (overallHaz > selectedHaz) {
    const noteY = MAP_Y + 4 * (CARD_H + CARD_GAP) + 1;
    if (noteY + FLEET_H - 1 <= PAGE_BTM) {
      setFill(doc, hazardLight(overallHaz));
      setDraw(doc, hazardColor(overallHaz));
      doc.setLineWidth(0.4);
      doc.roundedRect(CARD_X0, noteY, CARD_W, FLEET_H - 1, 1.5, 1.5, 'FD');
      setFont(doc, hazardText(overallHaz), 6.5, 'bold');
      doc.text(
        `Fleet advisory: ${hazardLabel(overallHaz).toUpperCase()} for most sensitive vessel classes`,
        CARD_X0 + CARD_W / 2, noteY + (FLEET_H - 1) * 0.62, { align: 'center' }
      );
    }
  }

  // ── Conditions bar ────────────────────────────────────────────────────────
  const COND_Y = PAGE_BTM + 1;
  rect(doc, 2.5, COND_Y, W - 5, COND_H, HEADER_BG);

  const anyVesselData = vcKeys.some(vc => hasVesselData(vessels, vc));
  const maxWind  = Math.max(...vcKeys.map(vc => vessels[vc]?.max_wind_kt ?? 0));
  const waveVals = vcKeys.map(vc => vessels[vc]?.max_wave_height_m).filter(v => Number.isFinite(v) && v > 0);
  const maxWave  = waveVals.length ? Math.max(...waveVals) : 0;
  const hazardedKeys = vcKeys.filter(vc =>
    domainHazard(vessels[vc]?.warning_percent ?? 0, vessels[vc]?.caution_percent ?? 0) > 0
  );
  const drivers = hazardedKeys.map(vc => vessels[vc]?.main_driver ?? 'none');
  const mainDriver = drivers.length
    ? drivers.sort((a, b) => drivers.filter(d => d === b).length - drivers.filter(d => d === a).length)[0]
    : 'none';
  const driverLabel = DRIVER_LABELS[mainDriver] ?? mainDriver;

  // Fleet advisory badge — right side of bar
  const badgeLabel = `Fleet: ${hazardLabel(overallHaz).toUpperCase()}`;
  const fleetBadgeW = 30;
  setFill(doc, hazardColor(overallHaz));
  doc.roundedRect(W - fleetBadgeW - 5, COND_Y + 1.5, fleetBadgeW, COND_H - 3, 1.5, 1.5, 'F');
  setFont(doc, [255, 255, 255], 7, 'bold');
  doc.text(badgeLabel, W - 5 - fleetBadgeW / 2, COND_Y + COND_H * 0.55, { align: 'center' });
  // Bumped from 5.5pt non-bold dim blue-grey to 6.5pt bold near-white — the
  // old qualifier was small/dim enough to read as fine print a reader could
  // miss, letting "Fleet: AVOID" alone imply every vessel class should
  // avoid the water when this badge is driven by only the most sensitive
  // one. Not equal weight to the headline (still 0.5pt smaller), but no
  // longer easy to skip past.
  setFont(doc, [235, 242, 252], 6.5, 'bold');
  doc.text(hazardLabel(overallHaz) === 'Suitable' ? 'All classes' : 'most sensitive class', W - 5 - fleetBadgeW / 2, COND_Y + COND_H * 0.82, { align: 'center' });

  // Conditions — two-line layout: values + driver
  setFont(doc, TEXT_LT, 8.5, 'bold');
  doc.text(
    anyVesselData
      ? `Wind up to ${maxWind.toFixed(0)} kt   ·   Seas up to ${maxWave.toFixed(1)} m`
      : 'Wind/sea conditions unavailable for this timestep',
    (W - fleetBadgeW - 5) / 2 + 2.5, COND_Y + COND_H * 0.40, { align: 'center' }
  );
  setFont(doc, [180, 200, 235], 6.5);
  doc.text(
    anyVesselData ? `Primary driver: ${driverLabel}` : 'Forecast data unavailable',
    (W - fleetBadgeW - 5) / 2 + 2.5, COND_Y + COND_H * 0.80, { align: 'center' }
  );

  // ── Footer ────────────────────────────────────────────────────────────────
  drawModelDisclaimer(doc);
}

// ── Pages 2–3 — continuous vessel outlook + heatmap/sea-level detail ─────────

function vesselOutlookHeadline(summary) {
  const vessels = summary?.vessels ?? {};
  if (!summary) return { hazard: null, text: 'Forecast summary unavailable — some outlook rows may be incomplete.' };
  const hazards = VESSEL_CLASSES
    .filter(vc => hasVesselData(vessels, vc.code))
    .map(vc => domainHazard(vessels[vc.code].warning_percent ?? 0, vessels[vc.code].caution_percent ?? 0));
  const overallHaz = hazards.length ? Math.max(...hazards) : null;
  const traditionalAvoid = vessels.traditional_craft?.warning_percent ?? 0;
  const largerSuitable = vessels.larger_vessels?.suitable_percent ?? 0;
  if (overallHaz === null) return { hazard: null, text: 'Suitability coverage is unavailable at the selected forecast time.' };
  if (overallHaz === 0) return { hazard: 0, text: 'All reported vessel classes remain within the configured wind-and-wave thresholds at the selected time.' };
  if (traditionalAvoid >= 50 && largerSuitable >= 50) {
    return { hazard: 2, text: 'Vessel sensitivity is pronounced: traditional craft face extensive Avoid coverage while larger vessels retain lower-risk areas.' };
  }
  if (overallHaz === 1) return { hazard: 1, text: 'Caution coverage is present — compare the full forecast shape before choosing a departure window.' };
  return { hazard: 2, text: 'Avoid coverage is present for one or more vessel classes — inspect timing, coverage gaps, and official warnings.' };
}

function vesselOutlookStats(vc, timeSeriesData = []) {
  const entries = timeSeriesData.map((step, index) => {
    const data = step?.vessels?.[vc.code];
    return hasVesselData(step?.vessels, vc.code) ? { data, index, time: step.time } : null;
  }).filter(Boolean);
  if (!entries.length) return { coveragePercent: 0, peakAvoid: null, best: null };
  const peakAvoid = Math.max(...entries.map(entry => entry.data.warning_percent ?? 0));
  const best = entries.reduce((winner, entry) => {
    const hazard = domainHazard(entry.data.warning_percent ?? 0, entry.data.caution_percent ?? 0);
    const exposure = (entry.data.warning_percent ?? 0) + (entry.data.caution_percent ?? 0);
    const score = hazard * 1000 + exposure;
    return !winner || score < winner.score ? { ...entry, score, hazard } : winner;
  }, null);
  return {
    coveragePercent: timeSeriesData.length ? entries.length / timeSeriesData.length * 100 : 0,
    peakAvoid,
    best,
  };
}

function outlookTimeTicks(timeSeriesData = []) {
  const validTimes = timeSeriesData
    .map(step => new Date(step?.time).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (validTimes.length < 2) return [];
  const start = validTimes[0];
  const end = validTimes[validTimes.length - 1];
  const durationHours = (end - start) / 3_600_000;
  const intervalHours = durationHours <= 24 ? 6 : durationHours <= 72 ? 12 : durationHours <= 192 ? 24 : 48;
  const intervalMs = intervalHours * 3_600_000;
  const ticks = [{ time: start, endpoint: 'start' }];
  for (let time = start + intervalMs; time < end; time += intervalMs) {
    ticks.push({ time, endpoint: null });
  }
  ticks.push({ time: end, endpoint: 'end' });
  return ticks;
}

function formatOutlookTick(time) {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return '';
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = date.toLocaleString('en', { month: 'short', timeZone: 'UTC' });
  const hour = String(date.getUTCHours()).padStart(2, '0');
  return `${day} ${month} ${hour}Z`;
}

// Draw a compact UTC axis while measuring every label. Interior labels that
// would collide with either neighbour are omitted, but their tick/grid line
// remains, so narrow export sizes degrade without overlap or clipping.
function drawOutlookTimeAxis(doc, { x, y, w, timeSeriesData = [] }) {
  const ticks = outlookTimeTicks(timeSeriesData);
  if (ticks.length < 2) return;
  const start = ticks[0].time;
  const end = ticks[ticks.length - 1].time;
  const toX = time => x + (time - start) / (end - start) * w;

  setFont(doc, TEXT_MD, 4.15);
  const candidates = ticks.map(tick => {
    const label = formatOutlookTick(tick.time);
    const tx = toX(tick.time);
    const width = doc.getTextWidth(label);
    const left = tick.endpoint === 'start' ? tx : tick.endpoint === 'end' ? tx - width : tx - width / 2;
    return { ...tick, label, tx, width, left, right: left + width };
  });

  const first = candidates[0];
  const last = candidates[candidates.length - 1];
  const visible = [first];
  let previousRight = first.right;
  candidates.slice(1, -1).forEach(candidate => {
    if (candidate.left >= previousRight + 2 && candidate.right <= last.left - 2) {
      visible.push(candidate);
      previousRight = candidate.right;
    }
  });
  if (last.left >= previousRight + 2) visible.push(last);

  setDraw(doc, [80, 91, 110]);
  doc.setLineWidth(0.18);
  doc.line(x, y, x + w, y);
  ticks.forEach(tick => {
    const tx = toX(tick.time);
    doc.line(tx, y, tx, y + 1.15);
  });
  visible.forEach(tick => {
    const align = tick.endpoint === 'start' ? 'left' : tick.endpoint === 'end' ? 'right' : 'center';
    doc.text(tick.label, tick.tx, y + 3.15, { align });
  });
}

// Full-resolution stacked area-share band. Width is based on forecast time,
// rather than giving every response item equal width; missing model summaries
// are explicit grey gaps instead of silently becoming 100% Suitable.
function drawContinuousOutlookBand(doc, { x, y, w, h, vc, timeSeriesData = [] }) {
  rect(doc, x, y, w, h, [232, 235, 240], GRID_CLR, 0.15);
  if (!timeSeriesData.length) return;

  const times = timeSeriesData.map(step => new Date(step?.time).getTime());
  const validTimes = times.filter(Number.isFinite);
  const t0 = validTimes[0];
  const t1 = validTimes[validTimes.length - 1];
  const useTimeScale = Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0;
  const toX = (ms, fallbackIndex = 0) => useTimeScale
    ? x + (ms - t0) / (t1 - t0) * w
    : x + fallbackIndex / Math.max(1, timeSeriesData.length) * w;

  timeSeriesData.forEach((step, index) => {
    const leftMs = index === 0 ? times[index] : (times[index - 1] + times[index]) / 2;
    const rightMs = index === timeSeriesData.length - 1 ? times[index] : (times[index] + times[index + 1]) / 2;
    const bx = useTimeScale && Number.isFinite(leftMs) ? toX(leftMs) : x + index / timeSeriesData.length * w;
    const right = useTimeScale && Number.isFinite(rightMs) ? toX(rightMs) : x + (index + 1) / timeSeriesData.length * w;
    const bw = Math.max(0.18, right - bx);
    const vd = step?.vessels?.[vc.code];
    if (!hasVesselData(step?.vessels, vc.code)) {
      setFill(doc, NO_DATA_GREY);
      doc.rect(bx, y, bw, h, 'F');
      return;
    }
    const toPct = (value) => {
      if (value === null || value === undefined) return 0;
      const number = Number(value);
      return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
    };
    let suitable = toPct(vd.suitable_percent);
    let caution = toPct(vd.caution_percent);
    let avoid = toPct(vd.warning_percent);
    const reportedTotal = suitable + caution + avoid;
    if (reportedTotal > 100) {
      const scale = 100 / reportedTotal;
      suitable *= scale;
      caution *= scale;
      avoid *= scale;
    }
    const unclassified = Math.max(0, 100 - suitable - caution - avoid);
    let top = y;
    [
      { pct: suitable, color: hazardColor(0) },
      { pct: caution, color: hazardColor(1) },
      { pct: avoid, color: hazardColor(2) },
      { pct: unclassified, color: NO_DATA_GREY },
    ].forEach(({ pct, color }) => {
      const segmentH = h * pct / 100;
      if (segmentH <= 0) return;
      setFill(doc, color);
      doc.rect(bx, top, bw, segmentH, 'F');
      top += segmentH;
    });
  });

  [0.5].forEach(fraction => {
    setDraw(doc, [255, 255, 255]);
    doc.setLineWidth(0.16);
    doc.line(x, y + h * fraction, x + w, y + h * fraction);
  });

  if (useTimeScale) {
    const axisTicks = outlookTimeTicks(timeSeriesData);
    axisTicks.slice(1, -1).forEach(({ time }) => {
      const tx = toX(time);
      setDraw(doc, [255, 255, 255]);
      doc.setLineWidth(0.2);
      doc.setLineDashPattern([0.8, 0.8], 0);
      doc.line(tx, y, tx, y + h);
      doc.setLineDashPattern([], 0);
    });

    const uncertaintyMs = t0 + 48 * 3_600_000;
    if (uncertaintyMs < t1) {
      const ux = toX(uncertaintyMs);
      setDraw(doc, [48, 63, 94]);
      doc.setLineWidth(0.45);
      doc.setLineDashPattern([1.3, 1.0], 0);
      doc.line(ux, y, ux, y + h);
      doc.setLineDashPattern([], 0);
    }
  }

  setDraw(doc, [35, 42, 55]);
  doc.setLineWidth(0.5);
  doc.line(x, y, x, y + h);
}

function drawVesselOutlookPage(doc, { summary, validTime, runId, timeSeriesData, vesselIcons = {} }) {
  doc.addPage();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  rect(doc, 0, 0, W, H, PAGE_BG);

  const validStr = validTime ? formatUtcTiny(validTime) : '-';
  const issuedStr = formatRunId(runId);
  drawHeaderBand(doc, {
    title: 'LOCATION / VESSEL OUTLOOK',
    subtitle: `${outlookLabel(timeSeriesData)} continuous suitability outlook · full forecast resolution`,
    rightLine1: `Valid: ${validStr}`,
    rightLine2: issuedStr ? `Issued: ${issuedStr}  ·  SWAN  |  Page 2 of 7` : 'SWAN  |  Page 2 of 7',
  });

  const headline = vesselOutlookHeadline(summary);
  rect(doc, 5, HDR_H + 2, W - 10, 8, headline.hazard === null ? [238, 242, 250] : hazardLight(headline.hazard), GRID_CLR, 0.2);
  setFont(doc, headline.hazard === null ? TEXT_MD : hazardText(headline.hazard), 7.2, 'bold');
  doc.text(fitTextToWidth(doc, headline.text, W - 18), 9, HDR_H + 7.1);

  const legendY = HDR_H + 14;
  setFont(doc, TEXT_MD, 5.5);
  doc.text('Vertical share = classified faces in advisory scope · dashed marker = +48 h (forecast uncertainty increases)', 7, legendY + 1);
  const legendItems = [
    { label: 'Suitable', color: hazardColor(0) },
    { label: 'Caution', color: hazardColor(1) },
    { label: 'Avoid', color: hazardColor(2) },
    { label: 'Unavailable', color: NO_DATA_GREY },
  ];
  let legendX = W - 94;
  legendItems.forEach(item => {
    setFill(doc, item.color);
    doc.roundedRect(legendX, legendY - 1.4, 3, 3, 0.5, 0.5, 'F');
    setFont(doc, TEXT_MD, 5.2);
    doc.text(item.label, legendX + 4.2, legendY + 1);
    legendX += item.label === 'Unavailable' ? 27 : 22;
  });

  const ROW_X = 6.5;
  const ROW_W = W - 13;
  const ROW_H = 38.5;
  const ROW_GAP = 1.7;
  const LABEL_W = 52;
  const CHART_X = ROW_X + LABEL_W;
  const CHART_W = ROW_W - LABEL_W - 3;
  const CHART_H = 16;
  const rowsY = HDR_H + 18;
  const currentVessels = summary?.vessels ?? {};

  VESSEL_CLASSES.forEach((vc, rowIndex) => {
    const y = rowsY + rowIndex * (ROW_H + ROW_GAP);
    const current = currentVessels[vc.code];
    const currentAvailable = hasVesselData(currentVessels, vc.code);
    const hazard = currentAvailable
      ? domainHazard(current.warning_percent ?? 0, current.caution_percent ?? 0)
      : null;
    const stats = vesselOutlookStats(vc, timeSeriesData);
    rect(doc, ROW_X, y, ROW_W, ROW_H, rowIndex % 2 ? [248, 250, 252] : [255, 255, 255], GRID_CLR, 0.2);

    if (vesselIcons[vc.code]) {
      doc.addImage(vesselIcons[vc.code], 'PNG', ROW_X + 3, y + 3, 13, 4.4, `p2_${vc.code}`, 'FAST');
    } else {
      drawVesselFallbackIcon(doc, ROW_X + 3, y + 2.7, vc, 5);
    }
    setFont(doc, TEXT_DK, vc.label.length > 22 ? 6.1 : 7.2, 'bold');
    const vesselNameLines = doc.splitTextToSize(vc.label, LABEL_W - 21).slice(0, 2);
    doc.text(vesselNameLines, ROW_X + 19, y + (vesselNameLines.length > 1 ? 3.8 : 6.2), { lineHeightFactor: 0.9 });

    const badgeColor = hazard === null ? NO_DATA_GREY : hazardColor(hazard);
    setFill(doc, badgeColor);
    doc.roundedRect(ROW_X + 3, y + 10, LABEL_W - 7, 7, 1.4, 1.4, 'F');
    setFont(doc, TEXT_LT, 6.3, 'bold');
    doc.text(hazard === null ? 'UNAVAILABLE' : hazardLabel(hazard).toUpperCase(), ROW_X + LABEL_W / 2, y + 14.8, { align: 'center' });

    setFont(doc, TEXT_MD, 4.8);
    doc.text(`Temporal coverage ${Math.round(stats.coveragePercent)}%`, ROW_X + 3, y + 22);
    doc.text(stats.peakAvoid === null ? 'Peak Avoid —' : `Peak Avoid ${Math.round(stats.peakAvoid)}%`, ROW_X + 3, y + 26.5);
    doc.text(stats.best?.time ? `Lowest exposure ${formatUtcTiny(stats.best.time).replace(' UTC', 'Z')}` : 'Lowest exposure —', ROW_X + 3, y + 31, { maxWidth: LABEL_W - 6 });

    const currentMix = currentAvailable
      ? `Now  ·  ${current.suitable_percent !== null && current.suitable_percent !== undefined && Number.isFinite(Number(current.suitable_percent)) ? `${Math.round(Number(current.suitable_percent))}%` : '—'} Suitable`
        + `  ·  ${current.caution_percent !== null && current.caution_percent !== undefined && Number.isFinite(Number(current.caution_percent)) ? `${Math.round(Number(current.caution_percent))}%` : '—'} Caution`
        + `  ·  ${current.warning_percent !== null && current.warning_percent !== undefined && Number.isFinite(Number(current.warning_percent)) ? `${Math.round(Number(current.warning_percent))}%` : '—'} Avoid`
      : 'Current advisory-scope breakdown unavailable';
    setFont(doc, hazard === null ? NO_DATA_GREY : hazardText(hazard), 5.8, 'bold');
    doc.text(currentMix, CHART_X, y + 6.2, { maxWidth: CHART_W });
    setFont(doc, TEXT_MD, 4.7);
    doc.text('100%', CHART_X - 2, y + 12.3, { align: 'right' });
    doc.text('50%', CHART_X - 2, y + 20.3, { align: 'right' });
    doc.text('0%', CHART_X - 2, y + 28.3, { align: 'right' });

    const chartY = y + 12;
    drawContinuousOutlookBand(doc, { x: CHART_X, y: chartY, w: CHART_W, h: CHART_H, vc, timeSeriesData });
    if (timeSeriesData.length >= 2) {
      drawOutlookTimeAxis(doc, {
        x: CHART_X,
        y: chartY + CHART_H,
        w: CHART_W,
        timeSeriesData,
      });
    }
  });

  drawModelDisclaimer(doc, { size: 5, bottomOffset: 2.2 });
}

async function drawPage2(doc, { summary, validTime, runId, timeSeriesData, vesselIcons = {}, baseUrl = '', windowHours = 168 }) {
  drawVesselOutlookPage(doc, { summary, validTime, runId, timeSeriesData, vesselIcons });

  let seaLevelData = null;
  let seaLevelError = null;
  if (baseUrl !== null && baseUrl !== undefined && timeSeriesData?.length >= 2) {
    try {
      seaLevelData = await fetchSeaLevelTimeseries(baseUrl, timeSeriesData[0].time, timeSeriesData[timeSeriesData.length - 1].time);
    } catch (error) {
      seaLevelError = error;
      console.warn('Sea-level timeseries unavailable — Page 3 context chart omitted:', error.message);
    }
  }

  doc.addPage();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  rect(doc, 0, 0, W, H, PAGE_BG);
  const validStr = validTime ? formatUtcTiny(validTime) : '-';
  const issuedStr = formatRunId(runId);
  drawHeaderBand(doc, {
    title: 'VESSEL OUTLOOK · TIME GRID & WATER LEVEL',
    subtitle: `${outlookLabel(timeSeriesData)} verification view · discrete hazard snapshots and independent sea-level context`,
    rightLine1: `Valid: ${validStr}`,
    rightLine2: issuedStr ? `Issued: ${issuedStr}  ·  SWAN  |  Page 3 of 7` : 'SWAN  |  Page 3 of 7',
    titleSize: 12.5,
  });

  const ROW_X = 6.5;
  const ROW_W = W - 13;
  const heatmapSteps = selectHeatmapSteps(timeSeriesData, windowHours);
  const currentVessels = summary?.vessels ?? {};
  const rowSummary = (vc) => {
    const current = currentVessels[vc.code];
    const available = hasVesselData(currentVessels, vc.code);
    const values = heatmapSteps
      .map(step => timeSeriesData[step.sourceIndex]?.vessels?.[vc.code]?.warning_percent)
      .filter(Number.isFinite);
    const peakAvoid = values.length ? Math.max(...values) : null;
    const stats = vesselOutlookStats(vc, timeSeriesData);
    const hazard = available ? domainHazard(current.warning_percent ?? 0, current.caution_percent ?? 0) : null;
    return {
      hazard,
      primary: hazard === null ? 'Unavailable now' : `${hazardLabel(hazard)} now`,
      secondary: stats.best?.time
        ? `Low ${formatUtcTiny(stats.best.time).replace(' UTC', 'Z')} · Peak ${peakAvoid === null ? '—' : `${Math.round(peakAvoid)}%`}`
        : `Peak ${peakAvoid === null ? '—' : `${Math.round(peakAvoid)}%`}`,
    };
  };

  const matrix = drawHazardHeatmapMatrix(doc, {
    x: ROW_X,
    y: HDR_H + 5,
    w: ROW_W,
    rowH: 14,
    labelW: 42,
    summaryW: 48,
    rows: VESSEL_CLASSES,
    heatmapSteps,
    title: 'DISCRETE FORECAST CHECKPOINTS',
    subtitle: 'Colour shows the dominant class; cell labels show Avoid share of classified faces in the advisory scope. Grey means unavailable.',
    cellForRowStep: (vc, step) => vesselHeatmapCell(timeSeriesData[step.sourceIndex]?.vessels?.[vc.code]),
    summaryForRow: rowSummary,
  });

  const seaY = matrix.bottom + 3;
  const seaLevelStrip = drawSeaLevelStrip(doc, {
    x: ROW_X,
    y: seaY,
    w: ROW_W,
    chartX: ROW_X + 32,
    chartW: ROW_W - 39,
    seaLevelData,
    t0: timeSeriesData?.[0]?.time,
    t1: timeSeriesData?.[timeSeriesData.length - 1]?.time,
    chartH: Math.max(28, H - seaY - 34),
    large: true,
  });
  if (!seaLevelStrip.drawn) {
    drawFailurePanel(
      doc,
      ROW_X,
      seaY,
      ROW_W,
      Math.max(42, H - seaY - 16),
      'Tide and total sea-level context unavailable',
      seaLevelError?.message ?? 'No usable sea-level values were returned for this forecast window.',
    );
  }

  setFont(doc, TEXT_MD, 5.2, 'italic');
  doc.text('Tide and total sea level are shown as context only and do not alter the wind/wave suitability classes.', W / 2, H - 7, { align: 'center' });
  drawModelDisclaimer(doc, { size: 5, bottomOffset: 2.2 });
  return { seaLevelShown: seaLevelStrip.drawn };
}

// ── Fetch rendered map PNG from zarr-api ─────────────────────────────────────
// Uses the operational-map endpoint: honest dissolved polygons, all classes visible,
// no smoothing, no clipping. Labels/legend are off by default so the PDF layout
// controls those elements itself.

async function fetchMapImage(
  vessel,
  timeIndex,
  baseUrl,
  {
    width = 900,
    height = 650,
    dpi = 150,
    showLabels = false,
    showLegend = false,
    showClassBoundaries = true,
    viewRadiusKm = 45,
    bounds = null,
  } = {}
) {
  const params = new URLSearchParams({
    width,
    height,
    dpi,
    show_labels: showLabels,
    show_legend: showLegend,
    show_class_boundaries: showClassBoundaries,
    show_stats: false,
    dissolve_classes: true,
  });
  const canonicalBounds = canonicalSuitabilityBounds(bounds);
  if (bounds && !canonicalBounds) throw new Error('Map bounds are invalid or incomplete.');
  // The backend contract makes bbox and view_radius_km mutually exclusive.
  // Every bounded PDF panel therefore receives the same canonical bbox and
  // cannot silently drift to the full-domain/radius view.
  if (canonicalBounds) {
    Object.entries(canonicalBounds).forEach(([key, value]) => params.set(key, String(value)));
  } else if (viewRadiusKm != null) {
    params.set('view_radius_km', String(viewRadiusKm));
  }
  const url = `${baseUrl}/niue/suitability/operational-map/${vessel}/${timeIndex}?${params}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`Suitability map image unavailable: ${url} returned HTTP ${res.status}`);
      return null;
    }
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn(`Suitability map image unavailable: ${url}`, error);
    return null;
  }
}

// ── Smart timestep selection ──────────────────────────────────────────────────

async function fetchBestContrastTimestep(baseUrl, bounds = null, startTimeIndex = null, endTimeIndex = null) {
  const range = {};
  if (Number.isInteger(startTimeIndex)) range.start_time_index = startTimeIndex;
  if (Number.isInteger(endTimeIndex)) range.end_time_index = endTimeIndex;
  const query = suitabilityQuery(bounds, range).toString();
  const url = `${baseUrl}/niue/suitability/best-contrast-timestep${query ? `?${query}` : ''}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      // Warn like every sibling fetch helper in this file (fetchMapImage,
      // fetchSummary, etc.) — a bare silent null here was indistinguishable
      // from "backend legitimately has nothing," so a real outage on this
      // endpoint left no trace and Page 4 just quietly fell back.
      console.warn(`Best-contrast-timestep unavailable: ${url} returned HTTP ${res.status}`);
      return null;
    }
    // This endpoint selects the shared timestep but intentionally returns no
    // full per-vessel summary. Fetch that selected moment through the same
    // bounded /summary contract used by the rest of the advisory.
    const data = await res.json();
    assertBoundedStatisticsResponse(data, bounds, 'Best-contrast-timestep');
    const resolvedIndex = data?.best_time_index ?? data?.time_index;
    if (resolvedIndex === null || resolvedIndex === undefined) return null;
    const summary = await fetchSummary(resolvedIndex, baseUrl, bounds);
    return { ...data, ...summary, time_index: resolvedIndex };
  } catch (error) {
    console.warn(`Best-contrast-timestep fetch failed: ${url}`, error);
    if (bounds) throw error;
    return null;
  }
}

// ── Page 4 — Four-vessel comparison ──────────────────────────────────────────

async function drawPage3(doc, { baseUrl, timeIndex = 0, endTimeIndex = null, runId = null, validTime = null, statisticsBounds = null, mapBounds = null }) {
  doc.addPage();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  rect(doc, 0, 0, W, H, PAGE_BG);

  // Fetch the best-contrast timestep first
  const best = await fetchBestContrastTimestep(baseUrl, statisticsBounds, timeIndex, endTimeIndex);
  const comparisonUnavailable = !best;
  const compTimeIndex = best?.time_index ?? timeIndex;
  const vessels  = best?.vessels ?? {};
  // formatUtcTiny — matches the "Valid:" format used on every other page.
  const validStr = best?.valid_time ? formatUtcTiny(best.valid_time) : '-';

  // Header
  const issuedStr3 = formatRunId(runId);
  drawHeaderBand(doc, {
    title: 'SAME OCEAN - DIFFERENT RISK',
    subtitle: 'Suitability varies significantly by vessel class under identical sea conditions',
    rightLine1: `Valid: ${validStr}`,
    rightLine2: issuedStr3 ? `Issued: ${issuedStr3}  ·  SWAN  |  Page 4 of 7` : 'SWAN  |  Page 4 of 7',
  });
  drawSharedLegend(doc, W - 42, HDR_H + 4);

  // Amber notice: this page's timestep is chosen for contrast, not the current advisory time
  setFill(doc, hazardLight(1));
  setDraw(doc, hazardColor(1));
  doc.setLineWidth(0.4);
  doc.roundedRect(5, HDR_H + 8, W - 10, 5.5, 1.5, 1.5, 'FD');
  setFont(doc, [160, 90, 30], 6, 'bold');
  doc.text(
    comparisonUnavailable
      ? 'Comparison timestep unavailable - using current advisory timestep as fallback.'
      : `Same forecast moment: ${validStr} — selected for maximum vessel-class contrast.`,
    W / 2, HDR_H + 10.9, { align: 'center' }
  );

  // 2×2 grid layout — hoisted before fetch so slotAspect can set image dimensions.
  const MAP_Y0  = HDR_H + 21;
  const COLS    = 2;
  const MAP_W   = (W - 6) / COLS;
  const MAP_H   = (H - MAP_Y0 - 14) / 2;  // 14mm footer clearance prevents pill/disclaimer overlap
  const PILL_H  = 4.8;

  // Request images at the PDF panel slot aspect (W:slot_h ≈ 2:1) so the backend fills
  // the frame exactly with no letterbox bands and jsPDF embeds without any stretch.
  const slotAspect = MAP_W / (MAP_H - PILL_H - 1);
  const p3ImgW = 1100;
  const p3ImgH = Math.round(p3ImgW / slotAspect);

  // Fetch all 4 vessel maps in parallel using the best-contrast timestep.
  const mapImages = await Promise.all(
    VESSEL_CLASSES.map(vc => fetchMapImage(vc.code, compTimeIndex, baseUrl, {
      width: p3ImgW, height: p3ImgH, dpi: 220,
      showLabels: false, showLegend: false, showClassBoundaries: true, viewRadiusKm: 70,
      bounds: mapBounds,
    }))
  );

  // Image fills the full slot — no centering offset needed.
  const panelImgW = MAP_W;
  const panelImgH = MAP_H - PILL_H - 1;
  const panelImgYOffset = 0;

  VESSEL_CLASSES.forEach((vc, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const mx  = 2 + col * (MAP_W + 2);
    const my  = MAP_Y0 + row * (MAP_H + 4);

    // Compute dominant state early so the interior header strip can use the correct hazard colour.
    const dataPresent = hasVesselData(vessels, vc.code);
    const vd = vessels[vc.code] ?? {};
    const pills = [
      { pct: vd.suitable_percent ?? 0, bg: hazardLight(0), fg: hazardColor(0), lbl: 'Suitable' },
      { pct: vd.caution_percent  ?? 0, bg: hazardLight(1), fg: hazardColor(1), lbl: 'Caution'  },
      { pct: vd.warning_percent  ?? 0, bg: hazardLight(2), fg: hazardColor(2), lbl: 'Avoid'    },
    ];
    const dominant    = pills.reduce((a, b) => a.pct >= b.pct ? a : b);
    const dominantHaz = dominant.lbl === 'Avoid' ? 2 : dominant.lbl === 'Caution' ? 1 : 0;
    const stripColor  = dataPresent ? hazardColor(dominantHaz) : NO_DATA_GREY;

    // Fill the full panel slot (including any vertical letterbox bands) with ocean colour.
    setFill(doc, [221, 239, 243]);   // PRESENTATION_OCEAN = #DDEFF3
    doc.rect(mx, my, MAP_W, MAP_H - PILL_H - 1, 'F');

    if (dataPresent && mapImages[idx]) {
      doc.addImage(mapImages[idx], 'PNG', mx, my + panelImgYOffset, panelImgW, panelImgH, 'p3_map_' + vc.code, 'FAST');
    } else {
      drawFailurePanel(
        doc,
        mx,
        my + panelImgYOffset,
        panelImgW,
        panelImgH,
        dataPresent ? 'Map data unavailable for this panel' : 'Suitability data unavailable',
        dataPresent ? 'Map unavailable - data could not be loaded' : 'No classified summary is available for this vessel and timestep'
      );
    }

    // Interior hazard-coloured header strip overlaid on the map top edge.
    const P3_HDR_H = 13.5;
    setFill(doc, stripColor);
    doc.rect(mx, my, MAP_W, P3_HDR_H, 'F');
    setFont(doc, [255, 255, 255], vc.label.length > 23 ? 6.8 : 7.8, 'bold');
    doc.text(vc.label, mx + 3, my + 5.4, { maxWidth: MAP_W - 6 });
    setFont(doc, [255, 255, 255], 5.5, 'bold');
    const summaryText = dataPresent
      ? `${Math.round(vd.warning_percent ?? 0)}% Avoid · ${Math.round(vd.caution_percent ?? 0)}% Caution · ${Math.round(vd.suitable_percent ?? 0)}% Suitable`
      : 'Suitability data unavailable';
    doc.text(summaryText, mx + 3, my + 10.5, { maxWidth: MAP_W - 6 });

    // Stat pills under each map — dominant pill uses full hazard colour for visual emphasis.
    const PILL_W = MAP_W / 3 - 1.2;
    const py     = my + MAP_H - PILL_H;

    if (dataPresent) {
      pills.forEach((p, pi) => {
        const px         = mx + pi * (PILL_W + 1.2);
        const isDominant = p === dominant;
        setFill(doc, isDominant ? p.fg : p.bg);
        setDraw(doc, p.fg);
        doc.setLineWidth(isDominant ? 0.6 : 0.3);
        doc.roundedRect(px, py, PILL_W, PILL_H - 1, 1.0, 1.0, 'FD');
        setFont(doc, isDominant ? [255, 255, 255] : p.fg, 6.5, 'bold');
        doc.text(`${Math.round(p.pct)}% ${p.lbl}`, px + PILL_W / 2, py + (PILL_H - 1) * 0.68, { align: 'center' });
      });
    } else {
      setFill(doc, [235, 235, 235]);
      setDraw(doc, NO_DATA_GREY);
      doc.setLineWidth(0.3);
      doc.roundedRect(mx, py, MAP_W, PILL_H - 1, 1.0, 1.0, 'FD');
      setFont(doc, NO_DATA_GREY, 6.5, 'italic');
      doc.text('Suitability data unavailable', mx + MAP_W / 2, py + (PILL_H - 1) * 0.68, { align: 'center' });
    }

    // Panel border
    setDraw(doc, [185, 200, 215]);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([], 0);
    doc.rect(mx, my, MAP_W, MAP_H, 'S');
  });

  // Footer — two lines: scope boundary note + model guidance disclaimer
  setFont(doc, TEXT_MD, 5.5);
  doc.text(
    'Dashed rectangle, when visible, marks the SWAN model domain. Statistics use classified face centroids inside the advisory scope.',
    W / 2, H - 6, { align: 'center' }
  );
  drawModelDisclaimer(doc);
}

// ── Daily 07:00 local time step selector (Niue UTC-11 → 18:00 UTC) ────────────
// Returns up to nDays steps, one per calendar day, each closest to 18:00 UTC.

export function selectDailyTimelineSteps(timeIndex, timeSeriesData, nDays = 6) {
  const TARGET_UTC_HOUR = 18; // 07:00 Niue local (UTC-11)
  const future = timeSeriesData
    .filter(s => s.time_index != null && s.time_index >= timeIndex)
    .sort((a, b) => a.time_index - b.time_index);
  if (!future.length) return [];
  const startTime = new Date(future[0].time);
  const steps = [];
  const seen  = new Set();
  for (let day = 1; day <= nDays; day++) {
    const target = new Date(startTime);
    target.setUTCDate(startTime.getUTCDate() + day);
    target.setUTCHours(TARGET_UTC_HOUR, 0, 0, 0);
    let best = null, bestDiff = Infinity;
    for (const s of future) {
      const diff = Math.abs(new Date(s.time).getTime() - target.getTime());
      if (diff < bestDiff) { bestDiff = diff; best = s; }
    }
    if (best && bestDiff < 4 * 3600 * 1000 && !seen.has(best.time_index)) {
      seen.add(best.time_index);
      steps.push({ time_index: best.time_index, role: 'daily', valid_time: best.time, available: true });
    } else {
      // No model output within 4 h of the target — day is beyond the forecast horizon.
      steps.push({ time_index: null, role: 'daily', valid_time: null, available: false, target_time: target.toISOString() });
    }
  }
  return steps;
}

// ── Page 5 — Forecast timeline ────────────────────────────────────────────────

async function drawPage4(doc, { baseUrl, selectedVessel = 'small_craft', timeIndex = 0, timeSeriesData = [], runId = null, statisticsBounds = null, mapBounds = null }) {
  doc.addPage();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  rect(doc, 0, 0, W, H, PAGE_BG);

  const VESSEL = selectedVessel;

  // Daily 07:00 Niue local time (= 18:00 UTC) schedule for the next 6 days.
  // Returns exactly 6 entries; beyond-horizon days have available: false.
  const stepMeta = selectDailyTimelineSteps(timeIndex, timeSeriesData, 6);
  const availableDayCount = stepMeta.filter(s => s.available !== false).length;

  const vesselLabel = VESSEL_BY_CODE[VESSEL]?.label ?? VESSEL.replaceAll('_', ' ');
  const dayCountLabel = availableDayCount > 0 ? `${availableDayCount}-day` : 'forecast';
  const issuedStr4 = formatRunId(runId);
  drawHeaderBand(doc, {
    title: `${vesselLabel.toUpperCase()} - FORECAST EVOLUTION`,
    subtitle: `Daily 07:00 Niue local time (18:00 UTC) — ${dayCountLabel} evolution`,
    rightLine2: issuedStr4 ? `Issued: ${issuedStr4}  ·  SWAN  |  Page 5 of 7` : 'SWAN  |  Page 5 of 7',
  });

  // Fetch maps + summaries only for steps within the forecast horizon.
  // Placeholder entries (available: false) resolve to null without any network request.
  const p4DomainAspect = (() => {
    if (!mapBounds) return 1.78;  // fallback ≈ display slot ratio
    const latMidRad = ((mapBounds.south + mapBounds.north) / 2) * Math.PI / 180;
    const lonSpan = (mapBounds.east - mapBounds.west) * Math.cos(latMidRad);
    const latSpan = mapBounds.north - mapBounds.south;
    return lonSpan / latSpan;
  })();
  const p4FetchH = 900;
  const p4FetchW = Math.round(p4FetchH * p4DomainAspect);

  const [mapImages, summaries] = await Promise.all([
    Promise.all(stepMeta.map(meta =>
      meta.available !== false && meta.time_index != null
        ? fetchMapImage(VESSEL, meta.time_index, baseUrl, {
            width: p4FetchW, height: p4FetchH, dpi: 220,
            showLabels: false, showLegend: false, showClassBoundaries: true, viewRadiusKm: 30,
            bounds: mapBounds,
          })
        : Promise.resolve(null)
    )),
    Promise.all(stepMeta.map(meta =>
      meta.available !== false && meta.time_index != null
        ? fetchSummary(meta.time_index, baseUrl, statisticsBounds).catch(() => null)
        : Promise.resolve(null)
    )),
  ]);

  // Incomplete only if an *available* step failed to load — beyond-horizon placeholders are expected.
  const timelineIncomplete = availableDayCount < 1 ||
    stepMeta.some((meta, i) => meta.available !== false && !mapImages[i]);

  const trendInsight = describeDailyTimeline(stepMeta, summaries, VESSEL);
  const INSIGHT_H = trendInsight ? 7 : 0;
  if (trendInsight) {
    rect(doc, 5, HDR_H + 1.5, W - 10, INSIGHT_H - 1, [236, 242, 250], [190, 205, 225], 0.25);
    setFont(doc, trendInsight.color, 6.5, 'bold');
    doc.text(trendInsight.text, W / 2, HDR_H + INSIGHT_H * 0.78, { align: 'center' });
  }

  let noteBannerH = 0;
  if (timelineIncomplete) {
    noteBannerH = 9;
    drawFailurePanel(
      doc,
      5,
      HDR_H + INSIGHT_H + 2,
      W - 10,
      noteBannerH - 2,
      'Timeline incomplete',
      'One or more maps or forecast summaries could not be loaded'
    );
  }

  const MAP_Y0  = HDR_H + INSIGHT_H + (noteBannerH > 0 ? noteBannerH + 2 : 2);

  // Tiny pill-order legend — reader does not have to guess bar order
  setFont(doc, TEXT_MD, 5.8, 'italic');
  doc.text('Bottom bars: Suitable | Caution | Avoid', W - 3, MAP_Y0 - 1.2, { align: 'right' });

  const COLS    = 3;
  const ROWS    = 2;
  const H_GAP   = 3;   // horizontal gap between columns
  const V_GAP   = 4;   // vertical gap between rows
  const MARGIN   = 2;
  const FOOTER_H = 8;   // clearance for disclaimer line at page bottom
  const PILL_H   = 4.2;
  const MAP_W    = (W - MARGIN * 2 - H_GAP * (COLS - 1)) / COLS;
  const MAP_H    = (H - MAP_Y0 - FOOTER_H - V_GAP * (ROWS - 1)) / ROWS;

  // Image slot geometry: centre the domain-aspect image in each panel slot so jsPDF
  // scales without distortion. Any remaining width is filled with PRESENTATION_OCEAN.
  const p4PanelImgH = MAP_H - PILL_H - 2;
  const p4PanelImgW = Math.min(p4PanelImgH * p4DomainAspect, MAP_W);
  const p4ImgHOffset = (MAP_W - p4PanelImgW) / 2;

  stepMeta.forEach((meta, idx) => {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const mx  = MARGIN + col * (MAP_W + H_GAP);
    const my  = MAP_Y0 + row * (MAP_H + V_GAP);

    // ── Beyond-horizon placeholder panel ─────────────────────────────────────
    if (meta.available === false) {
      const targetLabel = meta.target_time ? formatDayLocal(meta.target_time).toUpperCase() : `DAY ${idx + 1}`;
      setFill(doc, PAGE_BG);
      doc.rect(mx, my, MAP_W, p4PanelImgH, 'F');
      setDraw(doc, GRID_CLR);
      doc.setLineWidth(0.4);
      doc.setLineDashPattern([1.8, 1.8], 0);
      doc.rect(mx, my, MAP_W, p4PanelImgH, 'S');
      doc.setLineDashPattern([], 0);
      setFont(doc, TEXT_MD, 5.5, 'italic');
      doc.text('Beyond forecast horizon', mx + MAP_W / 2, my + p4PanelImgH * 0.52, { align: 'center' });
      // Label chip (greyed out)
      setFill(doc, [200, 200, 210]);
      doc.roundedRect(mx + 1, my + 2.5, MAP_W - 2, 8, 1.5, 1.5, 'F');
      setFont(doc, TEXT_MD, 8, 'bold');
      doc.text(targetLabel, mx + MAP_W / 2, my + 6.8, { align: 'center' });
      setFont(doc, TEXT_MD, 5.5);
      doc.text(
        meta.target_time ? formatLocalUtcTimePair(meta.target_time) : '07:00 local · 18:00 UTC',
        mx + MAP_W / 2, my + 10.5, { align: 'center' },
      );
      return;
    }

    // ── Normal panel ──────────────────────────────────────────────────────────
    const s  = summaries[idx];
    const dataPresent = hasVesselData(s?.vessels, VESSEL);
    const vd = s?.vessels?.[VESSEL] ?? {};

    // Border frame spans the full slot; image is centred inside it.
    setDraw(doc, [200, 200, 200]);
    doc.setLineWidth(0.5);
    doc.rect(mx - 0.5, my - 0.5, MAP_W + 1, p4PanelImgH + 1, 'S');
    if (dataPresent && mapImages[idx]) {
      setFill(doc, [221, 239, 243]);   // PRESENTATION_OCEAN = #DDEFF3
      doc.rect(mx, my, MAP_W, p4PanelImgH, 'F');
      doc.addImage(mapImages[idx], 'PNG', mx + p4ImgHOffset, my, p4PanelImgW, p4PanelImgH, 'p4_map_' + String(meta.time_index), 'FAST');
    } else {
      drawFailurePanel(
        doc,
        mx,
        my,
        MAP_W,
        p4PanelImgH,
        dataPresent ? 'Map data unavailable for this panel' : 'Suitability data unavailable',
        dataPresent ? 'Map unavailable - data could not be loaded' : 'No classified summary is available for this vessel and timestep'
      );
    }

    // Timestep label: local day plus dominant suitability state for this daily panel.
    const stepTime = meta.valid_time ?? s?.valid_time;
    const dayLabel = stepTime ? formatDayLocal(stepTime).toUpperCase() : `DAY ${idx + 1}`;
    const dominantState = [
      { pct: vd.suitable_percent ?? 0, label: 'Suitable' },
      { pct: vd.caution_percent  ?? 0, label: 'Caution'  },
      { pct: vd.warning_percent  ?? 0, label: 'Avoid'    },
    ].reduce((a, b) => a.pct >= b.pct ? a : b);
    const headerLabel = dataPresent
      ? `${dayLabel} - ${Math.round(dominantState.pct)}% ${dominantState.label}`
      : `${dayLabel} - No data`;
    const maxWindLabel = Number.isFinite(vd.max_wind_kt) && vd.max_wind_kt > 0
      ? ` · Wind max ${formatNumber(vd.max_wind_kt, 1)} kt`
      : '';
    const dominantHaz4 = dominantState.label === 'Avoid' ? 2 : dominantState.label === 'Caution' ? 1 : 0;
    setFill(doc, dataPresent ? hazardColor(dominantHaz4) : NO_DATA_GREY);
    doc.roundedRect(mx + 1, my + 2.5, MAP_W - 2, 8, 1.5, 1.5, 'F');
    setFont(doc, [255, 255, 255], headerLabel.length > 24 ? 6.4 : 7.1, 'bold');
    doc.text(headerLabel, mx + MAP_W / 2, my + 5.8, { align: 'center' });
    setFont(doc, [255, 255, 255], 5.3);
    doc.text(
      `${stepTime ? formatLocalUtcTimePair(stepTime) : '07:00 local · 18:00 UTC'}${maxWindLabel}`,
      mx + MAP_W / 2, my + 9.6, { align: 'center' },
    );

    // Stat pills
    const py = my + MAP_H - PILL_H - 1;
    if (dataPresent) {
      const pills = [
        { pct: vd.suitable_percent ?? 0, bg: hazardLight(0),  fg: hazardColor(0) },
        { pct: vd.caution_percent  ?? 0, bg: hazardLight(1),  fg: hazardColor(1) },
        { pct: vd.warning_percent  ?? 0, bg: hazardLight(2),  fg: hazardColor(2) },
      ];
      pills.forEach((p, pi) => {
        const pw = MAP_W / 3 - 0.6;
        const px = mx + pi * (pw + 0.6);
        setFill(doc, p.bg); setDraw(doc, p.fg); doc.setLineWidth(0.35);
        doc.roundedRect(px, py, pw, PILL_H, 0.7, 0.7, 'FD');
        setFont(doc, p.fg, 5.8, 'bold');
        doc.text(`${Math.round(p.pct)}%`, px + pw / 2, py + PILL_H * 0.68, { align: 'center' });
      });
    } else {
      setFill(doc, [235, 235, 235]); setDraw(doc, NO_DATA_GREY); doc.setLineWidth(0.35);
      doc.roundedRect(mx, py, MAP_W, PILL_H, 0.7, 0.7, 'FD');
      setFont(doc, NO_DATA_GREY, 6, 'italic');
      doc.text('No suitability data', mx + MAP_W / 2, py + PILL_H * 0.68, { align: 'center' });
    }

  });

  drawModelDisclaimer(doc, { size: 5.8 });
}

// ── Page 6 — Forecast trend chart ────────────────────────────────────────────

// Headline for Page 5 — describes ONLY the daily snapshots actually
// shown on that page. describeForecastShape() below analyses the full
// continuous time series (peaks/dips/recovery) and belongs on Page 6; reusing
// it on Page 5 previously produced captions like "briefly improve, then
// deteriorate sharply" sitting directly above five numbers that just declined
// steadily day over day — a page that samples once per day has no way to show
// the sub-daily oscillation that sentence describes, so it read as a flat
// contradiction of its own numbers.
export function describeDailyTimeline(stepMeta, summaries, vessel) {
  const vesselLabel = VESSEL_BY_CODE[vessel]?.label ?? vessel;
  const points = stepMeta
    .map((meta, i) => (meta.available !== false ? summaries[i]?.vessels?.[vessel]?.warning_percent : null))
    .filter(v => Number.isFinite(v));
  if (points.length < 2) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const peak = Math.max(...points);
  const delta = last - first;
  const isNonIncreasing = points.every((value, index) => index === 0 || value <= points[index - 1] + 1);
  const isNonDecreasing = points.every((value, index) => index === 0 || value >= points[index - 1] - 1);
  const min = Math.min(...points);
  const minIdx = points.indexOf(min);
  const postMinPeak = minIdx < points.length - 1 ? Math.max(...points.slice(minIdx + 1)) : min;
  const hasBriefImprovementThenDeterioration = minIdx > 0 && minIdx < points.length - 1 && first - min >= 10 && postMinPeak - min >= 10;

  if (hasBriefImprovementThenDeterioration) {
    const partialRecovery = last < postMinPeak - 5;
    return {
      text: partialRecovery
        ? `${vesselLabel} conditions briefly improve, deteriorate again, and partially recover by the final panel.`
        : `${vesselLabel} conditions briefly improve, then deteriorate again later in the shown days.`,
      color: hazardColor(postMinPeak >= 50 ? 2 : 1),
    };
  }
  if (delta <= -10 && isNonIncreasing) {
    return {
      text: `${vesselLabel} conditions steadily improve across the shown days (${Math.round(first)}% -> ${Math.round(last)}% Avoid).`,
      color: hazardColor(last >= 50 ? 1 : 0),
    };
  }
  if (delta >= 10 && isNonDecreasing) {
    return {
      text: `${vesselLabel} conditions steadily worsen across the shown days (${Math.round(first)}% -> ${Math.round(last)}% Avoid).`,
      color: hazardColor(2),
    };
  }
  if (Math.abs(delta) >= 10) {
    return {
      text: `${vesselLabel} conditions vary across the shown days (${Math.round(first)}% -> ${Math.round(last)}% Avoid), not as a steady trend.`,
      color: hazardColor(last >= 50 || peak >= 50 ? 2 : 1),
    };
  }
  if (peak >= 50) {
    return { text: `${vesselLabel} conditions remain broadly elevated across the shown days, with limited change.`, color: hazardColor(1) };
  }
  return { text: `${vesselLabel} conditions remain broadly stable and mostly suitable across the shown days.`, color: hazardColor(0) };
}

export function describeForecastShape(timeSeriesData, vessel) {
  if (!timeSeriesData.length) return null;
  const avoidAt = s => s?.vessels?.[vessel]?.warning_percent ?? 0;
  const vesselLabel = VESSEL_BY_CODE[vessel]?.label ?? vessel;
  const values = timeSeriesData.map(avoidAt);
  const n = values.length;
  const first = values[0];
  const last = values[n - 1];
  const peak = Math.max(...values);
  const peakIdx = values.indexOf(peak);
  const afterPeak = values.slice(peakIdx + 1);
  const highRiskPeriods = values.reduce((count, value, index) => {
    const wasBelowThreshold = index === 0 || values[index - 1] < 50;
    return value >= 50 && wasBelowThreshold ? count + 1 : count;
  }, 0);
  const hasRecovery = afterPeak.length > 0 && Math.min(...afterPeak) < peak - 20;
  const earlySlice = values.slice(1, Math.max(2, Math.floor(n * 0.25)));
  const hasBriefDip = first > 5 && earlySlice.some(v => v < first - 10);

  if (highRiskPeriods >= 2) {
    return { text: `${vesselLabel} conditions fluctuate between Caution and Avoid, with limited improvement between peaks.`, color: hazardColor(2) };
  }
  if (peak >= 80 && hasRecovery && hasBriefDip) {
    return { text: `${vesselLabel} conditions briefly improve, then deteriorate sharply to full Avoid before recovering later.`, color: hazardColor(2) };
  }
  if (peak >= 80 && hasRecovery) {
    return { text: `${vesselLabel} conditions deteriorate sharply to full Avoid before recovering later.`, color: hazardColor(2) };
  }
  if (peak >= 99.5) {
    return { text: `${vesselLabel} conditions deteriorate to full Avoid. No recovery within the forecast window.`, color: hazardColor(2) };
  }
  if (peak >= 80) {
    return { text: `${vesselLabel} conditions reach high-risk Avoid levels. No recovery within the forecast window.`, color: hazardColor(2) };
  }
  if (peak >= 40) {
    return { text: `${vesselLabel} conditions show elevated risk — peak Avoid reaches ${Math.round(peak)}%.`, color: hazardColor(1) };
  }
  if (last < first - 10) {
    return { text: `${vesselLabel} conditions improve through the forecast period.`, color: hazardColor(0) };
  }
  return { text: `${vesselLabel} conditions remain mostly suitable through the forecast period.`, color: hazardColor(0) };
}

// Finds the longest run of the lowest available domain hazard class in a
// per-vessel timeseries — the actual "best window" in this forecast, not a
// generic truism. Adapts summarizeBestHazardWindow's run-finding approach
// (built for a single discrete hazard_class per sample) to this page's
// per-timestep domain percentages, via the same domainHazard() classifier
// already used elsewhere in this file (Page 1 vessel cards, Page 5 daily
// panels) for "how bad is this timestep, overall."
//
// domainHazard(0, 0) alone can't distinguish "confirmed all-clear" from "no
// scored samples at all" — both look like warn=0, caution=0 — so a
// timestep where suitable/caution/avoid all read 0 is treated as
// unavailable here (excluded from ever winning "best"), not misread as
// Suitable, the same masking bug fixed elsewhere in this file and in the
// frontend's routeForecastService.js.
function findBestDomainWindow(timeSeriesData, vessel) {
  if (!timeSeriesData.length) return null;

  const hazards = timeSeriesData.map((s) => {
    const v = s?.vessels?.[vessel] ?? {};
    const suitable = v.suitable_percent ?? 0;
    const caution = v.caution_percent ?? 0;
    const avoid = v.warning_percent ?? 0;
    if (suitable + caution + avoid <= 0) return null;
    return domainHazard(avoid, caution);
  });

  let bestHazard = null, bestStart = -1, bestLen = 0;
  let runStart = -1, runHazard = null;
  for (let i = 0; i <= hazards.length; i++) {
    const haz = i < hazards.length ? hazards[i] : undefined; // undefined forces the final run to close
    if (haz !== runHazard) {
      if (runHazard !== null && runStart !== -1) {
        const len = i - runStart;
        if (bestHazard === null || runHazard < bestHazard || (runHazard === bestHazard && len > bestLen)) {
          bestHazard = runHazard;
          bestStart = runStart;
          bestLen = len;
        }
      }
      runStart = i;
      runHazard = haz;
    }
  }

  if (bestStart === -1 || bestLen === 0) return null;
  const startEntry = timeSeriesData[bestStart];
  const endEntry = timeSeriesData[bestStart + bestLen - 1];
  return { hazard: bestHazard, startTime: startEntry.time, endTime: endEntry.time };
}

// Fills the region between two parallel polylines (topYs above bottomYs, at
// matching xs) by tiling quads-as-two-triangles along the series — doc.lines
// with hand-computed relative deltas is the fancier jsPDF primitive for an
// arbitrary filled polygon, but a wrong delta silently produces a
// bowtie/self-intersecting shape with no error; doc.triangle takes absolute
// coordinates per call, so each piece is trivial to reason about in a
// document this file can't render and eyeball before shipping. 'FD' (fill
// and stroke in the same color) hides the seam between adjacent triangles.
function fillBandBetween(doc, xs, topYs, bottomYs, color) {
  setFill(doc, color);
  setDraw(doc, color);
  doc.setLineWidth(0.05);
  for (let i = 0; i < xs.length - 1; i++) {
    doc.triangle(xs[i], bottomYs[i], xs[i], topYs[i], xs[i + 1], topYs[i + 1], 'FD');
    doc.triangle(xs[i], bottomYs[i], xs[i + 1], topYs[i + 1], xs[i + 1], bottomYs[i + 1], 'FD');
  }
}

function strokePolyline(doc, xs, ys, color, lineWidth) {
  setDraw(doc, color);
  doc.setLineWidth(lineWidth);
  for (let i = 0; i < xs.length - 1; i++) {
    doc.line(xs[i], ys[i], xs[i + 1], ys[i + 1]);
  }
}

// ── Page 6 — Forecast trend ────────────────────────────────────────────────
// 100%-stacked Suitable/Caution/Avoid area for the selected vessel, across
// the full forecast window. Redesigned from a single Avoid%-only line (which
// discarded Suitable/Caution entirely and stacked a risk-window strip, two
// dashed threshold lines, and 3 faint comparison lines onto one chart) down
// to one honest read of the full classification mix for this vessel, plus a
// data-derived best-window callout instead of a generic disclaimer sentence.
// Cross-vessel comparison is intentionally dropped — Page 4's 4-vessel map
// comparison already covers that; this page's job is "how does the vessel I
// picked do over the whole week," not another comparison view.
async function drawPage5(doc, { selectedVessel = 'small_craft', timeIndex = 0, timeSeriesData = [], runId = null }) {
  doc.addPage();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  rect(doc, 0, 0, W, H, PAGE_BG);

  const VESSEL      = selectedVessel;
  const vesselLabel = VESSEL_BY_CODE[VESSEL]?.label ?? VESSEL.replaceAll('_', ' ');

  // Recompute the same daily steps as page 4 so chart markers match panels exactly.
  const stepMeta = selectDailyTimelineSteps(timeIndex, timeSeriesData, 6);

  const issuedStr5 = formatRunId(runId);
  drawHeaderBand(doc, {
    title: `${vesselLabel.toUpperCase()} - FORECAST TREND`,
    subtitle: 'Suitable / Caution / Avoid share of the domain, over the full forecast period',
    rightLine2: issuedStr5 ? `Issued: ${issuedStr5}  ·  SWAN  |  Page 6 of 7` : 'SWAN  |  Page 6 of 7',
  });

  // Chart geometry — shorter footer than before: no risk-window strip or
  // threshold-line labels to make room for, just the shape sentence, the
  // best-window sentence, and the disclaimer.
  const FOOT_H = 20;
  const CX     = 16;  // left margin for Y-axis labels
  const CY     = HDR_H + 10;
  const CW     = W - CX - 6;
  const CH     = H - CY - FOOT_H;
  const n      = timeSeriesData.length;

  // No trend data — explicit empty state rather than an empty chart frame,
  // so this reads as "unavailable" and not "confirmed all-clear."
  if (n < 2) {
    setDraw(doc, GRID_CLR);
    doc.setLineWidth(0.25);
    doc.rect(CX, CY, CW, CH, 'S');
    drawFailurePanel(
      doc, CX, CY, CW, CH,
      'Forecast trend unavailable',
      'Per-timestep suitability summaries could not be loaded for this window.'
    );
    drawModelDisclaimer(doc, { size: 5, bottomOffset: 2 });
    return;
  }

  // Shared Suitable/Caution/Avoid legend — same component every other page's
  // hazard-colored chart/map uses, instead of this page inventing its own
  // "selected vessel vs. other vessels (faint)" legend for content that no
  // longer exists here (cross-vessel comparison is Page 4's job).
  drawSharedLegend(doc, W / 2, CY - 5);

  setDraw(doc, GRID_CLR);
  doc.setLineWidth(0.25);
  doc.rect(CX, CY, CW, CH, 'S');

  // Y-axis grid lines + labels
  for (const pct of [25, 50, 75, 100]) {
    const gy = CY + CH * (1 - pct / 100);
    setDraw(doc, GRID_CLR);
    doc.setLineWidth(pct === 50 ? 0.35 : 0.15);
    doc.line(CX, gy, CX + CW, gy);
    setFont(doc, TEXT_MD, 5.5);
    doc.text(`${pct}%`, CX - 1.5, gy + 1.5, { align: 'right' });
  }
  setFont(doc, TEXT_MD, 5.5);
  doc.text('0%', CX - 1.5, CY + CH + 1.5, { align: 'right' });

  // Build the 100%-stacked series (Suitable bottom, Caution middle, Avoid
  // top) normalized per timestep so the stack always reaches exactly 100% —
  // the three source percentages are independently rounded server-side and
  // can drift by a fraction of a percent. A genuinely unscored timestep
  // (suitable/caution/avoid all 0) stays at zero height for all three bands
  // — i.e. a visible gap in the fill — rather than being stretched into a
  // false reading; it is never repainted as Suitable.
  const xs = [];
  const suitableTop = [];
  const cautionTop = [];
  const avoidTop = [];
  const baseline = [];
  for (let si = 0; si < n; si++) {
    const v = timeSeriesData[si]?.vessels?.[VESSEL] ?? {};
    const suitable = Math.max(0, v.suitable_percent ?? 0);
    const caution = Math.max(0, v.caution_percent ?? 0);
    const avoid = Math.max(0, v.warning_percent ?? 0);
    const total = suitable + caution + avoid;
    const scale = total > 0 ? 100 / total : 0;
    const x = CX + (CW / (n - 1)) * si;
    xs.push(x);
    baseline.push(CY + CH);
    suitableTop.push(CY + CH * (1 - (suitable * scale) / 100));
    cautionTop.push(CY + CH * (1 - ((suitable + caution) * scale) / 100));
    avoidTop.push(CY + CH * (1 - ((suitable + caution + avoid) * scale) / 100));
  }

  fillBandBetween(doc, xs, suitableTop, baseline, hazardColor(0));
  fillBandBetween(doc, xs, cautionTop, suitableTop, hazardColor(1));
  fillBandBetween(doc, xs, avoidTop, cautionTop, hazardColor(2));

  // Thin white separators between bands read more clearly as three distinct
  // stacked regions than the raw fill-to-fill color transition alone.
  strokePolyline(doc, xs, suitableTop, [255, 255, 255], 0.3);
  strokePolyline(doc, xs, cautionTop, [255, 255, 255], 0.3);

  // Re-stroke the frame on top of the fills.
  setDraw(doc, GRID_CLR);
  doc.setLineWidth(0.25);
  doc.rect(CX, CY, CW, CH, 'S');

  // X-axis time labels with daily tick marks
  const p5t0ms = new Date(timeSeriesData[0].time).getTime();
  const p5t1ms = new Date(timeSeriesData[n - 1].time).getTime();
  const p5tRange = p5t1ms - p5t0ms;
  const MONS_P5 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  setFont(doc, TEXT_MD, 5.5);
  doc.text(formatUtcTiny(timeSeriesData[0].time), CX, CY + CH + 5);
  doc.text(formatUtcTiny(timeSeriesData[n - 1].time), CX + CW, CY + CH + 5, { align: 'right' });

  const p5firstMidnight = new Date(p5t0ms);
  p5firstMidnight.setUTCHours(0, 0, 0, 0);
  p5firstMidnight.setUTCDate(p5firstMidnight.getUTCDate() + 1);
  for (let d = p5firstMidnight.getTime(); d < p5t1ms; d += 86400000) {
    const xPos = CX + (d - p5t0ms) / p5tRange * CW;
    if (xPos > CX + 14 && xPos < CX + CW - 14) {
      setDraw(doc, GRID_CLR);
      doc.setLineWidth(0.2);
      doc.line(xPos, CY + CH, xPos, CY + CH + 2);
      const dayD = new Date(d);
      setFont(doc, TEXT_MD, 5.0);
      doc.text(`${dayD.getUTCDate()} ${MONS_P5[dayD.getUTCMonth()]}`, xPos, CY + CH + 6, { align: 'center' });
    }
  }

  // Page 5's 6 daily reference moments — plain ticks + day label. No dot: a
  // stacked area has no single line to anchor a point to (each column has
  // three boundary values, not one). A distinct "current time" marker isn't
  // needed here — timeSeriesData always starts at the selected/current
  // timestep (see exportSuitabilityPDF's Step 4 build), so "now" is always
  // exactly the chart's left edge already.
  const MARKER_COLOR = [95, 95, 160];
  stepMeta.forEach((meta) => {
    if (!meta.available) return;
    const tsEntry = timeSeriesData.find(s => s.time_index === meta.time_index);
    if (!tsEntry) return;
    const si = timeSeriesData.indexOf(tsEntry);
    const px = CX + (n > 1 ? (CW / (n - 1)) * si : 0);

    setDraw(doc, MARKER_COLOR);
    doc.setLineWidth(0.22);
    doc.setLineDashPattern([1.2, 1.6], 0);
    doc.line(px, CY, px, CY + CH);
    doc.setLineDashPattern([], 0);

    setFont(doc, MARKER_COLOR, 4.3, 'bold');
    doc.text(formatDayLocal(meta.valid_time).toUpperCase(), px, CY + CH + 6.8, { align: 'center' });
  });

  // Forecast shape summary — still Avoid%-only: the right basis for a
  // one-line worst-case trajectory even though the chart above now shows
  // the fuller Suitable/Caution/Avoid mix.
  const shape = describeForecastShape(timeSeriesData, VESSEL);
  if (shape) {
    setFont(doc, shape.color, 7, 'bold');
    doc.text(shape.text, W / 2, H - 11, { align: 'center' });
  }

  // Data-derived best-window callout, replacing the old static "recovery
  // window" definition sentence with an actual answer for this forecast.
  const bestWindow = findBestDomainWindow(timeSeriesData, VESSEL);
  let bestWindowText;
  let bestWindowColor = TEXT_MD;
  let bestWindowStyle = 'italic';
  if (!bestWindow) {
    bestWindowText = 'No best window could be determined for this forecast.';
  } else if (bestWindow.hazard === 0) {
    bestWindowText = `Best window: Suitable throughout ${formatUtcTiny(bestWindow.startTime)} – ${formatUtcTiny(bestWindow.endTime)}.`;
    bestWindowColor = hazardColor(0);
    bestWindowStyle = 'bold';
  } else {
    bestWindowText = `No fully Suitable window in this forecast — lowest available risk (${hazardLabel(bestWindow.hazard)}) `
      + `${formatUtcTiny(bestWindow.startTime)} – ${formatUtcTiny(bestWindow.endTime)}.`;
    bestWindowColor = hazardColor(bestWindow.hazard);
    bestWindowStyle = 'bold';
  }
  setFont(doc, bestWindowColor, 6, bestWindowStyle);
  doc.text(bestWindowText, W / 2, H - 7.5, { align: 'center' });

  drawModelDisclaimer(doc, { size: 5, bottomOffset: 2 });
}

// ── Page 7 — Methodology & transparency ───────────────────────────────────────

function drawPage6(doc, { validTime, runId, advisoryConfig = null, summary = null, seaLevelShownOnPage3 = false }) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  doc.addPage();
  rect(doc, 0, 0, W, H, PAGE_BG);

  // Header
  const validStr = validTime ? formatUtcTiny(validTime) : '—';
  const issuedStr = formatRunId(runId);
  drawHeaderBand(doc, {
    title: 'NIUE COASTAL WATERS',
    subtitle: 'SUITABILITY METHODOLOGY & TRANSPARENCY',
    rightLine1: `Valid: ${validStr}`,
    rightLine2: issuedStr ? `Issued: ${issuedStr}  |  Page 7 of 7` : 'Page 7 of 7',
  });

  const MX     = 5;
  const BODY_Y = HDR_H + 5;

  // ── Classification logic (intro) ─────────────────────────────────────────────
  setFont(doc, HEADER_BG, 8, 'bold');
  doc.text('HOW SUITABILITY IS CLASSIFIED', MX, BODY_Y + 4.5);

  setFont(doc, TEXT_MD, 6.5);
  const logicLines = [
    'Classification is applied independently to each grid cell using two meteorological parameters: significant wave height (Hs) and',
    'sustained 10-metre wind speed. A cell is flagged Avoid when either parameter meets or exceeds the warning threshold for the',
    'selected vessel class; Caution when it meets the caution threshold; Suitable otherwise. Scope summaries report the',
    'percentage of grid cells in each category. Thresholds are defined per vessel class as shown in the table below.',
  ];
  logicLines.forEach((line, i) => {
    doc.text(line, MX, BODY_Y + 10.5 + i * 4.2);
  });

  // ── Vessel threshold table ────────────────────────────────────────────────────
  const TBL_Y = BODY_Y + 37;
  const TBL_X = MX;
  const tblW  = W - 2 * MX;                   // 287 mm
  const COL_W = [58, 56, 87, 86];             // vessel, typical use, caution, avoid
  const HDR_ROW_H = 9;
  const ROW_H     = 10;

  const colX = [];
  let cxAcc = TBL_X;
  COL_W.forEach(w => { colX.push(cxAcc); cxAcc += w; });

  // Header row
  rect(doc, TBL_X, TBL_Y, tblW, HDR_ROW_H, HEADER_BG);
  const tblHdrs = ['Vessel Class', 'Typical Use', 'Caution Threshold', 'Avoid Threshold'];
  tblHdrs.forEach((h, i) => {
    setFont(doc, TEXT_LT, 7, 'bold');
    doc.text(h, colX[i] + COL_W[i] / 2, TBL_Y + HDR_ROW_H * 0.68, { align: 'center' });
  });

  // Derived from VESSEL_THRESHOLDS (module scope) rather than a second set of
  // hardcoded numbers, so this displayed table and deriveDriverForVessel()
  // can never silently drift apart.
  const RULES = VESSEL_CLASSES.map(vc => {
    const t = VESSEL_THRESHOLDS[vc.code];
    return {
      label: t.label,
      examples: t.examples,
      cHs: t.cautionWaveHeightM.toFixed(1), aHs: t.maxWaveHeightM.toFixed(1),
      cWind: String(t.cautionWindKt), aWind: String(t.maxWindKt),
    };
  });

  RULES.forEach((r, ri) => {
    const ry = TBL_Y + HDR_ROW_H + ri * ROW_H;
    rect(doc, TBL_X, ry, tblW, ROW_H, ri % 2 === 0 ? [245, 247, 252] : [255, 255, 255]);

    setFont(doc, TEXT_DK, 7, 'bold');
    doc.text(r.label, colX[0] + 3, ry + ROW_H * 0.62);

    setFont(doc, TEXT_MD, 6);
    doc.text(r.examples, colX[1] + 3, ry + ROW_H * 0.62);

    setFont(doc, hazardText(1), 6.5, 'bold');
    doc.text(`Hs >= ${r.cHs} m`, colX[2] + COL_W[2] / 2, ry + 3.8, { align: 'center' });
    doc.text(`Wind >= ${r.cWind} kt`, colX[2] + COL_W[2] / 2, ry + 7.5, { align: 'center' });

    setFont(doc, hazardText(2), 6.5, 'bold');
    doc.text(`Hs >= ${r.aHs} m`, colX[3] + COL_W[3] / 2, ry + 3.8, { align: 'center' });
    doc.text(`Wind >= ${r.aWind} kt`, colX[3] + COL_W[3] / 2, ry + 7.5, { align: 'center' });
  });

  // Table border and grid lines
  setDraw(doc, GRID_CLR);
  doc.setLineWidth(0.3);
  doc.rect(TBL_X, TBL_Y, tblW, HDR_ROW_H + RULES.length * ROW_H, 'S');
  doc.setLineWidth(0.15);
  colX.slice(1).forEach(x => {
    doc.line(x, TBL_Y, x, TBL_Y + HDR_ROW_H + RULES.length * ROW_H);
  });
  doc.line(TBL_X, TBL_Y + HDR_ROW_H, TBL_X + tblW, TBL_Y + HDR_ROW_H);
  RULES.forEach((_, ri) => {
    if (ri > 0) {
      const ry = TBL_Y + HDR_ROW_H + ri * ROW_H;
      doc.line(TBL_X, ry, TBL_X + tblW, ry);
    }
  });

  // ── Classification legend ─────────────────────────────────────────────────────
  const LEG_Y = TBL_Y + HDR_ROW_H + RULES.length * ROW_H + 6;
  setFont(doc, TEXT_MD, 6, 'bold');
  doc.text('Classification:', MX, LEG_Y);
  let legXAcc = MX + 26;
  [
    { label: 'Suitable — all parameters below caution thresholds', haz: 0 },
    { label: 'Caution — any parameter at or above caution threshold', haz: 1 },
    { label: 'Avoid — any parameter at or above warning threshold', haz: 2 },
  ].forEach(item => {
    const sw = 5;
    rect(doc, legXAcc, LEG_Y - 4.2, sw, 5.2, hazardLight(item.haz), hazardColor(item.haz), 0.4);
    setFont(doc, hazardText(item.haz), 6);
    doc.text(item.label, legXAcc + sw + 2, LEG_Y);
    legXAcc += sw + 2 + doc.getTextWidth(item.label) + 8;
  });

  // ── Two-column information section ────────────────────────────────────────────
  const INFO_Y  = LEG_Y + 10;
  const COL_L_X = MX;
  const COL_L_W = (W - 2 * MX - 6) / 2;
  const COL_R_X = COL_L_X + COL_L_W + 6;

  const infoBlock = (x, y, title, lines, titleColor = HEADER_BG) => {
    setFont(doc, titleColor, 7, 'bold');
    doc.text(title, x, y);
    setFont(doc, TEXT_MD, 6);
    lines.forEach((line, i) => { doc.text(line, x, y + 5 + i * 3.5); });
    return y + 5 + lines.length * 3.5 + 4;
  };

  let ly = INFO_Y;
  ly = infoBlock(COL_L_X, ly, 'WAVE MODEL', [
    'SWAN (Simulating WAves Nearshore) — third-generation spectral wave model run operationally',
    'by the Pacific Community (SPC) for Niue. Atmospheric forcing: GFS 0.25° analysis fields.',
  ]);
  ly = infoBlock(COL_L_X, ly, 'FORECAST SCHEDULE', [
    'Runs every 6 hours: 00:00, 06:00, 12:00, 18:00 UTC. Forecast horizon: 7 days.',
  ]);
  ly = infoBlock(COL_L_X, ly, 'SEA-LEVEL CONTEXT', seaLevelShownOnPage3 ? [
    'Page 3 shows total sea level derived from astronomical tide, inverse barometer,',
    'and sea-level anomaly. This is contextual water-level guidance only and is not',
    'currently used in the wind/wave vessel suitability classification.',
  ] : [
    'Total sea level (tide + inverse barometer + sea-level anomaly) is shown on Page 3',
    'when available for this issue; not currently used in the wind/wave vessel',
    'suitability classification either way.',
  ]);

  let ry2 = INFO_Y;
  ry2 = infoBlock(COL_R_X, ry2, 'LIMITATIONS & CAVEATS', [
    '· Outputs are from a numerical model; local conditions may differ.',
    '· Forecast uncertainty grows at longer lead times (>48 h).',
    '· Coastal effects (currents, swell refraction) may not be fully resolved.',
    '· Not a substitute for official maritime warnings — always cross-check with Niue Met Service.',
    // Different pages deliberately sample at different reference times (a
    // single selected moment vs. a 6/12-hourly grid vs. one representative
    // local-time step per day) — without this, a reader has no way to know
    // a small cross-page percentage difference is expected, not an error.
    '· Percentages can differ slightly by page: Page 1 uses the selected time; Page 2 uses every',
    '  fetched timestep; Page 3 samples a 6-12 hourly grid; Page 5 samples once per day.',
  ], hazardColor(2));
  const attrLines = [
    'Produced by the Pacific Community (SPC), Ocean & Maritime Programme.',
    'SWAN © Delft University of Technology. Thresholds per WMO Pacific guidelines.',
  ];
  if (advisoryConfig) {
    const vc = advisoryConfig.vesselLabel ?? advisoryConfig.vesselType ?? '—';
    const tf = advisoryConfig.timeFrame?.label ?? '—';
    const area = advisoryConfig.area?.type === 'current_map_view'
      ? 'Current map view (centroid-filtered faces)'
      : 'Full model domain';
    attrLines.push(`Advisory scope — Vessel: ${vc}  ·  Window: ${tf}  ·  Area: ${area}`);
    if (advisoryConfig.area?.type === 'current_map_view') {
      const classified = summary?.classified_face_count;
      const eligible = summary?.eligible_face_count;
      const classCoverage = summary?.classification_coverage_percent;
      const rasterCoverage = summary?.spatial_scope_coverage_percent;
      attrLines.push(`Current-view faces — classified: ${classified ?? '—'}/${eligible ?? '—'} (${classCoverage ?? '—'}%).`);
      attrLines.push(`Renderable raster coverage inside requested bounds: ${rasterCoverage ?? '—'}%.`);
    }
  }
  ry2 = infoBlock(COL_R_X, ry2, 'ATTRIBUTION', attrLines);

  // ── Hazard class visual guide ─────────────────────────────────────────────
  const GUIDE_Y = Math.max(ly, ry2) + 3;
  const GUIDE_H = H - 7 - GUIDE_Y - 6;
  if (GUIDE_H >= 26) {
    setFont(doc, HEADER_BG, 7, 'bold');
    doc.text('UNDERSTANDING THE HAZARD CLASSES', MX, GUIDE_Y + 4);

    const CARD_H6  = GUIDE_H - 8;
    const CARD_W6  = (W - 2 * MX - 8) / 3;
    const GUIDE_DATA = [
      {
        haz: 0,
        title: 'SUITABLE',
        lines: ['Conditions within safe operating limits.', 'Proceed with normal seamanship.'],
        action: 'Action: Proceed — standard watch applies.',
      },
      {
        haz: 1,
        title: 'CAUTION',
        lines: ['One or more parameters near threshold.', 'Conditions marginal for this vessel class.'],
        action: 'Action: Monitor closely — ready to return.',
      },
      {
        haz: 2,
        title: 'AVOID',
        lines: ['Conditions exceed safe operating limits.', 'Departure is not recommended.'],
        action: 'Action: Do not proceed — await improvement.',
      },
    ];

    GUIDE_DATA.forEach((gd, gi) => {
      const gx = MX + gi * (CARD_W6 + 4);
      const gy = GUIDE_Y + 7;
      rect(doc, gx, gy, CARD_W6, CARD_H6, hazardLight(gd.haz), hazardColor(gd.haz), 0.5);
      rect(doc, gx, gy, CARD_W6, 6, hazardColor(gd.haz));
      setFont(doc, [255, 255, 255], 7.5, 'bold');
      doc.text(gd.title, gx + CARD_W6 / 2, gy + 4.3, { align: 'center' });
      setFont(doc, hazardText(gd.haz), 6);
      gd.lines.forEach((line, li) => {
        doc.text(line, gx + CARD_W6 / 2, gy + 9 + li * 3.5, { align: 'center' });
      });
      setFont(doc, hazardText(gd.haz), 6, 'bold');
      const actionY = gy + 9 + gd.lines.length * 3.5 + 3;
      if (actionY < gy + CARD_H6) {
        doc.text(gd.action, gx + CARD_W6 / 2, actionY, { align: 'center' });
      }
    });
  }

  // Footer disclaimer
  const FOOT_Y = H - 5;
  setDraw(doc, GRID_CLR);
  doc.setLineWidth(0.25);
  doc.line(MX, FOOT_Y - 3.5, W - MX, FOOT_Y - 3.5);
  setFont(doc, [140, 140, 140], 5.5);
  doc.text(
    'This advisory is generated automatically from numerical model output. It does not constitute an official weather or marine forecast. ' +
    'Always consult the Niue Meteorological Service and official maritime warnings before making navigation decisions.',
    W / 2, FOOT_Y, { align: 'center', maxWidth: W - 2 * MX },
  );
}

// ── Main export function ───────────────────────────────────────────────────────

export async function exportSuitabilityPDF({
  mapElement,
  mapVessel = null,
  timeIndex,
  validTime,
  runId,
  suitabilityBaseUrl = '',
  publicUrl = process.env.PUBLIC_URL ?? '',
  selectedVessel = 'small_craft',
  onProgress,
  advisoryConfig = null,
}) {
  if (advisoryConfig?.area?.type === 'route_forecast') {
    return exportRouteForecastPDF({ advisoryConfig, onProgress, apiBaseUrl: suitabilityBaseUrl });
  }

  if (advisoryConfig?.area?.type === 'scenario_comparison') {
    return exportScenarioComparisonPDF({ advisoryConfig, onProgress });
  }

  // Landing-area reports are a genuinely different data shape (one point's
  // hazard-over-time, not domain-wide percentages) — branch to a dedicated
  // export path so the whole-domain/map-view pipeline below is untouched.
  if (advisoryConfig?.area?.type === 'landing_area') {
    return exportLandingAreaSuitabilityPDF({
      timeIndex, validTime, runId, suitabilityBaseUrl, onProgress, advisoryConfig,
    });
  }

  const { jsPDF } = await import('jspdf');
  const progress = onProgress ?? (() => {});

  // ── Step 1: Fetch timesteps once; clamp provided timeIndex to backend bounds ──
  // The PDF's printed valid time comes only from backend summary.valid_time.
  progress('Resolving forecast timestep...');
  let apiBaseUrl = suitabilityBaseUrl;
  let tsMeta = null;
  let effectiveTimeIndex = timeIndex;
  try {
    const resolved = await resolveSuitabilityApi(suitabilityBaseUrl);
    apiBaseUrl = resolved.baseUrl;
    tsMeta = resolved.timesteps;
    if (tsMeta?.count) {
      effectiveTimeIndex = Math.max(0, Math.min(tsMeta.count - 1, Number(timeIndex) || 0));
    }
  } catch (error) {
    console.error(error.message);
    throw error;
  }

  const effectiveVessel = advisoryConfig?.vesselType ?? selectedVessel;
  const wantsCurrentMapView = advisoryConfig?.area?.type === 'current_map_view';
  const reportBounds = wantsCurrentMapView
    ? canonicalSuitabilityBounds(advisoryConfig?.area?.bounds)
    : null;
  if (wantsCurrentMapView && !reportBounds) {
    throw new Error('Current map bounds are unavailable or invalid. Reopen the advisory after the map has loaded.');
  }
  const windowHours = (() => {
    const t = advisoryConfig?.timeFrame?.type;
    if (t === 'current') return 0;
    if (t === 'next_72h') return 72;
    return 7 * 24;
  })();
  const stepHours = inferStepHours(tsMeta?.timesteps ?? []);
  const requestedStepCount = windowHours > 0 ? Math.ceil(windowHours / stepHours) : 0;
  const forecastEndTimeIndex = tsMeta?.count
    ? Math.min(tsMeta.count - 1, effectiveTimeIndex + requestedStepCount)
    : effectiveTimeIndex;

  // The advisory PDF is not just a map snapshot: pages 1, 2, 4, and 5 depend on
  // scope-aware summary statistics. If production is serving the lightweight
  // suitability API (timesteps/point/tiles only), fail early instead of saving a
  // visually polished but mostly empty advisory.
  progress('Fetching suitability data...');
  let summary = null;
  let effectiveValidTime = null;
  try {
    summary = await fetchSummary(effectiveTimeIndex, apiBaseUrl, reportBounds);
    if (summary?.valid_time) {
      effectiveValidTime = summary.valid_time;
      if (validTime) {
        const widgetMs = new Date(validTime).getTime();
        const backendMs = new Date(summary.valid_time).getTime();
        if (
          Number.isFinite(widgetMs)
          && Number.isFinite(backendMs)
          && Math.abs(widgetMs - backendMs) > 60_000
        ) {
          console.warn(
            `Ignoring widget validTime ${validTime}; PDF uses backend summary.valid_time ${summary.valid_time}.`
          );
        }
      }
    }
  } catch (error) {
    throw new Error(
      `Suitability advisory PDF is not available in this deployment. ` +
      `Missing /niue/suitability/summary/${effectiveTimeIndex}. ` +
      `Original error: ${error.message}`
    );
  }

  // ── Step 2: Fetch advisory map ────────────────────────────────────────────────
  // Page 1 slot is nearly square (≈178×160 mm) so request at 1.09:1 to avoid stretch.
  // Cartographic elements (scale bar, north arrow, markers) come from the backend.
  // The jsPDF legend is drawn separately, so showLegend is false here.
  progress(wantsCurrentMapView ? 'Rendering bounded advisory map...' : 'Rendering advisory map...');
  // Both the backend render and the client-side html2canvas fallback can
  // fail (network error / html2canvas dynamic-import or DOM-capture error
  // respectively) — either failure should degrade to mapDataUrl: null (Page
  // 1 already has a drawFailurePanel treatment for that), not abort the
  // whole 7-page export. The previous `.catch(() => null).then(...)` chain
  // only covered fetchMapImage; a captureMap rejection went unhandled.
  let mapDataUrl = null;
  let mapExtentSource = 'model_domain';
  if (wantsCurrentMapView && mapElement && (!mapVessel || mapVessel === effectiveVessel)) {
    try {
      mapDataUrl = await captureMap(mapElement);
      mapExtentSource = 'current_map_view_capture';
    } catch (error) {
      console.warn('[SuitabilityPDFExporter] current-view capture failed for Page 1:', error);
    }
  }
  if (!mapDataUrl) {
    try {
      mapDataUrl = await fetchMapImage(effectiveVessel, effectiveTimeIndex, apiBaseUrl, {
        width: 1100, height: 1010, dpi: 200,
        showLabels: false, showLegend: false,
        showClassBoundaries: true, viewRadiusKm: 34,
        bounds: reportBounds,
      });
      mapExtentSource = wantsCurrentMapView ? 'current_map_view_backend' : 'model_domain';
    } catch (error) {
      console.warn('[SuitabilityPDFExporter] fetchMapImage failed for Page 1:', error);
    }
  }
  if (wantsCurrentMapView && !mapDataUrl) {
    throw new Error('The backend could not render a map for the selected current-map bounds. The advisory was not generated because a full-domain fallback would be misleading.');
  }
  if (!mapDataUrl && !wantsCurrentMapView && mapElement) {
    try {
      mapDataUrl = await captureMap(mapElement);
      mapExtentSource = 'current_map_view_fallback';
    } catch (error) {
      console.warn('[SuitabilityPDFExporter] captureMap fallback failed for Page 1:', error);
    }
  }

  // ── Step 3b: Preload vessel SVG icons (one per vessel at its current hazard class) ──
  progress('Loading vessel icons...');
  const vesselIcons = {};
  if (summary?.vessels) {
    await Promise.all(VESSEL_CLASSES.map(async vc => {
      const vd  = summary.vessels[vc.code] ?? {};
      const haz = domainHazard(vd.warning_percent ?? 0, vd.caution_percent ?? 0);
      vesselIcons[vc.code] = await loadVesselSvgIcon(vc.code, haz);
    }));
  }

  // ── Step 4: Build forward time series in parallel (reuse tsMeta) ─────────────
  // Starts at effectiveTimeIndex — no historical steps, pure forward outlook.
  let timeSeriesData = [];
  try {
    if (tsMeta?.timesteps) {
      const start     = effectiveTimeIndex;
      const end       = forecastEndTimeIndex;

      // Sampling every native timestep for a full 7-day outlook means up to
      // ~168 summary fetches here alone (each fanning out to ~5 sub-requests
      // — see fetchSummary), which was enough to trip a volume-based block
      // at the backend's edge (see mapWithConcurrency). Sample every ~3 hours
      // instead — still comfortably inside selectDailyTimelineSteps' 4-hour
      // matching tolerance for the Page 5/6 daily snapshots, while cutting
      // the request count roughly stepStride×. Always keep the last index so
      // the outlook's end-of-window boundary/labels stay accurate.
      const desiredSampleHours = 3;
      const stepStride = Math.max(1, Math.round(desiredSampleHours / stepHours));
      const indices = [];
      for (let i = start; i <= end; i += stepStride) indices.push(i);
      if (indices[indices.length - 1] !== end) indices.push(end);

      const fetched = await mapWithConcurrency(indices, SUMMARY_FETCH_CONCURRENCY, (i) =>
        fetchSummary(i, apiBaseUrl, reportBounds)
          .then(s => ({ time_index: i, time: s.valid_time, vessels: s.vessels }))
          .catch(() => null),
        SUMMARY_FETCH_DELAY_MS
      );
      timeSeriesData = fetched.filter(Boolean);
    }
  } catch { /* leave sparklines empty */ }

  // ── Step 5: Build PDF ─────────────────────────────────────────────────────────
  progress('Building PDF...');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  setPdfMetadata(doc, {
    title: 'Niue Marine Suitability Advisory',
    subject: `Vessel suitability advisory — ${VESSEL_BY_CODE[effectiveVessel]?.label ?? effectiveVessel}`,
  });

  // Domain bounds from tsMeta pin all backend map renders to the true model extent,
  // activating adjustable="box" in the backend and eliminating the ocean-bg rectangle.
  const modelDomainBounds = (tsMeta?.lon_min != null) ? {
    west: tsMeta.lon_min,
    south: tsMeta.lat_min,
    east: tsMeta.lon_max,
    north: tsMeta.lat_max,
  } : null;
  const mapReportBounds = reportBounds ?? modelDomainBounds;

  // Print Issued only when real run metadata is available; never reuse the first valid timestep.
  const effectiveRunId = runId ?? tsMeta?.run_id ?? tsMeta?.forecast_run_id ?? tsMeta?.issued_at ?? null;

  await drawPage1(doc, { mapDataUrl, summary, validTime: effectiveValidTime, runId: effectiveRunId, selectedVessel: effectiveVessel, timeSeriesData, vesselIcons, advisoryConfig, mapExtentSource });
  const page2Result = await drawPage2(doc, { summary, validTime: effectiveValidTime, runId: effectiveRunId, timeSeriesData, vesselIcons, baseUrl: apiBaseUrl, windowHours });

  progress('Finding best contrast timestep...');
  await drawPage3(doc, { baseUrl: apiBaseUrl, timeIndex: effectiveTimeIndex, endTimeIndex: forecastEndTimeIndex, runId: effectiveRunId, validTime: effectiveValidTime, statisticsBounds: reportBounds, mapBounds: mapReportBounds });

  progress('Building forecast timeline...');
  await drawPage4(doc, { baseUrl: apiBaseUrl, selectedVessel: effectiveVessel, timeIndex: effectiveTimeIndex, timeSeriesData, runId: effectiveRunId, statisticsBounds: reportBounds, mapBounds: mapReportBounds });

  progress('Building trend chart...');
  await drawPage5(doc, { selectedVessel: effectiveVessel, timeIndex: effectiveTimeIndex, timeSeriesData, runId: effectiveRunId });

  progress('Adding methodology...');
  drawPage6(doc, { validTime: effectiveValidTime, runId: effectiveRunId, advisoryConfig, summary, seaLevelShownOnPage3: page2Result?.seaLevelShown ?? false });

const filename = `niue_suitability_advisory_t${String(effectiveTimeIndex).padStart(3,'0')}.pdf`;
  doc.save(filename);
  progress('Done');
  return filename;
}

// ── Route advisory PDF ───────────────────────────────────────────────────────
// Draws a compact route-line sketch (not a real basemap — no coastline, no
// tiles) inside the given box, coloured per-segment by hazard class, using
// the same equirectangular projection as the landing-area map overlay
// (projectLonLatToRect). This is the "map/route summary" the plan asks for;
// a real rendered basemap would need a network fetch this function doesn't
// otherwise make, so this stays a lightweight geometric sketch instead.
function drawRouteSketch(doc, x, y, w, h, samples) {
  setFill(doc, [221, 239, 243]);
  doc.rect(x, y, w, h, 'F');
  setDraw(doc, GRID_CLR);
  doc.setLineWidth(0.3);
  doc.rect(x, y, w, h, 'S');

  const points = samples.filter(s => Number.isFinite(s.lon) && Number.isFinite(s.lat));
  if (points.length < 2) {
    setFont(doc, TEXT_MD, 5.5, 'italic');
    doc.text('Route sketch unavailable', x + w / 2, y + h / 2, { align: 'center' });
    return;
  }

  const lons = points.map(p => p.lon);
  const lats = points.map(p => p.lat);
  const PAD = 0.02; // degrees, keeps the route off the box edges
  const bbox = {
    lonMin: Math.min(...lons) - PAD, lonMax: Math.max(...lons) + PAD,
    latMin: Math.min(...lats) - PAD, latMax: Math.max(...lats) + PAD,
  };
  if (bbox.lonMax === bbox.lonMin) { bbox.lonMax += PAD; bbox.lonMin -= PAD; }
  if (bbox.latMax === bbox.latMin) { bbox.latMax += PAD; bbox.latMin -= PAD; }

  const project = (lon, lat) => projectLonLatToRect(lon, lat, bbox, x, y, w, h);

  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = project(points[i - 1].lon, points[i - 1].lat);
    const [x1, y1] = project(points[i].lon, points[i].lat);
    const segColor = (points[i - 1].hazard_class !== null && points[i - 1].hazard_class !== undefined)
      ? hazardColor(Math.max(points[i - 1].hazard_class, points[i].hazard_class ?? points[i - 1].hazard_class))
      : NO_DATA_GREY;
    setDraw(doc, segColor);
    doc.setLineWidth(0.9);
    doc.line(x0, y0, x1, y1);
  }

  const [ox, oy] = project(points[0].lon, points[0].lat);
  const [dx, dy] = project(points[points.length - 1].lon, points[points.length - 1].lat);
  setFill(doc, [34, 197, 94]);
  doc.circle(ox, oy, 1.1, 'F');
  setFill(doc, [239, 68, 68]);
  doc.circle(dx, dy, 1.1, 'F');
}

function routeAvailableSamples(samples = []) {
  return samples.filter(s => s?.available !== false && s?.hazard_class !== null && s?.hazard_class !== undefined);
}

function getWorstRouteSample(samples = []) {
  return routeAvailableSamples(samples).reduce((worst, sample) => {
    if (!worst) return sample;
    if (sample.hazard_class > worst.hazard_class) return sample;
    if (sample.hazard_class === worst.hazard_class && new Date(sample.eta) < new Date(worst.eta)) return sample;
    return worst;
  }, null);
}

// How far a sample's wind/wave reading is past a vessel's Avoid (or, failing
// that, Caution) threshold, and which of the two metrics drove it — no
// existing helper computed a numeric exceedance amount, only the 0/1/2
// hazard class itself. Powers the Critical Point card. Returns null when the
// sample is within the vessel's Suitable envelope (or thresholds/readings
// are unavailable), matching this file's "never fabricate a reading"
// convention elsewhere.
export function computeExceedance(vesselType, sample) {
  const rule = VESSEL_THRESHOLDS[vesselType];
  if (!rule || !sample) return null;
  const windKt = Number(sample.wind_speed_kt);
  const waveM = Number(sample.wave_height_m);
  const windOverAvoid = Number.isFinite(windKt) ? windKt - rule.maxWindKt : -Infinity;
  const waveOverAvoid = Number.isFinite(waveM) ? waveM - rule.maxWaveHeightM : -Infinity;
  if (windOverAvoid >= 0 || waveOverAvoid >= 0) {
    return windOverAvoid >= waveOverAvoid
      ? { metric: 'wind', value: windKt, threshold: rule.maxWindKt, level: 'avoid', delta: windOverAvoid }
      : { metric: 'wave', value: waveM, threshold: rule.maxWaveHeightM, level: 'avoid', delta: waveOverAvoid };
  }
  const windOverCaution = Number.isFinite(windKt) ? windKt - rule.cautionWindKt : -Infinity;
  const waveOverCaution = Number.isFinite(waveM) ? waveM - rule.cautionWaveHeightM : -Infinity;
  if (windOverCaution >= 0 || waveOverCaution >= 0) {
    return windOverCaution >= waveOverCaution
      ? { metric: 'wind', value: windKt, threshold: rule.cautionWindKt, level: 'caution', delta: windOverCaution }
      : { metric: 'wave', value: waveM, threshold: rule.cautionWaveHeightM, level: 'caution', delta: waveOverCaution };
  }
  return null;
}

// Start/end/duration of the single worst contiguous hazard run along the
// route (by eta), not just the single worst sample — adapts the same
// run-length-encoding pattern summarizeBestHazardWindow already uses for the
// domain-wide forecast trend, applied to route samples instead of timesteps.
// Powers "exceeded between HH:MM-HH:MM" phrasing and the timeline's
// prolonged-vs-isolated hazard label.
export function findWorstRun(samples = []) {
  const avail = routeAvailableSamples(samples);
  if (!avail.length) return null;
  let worstHazard = -1;
  let worstLen = 0;
  let worstStart = null;
  let worstEnd = null;
  let runStart = 0;
  let runHazard = Number(avail[0].hazard_class);
  for (let i = 0; i <= avail.length; i++) {
    const haz = i < avail.length ? Number(avail[i].hazard_class) : null;
    if (i === avail.length || haz !== runHazard) {
      const len = i - runStart;
      // Tie-break by length, matching summarizeBestHazardWindow's
      // established convention — the sustained run is the one worth
      // surfacing for "prolonged vs isolated" labeling, not just whichever
      // Avoid/Caution run happened to occur first.
      if (runHazard > worstHazard || (runHazard === worstHazard && len > worstLen)) {
        worstHazard = runHazard;
        worstLen = len;
        worstStart = avail[runStart];
        worstEnd = avail[i - 1];
      }
      runStart = i;
      runHazard = haz;
    }
  }
  if (!worstStart) return null;
  const startMs = new Date(worstStart.eta).getTime();
  const endMs = new Date(worstEnd.eta).getTime();
  return {
    hazard: worstHazard,
    startTime: worstStart.eta,
    endTime: worstEnd.eta,
    startSample: worstStart,
    endSample: worstEnd,
    durationHours: Number.isFinite(startMs) && Number.isFinite(endMs) ? (endMs - startMs) / 3_600_000 : null,
  };
}

// Nearest user-supplied route waypoint (not forecast sample) to a given
// sample's position — powers "near waypoint N" phrasing, since the sample
// grid and the route's own waypoints are two different index spaces.
function nearestWaypointIndex(routePoints, sample) {
  if (!Array.isArray(routePoints) || !routePoints.length || !sample) return null;
  if (!Number.isFinite(sample.lon) || !Number.isFinite(sample.lat)) return null;
  let bestIdx = null;
  let bestDist = Infinity;
  routePoints.forEach((pt, idx) => {
    const lon = Array.isArray(pt) ? pt[0] : pt?.lon;
    const lat = Array.isArray(pt) ? pt[1] : pt?.lat;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const dist = (lon - sample.lon) ** 2 + (lat - sample.lat) ** 2;
    if (dist < bestDist) { bestDist = dist; bestIdx = idx; }
  });
  return bestIdx;
}

// Selects up to maxRows samples for the full table, always pinning the
// first, last, and worst sample (via getWorstRouteSample) so the worst point
// on the route can never be silently excluded the way a naive
// samples.slice(0, N) could — then fills remaining slots with an even index
// stride, same "resample, keep endpoints" spirit as selectHeatmapSteps.
export function selectRouteTableRows(samples = [], maxRows = 22) {
  if (samples.length <= maxRows) return samples;
  const pinned = new Set([0, samples.length - 1]);
  const worst = getWorstRouteSample(samples);
  if (worst) {
    const worstIndex = samples.indexOf(worst);
    if (worstIndex >= 0) pinned.add(worstIndex);
  }
  const remaining = maxRows - pinned.size;
  if (remaining > 0) {
    const stride = (samples.length - 1) / (remaining + 1);
    for (let i = 1; i <= remaining; i++) {
      pinned.add(Math.round(i * stride));
    }
  }
  return [...pinned].sort((a, b) => a - b).map(index => samples[index]);
}

// Maps a hazard verdict to one plain, actionable sentence instead of a bare
// classification label — "Suitable"/"Caution"/"Avoid" are model outputs, not
// instructions. Stale-departure takes priority (it's the more urgent thing
// to notice, matching the same override already applied to the executive
// sentence's color/prefix).
export function routeOperationalRecommendation({ hazardAvailable, hazard, worstRun, routePoints, isStaleDeparture }) {
  if (isStaleDeparture) {
    return 'Delay departure — the modelled departure window has already passed.';
  }
  if (!hazardAvailable) {
    return 'Assessment unavailable — insufficient model coverage along this route.';
  }
  if (hazard === 0) {
    return 'Proceed within the assessed departure window.';
  }
  const startTime = worstRun?.startTime ? formatUtcTiny(worstRun.startTime) : null;
  const endTime = worstRun?.endTime ? formatUtcTiny(worstRun.endTime) : null;
  const windowText = startTime && endTime && startTime !== endTime
    ? ` between ${startTime}-${endTime}`
    : (startTime ? ` near ${startTime}` : '');
  if (hazard === 1) {
    return `Proceed with caution — conditions approach the operating threshold${windowText}.`;
  }
  const waypointIndex = worstRun?.startSample ? nearestWaypointIndex(routePoints, worstRun.startSample) : null;
  const waypointText = waypointIndex !== null ? ` near waypoint ${waypointIndex + 1}` : '';
  return `Delay departure — operating envelope exceeded${waypointText}${windowText}.`;
}

function routeExposureSummary(samples = []) {
  const available = routeAvailableSamples(samples);
  const total = samples.length;
  const unavailable = total - available.length;
  const cautionOrAvoid = available.filter(s => Number(s.hazard_class) >= 1).length;
  const avoid = available.filter(s => Number(s.hazard_class) >= 2).length;
  const cautionOnly = cautionOrAvoid - avoid;
  return {
    total,
    available: available.length,
    unavailable,
    cautionOrAvoid,
    avoid,
    cautionOnly,
    exposurePercent: available.length ? (cautionOrAvoid / available.length) * 100 : null,
    avoidPercent: available.length ? (avoid / available.length) * 100 : null,
    cautionOnlyPercent: available.length ? (cautionOnly / available.length) * 100 : null,
  };
}

function routeConfidenceLabel(exposure) {
  if (!exposure.total) return 'unknown';
  if (exposure.unavailable === 0) return 'high';
  if (exposure.available === 0) return 'low';
  return 'reduced';
}

function routeThresholdText(vesselType) {
  const rule = VESSEL_THRESHOLDS[vesselType];
  if (!rule) return 'Thresholds unavailable for this vessel class.';
  return `Caution from ${formatNumber(rule.cautionWindKt, 0)} kt or ${formatNumber(rule.cautionWaveHeightM, 1)} m; Avoid from ${formatNumber(rule.maxWindKt, 0)} kt or ${formatNumber(rule.maxWaveHeightM, 1)} m.`;
}

function routeRiskNarrative({ samples, vesselLabel, vesselType, decision, hazardAvailable, hazard }) {
  const exposure = routeExposureSummary(samples);
  const worstSample = getWorstRouteSample(samples);
  if (!samples.length) return 'No route samples were returned, so the route cannot be assessed.';
  if (!hazardAvailable || !worstSample) {
    return `Route could not be classified. Confidence is ${routeConfidenceLabel(exposure)} because ${exposure.unavailable} of ${exposure.total} samples were unavailable.`;
  }
  const driver = DRIVER_LABELS[decision?.primaryDriver] ?? DRIVER_LABELS[worstSample.main_driver] ?? 'conditions';
  const eta = worstSample.eta ? formatUtcTiny(worstSample.eta) : 'the route';
  // Split out Avoid specifically, not just the combined Caution+Avoid figure
  // — a route that's 100% "Caution/Avoid" reads very differently depending
  // on whether that's mostly Caution or solidly Avoid, and the worst-case
  // recommendation above doesn't otherwise convey which one this is.
  const exposureText = exposure.exposurePercent === null
    ? 'exposure unavailable'
    : `${formatNumber(exposure.exposurePercent, 0)}% of available samples are Caution/Avoid `
      + `(${formatNumber(exposure.avoidPercent, 0)}% Avoid, ${formatNumber(exposure.cautionOnlyPercent, 0)}% Caution)`;
  return `${vesselLabel} reaches ${hazardLabel(hazard)} near ${eta}; ${driver.toLowerCase()} is the main driver. ${exposureText}. ${routeThresholdText(vesselType)}`;
}

function summarizeBestHazardWindow(steps = []) {
  if (!steps.length) return null;
  let bestHazard = 3;
  let bestStart = 0;
  let bestLen = 0;
  let runStart = 0;
  let runHazard = Number(steps[0]?.hazard_class ?? 3);
  for (let i = 0; i <= steps.length; i++) {
    const haz = i < steps.length ? Number(steps[i]?.hazard_class ?? 3) : null;
    if (i === steps.length || haz !== runHazard) {
      const len = i - runStart;
      if (runHazard < bestHazard || (runHazard === bestHazard && len > bestLen)) {
        bestHazard = runHazard;
        bestStart = runStart;
        bestLen = len;
      }
      runStart = i;
      runHazard = haz;
    }
  }
  const start = steps[bestStart];
  const end = steps[Math.min(steps.length - 1, bestStart + bestLen - 1)];
  if (!start) return null;
  return {
    hazard: bestHazard,
    label: hazardLabel(bestHazard),
    startTime: start.valid_time ?? start.time,
    endTime: end?.valid_time ?? end?.time,
    count: bestLen,
  };
}

function summarizeAvoidWindows(steps = []) {
  const avoidSteps = steps.filter(s => Number(s?.hazard_class) >= 2);
  if (!avoidSteps.length) return 'No Avoid timesteps in the selected outlook window.';
  const first = avoidSteps[0]?.valid_time ?? avoidSteps[0]?.time;
  const last = avoidSteps[avoidSteps.length - 1]?.valid_time ?? avoidSteps[avoidSteps.length - 1]?.time;
  return `${avoidSteps.length} Avoid timestep${avoidSteps.length === 1 ? '' : 's'}, from ${formatUtcTiny(first)} to ${formatUtcTiny(last)}.`;
}

function seaLevelSummary(seaLevel) {
  const source = seaLevel?.values?.length ? seaLevel.values : (seaLevel?.timesteps ?? []);
  // total_sea_level_m / tide_m are the real field names niue_sea_level_timeseries
  // returns — sea_level_m/water_level_m/value never matched any real response
  // shape, so this silently returned null on every call regardless of whether
  // the fetch succeeded, despite surrounding UI text ("Tide/sea-level context
  // summarized in the site card") already promising tide was being shown.
  const totals = source.map(v => Number(v?.total_sea_level_m)).filter(Number.isFinite);
  const tides = source.map(v => Number(v?.tide_m)).filter(Number.isFinite);
  if (totals.length < 2) return null;
  const tideRange = tides.length >= 2
    ? `tide ${formatNumber(Math.min(...tides), 2)}-${formatNumber(Math.max(...tides), 2)} m, `
    : '';
  return `Sea-level context available: ${tideRange}total (tide + inverse barometer + SLA) `
    + `${formatNumber(Math.min(...totals), 2)}-${formatNumber(Math.max(...totals), 2)} m across the report window.`;
}

function drawScenarioMiniTimeline(doc, x, y, w, h, scenario) {
  const samples = Array.isArray(scenario?.forecastResult?.samples) ? scenario.forecastResult.samples : [];
  if (!samples.length) {
    rect(doc, x, y, w, h, [235, 236, 238], GRID_CLR, 0.15);
    setFont(doc, TEXT_MD, 4.8, 'italic');
    doc.text('No timeline', x + w / 2, y + h * 0.64, { align: 'center' });
    return;
  }
  const sw = w / samples.length;
  samples.forEach((sample, index) => {
    const color = sample?.hazard_class !== null && sample?.hazard_class !== undefined ? hazardColor(sample.hazard_class) : NO_DATA_GREY;
    setFill(doc, color);
    doc.rect(x + index * sw, y, Math.max(sw, 0.25), h, 'F');
  });
  setDraw(doc, GRID_CLR);
  doc.setLineWidth(0.15);
  doc.rect(x, y, w, h, 'S');
}

function scenarioRecommendationReason(recommended, scenarios = []) {
  if (!recommended?.decision) return 'No ready scenario could be ranked.';
  const d = recommended.decision;
  const exposure = (d.cautionPercent ?? 0) + (d.warningPercent ?? 0);
  const readyCount = scenarios.filter(s => s.status === 'ready' && s.decision).length;
  // A qualitative "reduced" alone reads the same whether 1 sample is
  // missing or half the route is — pairing it with the raw ratio (matching
  // the live Route panel's own "Why" text) makes the coverage gap legible
  // without a reader having to hunt for it elsewhere in the brief.
  const coverageText = d.totalSamples
    ? ` (${d.totalSamples - (d.unavailableSamples ?? 0)}/${d.totalSamples} samples available)`
    : '';
  return `Why: best ranked of ${readyCount} ready scenario${readyCount === 1 ? '' : 's'} by lowest worst hazard, then exposure (${formatNumber(exposure, 0)}%), unavailable samples (${d.unavailableSamples ?? 0}), and duration (${formatNumber(d.durationHours, 1)} h). Confidence: ${d.confidenceLabel ?? 'unknown'}${coverageText}.`;
}

async function exportRouteForecastPDF({ advisoryConfig, onProgress }) {
  const { jsPDF } = await import('jspdf');
  const progress = onProgress ?? (() => {});
  const route = advisoryConfig?.routeForecast ?? {};
  const result = route.result ?? {};
  const summary = result.summary ?? {};
  const samples = Array.isArray(result.samples) ? result.samples : [];
  // decision/provenance come from scenarioService.js's deriveRouteDecision
  // and RouteForecastPanel's fetch bookkeeping — both optional so this
  // function still degrades gracefully if a caller doesn't supply them.
  const decision = route.decision ?? null;
  const provenance = route.provenance ?? {};
  // Both optional — null-safe throughout below, so a brief built without
  // either renders exactly as it did before they existed.
  const vesselSuggestion = route.vesselSuggestion ?? null;
  const departureSuggestion = route.departureSuggestion ?? null;
  const routeSeaLevelSteps = Array.isArray(route.seaLevel?.timesteps) ? route.seaLevel.timesteps : [];
  // null (not 0) means "every sample was unavailable/out of the model
  // domain" — see routeForecastService.js's normalizeRouteForecastResponse,
  // which is the source of this data. Defaulting to 0 here would paint an
  // unscored route with the same green "Suitable" as a real all-clear route.
  const hazardAvailable = summary.worst_hazard_class !== null && summary.worst_hazard_class !== undefined
    && Number.isFinite(Number(summary.worst_hazard_class));
  const hazard = hazardAvailable ? Number(summary.worst_hazard_class) : null;
  const hazardCardColor = hazardAvailable ? hazardColor(hazard) : NO_DATA_GREY;
  const vesselLabel = advisoryConfig?.vesselLabel ?? route.result?.vessel ?? 'Vessel';
  const vesselType = advisoryConfig?.vesselType ?? result.vessel ?? null;

  const unavailableCount = decision?.unavailableSamples
    ?? samples.filter(s => s.available === false || s.hazard_class === null || s.hazard_class === undefined).length;
  const primaryDriver = decision?.primaryDriver
    ?? (vesselType && samples.length
      ? deriveDriverForVessel(vesselType, Math.max(...samples.map(s => s.wind_speed_kt ?? 0)), Math.max(...samples.map(s => s.wave_height_m ?? 0)))
      : null);
  const driverText = DRIVER_LABELS[primaryDriver] ?? '—';

  progress('Building route advisory brief...');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  setPdfMetadata(doc, { title: 'Niue Route Advisory Brief', subject: `Route-based vessel suitability — ${vesselLabel}` });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  rect(doc, 0, 0, W, H, PAGE_BG);

  // A departure time earlier than when this brief was generated means the
  // voyage window it models has already closed — without a flag, a reader
  // skimming this as "today's guidance" has no way to tell that apart from
  // a genuinely current advisory. Compared against provenance.generatedAt
  // (when supplied) rather than the live clock, so a re-render of an older
  // brief doesn't retroactively flag itself.
  const departureMs = new Date(route.departureTime ?? result.departure_time).getTime();
  const generatedAtDate = provenance.generatedAt ? new Date(provenance.generatedAt) : new Date();
  const isStaleDeparture = Number.isFinite(departureMs) && Number.isFinite(generatedAtDate.getTime())
    && departureMs < generatedAtDate.getTime();

  drawHeaderBand(doc, {
    title: 'ROUTE ADVISORY BRIEF',
    subtitle: `${vesselLabel} route-based vessel suitability`,
    rightLine1: `Departure: ${formatUtcTiny(route.departureTime ?? result.departure_time)}${isStaleDeparture ? ' — ALREADY PASSED' : ''}`,
    rightLine2: `Speed: ${formatNumber(route.speedKt ?? result.speed_kt, 1)} kt  ·  SWAN  |  Page 1 of 2`,
  });

  const worstRun = findWorstRun(samples);

  // Executive recommendation — one plain, actionable sentence, before any
  // numbers. "Suitable"/"Caution"/"Avoid" are model classifications, not
  // instructions; routeOperationalRecommendation turns the verdict into a
  // plain-language action. Stale-departure overrides the normal
  // hazard-driven text — "this data is historical" is the more urgent thing
  // to notice.
  setFont(doc, isStaleDeparture ? hazardColor(2) : (hazardAvailable ? hazardText(hazard) : TEXT_MD), 9, 'bold');
  const execSentence = !samples.length
    ? 'No route samples were returned — recommendation unavailable.'
    : routeOperationalRecommendation({ hazardAvailable, hazard, worstRun, routePoints: route.routePoints, isStaleDeparture });
  doc.text(fitTextToWidth(doc, execSentence, W - 20), W / 2, 22, { align: 'center' });

  const CARD_Y = 26;
  const CARD_H = 30;
  // Distance/Duration render in NO_DATA_GREY (not TEXT_DK) when actually
  // missing, matching the Recommendation card's Unavailable treatment —
  // previously these two always used TEXT_DK regardless of whether
  // formatNumber had real data or was falling back to '-', so a route with
  // no distance/duration looked like ordinary data instead of missing data.
  const distanceAvailable = Number.isFinite(summary.distance_nm);
  const durationAvailable = Number.isFinite(summary.duration_hours);
  const cols = [
    ['Recommendation', summary.recommendation ?? (hazardAvailable ? hazardLabel(hazard) : 'Unavailable'), hazardCardColor],
    ['Distance', `${formatNumber(summary.distance_nm, 1)} nm`, distanceAvailable ? TEXT_DK : NO_DATA_GREY],
    ['Duration', `${formatNumber(summary.duration_hours, 1)} h`, durationAvailable ? TEXT_DK : NO_DATA_GREY],
    ['Primary driver', driverText, TEXT_DK],
    ['Samples', `${samples.length}${unavailableCount ? ` (${unavailableCount} unavail.)` : ''}`, TEXT_DK],
  ];
  const cardW = (W - 20) / cols.length;
  cols.forEach(([label, value, color], index) => {
    const x = 7 + index * cardW;
    setFill(doc, [255, 255, 255]);
    setDraw(doc, index === 0 ? hazardCardColor : GRID_CLR);
    doc.roundedRect(x, CARD_Y, cardW - 3, CARD_H, 2, 2, 'FD');
    setFont(doc, TEXT_MD, 6.5, 'bold');
    doc.text(label, x + 5, CARD_Y + 8);
    setFont(doc, color, index === 0 ? 12 : 10.5, 'bold');
    doc.text(String(value ?? '-'), x + 5, CARD_Y + 20, { maxWidth: cardW - 12 });
  });

  // A sample's hazard_class is null exactly when it's outside the model
  // domain (see routeForecastService.js) — must render as grey/unavailable,
  // not silently default into the "Suitable" green.
  const sampleHazardAvailable = (sample) => sample?.hazard_class !== null && sample?.hazard_class !== undefined;
  const sampleHazardColor = (sample) => sampleHazardAvailable(sample) ? hazardColor(sample.hazard_class) : NO_DATA_GREY;

  // Critical Point card — the worst single sample, spelled out (time,
  // position, readings, how far past threshold, how long it lasted), not
  // just implied by a color on the timeline below.
  // getWorstRouteSample always returns *a* sample (earliest tie-break) as
  // long as any sample is available — including an all-Suitable route,
  // where the "worst" sample is hazard 0. That's fine for the exec
  // sentence's generic "worst conditions are X-driven" framing, but this
  // card explicitly claims something noteworthy happened, so it must also
  // check the hazard level itself, not just presence of a sample.
  const worstSample = getWorstRouteSample(samples);
  const hasCriticalPoint = worstSample && Number(worstSample.hazard_class) >= 1;
  const exceedance = hasCriticalPoint && vesselType ? computeExceedance(vesselType, worstSample) : null;
  const CP_Y = 60;
  const CP_H = 20;
  setFill(doc, [255, 255, 255]);
  setDraw(doc, hasCriticalPoint ? hazardColor(worstSample.hazard_class) : GRID_CLR);
  doc.setLineWidth(0.35);
  doc.roundedRect(8, CP_Y, W - 16, CP_H, 2, 2, 'FD');
  setFont(doc, TEXT_DK, 6.5, 'bold');
  doc.text('Critical point', 12, CP_Y + 6);
  if (!hasCriticalPoint) {
    setFont(doc, TEXT_MD, 6, 'italic');
    doc.text('No Caution/Avoid samples — conditions stayed within the Suitable envelope for this route.', 12, CP_Y + 14);
  } else {
    setFont(doc, TEXT_DK, 6);
    const factParts = [
      `Time: ${formatUtcTiny(worstSample.eta)}`,
      `Position: ${formatNumber(worstSample.lat, 4)}, ${formatNumber(worstSample.lon, 4)}`,
      `Wave: ${formatNumber(worstSample.wave_height_m, 2)} m`,
      `Wind: ${formatNumber(worstSample.wind_speed_kt, 1)} kt`,
    ];
    doc.text(factParts.join('   ·   '), 12, CP_Y + 12.5);
    const sampleDriver = DRIVER_LABELS[worstSample.main_driver] ?? driverText;
    let exceedText = 'Vessel threshold data unavailable — cannot state exceedance amount.';
    if (exceedance) {
      const digits = exceedance.metric === 'wind' ? 1 : 2;
      const unit = exceedance.metric === 'wind' ? 'kt' : 'm';
      const metricLabel = exceedance.metric === 'wind' ? 'Wind' : 'Wave';
      const levelLabel = exceedance.level === 'avoid' ? 'Avoid' : 'Caution';
      exceedText = `${metricLabel} is ${formatNumber(Math.abs(exceedance.delta), digits)} ${unit} above the ${levelLabel} threshold (${formatNumber(exceedance.threshold, digits)} ${unit}).`;
    }
    const durationText = worstRun?.durationHours ? ` Sustained ${formatNumber(worstRun.durationHours, 1)} h.` : '';
    setFont(doc, TEXT_MD, 5.8);
    doc.text(fitTextToWidth(doc, `${exceedText}${durationText} Primary driver: ${sampleDriver}.`, W - 24), 12, CP_Y + 18);
  }

  // Hazard timeline (left, time-scaled) + route sketch (right) share a row.
  const stripX = 8;
  const stripY = 88;
  const stripH = 22;
  const sketchW = 62;
  const stripW = W - 16 - sketchW - 4;
  setFont(doc, TEXT_DK, 8, 'bold');
  doc.text('Hazard timeline (time-scaled)', stripX, stripY - 3);
  const timedSamples = samples.filter(s => Number.isFinite(new Date(s.eta).getTime()));
  if (timedSamples.length >= 2) {
    const t0 = new Date(timedSamples[0].eta).getTime();
    const t1 = new Date(timedSamples[timedSamples.length - 1].eta).getTime();
    const tRange = t1 - t0 || 1;
    timedSamples.forEach((sample, index) => {
      const segStartMs = new Date(sample.eta).getTime();
      const segEndMs = index < timedSamples.length - 1 ? new Date(timedSamples[index + 1].eta).getTime() : t1;
      const segX = stripX + ((segStartMs - t0) / tRange) * stripW;
      const segW = Math.max(((segEndMs - segStartMs) / tRange) * stripW, 0.3);
      setFill(doc, sampleHazardColor(sample));
      doc.rect(segX, stripY, segW, stripH, 'F');
    });
    // Worst-point marker — a small triangle above the strip at the worst
    // sample's time position, so the worst point can be located visually,
    // not just inferred from a solid block of Avoid color. Only drawn when
    // that point is actually Caution/Avoid — an all-Suitable route has no
    // "worst point" worth flagging, even though getWorstRouteSample still
    // returns its earliest sample as a tie-break.
    if (hasCriticalPoint) {
      const wMs = new Date(worstSample.eta).getTime();
      if (Number.isFinite(wMs)) {
        const wx = stripX + ((wMs - t0) / tRange) * stripW;
        setFill(doc, [30, 41, 59]);
        doc.triangle(wx - 1.5, stripY - 2, wx + 1.5, stripY - 2, wx, stripY + 0.5, 'F');
      }
    }
    setDraw(doc, GRID_CLR);
    doc.rect(stripX, stripY, stripW, stripH, 'S');
    // Time axis: start / midpoint distance / end.
    setFont(doc, TEXT_MD, 5);
    doc.text(formatUtcTiny(timedSamples[0].eta), stripX, stripY + stripH + 4);
    doc.text(formatUtcTiny(timedSamples[timedSamples.length - 1].eta), stripX + stripW, stripY + stripH + 4, { align: 'right' });
    const midMs = t0 + tRange / 2;
    const midSample = timedSamples.reduce((best, s) => (
      Math.abs(new Date(s.eta).getTime() - midMs) < Math.abs(new Date(best.eta).getTime() - midMs) ? s : best
    ), timedSamples[0]);
    if (Number.isFinite(midSample?.distance_nm)) {
      doc.text(`${formatNumber(midSample.distance_nm, 0)} nm`, stripX + stripW / 2, stripY + stripH + 4, { align: 'center' });
    }
    // Prolonged-hazard label — only the single longest Caution/Avoid run,
    // not every run (that would clutter a strip this size for no real gain).
    if (worstRun && worstRun.hazard >= 1 && worstRun.durationHours) {
      setFont(doc, TEXT_MD, 5, 'italic');
      doc.text(`Longest ${hazardLabel(worstRun.hazard)} run: ${formatNumber(worstRun.durationHours, 1)} h`, stripX, stripY + stripH + 8);
    }
  } else {
    rect(doc, stripX, stripY, stripW, stripH, [235, 236, 238]);
    setDraw(doc, GRID_CLR);
    doc.rect(stripX, stripY, stripW, stripH, 'S');
  }
  drawSharedLegend(doc, stripX + stripW / 2, stripY + stripH + 13);

  const sketchX = stripX + stripW + 4;
  setFont(doc, TEXT_DK, 8, 'bold');
  doc.text('Route', sketchX, stripY - 3);
  drawRouteSketch(doc, sketchX, stripY, sketchW, stripH, samples);

  // Suggestions — at most 2 lines, in the gap between the timeline/sketch
  // row and the operational context box. Estimate (vessel, client-side)
  // reads as muted/italic; route-checked departure guidance reads at normal
  // weight — see the plan's visual-distinction requirement.
  let suggestY = 126;
  if (vesselSuggestion) {
    setFont(doc, TEXT_MD, 6, 'italic');
    // fitTextToWidth (truncate to one line), not maxWidth (wrap) — this sits
    // in a fixed gap above the operational context box a few mm below; a
    // wrapped second line would run into it instead of just looking crowded.
    doc.text(
      fitTextToWidth(doc, `Suggestion: ${vesselSuggestion.vesselLabel} would rate ${hazardLabel(vesselSuggestion.estimatedWorstHazardClass)} instead of ${hazardLabel(vesselSuggestion.currentWorstHazardClass)} (client-side estimate, unconfirmed).`, W - 16),
      8, suggestY,
    );
    suggestY += 5;
  }
  if (departureSuggestion) {
    setFont(doc, TEXT_DK, 6, 'bold');
    const failedCount = departureSuggestion.failedOffsets?.length ?? 0;
    const failedText = failedCount > 0 ? ` ${failedCount} offset${failedCount === 1 ? '' : 's'} could not be checked.` : '';
    doc.text(
      fitTextToWidth(doc, `Better departure: +${departureSuggestion.offsetHours}h (${formatUtcTiny(departureSuggestion.departureTime)}) rates ${hazardLabel(departureSuggestion.worstHazardClass)} — checked against the route forecast.${failedText}`, W - 16),
      8, suggestY,
    );
    suggestY += 5;
  }

  const routeExposure = routeExposureSummary(samples);
  const routeNarrative = routeRiskNarrative({ samples, vesselLabel, vesselType, decision, hazardAvailable, hazard });
  const contextY = suggestY + 4;
  const contextH = 15;
  setFill(doc, [255, 255, 255]);
  setDraw(doc, hazardAvailable ? hazardCardColor : GRID_CLR);
  doc.setLineWidth(0.35);
  doc.roundedRect(8, contextY, W - 16, contextH, 2, 2, 'FD');
  setFont(doc, TEXT_MD, 6.2, 'bold');
  doc.text(`Operational context · confidence ${routeConfidenceLabel(routeExposure)} · ${routeExposure.unavailable} unavailable sample${routeExposure.unavailable === 1 ? '' : 's'}`, 12, contextY + 5);
  setFont(doc, TEXT_DK, 5.8);
  doc.text(routeNarrative, 12, contextY + 10.5, { maxWidth: W - 24 });

  setFont(doc, TEXT_MD, 6, 'italic');
  doc.text('Full route data, wind/wave/tide profile, thresholds, and provenance — see Page 2.', W / 2, contextY + contextH + 6, { align: 'center' });

  progress('Building route advisory detail page...');
  drawRouteAdvisoryPage2(doc, {
    W, H, samples, routeSeaLevelSteps, vesselType, vesselLabel, provenance,
    routeExposure, unavailableCount, route, result, summary,
  });

  const filename = `niue_route_advisory_brief_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
  progress('Done');
  return filename;
}

// ── Route advisory brief — Page 2: full sample table, wind/wave/tide voyage
// profiles, thresholds, confidence breakdown, and provenance. Two-column
// layout (table on the left, stacked charts/text on the right) makes better
// use of the landscape page than stacking everything in one column would.
function drawRouteAdvisoryPage2(doc, {
  W, H, samples, routeSeaLevelSteps, vesselType, vesselLabel, provenance,
  routeExposure, unavailableCount, route, result, summary,
}) {
  doc.addPage();
  rect(doc, 0, 0, W, H, PAGE_BG);
  drawHeaderBand(doc, {
    title: 'ROUTE ADVISORY BRIEF',
    subtitle: 'Route data, wind/wave/tide profile, and methodology',
    rightLine1: vesselLabel,
    rightLine2: 'SWAN  |  Page 2 of 2',
  });

  const sampleHazardAvailable = (sample) => sample?.hazard_class !== null && sample?.hazard_class !== undefined;
  const sampleHazardColor = (sample) => sampleHazardAvailable(sample) ? hazardColor(sample.hazard_class) : NO_DATA_GREY;

  // ── Left column: full sample table ──────────────────────────────────────
  const tableX = 8;
  const tableW = 130;
  const tableY = 26;
  const rowH = 5.6;
  const headerH = 8;
  const maxRows = Math.max(1, Math.floor((H - 12 - tableY - headerH) / rowH));
  const rows = selectRouteTableRows(samples, maxRows);
  const worstSampleForTable = getWorstRouteSample(samples);

  setFont(doc, TEXT_DK, 8, 'bold');
  doc.text('Route sample detail', tableX, tableY - 3);

  const headers = ['ETA', 'Dist', 'Hazard', 'Wave', 'Wind', 'Tide'];
  const widths = [30, 16, 24, 20, 20, 20];
  let x = tableX;
  setFill(doc, HEADER_BG);
  doc.rect(tableX, tableY, tableW, headerH, 'F');
  setFont(doc, TEXT_LT, 6, 'bold');
  headers.forEach((header, i) => {
    doc.text(header, x + 2, tableY + 5.5);
    x += widths[i];
  });

  rows.forEach((sample, rowIndex) => {
    const y = tableY + headerH + rowIndex * rowH;
    x = tableX;
    // Same guard as the Critical Point card: getWorstRouteSample always
    // returns a sample (earliest tie-break) once any is available, even on
    // an all-Suitable route — only actually highlight it when it's
    // Caution/Avoid, not just "technically the worst of an all-clear set."
    const isWorstRow = sample === worstSampleForTable && Number(worstSampleForTable?.hazard_class) >= 1;
    if (isWorstRow) rect(doc, tableX, y, tableW, rowH, [255, 241, 224]);
    else if (rowIndex % 2 === 0) rect(doc, tableX, y, tableW, rowH, [248, 250, 252]);
    const vals = [
      formatUtcTiny(sample.eta),
      `${formatNumber(sample.distance_nm, 0)} nm`,
      sample.hazard_label ?? (sampleHazardAvailable(sample) ? hazardLabel(sample.hazard_class) : 'Unavail.'),
      `${formatNumber(sample.wave_height_m, 2)} m`,
      `${formatNumber(sample.wind_speed_kt, 1)} kt`,
      (() => {
        const tide = seaLevelHeightM(nearestSeaLevelStep(routeSeaLevelSteps, sample.eta));
        return Number.isFinite(tide) ? `${formatNumber(tide, 2)} m` : '-';
      })(),
    ];
    vals.forEach((value, i) => {
      setFont(doc, i === 2 ? sampleHazardColor(sample) : TEXT_DK, 5.5);
      doc.text(String(value ?? '-'), x + 2, y + rowH - 1.5, { maxWidth: widths[i] - 3 });
      x += widths[i];
    });
  });

  const tableBottomY = tableY + headerH + rows.length * rowH;
  const tideUnavailable = routeSeaLevelSteps.length === 0;
  const footnoteParts = [];
  if (samples.length > rows.length) {
    const worstIsNotable = Number(worstSampleForTable?.hazard_class) >= 1;
    footnoteParts.push(`Showing ${rows.length} of ${samples.length} samples${worstIsNotable ? ', including the worst point on the route (highlighted)' : ''}.`);
  }
  if (tideUnavailable) footnoteParts.push('Tide is not available for this forecast window.');
  if (footnoteParts.length) {
    setFont(doc, TEXT_MD, 5.5, 'italic');
    doc.text(footnoteParts.join(' '), tableX, tableBottomY + 4, { maxWidth: tableW });
  }

  // ── Right column: wind/wave profile, tide profile, thresholds/provenance ──
  const rcX = 144;
  const rcW = W - 8 - rcX;

  const timedSamples = samples.filter(s => Number.isFinite(new Date(s.eta).getTime()));
  const t0 = timedSamples.length ? new Date(timedSamples[0].eta).getTime() : null;
  const t1 = timedSamples.length ? new Date(timedSamples[timedSamples.length - 1].eta).getTime() : null;

  setFont(doc, TEXT_DK, 8, 'bold');
  doc.text('Wind & wave profile', rcX, 24);
  drawRouteWindWaveChart(doc, rcX, 28, rcW, 32, timedSamples, vesselType, t0, t1);

  setFont(doc, TEXT_DK, 8, 'bold');
  doc.text('Tide voyage profile', rcX, 70);
  drawRouteTideChart(doc, rcX, 74, rcW, 28, routeSeaLevelSteps, t0, t1);
  // drawRouteTideChart's own start/end axis labels sit at y+h+4 = 106 —
  // this caption must clear that line, not sit on top of it.
  setFont(doc, TEXT_MD, 5.2, 'italic');
  doc.text(
    fitTextToWidth(doc, 'Tide is shown as voyage context — it does not currently change the wind/wave suitability class above.', rcW),
    rcX, 112,
  );

  setFont(doc, TEXT_DK, 7.5, 'bold');
  doc.text('Thresholds & provenance', rcX, 120);
  const routeCreated = provenance.generatedAt ? formatUtcTiny(provenance.generatedAt) : '—';
  const samplingIntervalMin = samples.length > 1 && Number.isFinite(summary.duration_hours)
    ? (summary.duration_hours * 60) / (samples.length - 1)
    : null;
  const provenanceLines = [
    `Route created: ${routeCreated}`,
    `Speed assumption: ${formatNumber(route.speedKt ?? result.speed_kt, 1)} kt`,
    `Sampling interval: ${samplingIntervalMin !== null ? `~${formatNumber(samplingIntervalMin, 0)} min` : 'unavailable'}`,
    routeThresholdText(vesselType),
    seaLevelSummary(route.seaLevel) ?? 'Tide/sea-level context unavailable for this window.',
  ];
  setFont(doc, TEXT_DK, 5.8);
  let pvY = 125;
  provenanceLines.forEach((line) => {
    doc.text(fitTextToWidth(doc, line, rcW), rcX, pvY);
    pvY += 5.2;
  });

  setFont(doc, TEXT_DK, 7.5, 'bold');
  doc.text('Confidence breakdown', rcX, pvY + 4);
  const forecastAgeHours = provenance.generatedAt && provenance.modelRunStart
    ? (new Date(provenance.generatedAt).getTime() - new Date(provenance.modelRunStart).getTime()) / 3_600_000
    : null;
  const confidenceLines = [
    `Model coverage: ${routeExposure.available}/${routeExposure.total} samples available (${unavailableCount} unavailable)`,
    `Forecast age: ${forecastAgeHours !== null ? `~${formatNumber(forecastAgeHours, 1)} h since model run start` : 'unavailable'}`,
    `Route sampling resolution: ${samplingIntervalMin !== null ? `~${formatNumber(samplingIntervalMin, 0)} min between samples` : 'unavailable'}`,
    'Forecast uncertainty grows at longer lead times (>48 h) — no numeric model-uncertainty estimate is currently available.',
  ];
  setFont(doc, TEXT_DK, 5.8);
  let cbY = pvY + 9;
  confidenceLines.forEach((line) => {
    doc.text(fitTextToWidth(doc, line, rcW), rcX, cbY);
    cbY += 5.2;
  });

  setFont(doc, TEXT_MD, 5.5, 'italic');
  doc.text(
    fitTextToWidth(doc, `Route forecast guidance samples model conditions along the supplied route and estimated travel time. ${ROUTE_ADVISORY_DISCLAIMER_TAIL}`, W - 20),
    W / 2,
    H - 4,
    { align: 'center' },
  );
}

// Wind + wave dual-scale line chart for Page 2 — wind (kt, ~0-40) and wave
// (m, ~0-4) share almost nothing in magnitude, so each gets its own Y scale
// (wind labeled top-left, wave top-right) rather than being squashed onto
// one axis. Dashed reference lines mark the vessel's Caution/Avoid
// thresholds for both metrics.
function drawRouteWindWaveChart(doc, x, y, w, h, timedSamples, vesselType, t0, t1) {
  setDraw(doc, GRID_CLR);
  doc.setLineWidth(0.25);
  doc.rect(x, y, w, h, 'S');
  if (timedSamples.length < 2 || !Number.isFinite(t0) || !Number.isFinite(t1) || t0 === t1) {
    drawFailurePanel(doc, x, y, w, h, 'Profile unavailable', 'Not enough timed samples to chart.');
    return;
  }
  const tRange = t1 - t0;
  const rule = VESSEL_THRESHOLDS[vesselType];
  const windVals = timedSamples.map(s => Number(s.wind_speed_kt)).filter(Number.isFinite);
  const waveVals = timedSamples.map(s => Number(s.wave_height_m)).filter(Number.isFinite);
  const windMax = Math.max(rule?.maxWindKt ?? 0, ...windVals, 1) * 1.15;
  const waveMax = Math.max(rule?.maxWaveHeightM ?? 0, ...waveVals, 1) * 1.15;
  const xAt = (ms) => x + ((ms - t0) / tRange) * w;
  const windY = (v) => y + h * (1 - v / windMax);
  const waveY = (v) => y + h * (1 - v / waveMax);

  // Wind thresholds: short dashes. Wave thresholds: dotted — same
  // Caution/Avoid colors, but each metric's pair needs to read as visually
  // distinct from the other's since they sit on two independent scales.
  if (rule) {
    doc.setLineWidth(0.2);
    setDraw(doc, hazardColor(1));
    doc.setLineDashPattern([1, 1], 0);
    doc.line(x, windY(rule.cautionWindKt), x + w, windY(rule.cautionWindKt));
    setDraw(doc, hazardColor(2));
    doc.line(x, windY(rule.maxWindKt), x + w, windY(rule.maxWindKt));
    setDraw(doc, hazardColor(1));
    doc.setLineDashPattern([0.4, 0.6], 0);
    doc.line(x, waveY(rule.cautionWaveHeightM), x + w, waveY(rule.cautionWaveHeightM));
    setDraw(doc, hazardColor(2));
    doc.line(x, waveY(rule.maxWaveHeightM), x + w, waveY(rule.maxWaveHeightM));
    doc.setLineDashPattern([], 0);
  }

  const windXs = [];
  const windYs = [];
  const waveXs = [];
  const waveYs = [];
  timedSamples.forEach((s) => {
    const ms = new Date(s.eta).getTime();
    if (Number.isFinite(s.wind_speed_kt)) { windXs.push(xAt(ms)); windYs.push(windY(s.wind_speed_kt)); }
    if (Number.isFinite(s.wave_height_m)) { waveXs.push(xAt(ms)); waveYs.push(waveY(s.wave_height_m)); }
  });
  if (windXs.length >= 2) strokePolyline(doc, windXs, windYs, [37, 99, 166], 0.5);
  if (waveXs.length >= 2) strokePolyline(doc, waveXs, waveYs, [8, 145, 178], 0.5);

  setFont(doc, [37, 99, 166], 5, 'bold');
  doc.text('Wind (kt)', x + 2, y + 4);
  setFont(doc, [8, 145, 178], 5, 'bold');
  doc.text('Wave (m)', x + w - 2, y + 4, { align: 'right' });
  setFont(doc, TEXT_MD, 5);
  doc.text(formatUtcTiny(timedSamples[0].eta), x, y + h + 4);
  doc.text(formatUtcTiny(timedSamples[timedSamples.length - 1].eta), x + w, y + h + 4, { align: 'right' });
}

// Astronomical tide + total sea level over the same time axis as the
// wind/wave chart above, with high/low tide time labels — the tide is
// intentionally NOT hazard-classified (see the caption in
// drawRouteAdvisoryPage2): it's voyage context, not a suitability input.
function drawRouteTideChart(doc, x, y, w, h, routeSeaLevelSteps, t0, t1) {
  setDraw(doc, GRID_CLR);
  doc.setLineWidth(0.25);
  doc.rect(x, y, w, h, 'S');
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t0 === t1 || !routeSeaLevelSteps.length) {
    drawFailurePanel(doc, x, y, w, h, 'Tide unavailable', 'No sea-level data for this forecast window.');
    return;
  }
  const padMs = 3 * 3_600_000;
  const steps = routeSeaLevelSteps
    .map(step => ({ step, ms: new Date(step?.valid_time_utc ?? step?.valid_time ?? step?.time ?? step?.time_utc).getTime() }))
    .filter(({ ms }) => Number.isFinite(ms) && ms >= t0 - padMs && ms <= t1 + padMs)
    .sort((a, b) => a.ms - b.ms);
  const tides = steps.map(({ step }) => seaLevelHeightM(step)).filter(Number.isFinite);
  const totals = steps.map(({ step }) => Number(step?.total_sea_level_m)).filter(Number.isFinite);
  if (steps.length < 2 || !tides.length) {
    drawFailurePanel(doc, x, y, w, h, 'Tide unavailable', 'No sea-level data for this forecast window.');
    return;
  }
  const allVals = [...tides, ...totals];
  const vMin = Math.min(...allVals, 0);
  const vMax = Math.max(...allVals, 0);
  const vPad = Math.max((vMax - vMin) * 0.15, 0.1);
  const loY = vMin - vPad;
  const hiY = vMax + vPad;
  const tRange = t1 - t0;
  const xAt = (ms) => x + ((ms - t0) / tRange) * w;
  const yAt = (v) => y + h * (1 - (v - loY) / (hiY - loY));

  setDraw(doc, GRID_CLR);
  doc.setLineWidth(0.15);
  doc.setLineDashPattern([0.5, 0.5], 0);
  doc.line(x, yAt(0), x + w, yAt(0));
  doc.setLineDashPattern([], 0);
  setFont(doc, TEXT_MD, 4.5);
  doc.text('0 m', x + 1, yAt(0) - 1);

  const tideXs = steps.map(({ ms }) => xAt(ms));
  const tideYs = steps.map(({ step }) => yAt(seaLevelHeightM(step) ?? 0));
  strokePolyline(doc, tideXs, tideYs, [8, 145, 178], 0.5);
  if (totals.length >= 2) {
    const totalXs = [];
    const totalYs = [];
    steps.forEach(({ step, ms }) => {
      const v = Number(step?.total_sea_level_m);
      if (Number.isFinite(v)) { totalXs.push(xAt(ms)); totalYs.push(yAt(v)); }
    });
    if (totalXs.length >= 2) strokePolyline(doc, totalXs, totalYs, [148, 163, 184], 0.4);
  }

  // High/low tide markers within the voyage window itself (not the padded
  // fetch window), so a departure/arrival right at a turning tide is called
  // out even if the true extremum sits just outside the voyage. Label
  // alignment flips near either edge (left-align/right-align instead of
  // center) and the high label's Y is floored below the top-corner legend —
  // a center-aligned label at the very edge would otherwise run past the
  // chart or sit directly on top of the "Tide (m)" / "Total sea level (m)"
  // legend text.
  const voyageSteps = steps.filter(({ ms }) => ms >= t0 && ms <= t1);
  if (voyageSteps.length) {
    const high = voyageSteps.reduce((best, s) => ((seaLevelHeightM(s.step) ?? -Infinity) > (seaLevelHeightM(best.step) ?? -Infinity) ? s : best));
    const low = voyageSteps.reduce((best, s) => ((seaLevelHeightM(s.step) ?? Infinity) < (seaLevelHeightM(best.step) ?? Infinity) ? s : best));
    const edgeAlign = (labelX) => (labelX < x + w * 0.18 ? 'left' : labelX > x + w * 0.82 ? 'right' : 'center');
    setFont(doc, TEXT_DK, 4.5, 'bold');
    const highX = xAt(high.ms);
    const highAlign = edgeAlign(highX);
    doc.text(
      `H ${formatUtcTiny(high.step.valid_time_utc ?? high.step.valid_time)}`,
      highAlign === 'left' ? highX + 1 : highAlign === 'right' ? highX - 1 : highX,
      Math.max(yAt(seaLevelHeightM(high.step)) - 1.5, y + 8),
      { align: highAlign },
    );
    const lowX = xAt(low.ms);
    const lowAlign = edgeAlign(lowX);
    doc.text(
      `L ${formatUtcTiny(low.step.valid_time_utc ?? low.step.valid_time)}`,
      lowAlign === 'left' ? lowX + 1 : lowAlign === 'right' ? lowX - 1 : lowX,
      Math.min(yAt(seaLevelHeightM(low.step)) + 4, y + h - 2),
      { align: lowAlign },
    );
  }

  setFont(doc, [8, 145, 178], 5, 'bold');
  doc.text('Tide (m)', x + 2, y + 4);
  setFont(doc, [148, 163, 184], 5, 'bold');
  doc.text('Total sea level (m)', x + w - 2, y + 4, { align: 'right' });
  setFont(doc, TEXT_MD, 5);
  doc.text(formatUtcTiny(new Date(t0).toISOString()), x, y + h + 4);
  doc.text(formatUtcTiny(new Date(t1).toISOString()), x + w, y + h + 4, { align: 'right' });
}

// ── Scenario comparison advisory brief ─────────────────────────────────────
// One page: recommended scenario highlighted, compact comparison table for
// every scenario, provenance + limitations. Expects advisoryConfig built by
// scenarioService.js's buildScenarioComparisonBriefConfig — each scenario
// already carries its derived `decision` (see deriveRouteDecision there).
async function exportScenarioComparisonPDF({ advisoryConfig, onProgress }) {
  const { jsPDF } = await import('jspdf');
  const progress = onProgress ?? (() => {});
  const comparison = advisoryConfig?.scenarioComparison ?? {};
  const scenarios = Array.isArray(comparison.scenarios) ? comparison.scenarios : [];
  const recommended = scenarios.find(s => s.id === comparison.recommendedId) ?? null;

  progress('Building scenario comparison brief...');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  setPdfMetadata(doc, {
    title: 'Niue Scenario Comparison Advisory Brief',
    subject: `Route scenario comparison — ${scenarios.length} scenario${scenarios.length === 1 ? '' : 's'}`,
  });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  rect(doc, 0, 0, W, H, PAGE_BG);

  drawHeaderBand(doc, {
    title: 'SCENARIO COMPARISON ADVISORY BRIEF',
    subtitle: `${scenarios.length} scenario${scenarios.length === 1 ? '' : 's'} compared`,
    rightLine1: `Generated: ${comparison.generatedAt ? formatUtcTiny(comparison.generatedAt) : '—'}`,
    rightLine2: 'SWAN',
  });

  // Recommended-scenario highlight.
  const RECO_Y = 24;
  const RECO_H = 30;
  const recoHaz = recommended?.decision?.worstHazardClass;
  const recoAvailable = recoHaz !== null && recoHaz !== undefined;
  const recoColor = recoAvailable ? hazardColor(recoHaz) : NO_DATA_GREY;
  setFill(doc, [255, 255, 255]);
  setDraw(doc, recoColor);
  doc.setLineWidth(0.6);
  doc.roundedRect(8, RECO_Y, W - 16, RECO_H, 2, 2, 'FD');
  setFill(doc, recoColor);
  doc.rect(8, RECO_Y + 1, 3.5, RECO_H - 2, 'F');
  setFont(doc, TEXT_MD, 7, 'bold');
  doc.text('RECOMMENDED SCENARIO', 16, RECO_Y + 8);
  setFont(doc, recoAvailable ? hazardText(recoHaz) : TEXT_MD, 11, 'bold');
  doc.text(
    fitTextToWidth(
      doc,
      recommended
        ? `${recommended.name} — ${recommended.vesselLabel ?? recommended.vessel} — ${recoAvailable ? hazardLabel(recoHaz) : 'Unavailable'}`
        : 'No scenario has a usable result yet.',
      W - 32,
    ),
    16, RECO_Y + 16,
  );
  setFont(doc, TEXT_DK, 6.2);
  doc.text(scenarioRecommendationReason(recommended, scenarios), 16, RECO_Y + 24, { maxWidth: W - 28 });

  // Compact comparison table.
  const tableY = 62;
  const headers = ['Scenario', 'Vessel', 'Worst', 'Caution+Avoid', 'Unavail.', 'Duration', 'Driver'];
  const widths = [46, 56, 30, 34, 26, 30, 40];
  let x = 8;
  setFill(doc, HEADER_BG);
  doc.rect(8, tableY, W - 16, 9, 'F');
  setFont(doc, TEXT_LT, 6.5, 'bold');
  headers.forEach((header, i) => {
    doc.text(header, x + 2, tableY + 6);
    x += widths[i];
  });

  scenarios.forEach((scenario, rowIndex) => {
    const y = tableY + 9 + rowIndex * 8;
    x = 8;
    if (rowIndex % 2 === 0) rect(doc, 8, y, W - 16, 8, [248, 250, 252]);
    const d = scenario.decision;
    const isRecommended = scenario.id === comparison.recommendedId;
    const worstAvailable = d && d.worstHazardClass !== null && d.worstHazardClass !== undefined;
    const rowColor = worstAvailable ? hazardColor(d.worstHazardClass) : NO_DATA_GREY;
    const vals = [
      `${scenario.name}${isRecommended ? ' (Recommended)' : ''}`,
      scenario.vesselLabel ?? scenario.vessel ?? '—',
      scenario.status !== 'ready' ? (scenario.status === 'error' ? 'Error' : 'Not run') : (worstAvailable ? hazardLabel(d.worstHazardClass) : 'Unavailable'),
      d ? `${formatNumber((d.cautionPercent ?? 0) + (d.warningPercent ?? 0), 0)}%` : '—',
      d ? String(d.unavailableSamples ?? 0) : '—',
      d ? `${formatNumber(d.durationHours, 1)} h` : '—',
      d?.primaryDriver ? (DRIVER_LABELS[d.primaryDriver] ?? '—') : '—',
    ];
    vals.forEach((value, i) => {
      setFont(doc, i === 2 && scenario.status === 'ready' ? rowColor : TEXT_DK, 6.5, isRecommended ? 'bold' : 'normal');
      doc.text(String(value ?? '-'), x + 2, y + 5.5, { maxWidth: widths[i] - 3 });
      x += widths[i];
    });
  });

  setDraw(doc, GRID_CLR);
  doc.setLineWidth(0.2);
  doc.rect(8, tableY, W - 16, 9 + scenarios.length * 8, 'S');

  const footerY = tableY + 9 + scenarios.length * 8 + 10;
  setFont(doc, TEXT_MD, 6, 'bold');
  doc.text('Ranking: lowest worst hazard, then least caution+avoid exposure, then fewest unavailable samples, then shortest duration.', 8, footerY);

  const cardsY = footerY + 8;
  const cardGap = 4;
  const cardW = (W - 16 - cardGap * 3) / 4;
  setFont(doc, TEXT_DK, 8, 'bold');
  doc.text('Scenario detail', 8, cardsY - 3);
  scenarios.slice(0, 4).forEach((scenario, index) => {
    const x0 = 8 + index * (cardW + cardGap);
    const d = scenario.decision;
    const ready = scenario.status === 'ready' && d;
    const haz = ready && d.worstHazardClass !== null && d.worstHazardClass !== undefined ? d.worstHazardClass : null;
    const color = haz !== null ? hazardColor(haz) : NO_DATA_GREY;
    setFill(doc, [255, 255, 255]);
    setDraw(doc, color);
    doc.setLineWidth(scenario.id === comparison.recommendedId ? 0.65 : 0.3);
    doc.roundedRect(x0, cardsY, cardW, 42, 2, 2, 'FD');
    setFill(doc, color);
    doc.rect(x0, cardsY + 1, 2.5, 40, 'F');

    setFont(doc, TEXT_DK, 6.8, 'bold');
    doc.text(`${scenario.name}${scenario.id === comparison.recommendedId ? ' · recommended' : ''}`, x0 + 5, cardsY + 7, { maxWidth: cardW - 8 });
    setFont(doc, haz !== null ? hazardText(haz) : TEXT_MD, 8, 'bold');
    const statusLabel = scenario.status === 'error'
      ? 'Error'
      : ready
        ? hazardLabel(haz)
        : 'Not run';
    doc.text(statusLabel, x0 + 5, cardsY + 15, { maxWidth: cardW - 8 });
    drawScenarioMiniTimeline(doc, x0 + 5, cardsY + 19, cardW - 10, 5, scenario);
    setFont(doc, TEXT_MD, 5.2);
    const exposure = ready ? `${formatNumber((d.cautionPercent ?? 0) + (d.warningPercent ?? 0), 0)}% exposure` : (scenario.error ?? 'No result available');
    const driver = ready && d.primaryDriver ? `${DRIVER_LABELS[d.primaryDriver] ?? 'Unknown'} driver` : 'Driver unavailable';
    doc.text(`${scenario.vesselLabel ?? scenario.vessel ?? 'Vessel'} · ${exposure}`, x0 + 5, cardsY + 30, { maxWidth: cardW - 8 });
    // Compact "(available/total)" form, not the fuller phrasing used in the
    // "Why" text above — this card is only 42mm tall with several other
    // lines already competing for room.
    const confidenceCoverage = ready && d.totalSamples ? ` (${d.totalSamples - (d.unavailableSamples ?? 0)}/${d.totalSamples})` : '';
    doc.text(`${driver} · confidence ${ready ? (d.confidenceLabel ?? 'unknown') : 'unknown'}${confidenceCoverage}`, x0 + 5, cardsY + 36, { maxWidth: cardW - 8 });
  });

  if (scenarios.length > 4) {
    setFont(doc, TEXT_MD, 5.5, 'italic');
    doc.text(`Showing first 4 of ${scenarios.length} scenarios in detail. The table above includes all scenarios.`, 8, cardsY + 49);
  }

  setFont(doc, TEXT_MD, 5.5, 'italic');
  doc.text(
    fitTextToWidth(doc, `Each scenario is scored independently against the current forecast. ${ROUTE_ADVISORY_DISCLAIMER_TAIL}`, W - 20),
    W / 2,
    H - 4,
    { align: 'center' },
  );

  const filename = `niue_scenario_comparison_brief_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
  progress('Done');
  return filename;
}

export function formatNumber(value, digits = 1) {
  // null/undefined must short-circuit before Number() — Number(null) is 0,
  // which is finite, so checking Number.isFinite(Number(value)) alone turned
  // an explicit "this reading is missing" into a fabricated 0 (same masking
  // bug this file's seaLevelHeightM was fixed for earlier).
  if (value === null || value === undefined) return '-';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '-';
}

// ── Landing-area advisory PDF ──────────────────────────────────────────────────
// A landing-area report: 500 m area hazard-over-time when the backend exposes
// area aggregates, with an explicit nearest-pixel fallback for older
// deployments. Reuses the same fetch/draw helpers as the whole-domain export
// above, but the outlook strip and map overlay are genuinely different (see
// drawPointOutlookStrip, projectLonLatToRect).

// Projects a lon/lat onto a jsPDF rect (x,y,w,h) drawn for the given bbox —
// equirectangular, consistent with geoBbox.js's bboxFromPointRadius/bboxAspectRatio.
function projectLonLatToRect(lon, lat, bbox, rectX, rectY, rectW, rectH) {
  const px = rectX + ((lon - bbox.lonMin) / (bbox.lonMax - bbox.lonMin)) * rectW;
  const py = rectY + (1 - (lat - bbox.latMin) / (bbox.latMax - bbox.latMin)) * rectH;
  return [px, py];
}

// Categorical sibling of drawOutlookStrip: one hazard_class per timestep, so
// solid single-colour blocks rather than stacked suitable/caution/avoid bars.
function drawPointOutlookStrip(doc, x, y, w, h, steps = []) {
  const n = steps.length;
  if (n === 0) {
    rect(doc, x, y, w, h, [235, 236, 238]);
    setDraw(doc, GRID_CLR);
    doc.setLineWidth(0.15);
    doc.rect(x, y, w, h, 'S');
    setFont(doc, [140, 140, 145], 4.2, 'italic');
    doc.text('No data', x + w / 2, y + h / 2 + 1, { align: 'center' });
    return;
  }

  rect(doc, x, y, w, h, [22, 27, 34]);
  const barW = w / n;
  steps.forEach((step, idx) => {
    // hazardColor(undefined) silently falls back to Suitable's green — an
    // out-of-domain timestep would paint as "all clear" instead of grey.
    setFill(doc, Number.isFinite(step.hazard_class) ? hazardColor(step.hazard_class) : NO_DATA_GREY);
    doc.rect(x + idx * barW, y, Math.max(0.15, barW), h, 'F');
  });
  setDraw(doc, GRID_CLR);
  doc.setLineWidth(0.15);
  doc.rect(x, y, w, h, 'S');
}

function normalisePointSteps(rawSteps = []) {
  return rawSteps.map((step, index) => ({
    ...step,
    time_index: step.time_index ?? index,
    time: step.valid_time ?? step.time,
    hazard_class: Number.isFinite(step.hazard_class) ? step.hazard_class : (
      Number.isFinite(step.dominant_hazard_class) ? step.dominant_hazard_class : step.hazard_class
    ),
    wind_speed_kt: step.wind_speed_kt ?? step.max_wind_speed_kt ?? step.max_wind_kt,
    wave_height_m: step.wave_height_m ?? step.max_wave_height_m ?? step.max_wave_m,
    suitable_percent: step.suitable_percent ?? step.suitablePercent,
    caution_percent: step.caution_percent ?? step.cautionPercent,
    avoid_percent: step.avoid_percent ?? step.warning_percent ?? step.avoidPercent,
    sample_count: step.sample_count ?? step.face_count ?? step.total_points ?? step.area_sample_count,
    face_count: step.face_count,
    used_nearest_face_fallback: step.used_nearest_face_fallback,
    unavailable_count: step.unavailable_count ?? step.unavailableCount,
  }));
}

function isSameLandingPoint(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  return Math.abs((a.lon ?? 0) - (b.lon ?? 99)) < 0.0001
    && Math.abs((a.lat ?? 0) - (b.lat ?? 99)) < 0.0001;
}

function landingAreaRowSummary(row) {
  const stats = landingAreaStats(row);
  const currentLabel = stats.currentHazard === null ? 'Unavailable' : hazardLabel(stats.currentHazard);
  const peakLabel = stats.peakHazard === null ? 'Unavailable' : hazardLabel(stats.peakHazard);
  return {
    hazard: stats.currentHazard,
    primary: `${currentLabel} now · ${formatNumber(stats.suitablePercent, 0)}% suitable`,
    secondary: stats.bestWindow
      ? `Best ${formatUtcTiny(stats.bestWindow.startTime).replace(' UTC', 'Z')} · ${stats.avoidCount} Avoid`
      : `Peak ${peakLabel} · ${stats.avoidCount} Avoid`,
  };
}

function landingAreaStats(row) {
  const steps = row?.steps ?? [];
  // null (not 0) for an out-of-domain/unavailable sample — folding it into
  // hazard 0 counted every unscored timestep as "Suitable," inflating
  // suitablePercent and letting a site with mostly missing data still win
  // "Best now" in drawLandingAreaOverviewCards. Percentages below are of
  // *scored* samples only, with unavailableCount reported separately.
  const hazards = steps.map(s => Number.isFinite(s.hazard_class) ? Number(s.hazard_class) : null);
  const scoredHazards = hazards.filter(h => h !== null);
  const currentHazard = hazards.length ? hazards[0] : null;
  const peakHazard = scoredHazards.length ? Math.max(...scoredHazards) : null;
  const suitableCount = scoredHazards.filter(h => h === 0).length;
  const cautionCount = scoredHazards.filter(h => h === 1).length;
  const avoidCount = scoredHazards.filter(h => h >= 2).length;
  const unavailableCount = hazards.length - scoredHazards.length;
  const bestWindow = summarizeBestHazardWindow(steps);
  const firstAvoid = steps.find(s => Number(s?.hazard_class) >= 2);
  const sampleCounts = steps
    .map(s => Number(s?.sample_count))
    .filter(Number.isFinite);
  const meanSampleCount = sampleCounts.length
    ? sampleCounts.reduce((sum, value) => sum + value, 0) / sampleCounts.length
    : null;
  return {
    label: row?.label ?? 'Landing area',
    currentHazard,
    peakHazard,
    total: steps.length,
    suitableCount,
    cautionCount,
    avoidCount,
    unavailableCount,
    suitablePercent: scoredHazards.length ? (suitableCount / scoredHazards.length) * 100 : 0,
    cautionPercent: scoredHazards.length ? (cautionCount / scoredHazards.length) * 100 : 0,
    avoidPercent: scoredHazards.length ? (avoidCount / scoredHazards.length) * 100 : 0,
    bestWindow,
    firstAvoidTime: firstAvoid?.valid_time ?? firstAvoid?.time ?? null,
    meanSampleCount,
    statisticsBasis: row?.statistics_basis ?? row?.statisticsBasis ?? null,
  };
}

function drawLandingAreaOverviewCards(doc, { x, y, w, rows = [], selectedLabel = null }) {
  const stats = rows.map(landingAreaStats);
  const withData = stats.filter(s => s.total > 0);
  // currentHazard === null means every sample for that site was unavailable
  // (see landingAreaStats) — such a site must never win "Best now," which
  // is why it's filtered out before the comparison, not compared with `<`
  // against a possibly-null candidate.
  const bestNow = withData.filter(s => s.currentHazard !== null).reduce((best, s) => (
    !best
      || s.currentHazard < best.currentHazard
      || (s.currentHazard === best.currentHazard && s.suitablePercent > best.suitablePercent)
      ? s
      : best
  ), null);
  const leastAvoid = withData.reduce((best, s) => (
    !best
      || s.avoidCount < best.avoidCount
      || (s.avoidCount === best.avoidCount && s.suitablePercent > best.suitablePercent)
      ? s
      : best
  ), null);
  const avoidSites = withData.filter(s => s.avoidCount > 0).length;
  const selectedStats = selectedLabel ? withData.find(s => s.label === selectedLabel) : null;
  const selectedHazardAvailable = selectedStats && selectedStats.currentHazard !== null;
  const cards = [
    {
      label: 'Best now',
      value: bestNow ? `${bestNow.label} · ${hazardLabel(bestNow.currentHazard)}` : 'Unavailable',
      color: bestNow ? hazardColor(bestNow.currentHazard) : NO_DATA_GREY,
      note: bestNow ? `${formatNumber(bestNow.suitablePercent, 0)}% Suitable over window` : 'No landing rows returned',
    },
    {
      label: 'Lowest Avoid count',
      value: leastAvoid ? `${leastAvoid.label} · ${leastAvoid.avoidCount} step${leastAvoid.avoidCount === 1 ? '' : 's'}` : 'Unavailable',
      color: leastAvoid && leastAvoid.peakHazard !== null ? hazardColor(leastAvoid.peakHazard) : NO_DATA_GREY,
      note: leastAvoid?.bestWindow ? `Best window starts ${formatUtcTiny(leastAvoid.bestWindow.startTime).replace(' UTC', 'Z')}` : 'No best window available',
    },
    {
      label: selectedStats ? 'Selected area' : 'Landing areas',
      value: selectedStats
        ? `${selectedStats.label} · ${selectedHazardAvailable ? hazardLabel(selectedStats.currentHazard) : 'Unavailable'} now`
        : `${withData.length} assessed · ${avoidSites} with Avoid`,
      color: selectedStats
        ? (selectedHazardAvailable ? hazardColor(selectedStats.currentHazard) : NO_DATA_GREY)
        : (avoidSites ? hazardColor(2) : hazardColor(0)),
      note: selectedStats
        ? `${selectedStats.avoidCount} Avoid, ${formatNumber(selectedStats.suitablePercent, 0)}% Suitable`
        : `${withData.length - avoidSites} area${withData.length - avoidSites === 1 ? '' : 's'} avoid-free in sampled window`,
    },
  ];

  const gap = 4;
  const cardW = (w - gap * 2) / 3;
  cards.forEach((card, i) => {
    const cx = x + i * (cardW + gap);
    setFill(doc, [255, 255, 255]);
    setDraw(doc, card.color);
    doc.setLineWidth(0.45);
    doc.roundedRect(cx, y, cardW, 22, 2, 2, 'FD');
    setFill(doc, card.color);
    doc.rect(cx, y + 1, 3, 20, 'F');
    setFont(doc, TEXT_MD, 5.7, 'bold');
    doc.text(card.label, cx + 6, y + 6);
    setFont(doc, TEXT_DK, 6.8, 'bold');
    doc.text(card.value, cx + 6, y + 13, { maxWidth: cardW - 9 });
    setFont(doc, TEXT_MD, 5.2);
    doc.text(card.note, cx + 6, y + 18.5, { maxWidth: cardW - 9 });
  });
}

function drawLandingAreaHeatmapPage(doc, {
  landingAreaRows = [], vesselLabel, validTime, runId, windowHours = 168, addPage = true, selectedLabel = null,
}) {
  if (addPage) doc.addPage();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  rect(doc, 0, 0, W, H, PAGE_BG);

  const validStr = validTime ? formatUtcTiny(validTime) : '-';
  const issuedStr = formatRunId(runId);
  drawHeaderBand(doc, {
    title: 'LANDING AREA HEATMAP MATRIX',
    subtitle: `${vesselLabel} suitability by launch area`,
    rightLine1: `Valid: ${validStr}`,
    rightLine2: issuedStr ? `Issued: ${issuedStr}  ·  SWAN` : 'SWAN',
    titleSize: 13,
  });

  const referenceSteps = landingAreaRows.find(row => row.steps?.length)?.steps ?? [];
  const heatmapSteps = selectHeatmapSteps(referenceSteps, windowHours);
  drawLandingAreaOverviewCards(doc, {
    x: 7,
    y: HDR_H + 6,
    w: W - 14,
    rows: landingAreaRows,
    selectedLabel,
  });
  drawHazardHeatmapMatrix(doc, {
    x: 7,
    y: HDR_H + 34,
    w: W - 14,
    rowH: landingAreaRows.length > 4 ? 13 : 16,
    labelW: 54,
    summaryW: 58,
    rows: landingAreaRows,
    heatmapSteps,
    title: 'Landing area x forecast time heatmap',
    // Was a blanket "nearest model grid cell" claim regardless of what each
    // row actually used — individual landing points can be on 500 m area
    // aggregation, a nearest-face fallback, or nearest-pixel (see basisLabel
    // in drawLandingAreaPage), and this page never surfaced which. Naming
    // one specific basis for every row was simply wrong whenever a row used
    // a different one.
    subtitle: 'Each row is one launch area; statistics basis may vary by site (see each site\'s own advisory page). Right column summarizes now, best window, and Avoid count.',
    // Each row's steps are fetched independently per landing point and can
    // have gaps/different lengths than the reference row heatmapSteps was
    // built from — match by time_index/valid_time, not array position, so a
    // column never displays a different row's timestep under the same label.
    cellForRowStep: (row, step) => pointHeatmapCell(findMatchingStep(row.steps, step) ?? {}),
    summaryForRow: landingAreaRowSummary,
  });

  drawSharedLegend(doc, W / 2, H - 10, { includeUnavailable: true });
  setFont(doc, TEXT_MD, 5.5, 'italic');
  // Same fix as the subtitle above — this used to claim "nearest-pixel"
  // unconditionally regardless of whether any row actually used 500 m area
  // aggregation or a nearest-face fallback instead.
  doc.text(
    'Landing-area guidance — statistics basis varies by site. Use alongside official warnings.',
    W / 2, H - 3, { align: 'center' }
  );
}

function drawLandingAreaPage(doc, {
  mapDataUrl, bbox, point, steps, currentStep, vessel, vesselLabel, vesselIcon, flagIcon,
  validTime, runId, advisoryConfig, seaLevel, statisticsBasis = 'area_500m',
}) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  rect(doc, 0, 0, W, H, PAGE_BG);

  // `?? 0` here used to silently paint a point with no current-step data as
  // green "SUITABLE" — the same masking bug fixed elsewhere in this file
  // (routeForecastService.js's toNumber, RouteForecastPanel's hazardAvailable
  // guard). hazardColor(h)/hazardLabel(h) themselves don't agree on how to
  // handle a missing class (hazardColor silently falls back to Suitable's
  // color; hazardLabel correctly says "Unknown"), so this page can't just
  // pass haz=null through to them — it needs its own explicit available/
  // color/label trio, used at every badge/card/strip site below instead of
  // calling hazardColor(haz)/hazardLabel(haz) directly.
  const hazardAvailable = Number.isFinite(currentStep?.hazard_class);
  const haz = hazardAvailable ? currentStep.hazard_class : null;
  const hazDisplayColor = hazardAvailable ? hazardColor(haz) : NO_DATA_GREY;
  const hazDisplayLabel = hazardAvailable ? hazardLabel(haz).toUpperCase() : 'UNAVAILABLE';
  const isAreaBasis = statisticsBasis === 'area_500m';
  const isNearestFaceFallback = statisticsBasis === 'nearest_face_area_fallback';
  const basisLabel = isAreaBasis ? '500 m area' : isNearestFaceFallback ? 'nearest valid model face' : 'nearest model grid cell';
  const sampleCount = currentStep?.sample_count ?? currentStep?.face_count ?? currentStep?.total_points ?? currentStep?.area_sample_count;

  // ── Header ────────────────────────────────────────────────────────────────
  const validStr = validTime ? formatUtcTiny(validTime) : '—';
  const issuedStr = formatRunId(runId);
  drawHeaderBand(doc, {
    title: 'LANDING AREA ADVISORY',
    subtitle: advisoryConfig?.area?.label ?? 'Landing area',
    rightLine1: `Valid: ${validStr}`,
    rightLine2: issuedStr ? `Issued: ${issuedStr}  ·  SWAN` : 'SWAN',
    titleSize: 13,
    topFrac: 0.4,
    bottomFrac: 0.75,
  });

  const badgeW = 60, badgeX = W / 2 - badgeW / 2;
  setFill(doc, hazDisplayColor);
  doc.roundedRect(badgeX, 1.5, badgeW, HDR_H - 3, 1.5, 1.5, 'F');
  setFont(doc, [255, 255, 255], 8, 'bold');
  doc.text(fitTextToWidth(doc, `${vesselLabel.toUpperCase()} — ${hazDisplayLabel}`, badgeW - 6), W / 2, HDR_H * 0.68, { align: 'center' });

  // ── Layout ────────────────────────────────────────────────────────────────
  const MAP_Y     = HDR_H + 3;
  const MAP_W     = W * 0.62;
  const STRIP_H    = 16;
  const STRIP_Y    = H - STRIP_H - 12;
  const SEA_LEVEL_STRIP_H = 12.5;
  const IMG_H      = STRIP_Y - SEA_LEVEL_STRIP_H - MAP_Y - 8;
  const SEA_LEVEL_Y = MAP_Y + IMG_H + 6.5;
  const CARD_X0    = MAP_W + 4;
  const CARD_W     = W - CARD_X0 - 3;

  // ── Map + flag/circle overlay ─────────────────────────────────────────────
  if (mapDataUrl) {
    setDraw(doc, [200, 200, 200]);
    doc.setLineWidth(0.5);
    doc.rect(2.5, MAP_Y - 0.5, MAP_W - 3, IMG_H + 1, 'S');
    const mapFormat = mapDataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
    doc.addImage(mapDataUrl, mapFormat, 3, MAP_Y, MAP_W - 4, IMG_H, 'landing_map', 'FAST');

    const mapRectX = 3, mapRectY = MAP_Y, mapRectW = MAP_W - 4, mapRectH = IMG_H;
    const [rawCx, rawCy] = projectLonLatToRect(point.lon, point.lat, bbox, mapRectX, mapRectY, mapRectW, mapRectH);
    // Radius in mm: project a point one radiusKm due east of centre, take the pixel delta.
    const radiusKm = point.radiusKm ?? 0.5;
    const kmPerDegLon = 111.32 * Math.cos((point.lat * Math.PI) / 180);
    const eastLon = point.lon + radiusKm / kmPerDegLon;
    const [ex] = projectLonLatToRect(eastLon, point.lat, bbox, mapRectX, mapRectY, mapRectW, mapRectH);
    const radiusMm = Math.abs(ex - rawCx);

    const flagW = 8, flagH = 8;
    // A landing point near the domain boundary can project outside the map
    // rect entirely — clamp so the flag/circle overlay always stays fully
    // inside the map image, not drawn over the status card, caption, or
    // legend next to/below it.
    const cx = Math.max(mapRectX + radiusMm, Math.min(mapRectX + mapRectW - radiusMm, rawCx));
    const cy = Math.max(mapRectY + radiusMm + flagH, Math.min(mapRectY + mapRectH - radiusMm, rawCy));

    setDraw(doc, [255, 255, 255]);
    doc.setLineWidth(0.8);
    doc.circle(cx, cy, radiusMm, 'S');
    setDraw(doc, [225, 29, 72]);
    doc.setLineWidth(0.4);
    doc.circle(cx, cy, radiusMm, 'S');

    if (flagIcon) {
      doc.addImage(flagIcon, 'PNG', cx - flagW / 2, cy - flagH, flagW, flagH, 'landing_flag', 'FAST');
    }
  } else {
    drawFailurePanel(doc, 3, MAP_Y, MAP_W - 4, IMG_H, 'Map data unavailable', 'Landing area map could not be loaded');
  }
  setFont(doc, TEXT_MD, 6, 'italic');
  doc.text(`500 m boundary shown  ·  ${basisLabel}  ·  ${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`, 5, MAP_Y + IMG_H + 3);
  drawSharedLegend(doc, MAP_W / 2, MAP_Y + IMG_H + 4.5);

  drawSeaLevelStrip(doc, {
    x: 5,
    y: SEA_LEVEL_Y,
    w: W - 10,
    chartX: 48,
    chartW: W - 96,
    seaLevelData: seaLevel,
    t0: steps[0]?.valid_time ?? steps[0]?.time,
    t1: steps[steps.length - 1]?.valid_time ?? steps[steps.length - 1]?.time,
    // Compact variant: this landing-area page has less vertical budget below
    // the map/card row than the dedicated large water-level chart on Page 3.
    chartH: 5.5,
  });

  // ── Status card (right column) ────────────────────────────────────────────
  setFill(doc, [255, 255, 255]);
  setDraw(doc, hazDisplayColor);
  doc.setLineWidth(0.6);
  doc.roundedRect(CARD_X0, MAP_Y, CARD_W, IMG_H, 2, 2, 'FD');
  setFill(doc, hazDisplayColor);
  doc.rect(CARD_X0, MAP_Y + 1, 3.5, IMG_H - 2, 'F');

  let cardTextY = MAP_Y + 10;
  if (vesselIcon) {
    doc.addImage(vesselIcon, 'PNG', CARD_X0 + 6, MAP_Y + 4, 16, 5.3, 'landing_vessel_icon', 'FAST');
    cardTextY = MAP_Y + 16;
  } else {
    drawVesselFallbackIcon(doc, CARD_X0 + 6, MAP_Y + 4, VESSEL_BY_CODE[vessel], 6);
    cardTextY = MAP_Y + 16;
  }

  setFont(doc, hazDisplayColor, 11, 'bold');
  doc.text(hazDisplayLabel, CARD_X0 + 6, cardTextY);
  setFont(doc, TEXT_MD, 8);
  doc.text(vesselLabel, CARD_X0 + 6, cardTextY + 6);

  if (currentStep) {
    setFont(doc, TEXT_DK, 7.5);
    // formatNumber (not a raw template literal) — every other numeric
    // display in this file rounds via formatNumber/.toFixed; these two were
    // the one spot that would print an unrounded value like "14.283729 kt"
    // if the backend ever returns a raw float here.
    doc.text(`Wind: ${formatNumber(currentStep.wind_speed_kt, 1)} kt`, CARD_X0 + 6, cardTextY + 14);
    doc.text(`Wave: ${formatNumber(currentStep.wave_height_m, 2)} m`, CARD_X0 + 6, cardTextY + 20);
  }

  const bestWindow = summarizeBestHazardWindow(steps);
  const avoidSummary = summarizeAvoidWindows(steps);
  const seaLevelText = seaLevelSummary(seaLevel);
  const selectedStats = landingAreaStats({ label: advisoryConfig?.area?.label, steps });
  const scoredTimesteps = selectedStats.total - selectedStats.unavailableCount;
  const narrativeLines = [
    // Percentages are of *scored* timesteps (landingAreaStats no longer
    // folds unavailable samples into "Suitable") — say so explicitly when
    // any were unavailable, so the three percentages summing to 100% of a
    // number smaller than the stated total isn't misread as inconsistent.
    `Window mix: ${formatNumber(selectedStats.suitablePercent, 0)}% Suitable, ${formatNumber(selectedStats.cautionPercent, 0)}% Caution, ${formatNumber(selectedStats.avoidPercent, 0)}% Avoid across ${scoredTimesteps} scored timesteps`
      + (selectedStats.unavailableCount > 0 ? ` (${selectedStats.unavailableCount} unavailable).` : '.'),
    bestWindow
      ? `Best window: ${bestWindow.label}, ${formatUtcTiny(bestWindow.startTime)} to ${formatUtcTiny(bestWindow.endTime)}.`
      : 'Best window unavailable for this landing area.',
    avoidSummary,
    seaLevelText ?? 'Sea-level context unavailable for this landing-area window.',
    isAreaBasis
      ? `Area basis: ${sampleCount ? `${sampleCount} model cells sampled inside` : 'model cells aggregated inside'} the 500 m boundary.`
      : isNearestFaceFallback
        ? 'Area endpoint basis: no model faces fell inside the 500 m boundary, so the backend used the nearest valid model face.'
      : 'Fallback basis: nearest model grid cell; 500 m boundary is shown for operational context only.',
    point?.source === 'preset' || advisoryConfig?.area?.source === 'preset' || /unverified|placeholder|⚠/.test(advisoryConfig?.area?.label ?? '')
      ? 'Preset coordinates are placeholders; verify locally before use.'
      : 'Custom point from map click; verify locally before use.',
  ];
  setFont(doc, TEXT_DK, 6.1);
  let narrativeY = cardTextY + 31;
  narrativeLines.forEach((line) => {
    const lines = doc.splitTextToSize(line, CARD_W - 12).slice(0, 2);
    doc.text(lines, CARD_X0 + 6, narrativeY);
    narrativeY += lines.length * 4.2 + 1.5;
  });

  setFont(doc, TEXT_MD, 6, 'italic');
  const noteY = MAP_Y + IMG_H - 8;
  doc.text(isAreaBasis ? '500 m area aggregate —' : 'Nearest model grid cell —', CARD_X0 + 6, noteY, { maxWidth: CARD_W - 10 });
  doc.text(isAreaBasis ? 'not a site observation.' : 'not a 500 m area average.', CARD_X0 + 6, noteY + 4, { maxWidth: CARD_W - 10 });

  // ── Point outlook strip ───────────────────────────────────────────────────
  setFont(doc, TEXT_DK, 7, 'bold');
  doc.text(`${vesselLabel} outlook`, 5, STRIP_Y - 2);
  drawPointOutlookStrip(doc, 5, STRIP_Y, W - 10, STRIP_H, steps);
  if (steps.length > 1) {
    setFont(doc, TEXT_MD, 5.5);
    doc.text(formatUtcTiny(steps[0].valid_time), 5, STRIP_Y + STRIP_H + 3.5);
    doc.text(formatUtcTiny(steps[steps.length - 1].valid_time), W - 5, STRIP_Y + STRIP_H + 3.5, { align: 'right' });
  }
  drawSharedLegend(doc, W / 2, STRIP_Y + STRIP_H + 3.5);

  // y = STRIP_Y + STRIP_H + 3.5 (not +8, which put this only ~1mm above the
  // footer disclaimer below — same y as the outlook strip's date labels
  // instead, which have a clear horizontal gap here: the shared legend ends
  // well before CARD_X0, and this line's ~59mm width ends well before the
  // right-aligned end-date label starts.
  setFont(doc, HEADER_BG, 6.2, 'bold');
  doc.text('Landing-area heatmap matrix follows on the next page.', CARD_X0 + 6, STRIP_Y + STRIP_H + 3.5, { maxWidth: CARD_W - 10 });

  // ── Footer / scope ─────────────────────────────────────────────────────────
  setFont(doc, TEXT_MD, 5.5, 'italic');
  doc.text(
    `Landing-area report — ${isAreaBasis ? '500 m area statistics' : 'nearest-pixel fallback'}, boundary shown. SWAN wave model guidance; use alongside official warnings.`,
    W / 2, H - 3, { align: 'center' }
  );
}

function drawLandingAreaSpaceBoatTimePage(doc, {
  point, steps, currentStep, vesselLabel, validTime, runId, advisoryConfig, statisticsBasis = 'area_500m',
}) {
  doc.addPage();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  rect(doc, 0, 0, W, H, PAGE_BG);
  const isAreaBasis = statisticsBasis === 'area_500m';
  const displayName = advisoryConfig?.area?.label ?? 'Landing area';
  const radiusKm = point?.radiusKm ?? 0.5;
  const isNearestFaceFallback = statisticsBasis === 'nearest_face_area_fallback';
  drawHeaderBand(doc, {
    title: 'LANDING OPERATIONS: SPACE · BOAT · TIME',
    subtitle: displayName,
    rightLine1: `Valid: ${validTime ? formatUtcTiny(validTime) : '—'}`,
    rightLine2: runId ? `Issued: ${formatRunId(runId)}  ·  SWAN` : 'SWAN',
  });

  const stats = landingAreaStats({ label: displayName, steps, statistics_basis: statisticsBasis });
  const sampleCount = currentStep?.sample_count ?? currentStep?.face_count ?? currentStep?.total_points ?? currentStep?.area_sample_count;
  const cards = [
    {
      label: 'Space',
      value: `${formatNumber(radiusKm * 1000, 0)} m boundary`,
      note: isAreaBasis
        ? `${sampleCount ? `${sampleCount} model cells at selected time` : 'Area aggregate'} inside the boundary`
        : isNearestFaceFallback ? 'Nearest valid face from area endpoint' : 'Nearest-pixel fallback',
    },
    { label: 'Boat', value: vesselLabel, note: VESSEL_OPERATING_ENVELOPE_STATUS },
    { label: 'Time', value: validTime ? formatUtcTiny(validTime) : 'Selected timestep', note: advisoryConfig?.timeFrame?.label ?? 'Forecast window' },
  ];
  const cardY = HDR_H + 10;
  const cardGap = 5;
  const cardW = (W - 20 - cardGap * 2) / 3;
  cards.forEach((card, index) => {
    const x = 10 + index * (cardW + cardGap);
    rect(doc, x, cardY, cardW, 30, [255, 255, 255], GRID_CLR, 0.25);
    setFont(doc, HEADER_BG, 7, 'bold');
    doc.text(card.label.toUpperCase(), x + 4, cardY + 7);
    setFont(doc, TEXT_DK, 10, 'bold');
    doc.text(String(card.value), x + 4, cardY + 17, { maxWidth: cardW - 8 });
    setFont(doc, TEXT_MD, 5.4);
    doc.text(String(card.note), x + 4, cardY + 25, { maxWidth: cardW - 8 });
  });

  const mixY = cardY + 42;
  setFont(doc, HEADER_BG, 8.5, 'bold');
  doc.text('Area mix over forecast window', 10, mixY);
  setFont(doc, TEXT_MD, 6);
  doc.text(
    `${formatNumber(stats.suitablePercent, 0)}% Suitable · ${formatNumber(stats.cautionPercent, 0)}% Caution · ${formatNumber(stats.avoidPercent, 0)}% Avoid`
      + (stats.unavailableCount ? ` · ${stats.unavailableCount} unavailable timestep${stats.unavailableCount === 1 ? '' : 's'}` : ''),
    10, mixY + 7,
  );

  const BAR_X = 10;
  const BAR_Y = mixY + 13;
  const BAR_W = W - 20;
  const BAR_H = 18;
  drawPointOutlookStrip(doc, BAR_X, BAR_Y, BAR_W, BAR_H, steps);
  if (steps.length > 1) {
    setFont(doc, TEXT_MD, 5.5);
    doc.text(formatUtcTiny(steps[0].valid_time ?? steps[0].time), BAR_X, BAR_Y + BAR_H + 5);
    doc.text(formatUtcTiny(steps[steps.length - 1].valid_time ?? steps[steps.length - 1].time), BAR_X + BAR_W, BAR_Y + BAR_H + 5, { align: 'right' });
  }
  if (currentStep) {
    const idx = Math.max(0, steps.findIndex(s => (s.time_index ?? null) === (currentStep.time_index ?? null)));
    const markerX = BAR_X + (idx < 0 ? 0 : (idx + 0.5) / Math.max(1, steps.length)) * BAR_W;
    setDraw(doc, [20, 24, 32]);
    doc.setLineWidth(0.7);
    doc.line(markerX, BAR_Y - 2, markerX, BAR_Y + BAR_H + 2);
    setFont(doc, TEXT_DK, 5.5, 'bold');
    doc.text('selected time', markerX, BAR_Y - 3, { align: 'center' });
  }
  drawSharedLegend(doc, W / 2, BAR_Y + BAR_H + 5);

  const noteY = BAR_Y + BAR_H + 18;
  setFont(doc, TEXT_DK, 7, 'bold');
  doc.text('Operational interpretation', 10, noteY);
  setFont(doc, TEXT_DK, 6.4);
  const notes = [
    stats.bestWindow
      ? `Best window: ${stats.bestWindow.label}, ${formatUtcTiny(stats.bestWindow.startTime)} to ${formatUtcTiny(stats.bestWindow.endTime)}.`
      : 'Best window unavailable for this landing area.',
    summarizeAvoidWindows(steps),
    isAreaBasis
      ? 'Statistics summarize modelled cells inside the 500 m landing boundary; local observations and official warnings still take priority.'
      : 'Fallback statistics use the nearest model grid cell; upgrade the backend area endpoint for true 500 m analysis.',
  ];
  let y = noteY + 8;
  notes.forEach((note) => {
    doc.text(note, 12, y, { maxWidth: W - 24 });
    y += 8;
  });

  setFont(doc, TEXT_MD, 5.5, 'italic');
  doc.text('Space = selected landing boundary · Boat = selected vessel class · Time = selected forecast window/timestep', W / 2, H - 4, { align: 'center' });
}

async function exportLandingAreaSuitabilityPDF({
  timeIndex,
  validTime,
  runId,
  suitabilityBaseUrl = '',
  onProgress,
  advisoryConfig,
}) {
  const { jsPDF } = await import('jspdf');
  const { bboxFromPointRadius, bboxAspectRatio } = await import('../lib/geoBbox');
  const {
    fetchSuitabilityAreaTimeseries,
    fetchSuitabilityTimeseries,
    isSuitabilityAreaTimeseriesUnavailable,
  } = await import('../lib/NiueSuitabilityOverlay');
  const { LANDING_AREA_PRESETS } = await import('../config/landingAreaPresets');
  const progress = onProgress ?? (() => {});

  const point = advisoryConfig?.area?.point;
  const vessel = advisoryConfig.vesselType;
  const vesselVc = VESSEL_BY_CODE[vessel];
  const vesselLabel = vesselVc?.label ?? String(vessel).replaceAll('_', ' ');

  progress('Resolving forecast API...');
  let apiBaseUrl = suitabilityBaseUrl;
  try {
    const resolved = await resolveSuitabilityApi(suitabilityBaseUrl);
    apiBaseUrl = resolved.baseUrl;
  } catch (error) {
    console.error(error.message);
    throw error;
  }

  progress('Fetching landing area suitability...');
  // `label` on a preset carries the "⚠ ... — unverified placeholder" warning
  // (landingAreaPresets.js — deliberately hard to miss in a web <select>
  // dropdown). Fixed-width PDF table/card columns (drawHazardHeatmapMatrix's
  // labelW, drawLandingAreaOverviewCards' card value) were sized for a bare
  // place name, not that ~40-character string, so it wrapped and overflowed
  // into neighbouring rows/cards. Swap in the clean `name` for PDF display —
  // the placeholder caveat is still stated in prose on drawLandingAreaPage's
  // narrative line, so nothing is silently lost, just not crammed into a
  // label column it was never sized for.
  const landingPoints = LANDING_AREA_PRESETS.map(preset => ({ ...preset, label: preset.name ?? preset.label, source: 'preset' }));
  if (point && !landingPoints.some(preset => isSameLandingPoint(preset, { ...point, id: advisoryConfig?.area?.id }))) {
    landingPoints.push({
      id: 'custom',
      label: advisoryConfig?.area?.label || 'Custom location',
      lon: point.lon,
      lat: point.lat,
      source: 'custom',
    });
  }

  const landingAreaRows = (await mapWithConcurrency(landingPoints, LANDING_FETCH_CONCURRENCY, async (landingPoint) => {
    const radiusKm = landingPoint.radiusKm ?? landingPoint.radius_km ?? point?.radiusKm ?? 0.5;
    try {
      if (isSuitabilityAreaTimeseriesUnavailable(apiBaseUrl)) {
        const series = await fetchSuitabilityTimeseries(apiBaseUrl, landingPoint.lon, landingPoint.lat, vessel);
        const rowSteps = normalisePointSteps(series?.steps ?? series?.timeseries ?? []);
        return {
          ...landingPoint,
          radiusKm,
          statistics_basis: 'nearest_pixel_fallback',
          fallback_reason: '500 m area endpoint is not available in this deployment.',
          steps: rowSteps,
        };
      }
      const series = await fetchSuitabilityAreaTimeseries(apiBaseUrl, landingPoint.lon, landingPoint.lat, vessel, radiusKm);
      const rowSteps = normalisePointSteps(series?.steps ?? series?.timeseries ?? []);
      return {
        ...landingPoint,
        radiusKm: series?.radius_km ?? radiusKm,
        statistics_basis: series?.statistics_basis ?? 'area_500m',
        face_count: series?.face_count,
        used_nearest_face_fallback: series?.used_nearest_face_fallback,
        available: series?.available,
        unavailable_reason: series?.unavailable_reason,
        steps: rowSteps,
      };
    } catch (error) {
      if (error.status === 404) {
        try {
          const series = await fetchSuitabilityTimeseries(apiBaseUrl, landingPoint.lon, landingPoint.lat, vessel);
          const rowSteps = normalisePointSteps(series?.steps ?? series?.timeseries ?? []);
          return {
            ...landingPoint,
            radiusKm,
            statistics_basis: 'nearest_pixel_fallback',
            fallback_reason: '500 m area endpoint is not available in this deployment.',
            steps: rowSteps,
          };
        } catch (fallbackError) {
          console.warn(`Landing-area fallback timeseries unavailable for ${landingPoint.label}:`, fallbackError.message);
        }
      }
      console.warn(`Landing-area timeseries unavailable for ${landingPoint.label}:`, error.message);
      return { ...landingPoint, steps: [] };
    }
  }, LANDING_FETCH_DELAY_MS)).filter(row => row.steps.length);

  if (!landingAreaRows.length) {
    throw new Error('No suitability timeseries returned for configured landing areas.');
  }

  const selectedRow = point
    ? landingAreaRows.find(row => isSameLandingPoint(row, point)) ?? landingAreaRows[0]
    : null;
  const steps = selectedRow?.steps ?? landingAreaRows[0]?.steps ?? [];
  const effectiveTimeIndex = Math.max(0, Math.min(Math.max(0, steps.length - 1), Number(timeIndex) || 0));
  const currentStep = selectedRow ? steps[effectiveTimeIndex] : null;

  let bbox = null;
  let mapDataUrl = null;
  if (point && selectedRow) {
    progress('Rendering landing area map...');
    const radiusKm = point.radiusKm ?? 0.5;
    bbox = bboxFromPointRadius(point.lon, point.lat, radiusKm);
    const aspect = bboxAspectRatio(bbox);
    const fetchH = 1000;
    const fetchW = Math.max(200, Math.round(fetchH * aspect));
    mapDataUrl = await fetchMapImage(vessel, effectiveTimeIndex, apiBaseUrl, {
      width: fetchW, height: fetchH, dpi: 200,
      showLabels: false, showLegend: false, showClassBoundaries: true,
      // The operational-map endpoint intentionally rejects sub-2 km bboxes;
      // landing-area statistics still come from the dedicated 500 m endpoint.
      viewRadiusKm: Math.max(2, radiusKm),
    }).catch(() => null);
  }

  progress('Loading icons...');
  // Only load a hazard-coloured icon when there's a real hazard to colour it
  // by — `?? 0` here silently requested the GREEN ("Suitable") icon for a
  // point with no current-step data at all. There's no grey/"unavailable"
  // icon asset in public/vessels/, so when hazard is unavailable this skips
  // loading one entirely; drawLandingAreaPage already falls back to
  // drawVesselFallbackIcon (a neutral initials box, no hazard color) when
  // vesselIcon is null.
  const currentHazardAvailable = Number.isFinite(currentStep?.hazard_class);
  const [vesselIcon, flagIcon] = await Promise.all([
    currentHazardAvailable ? loadVesselSvgIcon(vessel, currentStep.hazard_class) : Promise.resolve(null),
    loadFlagIcon(),
  ]);

  progress('Fetching sea-level context...');
  let seaLevel = null;
  try {
    seaLevel = await fetchSeaLevelTimeseries(apiBaseUrl, steps[0]?.valid_time ?? steps[0]?.time, steps[steps.length - 1]?.valid_time ?? steps[steps.length - 1]?.time);
  } catch (error) {
    // Same fix as drawPage2's identical fetch above — sea-level context is
    // optional, but silently swallowing every failure makes a real backend
    // problem indistinguishable from "feature not configured." Surface it.
    console.warn('Sea-level timeseries unavailable — landing-area context line omitted:', error.message);
  }

  progress('Building PDF...');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  setPdfMetadata(doc, {
    title: 'Niue Landing Area Advisory',
    subject: `Landing-area suitability — ${advisoryConfig?.area?.label ?? 'all launch areas'} — ${vesselLabel}`,
  });
  const effectiveRunId = runId ?? null;

  if (point && selectedRow) {
    drawLandingAreaPage(doc, {
      mapDataUrl, bbox, point, steps, currentStep, vessel, vesselLabel, vesselIcon, flagIcon,
      validTime: validTime ?? currentStep?.valid_time ?? currentStep?.time, runId: effectiveRunId, advisoryConfig, seaLevel,
      statisticsBasis: selectedRow?.statistics_basis ?? 'area_500m',
    });
    progress('Building landing operations page...');
    drawLandingAreaSpaceBoatTimePage(doc, {
      point, steps, currentStep, vesselLabel,
      validTime: validTime ?? currentStep?.valid_time ?? currentStep?.time,
      runId: effectiveRunId,
      advisoryConfig,
      statisticsBasis: selectedRow?.statistics_basis ?? 'area_500m',
    });
    progress('Building landing-area heatmap matrix...');
    drawLandingAreaHeatmapPage(doc, {
      landingAreaRows, vesselLabel, validTime: validTime ?? currentStep?.valid_time ?? currentStep?.time,
      runId: effectiveRunId, windowHours: advisoryConfig?.timeFrame?.hours ?? 168,
      selectedLabel: selectedRow?.label ?? advisoryConfig?.area?.label ?? null,
    });
  } else {
    progress('Building landing-area heatmap matrix...');
    drawLandingAreaHeatmapPage(doc, {
      landingAreaRows, vesselLabel, validTime: validTime ?? steps[0]?.valid_time ?? steps[0]?.time,
      runId: effectiveRunId, windowHours: advisoryConfig?.timeFrame?.hours ?? 168, addPage: false,
      selectedLabel: null,
    });
  }

  const slug = (advisoryConfig.area?.label ?? 'landing_area_matrix').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const filename = `niue_${slug}_advisory_t${String(effectiveTimeIndex).padStart(3, '0')}.pdf`;
  doc.save(filename);
  progress('Done');
  return filename;
}

// ── Competition poster export ──────────────────────────────────────────────────
// Single A3 landscape page. Dark editorial style. Visual-first — no tables.
// Core argument: same ocean, different risk across vessel classes.

// Per-vessel line colours for the shared timeline chart
const VESSEL_LINE_COLOR = {
  traditional_craft:          hazardColor(2),   // coral — highest risk class
  very_small_motorised_craft: hazardColor(1),   // amber
  small_craft:                hazardColor(0),   // teal
  larger_vessels:             [25,   94,  89],  // dark teal — lowest risk
};

function drawPosterPage(doc, { vessels, posterMapImg, posterVessel, timeSeriesData, validTime, nowIndex = 0 }) {
  const W = doc.internal.pageSize.getWidth();   // 420 mm (A3 landscape)
  const H = doc.internal.pageSize.getHeight();  // 297 mm

  // ── Layout constants ──────────────────────────────────────────────────────
  const HDR_H    = 22;    // headline strip
  const FOOT_H   = 10;
  const TL_H     = 52;    // timeline ribbon (larger than before — primary data view)
  const QUOTE_H  =  9;    // editorial pull-quote strip
  const LADDER_W = 118;   // wide vessel ranking column — the story lives here
  const MAP_Y0   = HDR_H;
  const MAP_BTM  = H - FOOT_H - TL_H - QUOTE_H;   // 297 - 10 - 52 - 9 = 226
  const MAP_AREA_H = MAP_BTM - MAP_Y0;              // 226 - 22 = 204
  const BADGE_H  = 11;
  const IMG_H    = MAP_AREA_H - BADGE_H - 1;        // 192
  const MAP_X0   = LADDER_W + 3;                    // 121
  const MAP_W    = W - MAP_X0 - 2;                  // 299 — single large map

  // ── Dark canvas ────────────────────────────────────────────────────────────
  rect(doc, 0, 0, W, H, [12, 20, 42]);

  // ── Headline strip ─────────────────────────────────────────────────────────
  rect(doc, 0, 0, W, HDR_H, [8, 14, 32]);

  // "SAME OCEAN." in white, "DIFFERENT RISK." in coral — poster-scale headline
  setFont(doc, [255, 255, 255], 20, 'bold');
  const sameOceanText = 'SAME OCEAN.';
  const sameW = doc.getTextWidth(sameOceanText + '  ');
  doc.text(sameOceanText, 5, HDR_H * 0.47);
  setFont(doc, hazardColor(2), 20, 'bold');
  doc.text('DIFFERENT RISK.', 5 + sameW, HDR_H * 0.47);

  // Subtitle: core insight
  setFont(doc, [150, 175, 215], 7);
  doc.text(
    'Vessel class determines hazard exposure — same sea state, different risk to life and vessel.',
    5, HDR_H * 0.82,
  );

  // Valid time and attribution (right-aligned)
  const validStr = validTime ? formatUtcTiny(validTime) : '—';
  setFont(doc, [110, 140, 185], 6.5);
  doc.text(`Most contrasting window: ${validStr}`, W - 4, HDR_H * 0.47, { align: 'right' });
  setFont(doc, [80, 108, 158], 6);
  doc.text('Niue Coastal Waters  ·  SPC Ocean Products', W - 4, HDR_H * 0.82, { align: 'right' });

  // ── Vessel ranking ladder ─────────────────────────────────────────────────
  rect(doc, 0, MAP_Y0, LADDER_W, MAP_AREA_H, [17, 28, 62]);

  setFont(doc, [120, 150, 200], 6, 'bold');
  doc.text('VESSEL RISK', LADDER_W / 2, MAP_Y0 + 5.5, { align: 'center' });
  doc.text('RANKING', LADDER_W / 2, MAP_Y0 + 10, { align: 'center' });

  const sortedVC = [...VESSEL_CLASSES].sort((a, b) => {
    const wa = vessels[a.code]?.warning_percent ?? 0;
    const wb = vessels[b.code]?.warning_percent ?? 0;
    const ca = vessels[a.code]?.caution_percent ?? 0;
    const cb = vessels[b.code]?.caution_percent ?? 0;
    return domainHazard(wb, cb) - domainHazard(wa, ca) || wb - wa;
  });

  const RUNG_Y0 = MAP_Y0 + 13;
  const RUNG_H  = (MAP_AREA_H - 14) / 4;
  const PAD     = 3;

  for (let ri = 0; ri < sortedVC.length; ri++) {
    const vc   = sortedVC[ri];
    const dataPresent = hasVesselData(vessels, vc.code);
    const vd   = vessels[vc.code] ?? {};
    const warn = vd.warning_percent ?? 0;
    const caut = vd.caution_percent ?? 0;
    const haz  = domainHazard(warn, caut);
    const ry   = RUNG_Y0 + ri * RUNG_H;

    // Rank number — large visual anchor
    setFont(doc, [35, 52, 95], 30, 'bold');
    doc.text(`${ri + 1}`, PAD + 3, ry + RUNG_H * 0.50);

    // Vessel name
    setFont(doc, [215, 228, 248], 7.5, 'bold');
    doc.text(vc.label, PAD + 16, ry + RUNG_H * 0.24);

    // Hazard badge
    const bw = LADDER_W - PAD - 18;
    setFill(doc, dataPresent ? hazardColor(haz) : NO_DATA_GREY);
    doc.roundedRect(PAD + 16, ry + RUNG_H * 0.31, bw, 6, 1.5, 1.5, 'F');
    setFont(doc, [255, 255, 255], 7, 'bold');
    doc.text(
      dataPresent ? hazardLabel(haz).toUpperCase() : 'NO DATA',
      PAD + 16 + bw / 2,
      ry + RUNG_H * 0.31 + 4.2,
      { align: 'center' },
    );

    // Three-segment bar (avoid | caution | suitable)
    const bx = PAD + 1;
    const by = ry + RUNG_H * 0.65;
    const bw2 = LADDER_W - PAD * 2;
    const bh = 4;
    if (dataPresent) {
      // base (suitable / teal)
      setFill(doc, hazardColor(0));
      doc.roundedRect(bx, by, bw2, bh, 1.2, 1.2, 'F');
      // caution layer
      if (warn + caut > 0) {
        setFill(doc, hazardColor(1));
        doc.roundedRect(bx, by, bw2 * Math.min(1, (warn + caut) / 100), bh, 1.2, 1.2, 'F');
      }
      // avoid layer (front)
      if (warn > 0) {
        setFill(doc, hazardColor(2));
        doc.roundedRect(bx, by, bw2 * Math.min(1, warn / 100), bh, 1.2, 1.2, 'F');
      }
    } else {
      setFill(doc, [60, 70, 95]);
      doc.roundedRect(bx, by, bw2, bh, 1.2, 1.2, 'F');
    }

    // Editorial risk sentence
    const riskSentence = !dataPresent    ? 'Suitability data unavailable'
                       : warn >= 80  ? `${Math.round(warn)}% — no safe departure window`
                       : warn >= 40  ? `${Math.round(warn)}% Avoid, high exposure`
                       : warn > 0    ? `${Math.round(warn)}% Avoid, limited risk`
                       : caut >= 50  ? 'Elevated caution, monitor closely'
                       : caut > 0    ? 'Mostly suitable, localised caution'
                       :               'Suitable conditions across domain';
    setFont(doc, [110, 138, 178], 5);
    doc.text(riskSentence, bx + bw2 / 2, by + bh + 3.2, { align: 'center' });

    // Separator
    if (ri < sortedVC.length - 1) {
      setDraw(doc, [32, 48, 88]);
      doc.setLineWidth(0.28);
      doc.line(PAD, ry + RUNG_H - 1, LADDER_W - PAD, ry + RUNG_H - 1);
    }
  }

  // ── Single large map ─────────────────────────────────────────────────────
  // One beautiful map at ~299×204 mm shows the suitability pattern for the
  // vessel class with the most spatial contrast.  The ladder on the left
  // provides the vessel-to-vessel comparison — the map provides the geography.
  {
    const mx = MAP_X0;
    const my = MAP_Y0;
    const vcObj = VESSEL_BY_CODE[posterVessel] ?? VESSEL_CLASSES[0];
    const vd  = vessels[vcObj.code] ?? {};
    const warn = vd.warning_percent ?? 0;
    const caut = vd.caution_percent ?? 0;
    const haz  = domainHazard(warn, caut);

    if (posterMapImg) {
      const fmt = posterMapImg.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(posterMapImg, fmt, mx, my, MAP_W, IMG_H, 'poster_map_' + (posterVessel ?? 'default'), 'FAST');
    } else {
      rect(doc, mx, my, MAP_W, IMG_H, [17, 28, 62]);
      setFont(doc, [100, 130, 180], 9, 'italic');
      doc.text('Map data unavailable', mx + MAP_W / 2, my + IMG_H / 2, { align: 'center' });
    }

    // Vessel context pill — top-left of image
    {
      const lbl = `${vcObj.label.toUpperCase()} — ${hazardLabel(haz).toUpperCase()}`;
      setFont(doc, [220, 235, 255], 7, 'bold');
      const pw = doc.getTextWidth(lbl) + 6;
      rect(doc, mx + 3, my + 3, pw, 8, [8, 16, 42]);
      doc.text(lbl, mx + 6, my + 8.2);
    }

    // Avoid/Caution annotation pill — top-right
    if (warn > 0 || caut > 0) {
      const ann = warn > 0 ? `${Math.round(warn)}% Avoid` : `${Math.round(caut)}% Caution`;
      setFont(doc, [255, 255, 255], 6.5, 'bold');
      const aw = doc.getTextWidth(ann) + 4;
      rect(doc, mx + MAP_W - aw - 4, my + 3, aw + 1, 7, hazardColor(warn > 0 ? 2 : 1));
      doc.text(ann, mx + MAP_W - 5, my + 7.8, { align: 'right' });
    }

    // Hazard badge strip below map
    setFill(doc, hazardColor(haz));
    doc.rect(mx, my + IMG_H, MAP_W, BADGE_H, 'F');
    setFont(doc, [255, 255, 255], 6.5, 'bold');
    doc.text(vcObj.label.toUpperCase(), mx + MAP_W / 2, my + IMG_H + BADGE_H * 0.33, { align: 'center' });
    setFont(doc, [255, 255, 255], 9, 'bold');
    doc.text(hazardLabel(haz).toUpperCase(), mx + MAP_W / 2, my + IMG_H + BADGE_H * 0.80, { align: 'center' });
  }

  // ── Editorial pull-quote strip ────────────────────────────────────────
  const QUOTE_Y = MAP_BTM;
  rect(doc, 0, QUOTE_Y, W, QUOTE_H, [22, 36, 75]);
  setFont(doc, [215, 225, 255], 7.5, 'bold');
  doc.text(
    'SAME OCEAN — BUT VESSEL CLASS DETERMINES WHETHER YOU COME HOME.',
    W / 2, QUOTE_Y + QUOTE_H * 0.62,
    { align: 'center' },
  );

  // ── Shared timeline ribbon ─────────────────────────────────────────────
  const TL_Y = QUOTE_Y + QUOTE_H;
  rect(doc, 0, TL_Y, W, TL_H, [13, 22, 50]);

  setFont(doc, [110, 142, 192], 6, 'bold');
  doc.text('72-HOUR FORECAST — AVOID % BY VESSEL CLASS', 5, TL_Y + 6);

  // Legend (right of title) — set font BEFORE measuring text widths
  setFont(doc, [255, 255, 255], 5, 'bold');
  let legX = W - 5;
  for (const vc of [...VESSEL_CLASSES].reverse()) {
    const haz   = domainHazard(vessels[vc.code]?.warning_percent ?? 0, vessels[vc.code]?.caution_percent ?? 0);
    const color = VESSEL_LINE_COLOR[vc.code] ?? hazardColor(haz);
    const lw    = doc.getTextWidth(vc.short);
    setFill(doc, color);
    doc.roundedRect(legX - lw - 5.5, TL_Y + 2.5, lw + 5, 4, 1, 1, 'F');
    setFont(doc, [255, 255, 255], 5, 'bold');   // re-assert after setFill resets nothing, but explicit is safe
    doc.text(vc.short, legX - lw - 3, TL_Y + 5.5);
    legX -= lw + 8;
  }

  // Chart area
  const CX = 5, CY = TL_Y + 10, CW = W - 12, CH = TL_H - 14;

  // Grid
  setDraw(doc, [28, 44, 84]);
  doc.setLineWidth(0.2);
  for (const pct of [25, 50, 75]) {
    const gy = CY + CH * (1 - pct / 100);
    doc.line(CX, gy, CX + CW, gy);
    setFont(doc, [72, 95, 138], 4.5);
    doc.text(`${pct}%`, CX - 1.5, gy + 1.5, { align: 'right' });
  }
  // Baseline
  setDraw(doc, [42, 62, 108]);
  doc.setLineWidth(0.35);
  doc.line(CX, CY + CH, CX + CW, CY + CH);

  // Plot vessel series — clean polylines, no broken GState area fills
  if (timeSeriesData.length >= 2) {
    const n = timeSeriesData.length;

    for (const vc of VESSEL_CLASSES) {
      const color = VESSEL_LINE_COLOR[vc.code] ?? hazardColor(0);
      setDraw(doc, color);
      doc.setLineWidth(1.8);

      let px0 = null, py0 = null;
      for (let si = 0; si < n; si++) {
        const warn = timeSeriesData[si]?.vessels?.[vc.code]?.warning_percent ?? 0;
        const px = CX + (CW / (n - 1)) * si;
        const py = CY + CH * (1 - Math.min(1, warn / 100));
        if (px0 !== null) doc.line(px0, py0, px, py);
        px0 = px; py0 = py;
      }
    }

    // "NOW" marker: vertical tick at the actual current-time index. The
    // series starts 6 steps before "now" (exportSuitabilityPoster fetches
    // timeIndex-6 .. timeIndex+66 so the ribbon has runway on both sides of
    // "now"), so the marker previously drawn at the series' first step (CX)
    // was backdated by up to 6 steps instead of marking the real present.
    const clampedNowIndex = Math.max(0, Math.min(n - 1, nowIndex));
    const nowX = CX + (CW / (n - 1)) * clampedNowIndex;
    setDraw(doc, [180, 200, 235]);
    doc.setLineWidth(0.4);
    doc.line(nowX, CY, nowX, CY + CH);
    setFont(doc, [160, 185, 225], 5, 'bold');
    doc.text('NOW', nowX + 1, CY - 1);

    // X-axis time labels
    setFont(doc, [80, 108, 152], 5.5);
    doc.text(formatUtcTiny(timeSeriesData[0].time),     CX,      CY + CH + 4.5);
    doc.text(formatUtcTiny(timeSeriesData[n - 1].time), CX + CW, CY + CH + 4.5, { align: 'right' });

    // End-of-line labels, staggered to prevent overlap
    const labelQueue = VESSEL_CLASSES.map(vc => {
      const lastWarn = timeSeriesData[n - 1]?.vessels?.[vc.code]?.warning_percent ?? 0;
      return {
        label: vc.short,
        color: VESSEL_LINE_COLOR[vc.code] ?? hazardColor(0),
        ly: CY + CH * (1 - Math.min(1, lastWarn / 100)),
      };
    }).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < labelQueue.length; i++) {
      if (labelQueue[i].ly - labelQueue[i - 1].ly < 5) labelQueue[i].ly = labelQueue[i - 1].ly + 5;
    }
    for (const { label, color, ly } of labelQueue) {
      setFont(doc, color, 5.5, 'bold');
      doc.text(label, CX + CW + 2, ly + 1.5);
    }
  } else {
    setFont(doc, [72, 98, 145], 6, 'italic');
    doc.text('Time series data unavailable', CX + CW / 2, CY + CH / 2, { align: 'center' });
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const FY = H - FOOT_H;
  rect(doc, 0, FY, W, FOOT_H, [7, 12, 28]);
  setFont(doc, [190, 215, 255], 9, 'bold');
  doc.text('Marine risk is not universal — it depends on the vessel.', W / 2, FY + 5.5, { align: 'center' });
  setFont(doc, [90, 120, 170], 5.5, 'italic');
  // FY + 8, not + 9.5 — the old baseline sat only 0.5mm above the physical
  // page bottom inside a 10mm footer band, close enough that font descenders
  // (g, p, y) could already be clipped by some renderers.
  doc.text(
    fitTextToWidth(doc, 'Advisory guidance only — not an official navigation chart. All suitability classifications are model-derived forecasts. Verify with official warnings before departure.', W - 20),
    W / 2, FY + 8, { align: 'center' },
  );
}

export async function exportSuitabilityPoster({
  timeIndex,
  validTime,
  suitabilityBaseUrl = '',
  onProgress,
}) {
  const { jsPDF } = await import('jspdf');
  const progress = onProgress ?? (() => {});

  progress('Resolving suitability API...');
  const resolved = await resolveSuitabilityApi(suitabilityBaseUrl);
  const apiBaseUrl = resolved.baseUrl;

  progress('Finding best contrast timestep...');
  const posterEndIndex = resolved.timesteps?.count
    ? resolved.timesteps.count - 1
    : null;
  const best = await fetchBestContrastTimestep(apiBaseUrl, null, timeIndex, posterEndIndex).catch(() => null);
  const compTimeIndex = best?.time_index ?? timeIndex;
  const vessels = best?.vessels ?? {};
  const posterValidTime = best?.valid_time ?? validTime;

  // Full summary at the comparison timestep — needed before we pick the poster vessel.
  let fullSummaryEarly = null;
  try { fullSummaryEarly = await fetchSummary(compTimeIndex, apiBaseUrl); } catch { /* fall back */ }
  const earlyVessels = fullSummaryEarly?.vessels ?? vessels;

  // Pick the vessel with the most spatial variation (farthest from 100% single class).
  // This gives the most visually rich map for the competition single-map layout.
  const posterVessel = (() => {
    let best = VESSEL_CLASSES[0].code;
    let bestVar = -1;
    for (const vc of VESSEL_CLASSES) {
      const w = earlyVessels[vc.code]?.warning_percent ?? 0;
      const c = earlyVessels[vc.code]?.caution_percent ?? 0;
      const s = earlyVessels[vc.code]?.suitable_percent ?? 0;
      const variation = 100 - Math.max(w, c, s);
      if (variation > bestVar) { bestVar = variation; best = vc.code; }
    }
    return best;
  })();

  progress('Rendering poster map (high resolution)...');
  // Single large map: poster slot is ~299 × 192 mm = 1.56:1 landscape aspect.
  // viewRadiusKm=55 with no explicit bbox → adjustable="datalim" lets the ocean
  // extend naturally around the domain, giving a geographically rich composition.
  //
  // width/height/dpi scaled up by the same 2.25x factor from the previous
  // 1560x1000@200dpi — that was only ~132 PPI at final A3 print size (299mm
  // needs ~3530px for a real 300 PPI target), soft enough to look genuinely
  // blurry off a printer even though it read fine on screen. Scaling all
  // three together (not just width/height) keeps matplotlib's figsize
  // (width/dpi, height/dpi) unchanged, so line weights, coastline strokes,
  // and marker sizes stay visually identical to what's already tuned —
  // only the final pixel density goes up.
  const posterMapImg = await fetchMapImage(posterVessel, compTimeIndex, apiBaseUrl, {
    width: 3510, height: 2250, dpi: 450,
    showLabels: false, showLegend: false, showClassBoundaries: true, viewRadiusKm: 55,
  }).catch(() => null);

  progress('Fetching forecast time series...');
  let timeSeriesData = [];
  let nowIndex = 0;
  try {
    const tsMeta = resolved.timesteps;
    if (tsMeta?.timesteps) {
      // Steps-per-hour-target (not a hardcoded step count) — mirrors
      // exportSuitabilityPDF's Step 4 fix for the same problem: a fixed "6
      // back / 66 forward" step offset only spans the labeled 72-hour
      // window if the backend's native cadence happens to be hourly.
      const stepHours   = inferStepHours(tsMeta.timesteps);
      const stepsBack    = Math.round(6 / stepHours);
      const stepsForward = Math.round(66 / stepHours);
      const start = Math.max(0, timeIndex - stepsBack);
      const end   = Math.min(tsMeta.count - 1, timeIndex + stepsForward);
      nowIndex = timeIndex - start;
      const steps = [];
      for (let i = start; i <= end; i++) {
        try {
          const s = await fetchSummary(i, apiBaseUrl);
          steps.push({ time: s.valid_time, vessels: s.vessels });
        } catch { /* skip */ }
      }
      timeSeriesData = steps;
    }
  } catch { /* leave empty */ }

  progress('Building poster...');
  const posterVessels = earlyVessels;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  setPdfMetadata(doc, {
    title: 'Same Ocean, Different Risk',
    subject: 'Vessel-class marine risk comparison poster — Niue coastal waters',
  });

  drawPosterPage(doc, {
    vessels:      posterVessels,
    posterMapImg,
    posterVessel,
    timeSeriesData,
    validTime:    posterValidTime,
    nowIndex,
  });

  const filename = `niue_same_ocean_different_risk_t${String(compTimeIndex).padStart(3,'0')}.pdf`;
  doc.save(filename);
  progress('Done');
  return filename;
}
