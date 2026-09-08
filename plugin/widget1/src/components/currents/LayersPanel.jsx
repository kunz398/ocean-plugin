import Depth from './Depth';
import TimeStep from './TimeStep';
import { formatZoned } from '../../utils/timeZoneFormat';
import './currents.css';

const LAYER_COLORS = {
  temperature: '#f59e0b',
  salinity: '#60a5fa',
  velocity: '#34d399',
  seaSurfaceHeight: '#22d3ee',
};

export default function LayersPanel({
  layers = [],
  selectedLayer,
  onLayerChange,
  depth,
  depthLevels,
  onDepthChange,
  sliderIndex,
  totalSteps,
  minIndex,
  currentSliderDate,
  availableTimestamps,
  isPlaying,
  playSpeedMs,
  timeDisplayZone,
  onTimeIndexChange,
  onPlayPause,
  onPrevious,
  onNext,
  onSpeedChange,
  overlayStats,
  forecastStartTime,
  particlesEnabled = false,
  onParticlesEnabledChange,
}) {
  const activeLayerConfig = layers.find((l) => l.value === selectedLayer);
  const hasDepth = activeLayerConfig?.hasDepth ?? true;
  // Only the Velocity layer has u/v components to animate — particles are
  // meaningless (and get torn down automatically) for the scalar layers.
  const particlesAvailable = selectedLayer === 'velocity';

  return (
    <div className="currents-layers">
      <section>
        <div className="currents-section__label">Overlay</div>
        <div className="currents-layer-list">
          {layers.map(({ value, label, units }) => {
            const isActive = value === selectedLayer;
            return (
              <button
                key={value}
                type="button"
                className={`currents-layer-btn${isActive ? ' currents-layer-btn--active' : ''}`}
                aria-pressed={isActive}
                onClick={() => onLayerChange?.(value)}
              >
                <span className="currents-layer-btn__dot" style={{ '--dot-color': LAYER_COLORS[value] ?? '#60a5fa' }} />
                <span className="currents-layer-btn__label">{label}</span>
                {isActive && <span className="currents-layer-btn__unit">{units}</span>}
              </button>
            );
          })}
        </div>
      </section>

      {particlesAvailable && (
        <section>
          <div className="currents-section__label">Flow particles</div>
          <div className="currents-particles-card">
            <div className="currents-toggle-row">
              <span className="currents-toggle-row__label">Show particles</span>
              <button
                type="button"
                role="switch"
                aria-checked={particlesEnabled}
                onClick={() => onParticlesEnabledChange?.(!particlesEnabled)}
                className={`currents-toggle-switch${particlesEnabled ? ' currents-toggle-switch--on' : ''}`}
                style={{ border: 'none', padding: 0, cursor: 'pointer' }}
              >
                <span className="currents-toggle-switch__knob" />
              </button>
            </div>
           
          </div>
        </section>
      )}

      {hasDepth && (
        <section>
          <Depth depth={depth} depthLevels={depthLevels} onDepthChange={onDepthChange} />
        </section>
      )}

      <section>
        <TimeStep
          sliderIndex={sliderIndex}
          totalSteps={totalSteps}
          minIndex={minIndex}
          currentSliderDate={currentSliderDate}
          availableTimestamps={availableTimestamps}
          isPlaying={isPlaying}
          playSpeedMs={playSpeedMs}
          timeDisplayZone={timeDisplayZone}
          onTimeIndexChange={onTimeIndexChange}
          onPlayPause={onPlayPause}
          onPrevious={onPrevious}
          onNext={onNext}
          onSpeedChange={onSpeedChange}
          depth={hasDepth ? depth : null}
        />
      </section>

      <div className="currents-model-run">
        {/* The CROCO zarr store only exposes forecast *valid* times, not a
            certified model-run/init timestamp (same caveat useZarrMap's
            capTime.modelRunStart documents for the wave side) — show the
            forecast window's start instead of guessing at a run time. */}
        {forecastStartTime && (
          <div>Forecast from {formatZoned(forecastStartTime, timeDisplayZone)}</div>
        )}
        {overlayStats && Number.isFinite(overlayStats.min) && Number.isFinite(overlayStats.max) && (
          <div>{activeLayerConfig?.label ?? 'Range'}: {overlayStats.min}–{overlayStats.max} {overlayStats.units ?? ''}</div>
        )}
      </div>
    </div>
  );
}
