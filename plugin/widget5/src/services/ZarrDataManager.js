/**
 * ZarrDataManager - Production-ready Zarr data loader for GPU visualization
 * 
 * Features:
 * - Sliding cache window for smooth animation (pre-fetches ahead)
 * - Typed array output ready for GPU texture upload
 * - Handles NaN/fill values
 * - Configurable cache size and prefetch strategy
 * - Memory-efficient eviction policy
 * 
 * Usage:
 *   const manager = new ZarrDataManager('http://localhost:8080/SWAN_UGRID.zarr');
 *   await manager.init();
 *   const data = await manager.getTimestepData(5, ['transp_x', 'transp_y', 'hs']);
 */

import { openArray, HTTPStore } from 'zarr';

export default class ZarrDataManager {
  constructor(zarrUrl, options = {}) {
    // Convert relative URLs to absolute URLs for HTTPStore
    if (zarrUrl.startsWith('/')) {
      // Relative path - make it absolute using window.location
      this.zarrUrl = new URL(zarrUrl, window.location.origin).href;
    } else {
      this.zarrUrl = zarrUrl;
    }
    
    this.cacheSize = options.cacheSize || 8;
    this.prefetchWindow = options.prefetchWindow || 4;
    this.cache = new Map();
    this.loading = new Map(); // Track in-flight requests
    this.gridCache = new Map(); // meshToGrid() results, keyed by `${timestep}:${variable}:${gridSize}`
    this.metadata = null;
    this.arrays = {};
    
    // Performance tracking
    this.stats = {
      cacheHits: 0,
      cacheMisses: 0,
      bytesLoaded: 0,
      requestCount: 0
    };
  }

  async init() {
    console.log('🔧 Initializing ZarrDataManager:', this.zarrUrl);
    
    try {
      this.store = new HTTPStore(this.zarrUrl);
      
      // Load metadata arrays (lon, lat, triangles)
      console.log('📍 Loading mesh coordinates...');
      this.lonArray = await openArray({ store: this.store, path: 'mesh_node_lon', mode: 'r' });
      this.latArray = await openArray({ store: this.store, path: 'mesh_node_lat', mode: 'r' });
      
      const [lonData, latData] = await Promise.all([
        this.lonArray.get(null),  // Use get() instead of getRaw() to handle decompression
        this.latArray.get(null)
      ]);
      
      this.lon = new Float32Array(lonData.data);
      this.lat = new Float32Array(latData.data);
      this.nodeCount = this.lon.length;
      
      console.log(`✅ Loaded ${this.nodeCount} mesh nodes`);

      // Load time coordinates
      try {
        const timeArray = await openArray({ store: this.store, path: 'time', mode: 'r' });
        const timeData = await timeArray.get(null);
        const timeUnits = await this._fetchTimeUnits();
        this.times = Array.from(timeData.data).map((t) => this._decodeTimeValue(t, timeUnits));
        this.timestepCount = this.times.length;
        console.log(`⏱️  ${this.timestepCount} timesteps available`);
      } catch (e) {
        // zarr.js 0.6.3 has no dtype entry for <i8 (64-bit int) — see
        // node_modules/zarr/lib/nestedArray/types.js — so any `time` array
        // encoded that way throws here even though it genuinely exists in
        // the store (confirmed for rarotonga_ugrid.zarr). UgridOverlay.js
        // already works around this by reading only the small .zmetadata
        // JSON (never the broken binary chunk) to recover real timestamps;
        // apply the same fix here instead of losing them.
        const synthesized = await this._synthesizeTimesFromMetadata();
        if (synthesized) {
          this.times = synthesized;
          this.timestepCount = synthesized.length;
          console.log(`⏱️  ${this.timestepCount} timesteps recovered from time/.zattrs metadata (array dtype undecodable by zarr.js, likely <i8)`);
        } else {
          console.warn('⚠️  No explicit time coordinate found; inferring timestep count from variable shapes when available');
          this.times = [];
          this.timestepCount = 0;
        }
      }

      // Calculate bounds
      this.bounds = [
        Math.min(...this.lon),
        Math.min(...this.lat),
        Math.max(...this.lon),
        Math.max(...this.lat)
      ];
      
      console.log(`📦 Bounds: [${this.bounds.map(b => b.toFixed(2)).join(', ')}]`);
      
      this.metadata = {
        nodeCount: this.nodeCount,
        timestepCount: this.timestepCount,
        bounds: this.bounds,
        times: this.times
      };
      
      return this.metadata;
    } catch (error) {
      console.error('❌ Failed to initialize ZarrDataManager:', error);
      throw error;
    }
  }

