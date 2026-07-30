import React from 'react';
import ThemeToggle from './ThemeToggle';
import { formatZoned } from '../utils/timeZoneFormat';

const ModernHeader = ({ timeDisplayZone = 'Pacific/Rarotonga' }) => {
  const [currentTime, setCurrentTime] = React.useState(new Date());

  React.useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDateTime = (date) => formatZoned(date, timeDisplayZone, { second: '2-digit' });

  return (
    <nav className="modern-header" style={{
      minHeight: '60px',
      padding: '0 30px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'relative',
      zIndex: 1001,
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
          <h1 className="modern-header__title" style={{
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
            Cook Islands Wave and Inundation Forecast System
          </h1>
          <p style={{
            margin: 0,
            color: 'rgba(255,255,255,0.8)',
            fontSize: '0.9rem',
            fontWeight: '300'
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
        <ThemeToggle />

        {/* Connection Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#10b981',
            boxShadow: '0 0 6px rgba(16, 185, 129, 0.6)',
            animation: 'pulse 2s infinite'
          }}></div>
          <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)' }}>Live</span>
          <span style={{ 
            fontSize: '0.8rem', 
            color: 'rgba(255,255,255,0.5)',
            marginLeft: '10px'
          }}>
            {formatDateTime(currentTime)}
          </span>
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
