// CurrentsParticleOverlay.js — animated flow particles for the Niue currents
// Velocity layer (u/v on a regular lat/lon/depth/time grid).
//
// Ported from niu_current's WindAnimationOverlay.ts (the u/v-components path
// only — this app never needs the speed+direction wave-mode branch), not
// widget1's GPU-shader WaveParticleOverlay: that one is built around
// ZarrDataManager's mesh-to-grid rasterization (UGRID-specific) and a fixed
// square texture, neither of which fits a regular lat/lon grid cleanly.
// This is a plain Canvas2D CPU particle sim instead — particles are tracked
// in real lon/lat, moved with actual map.project()/unproject() each frame,
// and sampled from the native-resolution grid via an O(1) regular-grid index
// lookup (cellIndex) — no resampling/orientation-guessing needed at all.
import { openArray, HTTPStore } from 'zarr';

// Pixels-per-(m/s)-per-second at speedFactor=1 — tuned in the reference so a
// typical current speed produces a readable streak length.
const FLOW_SPEED_MULTIPLIER = 200;

function buildUrl(datasetName, baseUrl) {
  const base = ((baseUrl || '').trim()).replace(/\/+$/, '');
  const ds = (datasetName || '').replace(/^\/+/, '').replace(/\/+$/, '');
  return `${base}/${ds}`;
}

function findNearestIndex(values, target) {
  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < values.length; i++) {
    const dist = Math.abs(values[i] - target);
    if (dist < bestDist) { bestDist = dist; bestIndex = i; }
  }
  return bestIndex;
}