  /**
   * Fetch just the `time` variable's CF `units` attribute (e.g. "hours since
   * 2026-07-08 06:00:00") via the store's small .zmetadata JSON — cheap and
   * independent of whether the `time` array's own dtype is decodable.
   */
  async _fetchTimeUnits() {
    try {
      const resp = await fetch(`${this.zarrUrl}/.zmetadata`);
      if (!resp.ok) return null;
      const meta = await resp.json();
      return meta?.metadata?.['time/.zattrs']?.units ?? null;
    } catch {
      return null;
    }
  }

  /** Parse a CF `"<unit> since <base>"` units string into {baseDate, unitMs}. */
  _parseTimeUnits(units) {
    if (!units) return null;
    const m = units.match(/(seconds|minutes|hours|days)\s+since\s+(.+)/i);
    if (!m) return null;
    const unitMs = { seconds: 1e3, minutes: 60e3, hours: 3600e3, days: 86400e3 }[m[1].toLowerCase()];
    const baseStr = m[2].trim().replace(' ', 'T') + (m[2].includes('Z') ? '' : 'Z');
    const baseDate = new Date(baseStr);
    if (isNaN(baseDate)) return null;
    return { baseDate, unitMs };
  }

  /**
   * Decode a raw `time` array value into an ISO string, honoring the CF
   * `units` convention (e.g. "hours since <base>") when available. Falls
   * back to treating the value as Unix seconds if `units` is missing/
   * unparseable, matching this method's original (pre-fix) behavior.
   */
  _decodeTimeValue(rawValue, units) {
    const parsed = this._parseTimeUnits(units);
    if (parsed) {
      return new Date(parsed.baseDate.getTime() + rawValue * parsed.unitMs).toISOString();
    }
    return new Date(rawValue * 1000).toISOString();
  }

  /**
   * Recover timestep count + real timestamps without ever decoding the
   * `time` array's binary chunk data — used when that array's dtype isn't
   * supported by zarr.js (see the catch block in init()). Reads time/.zarray
   * (for shape[0], the step count) and time/.zattrs (for units, to compute
   * real dates), both plain JSON served from the same .zmetadata document,
   * and assumes a uniform interval implied by `units` across all steps.
   */
  async _synthesizeTimesFromMetadata() {
    try {
      const resp = await fetch(`${this.zarrUrl}/.zmetadata`);
      if (!resp.ok) return null;
      const meta = await resp.json();
      const timeCount = meta?.metadata?.['time/.zarray']?.shape?.[0];
      if (!timeCount) return null;

      const parsed = this._parseTimeUnits(meta?.metadata?.['time/.zattrs']?.units);
      if (!parsed) return null;

      return Array.from({ length: timeCount }, (_, i) =>
        new Date(parsed.baseDate.getTime() + i * parsed.unitMs).toISOString()
      );
    } catch {
      return null;
    }
  }

  async loadVariable(variableName) {
    if (this.arrays[variableName]) {
      return this.arrays[variableName];
    }
    
    try {
      console.log(`📂 Opening Zarr array: ${variableName}`);
      this.arrays[variableName] = await openArray({ 
        store: this.store, 
        path: variableName, 
        mode: 'r' 
      });

      if (this.timestepCount === 0 && this.arrays[variableName].shape?.length === 2) {
        this.timestepCount = this.arrays[variableName].shape[0];
        this.metadata = this.metadata
          ? { ...this.metadata, timestepCount: this.timestepCount }
          : this.metadata;
        console.log(`⏱️  Inferred ${this.timestepCount} timesteps from ${variableName} shape`);
      }

      return this.arrays[variableName];
    } catch (error) {
      console.error(`❌ Failed to load variable ${variableName}:`, error);
      throw error;
    }
  }

