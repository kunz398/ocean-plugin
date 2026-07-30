import React from 'react';
import { formatZoned } from '../utils/timeZoneFormat';

function getForecastStatus(capTime) {
  if (capTime?.loading) {
    return { label: 'Loading', color: '#94a3b8', pulse: true };
  }
  if (capTime?.availableTimestamps?.length) {
    return {
      label: 'Forecast data',
      color: '#10b981',
      pulse: true,
      forecastStart: capTime.forecastStart ?? capTime.availableTimestamps[0],
    };
  }
  if (!capTime?.forecastStart) {
    return { label: 'Unavailable', color: '#94a3b8', pulse: false };
  }
  return { label: 'Forecast data', color: '#10b981', pulse: true, forecastStart: capTime.forecastStart };
}

function formatForecastStart(dateLike, timeZone) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  return formatZoned(date, timeZone);
}

const ModernHeader = ({ capTime, timeDisplayZone = 'Pacific/Niue' }) => {
  const status = getForecastStatus(capTime);

  return (
    <nav style={{
      background: 'linear-gradient(135deg, #0a2463 0%, #1e3a5f 40%, #2e5266 70%, #3e7b69 100%)',
      minHeight: '60px',
      padding: '0 30px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'relative',
      zIndex: 1001,
      boxShadow: '0 2px 20px rgba(0,0,0,0.3)',
      borderBottom: '1px solid rgba(255,255,255,0.1)'
    }}>
      {/* Logo and Title */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '15px'
      }}>
        <img 
          src={process.env.PUBLIC_URL + '/COSPPaC_white_crop2.png'} 
          alt="COSPPaC Logo" 
          height="35" 
          style={{ 
            filter: 'brightness(0) saturate(100%) invert(100%)',
            transition: 'filter 0.3s ease'
          }}
        />
        <div>
          <h1 style={{
            margin: 0,
            color: '#00d4ff',
            fontSize: '1.5rem',
            fontWeight: '700',
            textShadow: '0 2px 4px rgba(0,0,0,0.3)',
            background: 'linear-gradient(45deg, #00d4ff, #90e0ef)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}>
            Niue Wave and Inundation Forecast System
          </h1>
          <p style={{
            margin: 0,
            color: '#ffffff',
            fontSize: '0.9rem',
            fontWeight: '400',
            textShadow: '0 1px 2px rgba(0,0,0,0.5)'
          }}>
            Marine Forecasting • Pacific Community (SPC) Data
          </p>
        </div>
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '20px'
      }}>
        {/* Forecast metadata. The zarr source exposes forecast valid times,
            not a certified model-run/init timestamp, so avoid displaying a
            fabricated "model run age" here. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} title={
          status.forecastStart ? `First forecast valid time: ${formatForecastStart(status.forecastStart, timeDisplayZone)}` : undefined
        }>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: status.color,
            boxShadow: `0 0 6px ${status.color}99`,
            animation: status.pulse ? 'pulse 2s infinite' : 'none'
          }}></div>
          <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.95)', fontWeight: '600' }}>
            {status.label}
          </span>
          {status.forecastStart && (
            <span style={{
              fontSize: '0.8rem',
              color: 'rgba(255,255,255,0.85)',
              marginLeft: '10px'
            }}>
              from {formatForecastStart(status.forecastStart, timeDisplayZone)}
            </span>
          )}
        </div>
      </div>

      {/* Add the pulse animation as a style tag */}
      <style dangerouslySetInnerHTML={{__html: `
        .pulse-dot {
          animation: pulse-animation 2s infinite;
        }
        @keyframes pulse-animation {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.7; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}} />
    </nav>
  );
};

export default ModernHeader;
