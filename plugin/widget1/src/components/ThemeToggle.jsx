import React, { useState, useEffect } from 'react';

function initialDarkMode() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true;
  const saved = localStorage.getItem('ui-theme') || localStorage.getItem('theme');
  const docTheme = document.documentElement.getAttribute('data-theme');
  if (saved === 'day' || saved === 'light' || docTheme === 'day') return false;
  return true;
}

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(initialDarkMode);

  useEffect(() => {
    // Load theme from localStorage or existing document attribute
    const saved = localStorage.getItem('ui-theme') || localStorage.getItem('theme');
    const docTheme = document.documentElement.getAttribute('data-theme');
    if (saved === 'day' || saved === 'light' || docTheme === 'day') {
      setIsDark(false);
      document.documentElement.setAttribute('data-theme', 'day');
    } else if (saved === 'dark' || docTheme === 'dark') {
      setIsDark(true);
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      // Dark is the product default. An explicit saved day preference above
      // still wins on subsequent visits.
      setIsDark(true);
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('ui-theme', 'dark');
    }
  }, []);

  const applyTransition = () => {
    const el = document.documentElement;
    el.classList.add('theme-transition');
    window.setTimeout(() => el.classList.remove('theme-transition'), 350);
  };

  const toggleTheme = () => {
    const newIsDark = !isDark;
    setIsDark(newIsDark);
    applyTransition();
    if (newIsDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('ui-theme', 'dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'day');
      localStorage.setItem('ui-theme', 'day');
    }
  };

  return (
    <div className="form-check form-switch d-flex align-items-center">
      <input
        className="form-check-input me-2"
        type="checkbox"
        role="switch"
        id="themeToggle"
        checked={isDark}
        onChange={toggleTheme}
      />
      <label className="form-check-label" htmlFor="themeToggle" style={{ color: 'var(--color-text)' }}>
        {isDark ? (
          <i className="bi bi-moon-fill" style={{ color: 'var(--color-primary)' }}></i>
        ) : (
          <i className="bi bi-sun-fill" style={{ color: '#0065f8' }}></i>
        )}
      </label>
    </div>
  );
}