  async getTimestepData(timestep, variables, options = {}) {
    const { prefetch = true } = options;
    const cacheKey = `${timestep}:${variables.join(',')}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      this.stats.cacheHits++;
      return this.cache.get(cacheKey);
    }
    
    // Check if already loading
    if (this.loading.has(cacheKey)) {
      return this.loading.get(cacheKey);
    }
    
    this.stats.cacheMisses++;
    this.stats.requestCount++;
    
    // Start loading
    const loadPromise = this._loadTimestepData(timestep, variables);
    this.loading.set(cacheKey, loadPromise);
    
    try {
      const data = await loadPromise;
      this.cache.set(cacheKey, data);
      this.loading.delete(cacheKey);
      
      // Trigger prefetch only for foreground requests.
      if (prefetch) {
        this._prefetchAhead(timestep, variables);
      }
      
      // Evict old entries if cache is full
      this._evictOldest(timestep);
      
      return data;
    } catch (error) {
      this.loading.delete(cacheKey);
      throw error;
    }
  }

  async _loadTimestepData(timestep, variables) {
    const startTime = performance.now();
    const data = {};
    
    await Promise.all(variables.map(async (varName) => {
      const array = await this.loadVariable(varName);
      const shape = array.shape;
      
      let rawData;
      if (shape.length === 2) {
        // Time-varying: [time, nodes]
        rawData = await array.get([timestep, null]);
      } else if (shape.length === 1) {
        // Static: [nodes]
        rawData = await array.get(null);
      } else {
        throw new Error(`Unsupported shape for ${varName}: ${shape}`);
      }
      
      // Convert to Float32Array and handle fill values
      const float32Data = new Float32Array(rawData.data);
      data[varName] = this._maskFillValues(float32Data);
      
      this.stats.bytesLoaded += float32Data.byteLength;
    }));
    
    const elapsed = performance.now() - startTime;
    console.log(`⚡ Loaded timestep ${timestep} (${variables.join(', ')}) in ${elapsed.toFixed(1)}ms`);
    
    return data;
  }

  _maskFillValues(array) {
    // Replace common fill values with NaN
    const fillValues = [-999, -9999, 1e20, 9.96921e36];
    for (let i = 0; i < array.length; i++) {
      const val = array[i];
      if (!isFinite(val) || fillValues.some(fv => Math.abs(val - fv) < 1)) {
        array[i] = NaN;
      }
    }
    return array;
  }

  async _prefetchAhead(currentTimestep, variables) {
    const prefetchPromises = [];
    for (let i = 1; i <= this.prefetchWindow; i++) {
      const nextStep = currentTimestep + i;
      if (nextStep < this.timestepCount) {
        const cacheKey = `${nextStep}:${variables.join(',')}`;
        if (!this.cache.has(cacheKey) && !this.loading.has(cacheKey)) {
          prefetchPromises.push(
            this.getTimestepData(nextStep, variables, { prefetch: false }).catch(err => {
              console.warn(`⚠️  Prefetch failed for timestep ${nextStep}:`, err);
            })
          );
        }
      }
    }
    
    if (prefetchPromises.length > 0) {
      console.log(`🔮 Prefetching ${prefetchPromises.length} timesteps ahead...`);
      await Promise.all(prefetchPromises);
    }
  }

  _evictOldest(currentTimestep) {
    if (this.cache.size <= this.cacheSize) return;
    
    // Evict timesteps that are furthest from current
    const entries = Array.from(this.cache.keys())
      .map(key => {
        const timestep = parseInt(key.split(':')[0]);
        return { key, timestep, distance: Math.abs(timestep - currentTimestep) };
      })
      .sort((a, b) => b.distance - a.distance);
    
    const toEvict = entries.slice(this.cacheSize);
    toEvict.forEach(({ key }) => {
      this.cache.delete(key);
      console.log(`🗑️  Evicted cache entry: ${key}`);
    });
  }

  /**
   * Get 4 consecutive timesteps for cubic interpolation
   */
  /**
   * The 4 timesteps (t-1, t, t+1, t+2) used for cubic interpolation, clamped to
   * the available range. Shared by getInterpolationWindow() and callers that
   * need the timestep list without fetching data (e.g. to drive getGriddedTimestep).
   */
  getInterpolationTimesteps(centerTimestep) {
    if (this.timestepCount <= 1) {
      const t = Math.max(0, centerTimestep);
      return [t, t, t, t];
    }
    const t = centerTimestep;
    return [
      Math.max(0, t - 1),
      t,
      Math.min(this.timestepCount - 1, t + 1),
      Math.min(this.timestepCount - 1, t + 2),
    ];
  }

  async getInterpolationWindow(centerTimestep, variables) {
    const timesteps = this.getInterpolationTimesteps(centerTimestep);
    const data = await Promise.all(timesteps.map((t) => this.getTimestepData(t, variables)));
    return { timesteps, data };
  }

  /**
   * Spatial bucket index over mesh node positions (not values), so it's built
   * once and reused across every timestep/variable — only node coordinates
   * change if the mesh itself changes, never the data grid onto it.
   * Bucket count targets ~4 nodes/bucket so IDW neighbor search stays O(1).
   */
  _getSpatialIndex() {
    if (this._spatialIndex) return this._spatialIndex;

    const [minLon, minLat, maxLon, maxLat] = this.bounds;
    const lonSpan = (maxLon - minLon) || 1;
    const latSpan = (maxLat - minLat) || 1;
    const bucketsPerSide = Math.max(16, Math.round(Math.sqrt(this.nodeCount / 4)));
    const buckets = new Array(bucketsPerSide * bucketsPerSide);
    for (let i = 0; i < buckets.length; i++) buckets[i] = [];

    for (let i = 0; i < this.nodeCount; i++) {
      const bx = Math.min(bucketsPerSide - 1, Math.max(0, Math.floor(((this.lon[i] - minLon) / lonSpan) * bucketsPerSide)));
      const by = Math.min(bucketsPerSide - 1, Math.max(0, Math.floor(((this.lat[i] - minLat) / latSpan) * bucketsPerSide)));
      buckets[by * bucketsPerSide + bx].push(i);
    }

    this._spatialIndex = { buckets, bucketsPerSide, minLon, minLat, lonSpan, latSpan };
    return this._spatialIndex;
  }

  /**
   * Inverse-distance-weighted value at (lon, lat) from the k nearest finite
   * mesh nodes, found by expanding outward ring-by-ring through the spatial
   * index. Returns null if no finite node is within range (genuine gap —
   * left to _fillGridHoles).
   *
   * Maintains a fixed-size top-k via insertion (k=8, so worst case is a tiny
   * O(k) shift) instead of collecting per-candidate objects into an array and
   * sorting — profiling showed the original version spending ~80% of its time
   * in JS allocation/sort for this loop (65536 cells x ~20-30 candidates each
   * was 1M+ short-lived object allocations per grid). This version reuses two
   * scratch typed arrays across calls instead.
   */
  _idwAt(lon, lat, meshData, index, k = 8, power = 2) {
    const { buckets, bucketsPerSide, minLon, minLat, lonSpan, latSpan } = index;
    const bx = Math.min(bucketsPerSide - 1, Math.max(0, Math.floor(((lon - minLon) / lonSpan) * bucketsPerSide)));
    const by = Math.min(bucketsPerSide - 1, Math.max(0, Math.floor(((lat - minLat) / latSpan) * bucketsPerSide)));

    if (!this._idwBestDistSq || this._idwBestDistSq.length !== k) {
      this._idwBestDistSq = new Float64Array(k);
      this._idwBestValue = new Float64Array(k);
    }
    const bestDistSq = this._idwBestDistSq;
    const bestValue = this._idwBestValue;
    let count = 0;

    for (let radius = 0; radius <= bucketsPerSide; radius++) {
      const yLo = Math.max(0, by - radius), yHi = Math.min(bucketsPerSide - 1, by + radius);
      for (let cy = yLo; cy <= yHi; cy++) {
        const dyAbs = Math.abs(cy - by);
        const xLo = Math.max(0, bx - radius), xHi = Math.min(bucketsPerSide - 1, bx + radius);
        for (let cx = xLo; cx <= xHi; cx++) {
          if (Math.max(Math.abs(cx - bx), dyAbs) !== radius) continue; // only this ring's new cells
          const bucket = buckets[cy * bucketsPerSide + cx];
          for (let bi = 0; bi < bucket.length; bi++) {
            const nodeIdx = bucket[bi];
            const v = meshData[nodeIdx];
            if (!isFinite(v)) continue;
            const dlon = this.lon[nodeIdx] - lon;
            const dlat = this.lat[nodeIdx] - lat;
            const distSq = dlon * dlon + dlat * dlat;

            if (count < k) {
              let pos = count;
              while (pos > 0 && bestDistSq[pos - 1] > distSq) {
                bestDistSq[pos] = bestDistSq[pos - 1];
                bestValue[pos] = bestValue[pos - 1];
                pos--;
              }
              bestDistSq[pos] = distSq;
              bestValue[pos] = v;
              count++;
            } else if (distSq < bestDistSq[k - 1]) {
              let pos = k - 1;
              while (pos > 0 && bestDistSq[pos - 1] > distSq) {
                bestDistSq[pos] = bestDistSq[pos - 1];
                bestValue[pos] = bestValue[pos - 1];
                pos--;
              }
              bestDistSq[pos] = distSq;
              bestValue[pos] = v;
            }
          }
        }
      }
      // One extra ring past first reaching k, so the result isn't biased
      // toward whichever ring happened to fill the quota first.
      if (count >= k && radius > 0) break;
    }

    if (count === 0) return null;
    if (bestDistSq[0] < 1e-12) return bestValue[0]; // exact/near-exact node hit

    let weightSum = 0, valueSum = 0;
    for (let i = 0; i < count; i++) {
      const w = 1 / Math.pow(bestDistSq[i], power / 2);
      weightSum += w;
      valueSum += w * bestValue[i];
    }
    return valueSum / weightSum;
  }

  /**
   * Convert unstructured mesh data to a regular grid for GPU texture upload.
   *
   * Was nearest-neighbor-per-node (each node claims its single grid cell,
   * leaving a discrete "stair-step" field with sharp per-cell boundaries).
   * Now inverse-distance-weighted from the k nearest mesh nodes per grid
   * cell, giving a continuous field instead of blocky quantization — the
   * RK4 particle advection and cubic temporal interpolation downstream can
   * only be as smooth as the field they're integrating over.
   */
  meshToGrid(meshData, gridSize = 256) {
    const [minLon, minLat, maxLon, maxLat] = this.bounds;
    const grid = new Float32Array(gridSize * gridSize).fill(NaN);
    const index = this._getSpatialIndex();
    const lonSpan = maxLon - minLon;
    const latSpan = maxLat - minLat;

    for (let gy = 0; gy < gridSize; gy++) {
      const lat = minLat + (gy / (gridSize - 1)) * latSpan;
      for (let gx = 0; gx < gridSize; gx++) {
        const lon = minLon + (gx / (gridSize - 1)) * lonSpan;
        const value = this._idwAt(lon, lat, meshData, index);
        if (value !== null) grid[gy * gridSize + gx] = value;
      }
    }

    // Safety net for genuine gaps beyond the search radius (e.g. isolated
    // domain edges) — should rarely fire now that IDW covers most of the area.
    this._fillGridHoles(grid, gridSize);

    return grid;
  }

  _fillGridHoles(grid, size) {
    const iterations = 3;
    for (let iter = 0; iter < iterations; iter++) {
      const filled = new Float32Array(grid);
      for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
          const idx = y * size + x;
          if (!isFinite(grid[idx])) {
            const neighbors = [
              grid[(y - 1) * size + x],     // N
              grid[(y + 1) * size + x],     // S
              grid[y * size + (x - 1)],     // W
              grid[y * size + (x + 1)],     // E
            ].filter(v => isFinite(v));
            
            if (neighbors.length > 0) {
              filled[idx] = neighbors.reduce((a, b) => a + b, 0) / neighbors.length;
            }
          }
        }
      }
      grid.set(filled);
    }
  }

  /**
   * meshToGrid() is O(nodeCount + gridSize²) and runs synchronously on the main
   * thread, so scrubbing the time slider (which regrids 4 interpolation-window
   * timesteps per variable) can get expensive. Cache the gridded result per
   * (timestep, variable, gridSize) — consecutive timesteps share 3 of their 4
   * interpolation-window entries, so this cuts repeat regridding substantially.
   */
  async getGriddedTimestep(timestep, variables, gridSize) {
    const data = await this.getTimestepData(timestep, variables);
    const grids = {};
    for (const varName of variables) {
      const key = `${timestep}:${varName}:${gridSize}`;
      if (!this.gridCache.has(key)) {
        this.gridCache.set(key, this.meshToGrid(data[varName], gridSize));
      }
      grids[varName] = this.gridCache.get(key);
    }
    this._evictOldestGrid(timestep);
    return grids;
  }

  _evictOldestGrid(currentTimestep) {
    const maxGridCacheSize = this.cacheSize * 4;
    if (this.gridCache.size <= maxGridCacheSize) return;

    const entries = Array.from(this.gridCache.keys())
      .map((key) => ({ key, timestep: parseInt(key.split(':')[0], 10) }))
      .sort((a, b) => Math.abs(b.timestep - currentTimestep) - Math.abs(a.timestep - currentTimestep));

    entries.slice(0, entries.length - maxGridCacheSize).forEach(({ key }) => this.gridCache.delete(key));
  }

  /**
   * Prepare velocity field for GPUParticleFlowLayer
   */
  async getVelocityFieldForGPU(centerTimestep, uVar, vVar, gridSize = 256) {
    const timesteps = this.getInterpolationTimesteps(centerTimestep);
    const grids = await Promise.all(timesteps.map((t) => this.getGriddedTimestep(t, [uVar, vVar], gridSize)));

    return {
      u: grids.map((g) => g[uVar]),
      v: grids.map((g) => g[vVar]),
      width: gridSize,
      height: gridSize,
      timesteps
    };
  }

  /**
   * Prepare scalar field for GPU texture
   */
  async getScalarFieldForGPU(timestep, variable, gridSize = 256) {
    const grids = await this.getGriddedTimestep(timestep, [variable], gridSize);
    const grid = grids[variable];

    // Calculate min/max for color mapping (excluding NaN)
    const validValues = Array.from(grid).filter(v => isFinite(v));
    const min = Math.min(...validValues);
    const max = Math.max(...validValues);

    return {
      values: grid,
      width: gridSize,
      height: gridSize,
      min,
      max
    };
  }

  /**
   * Prepare wave height + direction grids for deck.gl-native particle rendering.
   * Direction values are kept in degrees; the overlay applies direction convention.
   */
  async getWaveDirectionFieldForParticles(timestep, scalarVar = 'hs', directionVar = 'dirm', gridSize = 160) {
    const grids = await this.getGriddedTimestep(timestep, [scalarVar, directionVar], gridSize);
    const hsGrid = grids[scalarVar];
    const dirGrid = grids[directionVar];

    const validHs = Array.from(hsGrid).filter(Number.isFinite);
    const minHs = validHs.length ? Math.min(...validHs) : 0;
    const maxHs = validHs.length ? Math.max(...validHs) : 1;

    return {
      hsGrid,
      dirGrid,
      width: gridSize,
      height: gridSize,
      bounds: this.bounds,
      minHs,
      maxHs,
      timestep,
    };
  }

  getStats() {
    const cacheTotal = this.stats.cacheHits + this.stats.cacheMisses;
    return {
      ...this.stats,
      cacheHitRate: cacheTotal > 0 ? (this.stats.cacheHits / cacheTotal * 100).toFixed(1) + '%' : 'N/A',
      cachedEntries: this.cache.size,
      loadingEntries: this.loading.size,
      mbLoaded: (this.stats.bytesLoaded / 1048576).toFixed(2) + ' MB'
    };
  }

  clearCache() {
    this.cache.clear();
    this.loading.clear();
    this.gridCache.clear();
    console.log('🧹 Cache cleared');
  }
}
