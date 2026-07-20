import React from 'react';
import { Link } from 'react-router-dom';

export default function Header() {
  return (
    <nav className="navbar navbar-expand-lg py-2" style={{ 
      backgroundColor: 'var(--color-surface)', 
      borderBottom: '1px solid var(--color-border, #e2e8f0)',
      boxShadow: 'var(--card-shadow)',
      minHeight: '60px'
    }}>
      <div className="container-fluid">
        {/* Logo */}
        <Link className="navbar-brand d-flex align-items-center" to="/">
          <img 
            src={process.env.PUBLIC_URL + '/COSPPaC_white_crop2.png'} 
            alt="COSPPaC Logo" 
            height="30" 
            className="d-inline-block align-text-top me-2"
            style={{ 
              filter: 'brightness(0) saturate(100%) invert(15%) sepia(100%) saturate(10000%) hue-rotate(210deg) brightness(100%) contrast(100%)',
              transition: 'filter 0.3s ease'
            }}
          />
          <span style={{ color: '#0065f8', fontWeight: 'bold', fontSize: '1.1rem' }}>
            Cook Islands Forecast
          </span>
        </Link>

        {/* Mobile Toggle Button */}
        <button 
          className="navbar-toggler" 
          type="button" 
          data-bs-toggle="collapse" 
          data-bs-target="#navbarNav" 
          aria-controls="navbarNav" 
          aria-expanded="false" 
          aria-label="Toggle navigation"
          style={{ borderColor: 'var(--color-border, #e2e8f0)' }}
        >
          <span className="navbar-toggler-icon"></span>
        </button>

        {/* Navigation Items */}
        <div className="collapse navbar-collapse" id="navbarNav">
          {/* Left side - Explorer Button */}
          <div className="navbar-nav me-auto">
            {/* <button 
              className="btn btn-success" 
              style={{ 
                backgroundColor: 'var(--color-success)', 
                borderColor: 'var(--color-success)',
                color: 'white'
              }}
            >
              Explorer
            </button> */}
          </div>

          {/* Right side - Navigation Links and Theme Toggle */}
          <ul className="navbar-nav ms-auto mb-2 mb-lg-0">
            {/* <li className="nav-item">
              <Link className="nav-link" to="/" style={{ color: 'var(--color-text)' }}>
                Home
              </Link>
            </li>
            <li className="nav-item">
              <Link className="nav-link" to="/link1" style={{ color: 'var(--color-text)' }}>
                Link 1
              </Link>
            </li>
            <li className="nav-item">
              <Link className="nav-link" to="/link2" style={{ color: 'var(--color-text)' }}>
                Link 2
              </Link>
            </li>
            <li className="nav-item">
              <Link className="nav-link" to="/link3" style={{ color: 'var(--color-text)' }}>
                Link 3
              </Link>
            </li> */}
          </ul>
        </div>
      </div>
    </nav>
  );
}