// Shortest absolute angular distance between two longitudes (degrees), so a
// particle at lng -160 correctly matches a grid lon of 200 (0-360 datasets).
function lonDelta(a, b) {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

export class CurrentsParticleOverlay {
  constructor(map, config) {
    this.map = map;
    this.config = config;
    this.mounted = true;

    this.particles = [];
    this.dataBounds = null;
    this.validCells = null;
    this.uValues = null;
    this.vValues = null;
    this.timeIndex = 0;
    this.depthIndex = 0;
    this.depth = config.depth ?? null;
    this._animationFrame = null;
    this._lastTimestamp = 0;
    this.isPanning = false;
    this._loadGen = 0;

    this.onLoadingChange = null;
    this.onErrorChange = null;

    this.canvas = document.createElement('canvas');
    // Appended directly into the map's own container (not document.body):
    // the whole widget is wrapped in a fixed, very-high-z-index host div (it
    // overlays a host page), so a body-level fixed canvas can only ever paint
    // entirely above or entirely below that whole wrapper — there's no
    // z-index that lands it "above the raster, below the legend" from
    // outside, since the legend lives inside that same wrapper. Mounting
    // inside the map container instead lets it share the container's local
    // stacking context with the legend, so a z-index between the raster
    // (auto) and .marine-legend (999) sandwiches it correctly. Confirmed
    // empirically that deck.gl's raster canvas does NOT have any special
    // "always on top" behavior against plain sibling DOM here — that issue
    // was specific to maplibre's own Popup/Marker panes, not general siblings.
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:500;';
    map.getContainer().appendChild(this.canvas);
    this.context = this.canvas.getContext('2d', { alpha: true });

    this._handleResize = () => this._syncCanvasRect();
    this._handleMoveStart = () => { this.isPanning = true; };
    this._handleMoveEnd = () => {
      this.isPanning = false;
      this._syncCanvasRect();
      this._reseedHidden();
    };

    map.on('resize', this._handleResize);
    map.on('movestart', this._handleMoveStart);
    map.on('moveend', this._handleMoveEnd);
    map.on('zoomend', this._handleMoveEnd);
    window.addEventListener('resize', this._handleResize);

    this._syncCanvasRect();
    this._init();
  }

  async _init() {
    this.onLoadingChange?.(true);
    try {
      await this._loadStaticFieldData();
      if (!this.mounted) return;
      // setTimeIndex()/setDepth() can be called synchronously right after
      // construction (before this async setup finishes) — they just record
      // the requested value while !_ready, and this initial load picks up
      // whatever they last set instead of racing them for a still-undefined
      // this._uArr.
      this._ready = true;
      await this._loadWindData(this.timeIndex);
      if (!this.mounted) return;
      this._seedParticles(true);
      this._startAnimation();
    } catch (err) {
      if (this.mounted) this.onErrorChange?.(String(err));
    } finally {
      if (this.mounted) this.onLoadingChange?.(false);
    }
  }

  async _loadStaticFieldData() {
    const storeUrl = buildUrl(this.config.datasetName, this.config.zarrBaseUrl);
    // no-cache: Wasabi sends no Cache-Control on this bucket, so without
    // forcing revalidation a fresh forecast run overwriting the same S3 keys
    // can sit invisible behind a stale browser-cached response (wrong time
    // range) until the user hard-refreshes.
    const store = new HTTPStore(storeUrl, { fetchOptions: { credentials: 'omit', cache: 'no-cache' } });
    // zarr.js sends HEAD requests for containsItem() checks; the zarr-api only supports GET.
    store.containsItem = async (item) => {
      try {
        const resp = await fetch(`${storeUrl}/${item}`, { method: 'GET', credentials: 'omit', cache: 'no-cache' });
        return resp.status === 200;
      } catch { return false; }
    };

    const [uArr, vArr, latArr, lonArr, depthArr] = await Promise.all([
      openArray({ store, path: 'u', mode: 'r' }),
      openArray({ store, path: 'v', mode: 'r' }),
      openArray({ store, path: 'lat', mode: 'r' }),
      openArray({ store, path: 'lon', mode: 'r' }),
      openArray({ store, path: 'depth', mode: 'r' }),
    ]);
    this._uArr = uArr;
    this._vArr = vArr;
    this._timeCount = uArr.shape[0];

    const [latValues, lonValuesRaw, depthValues] = await Promise.all([
      latArr.get(null).then((r) => Array.from(r.data, Number)),
      lonArr.get(null).then((r) => Array.from(r.data, Number)),
      depthArr.get(null).then((r) => Array.from(r.data, Number)),
    ]);
    this._depthLevels = depthValues;
    this.depthIndex = findNearestIndex(depthValues, this.depth ?? depthValues[0]);

    // Fold 0-360 longitude (Niue's grid is ~188-194°E) down to -180..180 to
    // match map/particle coordinates — only when the whole axis is past 180°
    // so a domain straddling the antimeridian isn't corrupted.
    const lonValues = lonValuesRaw.every((v) => v > 180) ? lonValuesRaw.map((v) => v - 360) : lonValuesRaw;

    this._latValues = latValues;
    this._lonValues = lonValues;
    this._width = lonValues.length;
    this._height = latValues.length;

    const lonMin = Math.min(...lonValues);
    const lonMax = Math.max(...lonValues);
    const latMin = Math.min(...latValues);
    const latMax = Math.max(...latValues);
    this._lonStep = this._width > 1 ? Math.abs(lonMax - lonMin) / (this._width - 1) : 1;
    this._latStep = this._height > 1 ? Math.abs(latMax - latMin) / (this._height - 1) : 1;
    // Signed start/step (not just min/max) so cellIndex() works regardless of
    // whether the store's lat/lon arrays run ascending or descending.
    this._lonStart = lonValues[0];
    this._latStart = latValues[0];
    this._lonStepSigned = this._width > 1 ? (lonValues[this._width - 1] - lonValues[0]) / (this._width - 1) : 1;
    this._latStepSigned = this._height > 1 ? (latValues[this._height - 1] - latValues[0]) / (this._height - 1) : 1;
    this._lonWraps = this._width * this._lonStep >= 359;
    this.dataBounds = { lonMin, lonMax, latMin, latMax };
  }

  async _loadWindData(timeIdx) {
    const gen = ++this._loadGen;
    const t = Math.max(0, Math.min(timeIdx, this._timeCount - 1));

    const [uRaw, vRaw] = await Promise.all([
      this._uArr.get([t, this.depthIndex, null, null]).then((r) => r.flatten()),
      this._vArr.get([t, this.depthIndex, null, null]).then((r) => r.flatten()),
    ]);
    if (!this.mounted || gen !== this._loadGen) return;

    const uValues = Array.from(uRaw, Number);
    const vValues = Array.from(vRaw, Number);
    const validCells = new Set();
    for (let i = 0; i < uValues.length; i++) {
      const u = uValues[i];
      const v = vValues[i];
      // Exact (0,0) is this dataset's land/masked sentinel (no _FillValue —
      // see mapLayersConfig.js) — treat it as "no current" the same way
      // niu_current's speed>0 check does for its own zero-speed cells.
      if (Number.isFinite(u) && Number.isFinite(v) && (u !== 0 || v !== 0)) {
        validCells.add(i);
      }
    }

    this.uValues = uValues;
    this.vValues = vValues;
    this.validCells = validCells;
    this.timeIndex = t;
  }

  _syncCanvasRect() {
    const container = this.map.getContainer();
    const rect = container.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this._clearCanvas();
  }

  _clearCanvas() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // Map a lon/lat to its flattened grid index in O(1) (regular rectilinear grid).
  _cellIndex(lon, lat) {
    if (!this.uValues) return -1;
    const latIdx = Math.round((lat - this._latStart) / this._latStepSigned);
    if (latIdx < 0 || latIdx > this._height - 1) return -1;

    // Normalize the longitude offset into index space modulo a full turn, so
    // a -180..180 particle longitude maps onto a 0..360-encoded grid.
    const period = 360 / Math.abs(this._lonStepSigned);
    let rel = (lon - this._lonStart) / this._lonStepSigned;
    rel = ((rel % period) + period) % period;
    let lonIdx = Math.round(rel);
    if (lonIdx >= this._width) {
      lonIdx = this._lonWraps ? lonIdx % this._width : -1;
      if (lonIdx < 0) return -1;
    }

    if (Math.abs(this._latValues[latIdx] - lat) > this._latStep * 1.5) return -1;
    if (lonDelta(this._lonValues[lonIdx], lon) > this._lonStep * 1.5) return -1;

    return latIdx * this._width + lonIdx;
  }

  _isValidWindPoint(lon, lat) {
    if (!this.validCells) return false;
    const idx = this._cellIndex(lon, lat);
    return idx >= 0 && this.validCells.has(idx);
  }

  _getCurrentAt(lon, lat) {
    if (!this.uValues) return [0, 0];
    const idx = this._cellIndex(lon, lat);
    if (idx < 0) return [0, 0];
    return [this.uValues[idx], this.vValues[idx]];
  }

  _spawn(lon, lat) {
    return { lon, lat, age: 0, maxAge: 80 + Math.floor(Math.random() * 60) };
  }

  _randomParticle() {
    const width = this.canvas.clientWidth || this.map.getContainer().clientWidth;
    const height = this.canvas.clientHeight || this.map.getContainer().clientHeight;

    for (let attempts = 0; attempts < 60; attempts++) {
      const ll = this.map.unproject([Math.random() * width, Math.random() * height]);
      if (this._isValidWindPoint(ll.lng, ll.lat)) return this._spawn(ll.lng, ll.lat);
    }
    if (this.dataBounds) {
      return this._spawn(
        (this.dataBounds.lonMin + this.dataBounds.lonMax) / 2,
        (this.dataBounds.latMin + this.dataBounds.latMax) / 2
      );
    }
    const center = this.map.getCenter();
    return this._spawn(center.lng, center.lat);
  }

  _seedParticles(resetAll) {
    const count = this.config.particleCount ?? 2000;
    if (resetAll || this.particles.length === 0) {
      this.particles = Array.from({ length: count }, () => this._randomParticle());
      return;
    }
    if (this.particles.length < count) {
      while (this.particles.length < count) this.particles.push(this._randomParticle());
    } else if (this.particles.length > count) {
      this.particles.length = count;
    }
    for (let i = 0; i < this.particles.length; i++) {
      if (!this._isValidWindPoint(this.particles[i].lon, this.particles[i].lat)) {
        this.particles[i] = this._randomParticle();
      }
    }
  }

  _reseedHidden() {
    if (this.particles.length === 0) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const pt = this.map.project({ lng: p.lon, lat: p.lat });
      const onScreen = pt.x >= 0 && pt.x <= w && pt.y >= 0 && pt.y <= h;
      if (!onScreen || !this._isValidWindPoint(p.lon, p.lat)) this.particles[i] = this._randomParticle();
    }
  }

  _ensureVisibleParticles() {
    if (this.particles.length === 0) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const hasVisible = this.particles.some((p) => {
      const pt = this.map.project({ lng: p.lon, lat: p.lat });
      return pt.x >= 0 && pt.x <= w && pt.y >= 0 && pt.y <= h;
    });
    if (!hasVisible) this._seedParticles(true);
  }

  _fadeFrame() {
    this.context.save();
    this.context.globalCompositeOperation = 'destination-in';
    this.context.fillStyle = 'rgba(0, 0, 0, 0.92)';
    this.context.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    this.context.restore();
  }

  _updateParticles(deltaSeconds) {
    const speedFactor = this.config.speedFactor ?? 0.35;
    const canvasWidth = this.canvas.clientWidth;
    const canvasHeight = this.canvas.clientHeight;
    const segments = [];

    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      const [u, v] = this._getCurrentAt(particle.lon, particle.lat);
      const speed = Math.hypot(u, v);
      if (!Number.isFinite(speed) || speed <= 0.0001) {
        this.particles[i] = this._randomParticle();
        continue;
      }

      const previous = this.map.project({ lng: particle.lon, lat: particle.lat });
      const dx = u * speedFactor * FLOW_SPEED_MULTIPLIER * deltaSeconds;
      const dy = -v * speedFactor * FLOW_SPEED_MULTIPLIER * deltaSeconds;
      const nextPoint = { x: previous.x + dx, y: previous.y + dy };
      const nextLngLat = this.map.unproject([nextPoint.x, nextPoint.y]);

      const hasValidWind = this._isValidWindPoint(nextLngLat.lng, nextLngLat.lat);
      const outOfCanvas =
        nextPoint.x < -20 || nextPoint.x > canvasWidth + 20 ||
        nextPoint.y < -20 || nextPoint.y > canvasHeight + 20;

      particle.age++;
      if (!hasValidWind || outOfCanvas || particle.age > particle.maxAge) {
        this.particles[i] = this._randomParticle();
        continue;
      }

      particle.lon = nextLngLat.lng;
      particle.lat = nextLngLat.lat;
      segments.push({ x0: previous.x, y0: previous.y, x1: nextPoint.x, y1: nextPoint.y, speed });
    }
    return segments;
  }

  _drawSegments(segments) {
    const particleSize = this.config.particleSize ?? 2.6;
    const floor = this.config.minSpeed ?? 0;
    const scale = this.config.maxSpeed ?? 0.8;
    const range = Math.max(scale - floor, 1e-6);

    // Bright streaks drawn additively so they glow on top of the coloured
    // speed raster instead of blending into a same-coloured background.
    this.context.save();
    this.context.globalCompositeOperation = 'lighter';
    this.context.lineCap = 'round';
    this.context.lineJoin = 'round';
    for (const seg of segments) {
      const t = Math.max(0, Math.min(1, (seg.speed - floor) / range));
      const alpha = 0.5 + 0.3 * t;
      const lineWidth = Math.max(0.8, particleSize * (0.5 + 0.9 * t));
      this.context.beginPath();
      this.context.moveTo(seg.x0, seg.y0);
      this.context.lineTo(seg.x1, seg.y1);
      this.context.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      this.context.lineWidth = lineWidth;
      this.context.stroke();
    }
    this.context.restore();
  }

  _startAnimation() {
    this._lastTimestamp = performance.now();
    const loop = (now) => {
      if (!this.mounted) return;
      const delta = Math.min(0.033, (now - this._lastTimestamp) / 1000);
      this._lastTimestamp = now;

      if (this.isPanning) {
        this._clearCanvas();
        this._animationFrame = requestAnimationFrame(loop);
        return;
      }

      this._fadeFrame();
      const segments = this._updateParticles(delta);
      this._drawSegments(segments);
      this._animationFrame = requestAnimationFrame(loop);
    };
    this._animationFrame = requestAnimationFrame(loop);
    // The very first seed can land looking oddly clustered — e.g. if the
    // map's camera/layout hadn't fully settled the instant this overlay was
    // constructed. A cheap full reseed shortly after start (2000 points is
    // nothing) irons that out immediately instead of waiting ~2s for it to
    // disperse naturally as individual particles age out and respawn.
    setTimeout(() => { if (this.mounted) this._seedParticles(true); }, 400);
    setTimeout(() => { if (this.mounted) this._ensureVisibleParticles(); }, 1000);
  }

  setTimeIndex(index) {
    this.timeIndex = index;
    // Not ready yet (static field data — lat/lon/depth/u/v arrays — still
    // loading): _init()'s own initial _loadWindData(this.timeIndex) call
    // will pick up this value once it resolves; calling it again here would
    // race that load for a still-undefined this._uArr.
    if (!this._ready) return;
    // A full reseed would teleport every particle to a new random spot each
    // tick (looks like stutter, not flow) — only replace ones no longer over
    // valid data, the rest keep animating continuously.
    this._loadWindData(index)
      .then(() => {
        if (!this.mounted) return;
        this._seedParticles(false);
        this._ensureVisibleParticles();
      })
      .catch((err) => { if (this.mounted) this.onErrorChange?.(String(err)); });
  }

  // depthMeters is a value from the dataset's own depth coordinate (e.g. -30),
  // resolved to the nearest real index — same convention as ZarrOverlay.setDepth.
  setDepth(depthMeters) {
    this.depth = depthMeters;
    if (!this._depthLevels) return;
    const idx = findNearestIndex(this._depthLevels, depthMeters);
    if (idx === this.depthIndex) return;
    this.depthIndex = idx;
    this._loadWindData(this.timeIndex)
      .then(() => {
        if (!this.mounted) return;
        this._seedParticles(false);
        this._ensureVisibleParticles();
      })
      .catch((err) => { if (this.mounted) this.onErrorChange?.(String(err)); });
  }

  destroy() {
    this.mounted = false;
    this.onLoadingChange = null;
    this.onErrorChange = null;
    this._loadGen++;
    if (this._animationFrame) cancelAnimationFrame(this._animationFrame);
    this.map.off('resize', this._handleResize);
    this.map.off('movestart', this._handleMoveStart);
    this.map.off('moveend', this._handleMoveEnd);
    this.map.off('zoomend', this._handleMoveEnd);
    window.removeEventListener('resize', this._handleResize);
    this.canvas.remove();
  }
}
