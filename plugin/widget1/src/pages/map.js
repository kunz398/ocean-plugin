import React, { useState, useEffect } from "react";

function MapPreview({ data }) {
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Check for dark mode
  useEffect(() => {
    const checkTheme = () => {
      const theme = document.documentElement.getAttribute('data-theme');
      const isDark = theme === 'dark' || document.body.classList.contains('dark-mode');
      setIsDarkMode(isDark);
    };
    
    checkTheme();
    
    // Listen for theme changes
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    
    return () => observer.disconnect();
  }, []);

  return (
    <div style={{ 
      color: isDarkMode ? '#f1f5f9' : '#1e293b',
      backgroundColor: isDarkMode ? '#2e2f33' : 'transparent'
    }}>
      <em style={{ color: isDarkMode ? '#a1a1aa' : '#666' }}>
        Map preview for this point goes here.
      </em>
      <pre style={{ 
        background: isDarkMode ? "#3f4854" : "#f8f9fa", 
        padding: 8,
        color: isDarkMode ? '#f1f5f9' : '#1e293b',
        border: `1px solid ${isDarkMode ? '#44454a' : '#e2e8f0'}`,
        borderRadius: '4px',
        fontSize: '12px',
        overflow: 'auto'
      }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

export default MapPreview;