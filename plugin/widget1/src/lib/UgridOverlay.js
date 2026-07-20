// UgridOverlay.js — renders an unstructured UGRID mesh Zarr dataset via deck.gl + MapLibre.
// Ported from zarr_web/src/lib/UgridOverlay.ts (TypeScript stripped, zarrita → zarr v0.6.3).
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PolygonLayer, IconLayer, PathLayer, TextLayer } from '@deck.gl/layers';
import { openArray, HTTPStore } from 'zarr';
import { getColormap } from './colormaps';

const DEFAULT_ARROW_PIXEL_SPACING = 56;
const DEFAULT_ARROW_MIN_ZOOM = 8;
const ARROW_SPATIAL_GRID_SIZE = 32;
const DIRECTION_ARROW_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path d="M32 4 L52 30 H40 V60 H24 V30 H12 Z" fill="black" stroke="white" stroke-width="4" stroke-linejoin="round"/></svg>',
)}`;

// ── geometry helpers ────────────────────────────────────────────────────────
function triangleBounds(a, b, c) {
  return {
    lonMin: Math.min(a[0], b[0], c[0]), lonMax: Math.max(a[0], b[0], c[0]),
    latMin: Math.min(a[1], b[1], c[1]), latMax: Math.max(a[1], b[1], c[1]),
  };
}
function boundsIntersect(a, b) {
  return !(a.lonMax < b.west || a.lonMin > b.east || a.latMax < b.south || a.latMin > b.north);
}

// ── contour helpers ──────────────────────────────────────────────────────────
const CONTOUR_EPS = 1e-9;
function edgeCrossing(p0, p1, v0, v1, level) {
  if (!Number.isFinite(v0) || !Number.isFinite(v1)) return null;
  const d0 = v0 - level, d1 = v1 - level;
  if (Math.abs(d0) < CONTOUR_EPS && Math.abs(d1) < CONTOUR_EPS) return null;
  if ((d0 > CONTOUR_EPS && d1 > CONTOUR_EPS) || (d0 < -CONTOUR_EPS && d1 < -CONTOUR_EPS)) return null;
  if (Math.abs(d0) < CONTOUR_EPS) return p0;
  if (Math.abs(d1) < CONTOUR_EPS) return p1;
  const t = (level - v0) / (v1 - v0);
  if (t < 0 || t > 1 || !Number.isFinite(t)) return null;
  return [p0[0] + t * (p1[0] - p0[0]), p0[1] + t * (p1[1] - p0[1])];
}
function pushUnique(arr, pt) {
  if (!arr.some(p => Math.abs(p[0] - pt[0]) < 1e-10 && Math.abs(p[1] - pt[1]) < 1e-10)) arr.push(pt);
}

// Marching-triangles: extracts contour line segments from a UGRID triangular mesh.
// Returns [{level, major, path:[p0,p1]}] using visible-bounds filtering for performance.
function buildTriangleContours({ triangles, values, levels, majorLevels = [], visibleBounds = null }) {
  const majorSet = new Set(majorLevels.map(v => Number(v.toFixed(6))));
  const segments = [];
  for (const tri of triangles) {
    if (visibleBounds && !boundsIntersect(tri.bounds, visibleBounds)) continue;
    const [i0, i1, i2] = tri.nodeIndices;
    const v0 = values[i0], v1 = values[i1], v2 = values[i2];
    if (!Number.isFinite(v0) || !Number.isFinite(v1) || !Number.isFinite(v2)) continue;
    const pts = tri.nodes;
    const edges = [[pts[0], pts[1], v0, v1], [pts[1], pts[2], v1, v2], [pts[2], pts[0], v2, v0]];
    for (const level of levels) {
      const crossings = [];
      for (const [pA, pB, vA, vB] of edges) {
        const p = edgeCrossing(pA, pB, vA, vB, level);
        if (p) pushUnique(crossings, p);
      }
      if (crossings.length === 2) {
        segments.push({ level, major: majorSet.has(Number(level.toFixed(6))), path: crossings });
      }
    }
  }
  return segments;
}
function computeBarycentric(pt, a, b, c) {
  const denom = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(denom) < 1e-12) return null;
  const w1 = ((b[1] - c[1]) * (pt[0] - c[0]) + (c[0] - b[0]) * (pt[1] - c[1])) / denom;
  const w2 = ((c[1] - a[1]) * (pt[0] - c[0]) + (a[0] - c[0]) * (pt[1] - c[1])) / denom;
  const w3 = 1 - w1 - w2;
  if (w1 < -1e-7 || w2 < -1e-7 || w3 < -1e-7) return null;
  return [w1, w2, w3];
}
function interpolateScalar(a, b, c, [wa, wb, wc]) {
  return a * wa + b * wb + c * wc;
}
function interpolateAngleDeg(a, b, c, [wa, wb, wc]) {
  const toRad = (v) => (v * Math.PI) / 180;
  const x = Math.cos(toRad(a)) * wa + Math.cos(toRad(b)) * wb + Math.cos(toRad(c)) * wc;
  const y = Math.sin(toRad(a)) * wa + Math.sin(toRad(b)) * wb + Math.sin(toRad(c)) * wc;
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
function getArrowPixelSpacing(zoom) {
  return Math.max(28, DEFAULT_ARROW_PIXEL_SPACING - (zoom - 8) * 2);
}

function resolveArrowSpacing(config, zoom) {
  const byZoom = config.arrowDensityByZoom;
  if (byZoom?.length) {
    const sorted = [...byZoom].sort((a, b) => a.zoom - b.zoom);
    let stride = sorted[0].stride;
    for (const entry of sorted) { if (zoom >= entry.zoom) stride = entry.stride; }
    return Math.max(12, stride);
  }
  return Math.max(12, config.arrowStride ?? getArrowPixelSpacing(zoom));
}
function buildSpatialIndex(triangles, datasetBounds, gridSize = ARROW_SPATIAL_GRID_SIZE) {
  const [[west, south], [east, north]] = datasetBounds;
  const lonSpan = east - west || 1;
  const latSpan = north - south || 1;
  const cells = Array.from({ length: gridSize * gridSize }, () => []);
  const clampCell = (value) => Math.max(0, Math.min(gridSize - 1, Math.floor(value)));

  triangles.forEach((tri, index) => {
    const x0 = clampCell(((tri.bounds.lonMin - west) / lonSpan) * gridSize);
    const x1 = clampCell(((tri.bounds.lonMax - west) / lonSpan) * gridSize);
    const y0 = clampCell(((tri.bounds.latMin - south) / latSpan) * gridSize);
    const y1 = clampCell(((tri.bounds.latMax - south) / latSpan) * gridSize);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        cells[y * gridSize + x].push(index);
      }
    }
  });

  return {
    cells,
    gridSize,
    west,
    south,
    lonSpan,
    latSpan,
  };
}
function getSpatialCandidates(index, lng, lat) {
  if (!index) return null;
  const x = Math.floor(((lng - index.west) / index.lonSpan) * index.gridSize);
  const y = Math.floor(((lat - index.south) / index.latSpan) * index.gridSize);
  if (x < 0 || x >= index.gridSize || y < 0 || y >= index.gridSize) return [];
  return index.cells[y * index.gridSize + x] ?? [];
}
function quantile(sortedValues, p) {
  if (!sortedValues.length) return 0;
  const clamped = Math.max(0, Math.min(1, p));
  const pos = (sortedValues.length - 1) * clamped;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (pos - lower);
}
function resolveColorRange(config, finiteValues, dataMin, dataMax) {
  const configuredMin = config.colorRange?.min;
  const configuredMax = config.colorRange?.max;
  let min = Number.isFinite(configuredMin) ? configuredMin : dataMin;
  let max = Number.isFinite(configuredMax) ? configuredMax : dataMax;

  // dynamicColorMin: use actual data minimum (matches WMS COLORSCALERANGE behaviour),
  // clamped to configuredMin floor so it never goes below the layer's stated minimum.
  if (config.dynamicColorMin && Number.isFinite(dataMin)) {
    min = Number.isFinite(configuredMin) ? Math.max(configuredMin, dataMin) : dataMin;
  }

  if (config.dynamicColorRange && finiteValues.length > 2) {
    const options = typeof config.dynamicColorRange === 'object' ? config.dynamicColorRange : {};
    const sorted = [...finiteValues].sort((a, b) => a - b);
    const lowerPct = Number.isFinite(options.lowerPct) ? options.lowerPct : 2;
    const upperPct = Number.isFinite(options.upperPct) ? options.upperPct : 98;
    min = quantile(sorted, lowerPct / 100);
    max = quantile(sorted, upperPct / 100);

    if (options.clampToColorRange !== false) {
      if (Number.isFinite(configuredMin)) min = Math.max(configuredMin, min);
      if (Number.isFinite(configuredMax)) max = Math.min(configuredMax, max);
    }

    const minSpan = Number(options.minSpan) || 0;
    if (minSpan > 0 && max - min < minSpan) {
      const center = (min + max) / 2;
      min = center - minSpan / 2;
      max = center + minSpan / 2;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    min = Number.isFinite(dataMin) ? dataMin : 0;
    max = Number.isFinite(dataMax) && dataMax !== min ? dataMax : min + 1;
  }

  return { min, max };
}

// ── node spatial index ────────────────────────────────────────────────────────
function buildNodeSpatialIndex(nodes, bounds, gridSize = 64) {
  const [[west, south], [east, north]] = bounds;
  const lonSpan = east - west || 1;
  const latSpan = north - south || 1;
  const clamp = (v) => Math.max(0, Math.min(gridSize - 1, Math.floor(v)));
  const cells = Array.from({ length: gridSize * gridSize }, () => []);
  nodes.forEach((node, i) => {
    const x = clamp(((node[0] - west) / lonSpan) * gridSize);
    const y = clamp(((node[1] - south) / latSpan) * gridSize);
    cells[y * gridSize + x].push(i);
  });
  return { cells, gridSize, west, south, lonSpan, latSpan };
}
function findNearestNode(index, nodes, lng, lat) {
  const { cells, gridSize, west, south, lonSpan, latSpan } = index;
  const cx = Math.max(0, Math.min(gridSize - 1, Math.floor(((lng - west) / lonSpan) * gridSize)));
  const cy = Math.max(0, Math.min(gridSize - 1, Math.floor(((lat - south) / latSpan) * gridSize)));
  let best = 0, bestDist = Infinity;
  for (let r = 0; r <= gridSize; r++) {
    if (r > 2 && bestDist < Infinity) break;
    const x0 = Math.max(0, cx - r), x1 = Math.min(gridSize - 1, cx + r);
    const y0 = Math.max(0, cy - r), y1 = Math.min(gridSize - 1, cy + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (r > 0 && x > x0 && x < x1 && y > y0 && y < y1) continue;
        for (const i of cells[y * gridSize + x]) {
          const d = (nodes[i][0] - lng) ** 2 + (nodes[i][1] - lat) ** 2;
          if (d < bestDist) { bestDist = d; best = i; }
        }
      }
    }
  }
  return best;
}

// ── direction metadata helpers ───────────────────────────────────────────────
function normalizeText(v) { return typeof v === 'string' ? v.trim().toLowerCase() : ''; }
function buildDirMeta(raw) {
  return {
    standardName: normalizeText(raw?.standard_name),
    longName:     normalizeText(raw?.long_name),
    comment:      normalizeText(raw?.comment),
    units:        normalizeText(raw?.units),
  };
}
function normalizeDirForIcon(rawAngle, meta, offset = 0, directionConvention = null) {
  let dir = ((rawAngle % 360) + 360) % 360;
  // Config takes priority; fall back to zarr metadata standard_name/long_name/comment.
  const configSaysFrom = directionConvention === 'coming_from';
  const metaSaysFrom = meta.standardName.includes('from_direction') ||
    meta.longName.includes('from direction') ||
    meta.comment.includes('from direction');
  if (configSaysFrom || metaSaysFrom) dir = (dir + 180) % 360;
  const isCwFromNorth = meta.comment.includes('clockwise from due north') ||
    meta.comment.includes('north=0') || meta.units.includes('degree');
  const iconAngle = isCwFromNorth ? -dir : dir;
  return ((iconAngle + offset) % 360 + 360) % 360;
}

// ── zarr helpers ─────────────────────────────────────────────────────────────
function buildZarrUrl(datasetName, baseUrl) {
  const base = ((baseUrl || '').trim() || 'https://s3.ap-southeast-2.wasabisys.com/spc-zarr-file/')
    .replace(/\/+$/, '');
  const ds = datasetName.replace(/^\/+/, '').replace(/\/+$/, '');
  const url = `${base}/${ds}`;
  if (/^https?:\/\//i.test(url)) return url;
  const origin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : '';
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

async function fetchZarrAttrs(storeUrl, variableName) {
  try {
    const resp = await fetch(`${storeUrl}/.zmetadata`);
    if (!resp.ok) return null;
    const meta = await resp.json();
    return meta?.metadata?.[`${variableName}/.zattrs`] ?? null;
  } catch {
    return null;
  }
}

async function openZarrArray(storeUrl, varPath) {
  const store = new HTTPStore(storeUrl);
  return openArray({ store, path: varPath, mode: 'r' });
}

async function getSlice(arr, selection) {
  const result = await arr.get(selection);
  return result.data; // TypedArray
}

// ── main class ───────────────────────────────────────────────────────────────
export class UgridOverlay {
  constructor(map, config) {
    this.map = map;
    this.config = config;
    this._contoursEnabled = config.contours?.visibleByDefault ?? config.contours?.enabled ?? true;
    this.overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    this.map.addControl(this.overlay);

    this.dataset = null;
    this.variableArr = null;
    this.directionArr = null;
    this.directionMeta = buildDirMeta(null);
    this.extraArrs = {};
    this.nodeIndex = null;
    this.timeIndex = 0;
    this.playInterval = null;
    this.mounted = true;
    this.renderRequestId = 0;
    this.renderTimeout = null;
    this.didAutoFit = false;

    // UI callbacks
    this.onTimeChange   = null;
    this.onStatsChange  = null;
    this.onLoadingChange = null;
    this.onErrorChange  = null;

    this._boundMove = () => this._scheduleRender();
    this._boundZoom = () => this._scheduleRender();
    this.map.on('moveend', this._boundMove);
    this.map.on('zoomend', this._boundZoom);

    queueMicrotask(() => { if (this.mounted) this._initialize(); });
  }

  async _initialize() {
    this.onLoadingChange?.(true);
    try {
      await this._loadMetadata();
      if (this.mounted) this._render();
    } catch (err) {
      if (this.mounted) this.onErrorChange?.(String(err));
    } finally {
      // Guard: if destroyed mid-fetch the callback was already nulled by useZarrMap
      if (this.mounted) this.onLoadingChange?.(false);
    }
  }

  // pointVariables is shared across layers with different primary/direction
  // variables (e.g. the Mean/Peak Period layers' own variable also appears
  // in the shared list) — drop anything already covered by variableArr/
  // directionArr so it isn't opened and fetched twice per click.
  _pointVariableDefs() {
    const all = Array.isArray(this.config.pointVariables) ? this.config.pointVariables : [];
    return all.filter(({ name }) => name !== this.config.variable && name !== this.config.directionVariable);
  }

  async _loadMetadata() {
    if (this.dataset) return;
    const storeUrl = buildZarrUrl(this.config.datasetName, this.config.zarrBaseUrl);
    const extraDefs = this._pointVariableDefs();

    // Open all arrays + direction attrs in one round-trip batch
    const [lonArr, latArr, faceArr, varArr, dirArr, dirAttrs, ...extraArrList] = await Promise.all([
      openZarrArray(storeUrl, 'mesh_node_lon'),
      openZarrArray(storeUrl, 'mesh_node_lat'),
      openZarrArray(storeUrl, 'mesh_face_node'),
      openZarrArray(storeUrl, this.config.variable),
      this.config.directionVariable
        ? openZarrArray(storeUrl, this.config.directionVariable).catch(() => null)
        : Promise.resolve(null),
      this.config.directionVariable
        ? fetchZarrAttrs(storeUrl, this.config.directionVariable)
        : Promise.resolve(null),
      ...extraDefs.map(({ name }) => openZarrArray(storeUrl, name).catch(() => null)),
    ]);
    this.variableArr = varArr;
    this.directionArr = dirArr;
    if (this.config.directionVariable) this.directionMeta = buildDirMeta(dirAttrs);
    this.extraArrs = Object.fromEntries(extraDefs.map(({ name }, i) => [name, extraArrList[i]]));

    const [lonData, latData, faceData] = await Promise.all([
      getSlice(lonArr, null),
      getSlice(latArr, null),
      getSlice(faceArr, null),
    ]);

    // zarr.js 0.6.3 returns Array<TypedArray> for 2D arrays (one row per face) — flatten it.
    const indices = Array.isArray(faceData)
      ? faceData.flatMap((row) => Array.from(row))
      : Array.from(faceData);
    // UGRID spec: start_index=1 means 1-based, 0 means 0-based (default).
    // Don't sample — some meshes have no node-0 face; check the .zattrs instead.
    const faceAttrs = await fetchZarrAttrs(storeUrl, 'mesh_face_node');
    const startIndex = faceAttrs?.start_index ?? 0;
    const offset = startIndex > 0 ? startIndex : 0;
    const triangles = offset > 0 ? indices.map((v) => v - offset) : indices;

    const nodes = Array.from(lonData, (x, i) => [x, latData[i]]);
    const lons = Array.from(lonData, Number);
    const lats = Array.from(latData, Number);
    const timeCount = this.variableArr.shape[0];
    const bounds = [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ];

    const faceTriangles = [];
    const polygons = [];
    for (let i = 0; i < triangles.length; i += 3) {
      const i0 = triangles[i], i1 = triangles[i + 1], i2 = triangles[i + 2];
      if (i0 < 0 || i1 < 0 || i2 < 0 ||
          i0 >= nodes.length || i1 >= nodes.length || i2 >= nodes.length) continue;
      const a = nodes[i0], b = nodes[i1], c = nodes[i2];
      faceTriangles.push({
        nodeIndices: [i0, i1, i2],
        nodes: [a, b, c],
        polygon: [a, b, c],
        bounds: triangleBounds(a, b, c),
      });
      polygons.push([a, b, c]);
    }

    // Generate ISO time labels from time/.zattrs — zarr.js 0.6.3 cannot read <i8 (int64),
    // so we read only the metadata and assume hourly uniform steps from the units base date.
    const timeAttrs = await fetchZarrAttrs(storeUrl, 'time');
    const units = timeAttrs?.units ?? '';
    const m = units.match(/hours\s+since\s+(.+)/i);
    const baseDate = m ? new Date(m[1].trim().replace(' ', 'T') + (m[1].includes('Z') ? '' : 'Z')) : null;
    this.timeLabels = Array.from({ length: timeCount }, (_, i) => {
      if (baseDate && !isNaN(baseDate)) {
        const d = new Date(baseDate.getTime() + i * 3600 * 1000);
        return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
      }
      return `Timestep ${i + 1}`;
    });

    this.dataset = {
      nodes, triangles, faceTriangles, polygons, timeCount, bounds,
    };
    this.nodeIndex = buildNodeSpatialIndex(nodes, bounds);

    if (!this.didAutoFit) {
      this.didAutoFit = true;
      this.map.fitBounds(this.dataset.bounds, { padding: 30, animate: false });
    }
    const label0 = this.timeLabels[0] ?? '';
    this.onTimeChange?.(label0, 0, timeCount - 1);
  }

  getTimeLabels() { return this.timeLabels ?? []; }

  async _fetchValues(timeIdx) {
    if (!this.variableArr) await this._loadMetadata();
    return getSlice(this.variableArr, [timeIdx, null]);
  }

  async _fetchDirections(timeIdx) {
    if (!this.directionArr) return null;
    return getSlice(this.directionArr, [timeIdx, null]).catch(() => null);
  }

  _scheduleRender(delay = 0) {
    if (!this.mounted) return;
    if (this.renderTimeout) clearTimeout(this.renderTimeout);
    this.renderTimeout = setTimeout(() => { this.renderTimeout = null; this._render(); }, delay);
  }

  async _render() {
    if (!this.mounted) return;
    if (!this.dataset) return;
    const requestId = ++this.renderRequestId;
    this.onLoadingChange?.(true);
    try {
      const ds = this.dataset;
      const [values, dirValues] = await Promise.all([
        this._fetchValues(this.timeIndex),
        this._fetchDirections(this.timeIndex),
      ]);
      if (!this.mounted || requestId !== this.renderRequestId) return;

      const nums = Array.from(values, Number);
      const finiteNums = nums.filter(Number.isFinite);
      const dataMin = finiteNums.length ? Math.min(...finiteNums) : 0;
      const dataMax = finiteNums.length ? Math.max(...finiteNums) : 0;
      const { min, max } = resolveColorRange(this.config, finiteNums, dataMin, dataMax);
      const span = max - min || 1;
      // When colorBreaks are active, always use the continuous colormap — numColorBands
      // would double-quantize the palette and produce wrong band colours.
      const colormap = getColormap(
        this.config.colormap,
        this.config.colorBreaks?.length > 1 ? null : (this.config.numColorBands ?? null)
      );
      const opacity = this.config.opacity ?? 0.7;
      const alpha = Math.round(opacity * 255);
      const numDirs = dirValues ? Array.from(dirValues, Number) : null;
      const arrowSize = this.config.arrowSize ?? 18;
      const arrowMinSize = this.config.arrowMinSize ?? Math.max(10, arrowSize * 0.7);
      const arrowMaxSize = this.config.arrowMaxSize ?? Math.max(arrowSize, arrowSize * 1.35);
      const minArrowMagnitude = this.config.minArrowMagnitude ?? 0;
      const dirOffset = this.config.directionAngleOffset ?? 0;

      // Pre-compute per-band colours when colorBreaks are defined (threshold mode).
      // Sample the continuous colormap at each band's actual mid-value so colours
      // match what the x-sst palette produces at that wave height.
      const breaks = this.config.colorBreaks;
      const crMin = this.config.colorRange?.min ?? min;
      const crMax = this.config.colorRange?.max ?? max;
      // Use a focused magnitude reference range for sizing/opacity so typical wave
      // heights fill the full visual range rather than being compressed by the color scale.
      const arrowMagRef = this.config.arrowMagnitudeRef ?? (crMax * 0.7);
      const arrowMagRefMin = this.config.minArrowMagnitude ?? 0;
      const crSpan = crMax - crMin || 1;
      const bandColors = breaks?.length > 1
        ? Array.from({ length: breaks.length - 1 }, (_, i) => {
            const mid = (breaks[i] + breaks[i + 1]) / 2;
            const t = Math.max(0, Math.min(1, (mid - crMin) / crSpan));
            return colormap(t);
          })
        : null;

      // Geometry is static; only colors change between timesteps.
      const colors = [];
      for (const tri of ds.faceTriangles) {
        const [i0, i1, i2] = tri.nodeIndices;
        const val = (nums[i0] + nums[i1] + nums[i2]) / 3;
        if (!Number.isFinite(val)) { colors.push([0, 0, 0, 0]); continue; }
        let rgb;
        if (bandColors) {
          // Find band: values below first break → band 0, above last → last band
          let bi = bandColors.length - 1;
          for (let b = 0; b < breaks.length - 1; b++) { if (val < breaks[b + 1]) { bi = b; break; } }
          rgb = bandColors[bi];
        } else {
          const t = Math.min(1, Math.max(0, (val - min) / span));
          rgb = colormap(t);
        }
        colors.push([rgb[0], rgb[1], rgb[2], alpha]);
      }

      const fillLayer = new PolygonLayer({
        id: `ugrid-${requestId}`,
        beforeId: 'risk-circles',
        data: ds.polygons,
        getPolygon: (d) => d,
        getFillColor: (_, { index }) => colors[index] ?? [0, 0, 0, 0],
        stroked: false,
        extruded: false,
        opacity: 1,
        pickable: false,
        updateTriggers: { getFillColor: requestId },
      });

      const layers = [fillLayer];

      // Shared viewport bounds used by contours and arrows.
      const visibleBounds = (() => {
        const b = this.map.getBounds();
        return { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
      })();
      const currentZoom = this.map.getZoom();

      // Contour lines — halo + line PathLayers + TextLayer labels for major thresholds.
      const contourCfg = this.config.contours;
      // `enabled` = layer has contour capability; `_contoursEnabled` = UI toggle state.
      const contoursOn = this._contoursEnabled && contourCfg?.enabled === true;
      if (contoursOn && contourCfg?.levels?.length > 0
          && currentZoom >= (contourCfg.minZoom ?? 0)) {
        const majorBelow = contourCfg.majorOnlyBelowZoom;
        const activeLevels = (majorBelow && currentZoom < majorBelow)
          ? contourCfg.levels.filter(l => (contourCfg.majorLevels ?? []).includes(l))
          : contourCfg.levels;

        const segments = buildTriangleContours({
          triangles: ds.faceTriangles,
          values: nums,
          levels: activeLevels,
          majorLevels: contourCfg.majorLevels ?? [],
          visibleBounds,
        });

        if (segments.length > 0) {
          const s = contourCfg.style ?? {};
          // Dark halo behind white lines — visible over any wave colour
          layers.push(new PathLayer({
            id: `ugrid-contours-halo-${requestId}`,
            beforeId: 'risk-circles',
            data: segments,
            pickable: false,
            getPath: (d) => d.path,
            getWidth: (d) => d.major
              ? (s.majorWidth ?? 2) + (s.haloWidth ?? 2)
              : (s.minorWidth ?? 1) + (s.haloWidth ?? 2),
            getColor: [8, 18, 35, Math.round((s.haloOpacity ?? 0.4) * 255)],
            widthUnits: 'pixels',
            updateTriggers: { getPath: requestId, getWidth: requestId },
          }));
          layers.push(new PathLayer({
            id: `ugrid-contours-${requestId}`,
            beforeId: 'risk-circles',
            data: segments,
            pickable: false,
            getPath: (d) => d.path,
            getWidth: (d) => d.major ? (s.majorWidth ?? 3) : (s.minorWidth ?? 1.5),
            getColor: (d) => d.major
              ? [255, 255, 255, Math.round((s.majorOpacity ?? 0.92) * 255)]
              : [255, 255, 255, Math.round((s.minorOpacity ?? 0.6) * 255)],
            widthUnits: 'pixels',
            updateTriggers: { getPath: requestId, getWidth: requestId, getColor: requestId },
          }));

          // Labels on major contours — ~4 per level, only above a readable zoom.
          if (currentZoom >= (contourCfg.labelMinZoom ?? 7)) {
            const byLevel = new Map();
            for (const seg of segments) {
              if (!seg.major) continue;
              if (!byLevel.has(seg.level)) byLevel.set(seg.level, []);
              byLevel.get(seg.level).push(seg);
            }
            const labelData = [];
            for (const [level, segs] of byLevel) {
              const stride = Math.max(1, Math.floor(segs.length / 4));
              segs.forEach((seg, i) => {
                if (i % stride !== 0) return;
                labelData.push({
                  position: [(seg.path[0][0] + seg.path[1][0]) / 2, (seg.path[0][1] + seg.path[1][1]) / 2],
                  text: `${level.toFixed(1)} m`,
                });
              });
            }
            if (labelData.length > 0) {
              layers.push(new TextLayer({
                id: `ugrid-contour-labels-${requestId}`,
                beforeId: 'risk-circles',
                data: labelData,
                pickable: false,
                getPosition: (d) => d.position,
                getText: (d) => d.text,
                getSize: 11,
                getColor: [255, 255, 255, 235],
                background: true,
                getBackgroundColor: [8, 18, 35, 200],
                backgroundPadding: [4, 2, 4, 2],
                fontWeight: 700,
                updateTriggers: { getText: requestId },
              }));
            }
          }
        }
      }

      const showDirectionArrows = this.config.showDirectionArrows ?? Boolean(this.config.directionVariable);
      const minArrowZoom = this.config.minArrowZoom ?? DEFAULT_ARROW_MIN_ZOOM;
      if (numDirs && showDirectionArrows && currentZoom >= minArrowZoom) {
        const zoom = currentZoom;
        const visibleTriangles = [];
        for (const tri of ds.faceTriangles) {
          const [i0, i1, i2] = tri.nodeIndices;
          if (!boundsIntersect(tri.bounds, visibleBounds)) continue;
          const hs0 = nums[i0], hs1 = nums[i1], hs2 = nums[i2];
          const d0 = numDirs[i0], d1 = numDirs[i1], d2 = numDirs[i2];
          if (!Number.isFinite(hs0)||!Number.isFinite(hs1)||!Number.isFinite(hs2)||
              !Number.isFinite(d0)||!Number.isFinite(d1)||!Number.isFinite(d2)) continue;
          visibleTriangles.push({
            nodes: tri.nodes,
            values: [hs0, hs1, hs2],
            directions: [d0, d1, d2],
            bounds: tri.bounds,
          });
        }

        const visibleIndex = buildSpatialIndex(visibleTriangles, ds.bounds);
        const spacing = resolveArrowSpacing(this.config, zoom);
        const canvas = this.map.getCanvas();
        const arrows = [];
        for (let y = spacing / 2; y < canvas.height; y += spacing) {
          for (let x = spacing / 2; x < canvas.width; x += spacing) {
            const { lng, lat } = this.map.unproject([x, y]);
            const candidates = getSpatialCandidates(visibleIndex, lng, lat);
            for (const triIndex of candidates) {
              const tri = visibleTriangles[triIndex];
              if (lng < tri.bounds.lonMin || lng > tri.bounds.lonMax ||
                  lat < tri.bounds.latMin || lat > tri.bounds.latMax) continue;
              const bary = computeBarycentric([lng, lat], tri.nodes[0], tri.nodes[1], tri.nodes[2]);
              if (!bary) continue;
              const mag = interpolateScalar(tri.values[0], tri.values[1], tri.values[2], bary);
              const ang = interpolateAngleDeg(tri.directions[0], tri.directions[1], tri.directions[2], bary);
              if (Number.isFinite(mag) && Number.isFinite(ang) && mag >= minArrowMagnitude) {
                arrows.push({ position: [lng, lat], magnitude: mag, angle: normalizeDirForIcon(ang, this.directionMeta, dirOffset, this.config.directionConvention) });
              }
              break;
            }
          }
        }

        layers.push(new IconLayer({
          id: `ugrid-dir-${requestId}`,
          beforeId: 'risk-circles',
          data: arrows,
          pickable: false,
          iconAtlas: DIRECTION_ARROW_ICON,
          iconMapping: { arrow: { x: 0, y: 0, width: 64, height: 64, anchorY: 32 } },
          getIcon: () => 'arrow',
          getPosition: (d) => d.position,
          getAngle: (d) => d.angle,
          getSize: (d) => {
            const t = Math.max(0, Math.min(1, (d.magnitude - arrowMagRefMin) / Math.max(0.1, arrowMagRef - arrowMagRefMin)));
            const tc = Math.sqrt(t); // sqrt curve: amplifies low-to-mid range differences
            return arrowMinSize + (arrowMaxSize - arrowMinSize) * tc;
          },
          getColor: (d) => {
            const t = Math.max(0, Math.min(1, (d.magnitude - arrowMagRefMin) / Math.max(0.1, arrowMagRef - arrowMagRefMin)));
            const tc = Math.sqrt(t);
            const alpha = Math.round(80 + 175 * tc);
            // 'band' mode: tint the white halo with the wave-height band colour so the
            // arrow visually echoes the raster — changes are unmissable during animation.
            if (this.config.arrowColorMode === 'band' && bandColors) {
              let bi = bandColors.length - 1;
              for (let b = 0; b < breaks.length - 1; b++) {
                if (d.magnitude < breaks[b + 1]) { bi = b; break; }
              }
              const [r, g, bc] = bandColors[bi];
              return [r, g, bc, alpha];
            }
            return [20, 35, 50, alpha]; // neutral dark — readable on any raster colour
          },
          sizeUnits: 'pixels',
          sizeMinPixels: arrowMinSize,
          sizeMaxPixels: arrowMaxSize,
          billboard: false,
          updateTriggers: {
            getAngle:   [requestId],
            getSize:    [requestId, arrowMinSize, arrowMaxSize, arrowMagRef, arrowMagRefMin],
            getColor:   [requestId, arrowMagRef, arrowMagRefMin, !!bandColors],
          },
        }));
      }

      this.overlay.setProps({ layers });
      const varUnits = this.config.variable?.includes('dir') ? '°' : this.config.units ?? 'm';
      this.onStatsChange?.(dataMin, dataMax, varUnits, {
        colorMin: min,
        colorMax: max,
        variable: this.config.variable,
      });
      const label = this.timeLabels?.[this.timeIndex] ?? `Timestep ${this.timeIndex + 1}`;
      this.onTimeChange?.(label, this.timeIndex, ds.timeCount - 1);
    } catch (err) {
      this.onErrorChange?.(String(err));
    } finally {
      if (requestId === this.renderRequestId) this.onLoadingChange?.(false);
    }
  }

  async getTimeseriesAtPoint(lng, lat) {
    await this._loadMetadata();
    if (!this.variableArr || !this.dataset) return null;

    // Fast path: delegate to the zarr-api which fetches all chunks server-side
    // in parallel, replacing ~2700 browser HTTP requests with one API call.
    // ugridTimeseriesPath defaults to the Cook Islands route; Niue layers set
    // it to /niue/wave/ugrid/timeseries (backed by a separate Niue mesh) so
    // this never mixes up island datasets.
    if (this.config.ugridApiBase) {
      const path = this.config.ugridTimeseriesPath || '/wave/ugrid/timeseries';
      const apiUrl = `${this.config.ugridApiBase}${path}?lon=${lng}&lat=${lat}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);
      try {
        const response = await fetch(apiUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (response.ok) return await response.json();
        if (response.status === 404) return null;
        console.warn('[UgridOverlay] API returned', response.status, '— falling back to zarr');
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name !== 'AbortError') {
          console.warn('[UgridOverlay] API timeseries failed, falling back to zarr:', err.message);
        }
      }
    }

    // Fallback: direct zarr chunk fetching (slow — one round trip per timestep
    // per variable, since each zarr chunk covers a single timestep).
    const nodes = this.dataset.nodes;
    const [[lonMin, latMin], [lonMax, latMax]] = this.dataset.bounds;
    const margin = Math.max(lonMax - lonMin, latMax - latMin) * 0.05;
    if (lng < lonMin - margin || lng > lonMax + margin || lat < latMin - margin || lat > latMax + margin) return null;
    const bestNode = this.nodeIndex
      ? findNearestNode(this.nodeIndex, nodes, lng, lat)
      : (() => {
          let b = 0, bd = Infinity;
          for (let i = 0; i < nodes.length; i++) {
            const d = (nodes[i][0] - lng) ** 2 + (nodes[i][1] - lat) ** 2;
            if (d < bd) { bd = d; b = i; }
          }
          return b;
        })();
    const extraDefs = this._pointVariableDefs();

    const [hRaw, dirRaw, ...extraRaws] = await Promise.all([
      getSlice(this.variableArr, [null, bestNode]),
      this.directionArr ? getSlice(this.directionArr, [null, bestNode]) : Promise.resolve(null),
      ...extraDefs.map(({ name }) => {
        const arr = this.extraArrs[name];
        return arr ? getSlice(arr, [null, bestNode]).catch(() => null) : Promise.resolve(null);
      }),
    ]);
    const toValues = (raw) => Array.from(raw, (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; });
    const heightValues = toValues(hRaw);
    const variables = [{ name: this.config.variable, units: this.config.units ?? 'm', values: heightValues }];
    if (dirRaw && this.config.directionVariable) {
      variables.push({ name: this.config.directionVariable, units: 'degree', values: toValues(dirRaw), isDirection: true });
    }
    extraDefs.forEach(({ name, units, isDirection }, i) => {
      const raw = extraRaws[i];
      if (raw) variables.push({ name, units: units ?? '', isDirection: !!isDirection, values: toValues(raw) });
    });
    return {
      lon: nodes[bestNode][0], lat: nodes[bestNode][1],
      timeLabels: heightValues.map((_, i) => this.timeLabels?.[i] ?? `Timestep ${i + 1}`),
      variables,
    };
  }

  setOpacity(opacity) {
    this.config = { ...this.config, opacity };
    this._scheduleRender(0);
  }

  setShowContours(enabled) {
    this._contoursEnabled = enabled;
    this._scheduleRender(0);
  }

  setTimeIndex(index) {
    this.timeIndex = Math.max(0, Math.min(index, (this.dataset?.timeCount ?? 1) - 1));
    this._scheduleRender(150);
  }
  getTimeCount() { return this.dataset?.timeCount ?? 1; }

  startPlayback(intervalMs = 700) {
    if (this.playInterval) clearInterval(this.playInterval);
    this.playInterval = setInterval(() => {
      this.setTimeIndex((this.timeIndex + 1) % this.getTimeCount());
    }, intervalMs);
  }
  stopPlayback() {
    if (this.playInterval) { clearInterval(this.playInterval); this.playInterval = null; }
  }

  destroy() {
    this.mounted = false;
    this.stopPlayback();
    if (this.renderTimeout) clearTimeout(this.renderTimeout);
    this.overlay.setProps({ layers: [] });
    this.map.off('moveend', this._boundMove);
    this.map.off('zoomend', this._boundZoom);
    try { this.map.removeControl(this.overlay); } catch {}
  }
}
