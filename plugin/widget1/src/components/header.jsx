import React,{useEffect,useState} from 'react';
import { Link } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';

export default function Header() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('ui-theme') || localStorage.getItem('theme');
    const docTheme = document.documentElement.getAttribute('data-theme');
    if (stored === 'day' || stored === 'light' || docTheme === 'day') setDark(false);
    else if (stored === 'dark' || docTheme === 'dark') setDark(true);
    else setDark(false);
  }, []);
  return (
    <nav className="navbar navbar-expand-lg py-2" style={{ 
      backgroundColor: 'var(--color-surface)', 
      borderBottom: '1px solid var(--color-border, #e2e8f0)',
      boxShadow: 'var(--card-shadow)',
      minHeight: '60px'
    }}>
      <div className="container-fluid">
        {/* Logo */}
        <div className="navbar-brand d-flex align-items-center">
          <Link to="/" className="d-flex align-items-center text-decoration-none me-3">
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
          </Link>
          <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
            <a 
              style={{
                textDecoration: 'none',
                color: dark ? '#0065f8' : '#5FA4FA',
                transition: 'color 0.3s'
              }} 
              href="https://oceanportal2.spc.int" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              Pacific Ocean Portal
            </a> 
            <span style={{margin: '0 8px', textDecoration: 'none',
                color: dark ? '#0065f8' : '#5FA4FA',
                transition: 'color 0.3s'}}>-</span>
            <Link  style={{
                textDecoration: 'none',
                color: dark ? '#0065f8' : '#5FA4FA',
                transition: 'color 0.3s'
              }} to="/">High Resolution Wave and Inundation System - Niue</Link>
          </div>
        </div>

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
            <li className="nav-item d-flex align-items-center ms-3">
              <ThemeToggle />
            </li>
          </ul>
        </div>
      </div>
    </nav>
  );
}