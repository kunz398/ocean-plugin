import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import Header from './components/header';
import ErrorBoundary from './components/ErrorBoundary';
import './utils/NotificationManager'; // Initialize notification system
import { initConsoleErrorSuppressor } from './utils/ConsoleErrorSuppressor';

// Lazy-load heavy pages so MapLibre GL, deck.gl, zarr, and Plotly are excluded
// from the initial JS bundle (~7.8 MB → ~350 KB for first paint).
const Home = lazy(() => import('./pages/Home'));
const GPUParticleDemo = lazy(() => import('./pages/GPUParticleDemo'));

function App() {
  useEffect(() => {
    // Authentication is temporarily disabled for widget 5.
    initConsoleErrorSuppressor();
  }, []);

  return (
    <Router 
      basename={process.env.NODE_ENV === 'development' ? '/' : process.env.PUBLIC_URL}
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true
      }}
    >
      <div style={{ 
        backgroundColor: 'var(--color-background)', 
        minHeight: '100vh',
        transition: 'background-color 0.3s ease'
      }}>
        <Header />
        {/* fallback={null}: the HTML splash screen in index.html stays visible
            until the lazy chunk resolves and React renders the real content. */}
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<ErrorBoundary><Home /></ErrorBoundary>} />
            <Route path="/gpu-demo" element={<GPUParticleDemo />} />
            {/* Redirect any unknown routes to home */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
    </Router>
  );
}

export default App;
