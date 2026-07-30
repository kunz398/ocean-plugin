/**
 * GPU Particle Flow Demo - Standalone Test Page
 * 
 * This is a minimal demonstration of the GPU particle system
 * working with your SWAN_UGRID.zarr data.
 * 
 * To test:
 * 1. Ensure Zarr server is running: ./start-zarr-server.sh
 * 2. Add route to App.jsx
 * 3. Navigate to /gpu-demo
 * 4. Verify 60 FPS in browser dev tools
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { MapView } from '@deck.gl/core';
import GPUParticleFlowLayer from '../layers/GPUParticleFlowLayer';
import ZarrDataManager from '../services/ZarrDataManager';
import AnimationController from '../utils/AnimationController';
import { getZarrUrl, getZarrConnectionHelp } from '../config/zarrConfig';

// Cook Islands bounds (matching your current config)
// const COOK_ISLANDS_BOUNDS = {
//   west: -160.25042381,
//   south: -21.7498293078,
//   east: -159.2500903777,
//   north: -20.7496610545
// };

const INITIAL_VIEW_STATE = {
  longitude: -159.8,
  latitude: -21.2,
  zoom: 9,
  pitch: 0,
  bearing: 0
};

function GPUParticleDemo() {
  // State
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [layers, setLayers] = useState([]);
  const [animationState, setAnimationState] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState('Initializing...');

  // Refs
  const zarrManagerRef = useRef(null);
  const animControllerRef = useRef(null);
  const velocityDataRef = useRef(null);
  const colorDataRef = useRef(null);
  const currentTimestepRef = useRef(-1);
  const initializedRef = useRef(false);

  // Update deck.gl layers
  const updateLayers = useCallback((interpAlpha) => {
    const velocityData = velocityDataRef.current;
    const colorData = colorDataRef.current;

    if (!velocityData || !colorData) return;

    const particleLayer = new GPUParticleFlowLayer({
      id: 'gpu-particles',
      velocityField: velocityData,
      colorField: colorData,
      bounds: zarrManagerRef.current.metadata.bounds,
      particleResolution: 256, // 65,536 particles
      windResolution: 256,
      speedFactor: 5.0, // Particle speed multiplier
      fadeAmount: 0.982, // Trail fade
      dropRate: 0.003, // Particle respawn rate
      lineWidth: 2.0,
      interpAlpha: interpAlpha, // 0-1 interpolation between timesteps
      useWaveMode: true, // Color by wave height
      normalizeVelocity: false,
      waveSpeedScale: 35.0,
      opacity: 0.85,
      pickable: false
    });

    setLayers([particleLayer]);
  }, []);

  // Load data for a specific timestep
  const updateLayerData = useCallback(async (timestep) => {
    const zarr = zarrManagerRef.current;
    if (!zarr) return;

    try {
      console.log(`⏳ Loading timestep ${timestep}...`);
      const startTime = performance.now();

      // Load velocity field (4 timesteps for cubic interpolation)
      const velocityData = await zarr.getVelocityFieldForGPU(
        timestep, 
        'transp_x', 
        'transp_y', 
        256 // Grid resolution
      );
      velocityDataRef.current = velocityData;

      // Load color field (wave height for coloring)
      const colorData = await zarr.getScalarFieldForGPU(timestep, 'hs', 256);
      colorDataRef.current = colorData;

      // Update layers with alpha=0 (start of interpolation)
      updateLayers(0);

      const loadTime = (performance.now() - startTime).toFixed(1);
      console.log(`✅ Loaded timestep ${timestep} in ${loadTime}ms`);
      
      // Log cache stats
      const stats = zarr.getStats();
      console.log(`📈 Cache: ${stats.cacheHitRate} hit rate, ${stats.cachedEntries} entries, ${stats.mbLoaded}`);

      currentTimestepRef.current = timestep;

    } catch (err) {
      console.error(`❌ Failed to load timestep ${timestep}:`, err);
    }
  }, [updateLayers]);

  // Handle animation updates
  const handleAnimationUpdate = useCallback((state) => {
    setAnimationState(state);

    // Check if we need to load new timestep data
    const currentData = velocityDataRef.current;
    if (!currentData || !currentData.timesteps.includes(state.timestep)) {
      // Need new data
      if (currentTimestepRef.current !== state.timestep) {
        updateLayerData(state.timestep);
      }
    } else {
      // Just update interpolation alpha (no new data needed)
      updateLayers(state.interpAlpha);
    }
  }, [updateLayerData, updateLayers]);

  // Initialize Zarr and Animation
  useEffect(() => {
    if (initializedRef.current) {
      return undefined;
    }

    initializedRef.current = true;

    async function init() {
      try {
        console.log('🚀 Initializing GPU Particle System...');
        setStatus('Connecting to Zarr server...');
        const zarrUrl = getZarrUrl();
        
        // Initialize Zarr data manager
        const zarr = new ZarrDataManager(zarrUrl, {
          cacheSize: 8,
          prefetchWindow: 4
        });
        
        setStatus('Loading metadata...');
        await zarr.init();
        zarrManagerRef.current = zarr;

        console.log('📊 Zarr Metadata:', zarr.metadata);
        console.log(`   • Timesteps: ${zarr.metadata.timestepCount}`);
        console.log(`   • Nodes: ${zarr.metadata.nodeCount}`);
        console.log(`   • Bounds: [${zarr.metadata.bounds.join(', ')}]`);

        // Load initial data (timestep 0)
        setStatus('Loading initial timestep...');
        await updateLayerData(0);

        // Initialize animation controller
        const controller = new AnimationController(zarr, {
          speed: 1.5, // 1.5x speed for faster demo
          targetFPS: 60,
          onUpdate: handleAnimationUpdate
        });
        animControllerRef.current = controller;

        setIsLoading(false);
        setStatus('Ready! Press Play to start animation.');
        console.log('✅ Initialization complete!');

      } catch (err) {
        const baseMessage = err.message || 'Failed to initialize GPU system';
        const improvedMessage = err instanceof TypeError
          ? `${baseMessage}. ${getZarrConnectionHelp()}`
          : baseMessage;
        console.error('❌ Initialization failed:', improvedMessage, err);
        setIsLoading(false);
      }
    }

    init();

    // Cleanup on unmount
    return () => {
      if (animControllerRef.current) {
        animControllerRef.current.destroy();
      }
    };
  }, [updateLayerData, handleAnimationUpdate]);

  // UI Control Handlers
  function handlePlayPause() {
    if (animControllerRef.current) {
      animControllerRef.current.toggle();
      console.log(animationState?.isPlaying ? '⏸️  Paused' : '▶️  Playing');
    }
  }

  function handleSpeedChange(e) {
    const speed = parseFloat(e.target.value);
    if (animControllerRef.current) {
      animControllerRef.current.setSpeed(speed);
      console.log(`⏩ Speed: ${speed}x`);
    }
  }

  function handleSeek(e) {
    const timestep = parseInt(e.target.value);
    if (animControllerRef.current) {
      animControllerRef.current.jumpTo(timestep);
      console.log(`⏭️  Jumped to timestep ${timestep}`);
    }
  }

  function handleReset() {
    if (animControllerRef.current) {
      animControllerRef.current.reset();
      console.log('🔄 Reset to beginning');
    }
  }

  function showStats() {
    if (zarrManagerRef.current) {
      const stats = zarrManagerRef.current.getStats();
      console.log('📊 Performance Stats:', stats);
      alert(`📊 Cache Performance\n\n` +
        `Cache Hits: ${stats.cacheHits}\n` +
        `Cache Misses: ${stats.cacheMisses}\n` +
        `Hit Rate: ${stats.cacheHitRate}\n` +
        `Data Loaded: ${stats.mbLoaded}\n` +
        `Cached Entries: ${stats.cachedEntries}`
      );
    }
  }

  // Loading state
  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: '#1a1a2e',
        color: 'white',
        fontFamily: 'system-ui'
      }}>
        <div style={{ fontSize: 48, marginBottom: 20 }}>🌊</div>
        <h2>Loading GPU Particle System...</h2>
        <p style={{ opacity: 0.7, marginTop: 10 }}>{status}</p>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#0a1628' }}>
      {/* Deck.gl Map */}
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState }) => setViewState(viewState)}
        controller={true}
        layers={layers}
        parameters={{
          depthTest: false
        }}
      >
        <MapView id="map" controller={true} />
      </DeckGL>

      {/* Title Bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        background: 'linear-gradient(180deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 100%)',
        padding: '20px',
        color: 'white',
        fontFamily: 'system-ui',
        zIndex: 10
      }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
          🌊 GPU Particle Flow Demo - Cook Islands SWAN
        </h1>
        <p style={{ margin: '5px 0 0 0', opacity: 0.7, fontSize: 14 }}>
          {status}
        </p>
      </div>

      {/* Animation Controls */}
      <div style={{
        position: 'absolute',
        bottom: 30,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(10px)',
        color: 'white',
        padding: '20px 30px',
        borderRadius: 12,
        display: 'flex',
        gap: 20,
        alignItems: 'center',
        zIndex: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        fontFamily: 'system-ui'
      }}>
        {/* Play/Pause */}
        <button 
          onClick={handlePlayPause}
          style={{
            padding: '10px 20px',
            borderRadius: 6,
            border: 'none',
            background: animationState?.isPlaying ? '#ff4444' : '#00aa00',
            color: 'white',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: 14
          }}
        >
          {animationState?.isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>

        {/* Speed Control */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label htmlFor="gpu-speed-select" style={{ fontSize: 11, opacity: 0.7 }}>Speed</label>
          <select
            id="gpu-speed-select"
            name="gpu-speed-select"
            value={animationState?.speed || 1}
            onChange={handleSpeedChange}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #444',
              background: '#222',
              color: 'white',
              cursor: 'pointer'
            }}
          >
            <option value={0.25}>×0.25</option>
            <option value={0.5}>×0.5</option>
            <option value={1}>×1</option>
            <option value={1.5}>×1.5</option>
            <option value={2}>×2</option>
            <option value={5}>×5</option>
          </select>
        </div>

        {/* Timeline Slider */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 300 }}>
          <label htmlFor="gpu-timeline-slider" style={{ fontSize: 11, opacity: 0.7 }}>Timeline</label>
          <input
            id="gpu-timeline-slider"
            name="gpu-timeline-slider"
            type="range"
            min="0"
            max={zarrManagerRef.current?.metadata.timestepCount - 1 || 0}
            value={animationState?.timestep || 0}
            onChange={handleSeek}
            style={{ width: '100%' }}
          />
        </div>

        {/* Timestep Display */}
        <div style={{ fontFamily: 'monospace', minWidth: 140, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {animationState?.timestep || 0} / {zarrManagerRef.current?.metadata.timestepCount || 0}
          </div>
          <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>
            {animationState?.timestamp?.substring(0, 16) || 'Loading...'}
          </div>
        </div>

        {/* Reset Button */}
        <button 
          onClick={handleReset}
          style={{
            padding: '10px 16px',
            borderRadius: 6,
            border: '1px solid #444',
            background: '#222',
            color: 'white',
            cursor: 'pointer',
            fontSize: 14
          }}
        >
          🔄 Reset
        </button>

        {/* Stats Button */}
        <button 
          onClick={showStats}
          style={{
            padding: '10px 16px',
            borderRadius: 6,
            border: '1px solid #444',
            background: '#222',
            color: 'white',
            cursor: 'pointer',
            fontSize: 14
          }}
        >
          📊 Stats
        </button>
      </div>

      {/* Performance Monitor */}
      <div style={{
        position: 'absolute',
        top: 90,
        left: 20,
        background: 'rgba(0,0,0,0.8)',
        backdropFilter: 'blur(10px)',
        color: '#00ff00',
        padding: '12px 16px',
        borderRadius: 8,
        fontFamily: 'monospace',
        fontSize: 12,
        zIndex: 10,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        lineHeight: 1.6
      }}>
        <div style={{ color: '#00ff88', fontWeight: 600, marginBottom: 8 }}>⚡ GPU PERFORMANCE</div>
        <div>Particles: 65,536</div>
        <div>FPS: {animationState?.fps || 0}</div>
        <div>Mode: Zarr + WebGL2</div>
        <div>Interp: Cubic ({(animationState?.interpAlpha || 0).toFixed(3)})</div>
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #333' }}>
          <div style={{ color: '#88ff88' }}>Progress: {animationState?.progressPercent || 0}%</div>
        </div>
      </div>

      {/* Variable Info */}
      <div style={{
        position: 'absolute',
        bottom: 30,
        right: 30,
        background: 'rgba(0,0,0,0.8)',
        backdropFilter: 'blur(10px)',
        color: 'white',
        padding: '15px 20px',
        borderRadius: 8,
        fontFamily: 'system-ui',
        fontSize: 12,
        zIndex: 10,
        maxWidth: 250,
        lineHeight: 1.6
      }}>
        <div style={{ fontWeight: 600, marginBottom: 8, color: '#00aaff' }}>📊 Visualization</div>
        <div><strong>Velocity:</strong> transp_x, transp_y</div>
        <div><strong>Color:</strong> Wave Height (hs)</div>
        <div><strong>Integration:</strong> RK4</div>
        <div><strong>Interpolation:</strong> 4-point Cubic</div>
      </div>
    </div>
  );
}

export default GPUParticleDemo;
