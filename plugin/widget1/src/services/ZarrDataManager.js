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
      
      // Try to load triangles (optional for unstructured mesh)
      try {
        this.triangleArray = await openArray({ store: this.store, path: 'mesh_face_node', mode: 'r' });
        const triData = await this.triangleArray.get(null);
        this.triangles = new Int32Array(triData.data);
        
        // Adjust for 1-based indexing if needed
        if (this.triangles[0] === 1) {
          this.triangles = this.triangles.map(i => i - 1);
        }
        console.log(`✅ Loaded ${this.triangles.length / 3} triangles`);
      } catch (e) {
        console.warn('⚠️  No triangle connectivity found (particle-only mode)');
        this.triangles = null;
      }
      
      // Load time coordinates
      try {
        const timeArray = await openArray({ store: this.store, path: 'time', mode: 'r' });
        const timeData = await timeArray.get(null);
        this.times = Array.from(timeData.data).map(t => new Date(t * 1000).toISOString());
        this.timestepCount = this.times.length;
        console.log(`⏱️  ${this.timestepCount} timesteps available`);
      } catch (e) {
        console.warn('⚠️  No explicit time coordinate found; inferring timestep count from variable shapes when available');
        this.times = [];
        this.timestepCount = 0;
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
        hasTriangles: !!this.triangles,
        times: this.times
      };
      
      return this.metadata;
    } catch (error) {
      console.error('❌ Failed to initialize ZarrDataManager:', error);
      throw error;
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
  async getInterpolationWindow(centerTimestep, variables) {
    if (this.timestepCount <= 1) {
      const fallbackTimestep = Math.max(0, centerTimestep);
      const data = await this.getTimestepData(fallbackTimestep, variables);
      return {
        timesteps: [fallbackTimestep, fallbackTimestep, fallbackTimestep, fallbackTimestep],
        data: [data, data, data, data]
      };
    }

    const t = centerTimestep;
    const t_m1 = Math.max(0, t - 1);
    const t_p1 = Math.min(this.timestepCount - 1, t + 1);
    const t_p2 = Math.min(this.timestepCount - 1, t + 2);
    
    const [data_m1, data_0, data_p1, data_p2] = await Promise.all([
      this.getTimestepData(t_m1, variables),
      this.getTimestepData(t, variables),
      this.getTimestepData(t_p1, variables),
      this.getTimestepData(t_p2, variables)
    ]);
    
    return {
      timesteps: [t_m1, t, t_p1, t_p2],
      data: [data_m1, data_0, data_p1, data_p2]
    };
  }

  /**
   * Convert unstructured mesh data to regular grid for GPU texture upload
   */
  meshToGrid(meshData, gridSize = 256) {
    const [minLon, minLat, maxLon, maxLat] = this.bounds;
    const grid = new Float32Array(gridSize * gridSize);
    grid.fill(NaN);
    
    // Simple nearest-neighbor interpolation
    // For production, use more sophisticated methods (inverse distance weighting, etc.)
    for (let i = 0; i < this.nodeCount; i++) {
      const lon = this.lon[i];
      const lat = this.lat[i];
      const value = meshData[i];
      
      if (!isFinite(value)) continue;
      
      const x = Math.floor(((lon - minLon) / (maxLon - minLon)) * (gridSize - 1));
      const y = Math.floor(((lat - minLat) / (maxLat - minLat)) * (gridSize - 1));
      
      if (x >= 0 && x < gridSize && y >= 0 && y < gridSize) {
        const idx = y * gridSize + x;
        if (!isFinite(grid[idx]) || Math.abs(value) > Math.abs(grid[idx])) {
          grid[idx] = value;
        }
      }
    }
    
    // Fill holes with nearest neighbor
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
   * Prepare velocity field for GPUParticleFlowLayer
   */
  async getVelocityFieldForGPU(centerTimestep, uVar, vVar, gridSize = 256) {
    const window = await this.getInterpolationWindow(centerTimestep, [uVar, vVar]);
    
    const uGrids = window.data.map(d => this.meshToGrid(d[uVar], gridSize));
    const vGrids = window.data.map(d => this.meshToGrid(d[vVar], gridSize));
    
    return {
      u: uGrids,
      v: vGrids,
      width: gridSize,
      height: gridSize,
      timesteps: window.timesteps
    };
  }

  /**
   * Prepare scalar field for GPU texture
   */
  async getScalarFieldForGPU(timestep, variable, gridSize = 256) {
    const data = await this.getTimestepData(timestep, [variable]);
    const grid = this.meshToGrid(data[variable], gridSize);
    
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
    console.log('🧹 Cache cleared');
  }
}
