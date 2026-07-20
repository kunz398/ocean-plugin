// WaveParticleOverlay.js — GPU particle flow layer wired into the main MapLibre map.
// Uses MapboxOverlay (interleaved:false) so particles render above the wave raster.
// Owns its own ZarrDataManager instance; shares nothing with UgridOverlay to keep
// lifecycle independent and allow future refactor to share the store.
import { MapboxOverlay } from '@deck.gl/mapbox';
import GPUParticleFlowLayer from '../layers/GPUParticleFlowLayer';
import ZarrDataManager from '../services/ZarrDataManager';

const RES = { balanced: 192, high: 256 };

function buildUrl(datasetName, baseUrl) {
  const base = ((baseUrl || '').trim()).replace(/\/+$/, '');
  const ds = (datasetName || '').replace(/^\/+/, '').replace(/\/+$/, '');
  return `${base}/${ds}`;
}

export class WaveParticleOverlay {
  constructor(map, config) {
    this.map    = map;
    this.config = config;
    this.mounted = true;

    this._timeIndex        = 0;
    this._opacity          = config.opacity ?? 0.85;
    this._quality          = config.quality  ?? 'balanced';
    this._velocityData     = null;
    this._colorData        = null;
    this._currentLoadIndex = -1;
    this._loadGen          = 0;
    this._rafId            = null;

    this.onLoadingChange = null;
    this.onErrorChange   = null;

    this.overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    map.addControl(this.overlay);

    const zarrUrl = buildUrl(config.datasetName, config.zarrBaseUrl);
    this._zarr = new ZarrDataManager(zarrUrl, { cacheSize: 8, prefetchWindow: 3 });

    this._zarr.init()
      .then(() => { if (this.mounted) this._loadTimestep(this._timeIndex); })
      .catch((err) => { if (this.mounted) this.onErrorChange?.(String(err)); });
  }

  async _loadTimestep(idx) {
    if (!this.mounted) return;
    if (this._currentLoadIndex === idx && this._velocityData) return;

    const gen = ++this._loadGen;
    this.onLoadingChange?.(true);

    try {
      const res = RES[this._quality] || 192;
      const [velocity, color] = await Promise.all([
        this._zarr.getVelocityFieldForGPU(idx, 'transp_x', 'transp_y', res),
        this._zarr.getScalarFieldForGPU(idx, 'hs', res),
      ]);
      if (!this.mounted || gen !== this._loadGen) return;
      this._velocityData     = velocity;
      this._colorData        = color;
      this._currentLoadIndex = idx;
      this._updateLayer();
      this._startRenderLoop();
    } catch (err) {
      if (this.mounted && gen === this._loadGen) this.onErrorChange?.(String(err));
    } finally {
      if (this.mounted && gen === this._loadGen) this.onLoadingChange?.(false);
    }
  }

  _updateLayer() {
    if (!this.mounted || !this._velocityData) return;
    const res = RES[this._quality] || 192;
    const layer = new GPUParticleFlowLayer({
      id: 'wave-particles',
      velocityField: this._velocityData,
      colorField:    this._colorData,
      bounds:        this._zarr.bounds,
      particleResolution: res,
      windResolution:     res,
      speedFactor:  5.0,
      fadeAmount:   0.982,
      dropRate:     0.003,
      lineWidth:    2.0,
      interpAlpha:  0.0,
      useWaveMode:  true,
      waveSpeedScale: 35.0,
      opacity:  this._opacity,
      pickable: false,
    });
    this.overlay.setProps({ layers: [layer] });
  }

  // Keep MapLibre repainting every frame while particles are active.
  _startRenderLoop() {
    if (this._rafId) return;
    const loop = () => {
      if (!this.mounted || !this._velocityData) { this._rafId = null; return; }
      this.map.triggerRepaint();
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _stopRenderLoop() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  setTimeIndex(idx) {
    if (this._timeIndex === idx) return;
    this._timeIndex = idx;
    this._loadTimestep(idx);
  }

  setOpacity(opacity) {
    this._opacity = opacity;
    this._updateLayer();
  }

  setQuality(quality) {
    if (this._quality === quality) return;
    this._quality          = quality;
    this._currentLoadIndex = -1;
    this._loadTimestep(this._timeIndex);
  }

  destroy() {
    this.mounted = false;
    this.onLoadingChange = null;
    this.onErrorChange   = null;
    this._loadGen++;
    this._stopRenderLoop();
    try { this.map.removeControl(this.overlay); } catch { /* already removed */ }
  }
}
