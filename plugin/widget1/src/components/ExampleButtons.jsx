import React from 'react';

export default function ExampleButtons() {
  return (
    <div className="container mt-4">
      <h2 className="text-theme-body">Theme-Aware Components Examples</h2>
      
      {/* Method 1: Using CSS Classes (Recommended) */}
      <div className="mb-4">
        <h3 className="text-theme-primary">Method 1: CSS Classes</h3>
        <p className="text-theme-body">These buttons automatically adapt to dark/light theme:</p>
        
        <div className="d-flex gap-2 mb-3">
          <button className="btn btn-theme-primary">
            Primary Button
          </button>
          <button className="btn btn-theme-secondary">
            Secondary Button
          </button>
          <button className="btn btn-theme-outline">
            Outline Button
          </button>
        </div>
        
        <div className="card card-theme p-3">
          <h5 className="text-theme-primary">Theme Card</h5>
          <p className="text-theme-body">This card automatically adapts to the current theme.</p>
        </div>
      </div>

      {/* Method 2: Inline Styles with Theme Variables */}
      <div className="mb-4">
        <h3 className="text-theme-primary">Method 2: Inline Styles</h3>
        <p className="text-theme-body">Using CSS variables directly in style props:</p>
        
        <div className="d-flex gap-2 mb-3">
          <button 
            className="btn"
            style={{
              backgroundColor: 'var(--color-primary)',
              borderColor: 'var(--color-primary)',
              color: 'white'
            }}
          >
            Inline Primary
          </button>
          <button 
            className="btn"
            style={{
              backgroundColor: 'var(--color-secondary)',
              borderColor: 'var(--color-secondary)',
              color: 'white'
            }}
          >
            Inline Secondary
          </button>
        </div>
      </div>

      {/* Method 3: Conditional Styling */}
      <div className="mb-4">
        <h3 className="text-theme-primary">Method 3: Conditional Styling</h3>
        <p className="text-theme-body">Using JavaScript to detect theme and apply different styles:</p>
        
        <div className="d-flex gap-2 mb-3">
          <button 
            className="btn"
            style={{
              backgroundColor: document.documentElement.getAttribute('data-theme') === 'dark' 
                ? '#60a5fa' 
                : '#2563eb',
              borderColor: document.documentElement.getAttribute('data-theme') === 'dark' 
                ? '#60a5fa' 
                : '#2563eb',
              color: 'white'
            }}
          >
            Conditional Button
          </button>
        </div>
      </div>

      {/* Alert Examples */}
      <div className="mb-4">
        <h3 className="text-theme-primary">Theme-Aware Alerts</h3>
        
        <div className="alert alert-theme-info mb-2">
          <i className="bi bi-info-circle me-2"></i>
          This is an info alert that adapts to theme
        </div>
        
        <div className="alert alert-theme-success mb-2">
          <i className="bi bi-check-circle me-2"></i>
          This is a success alert that adapts to theme
        </div>
        
        <div className="alert alert-theme-warning mb-2">
          <i className="bi bi-exclamation-triangle me-2"></i>
          This is a warning alert that adapts to theme
        </div>
      </div>
    </div>
  );
}
