import React, { lazy, Suspense, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import ErrorBoundary from './components/ErrorBoundary';
// LEGACY HEADER REMOVED - ModernHeader is now used in Home.jsx
// import Header from './components/header';

// Lazy-load the heavy map/forecast page so MapLibre GL, deck.gl, zarr, and
// Plotly are excluded from the initial JS bundle.
const Home = lazy(() => import('./pages/Home'));

function App() {
  // AUTHENTICATION COMMENTED OUT
  // const [isAuthenticated, setIsAuthenticated] = useState(false);
  // const [isLoading, setIsLoading] = useState(true);
  // const [errorType, setErrorType] = useState(null);
  const [widgetData] = useState(null);
  const [validCountries] = useState([]);

  // AUTHENTICATION COMMENTED OUT - App now loads without token validation
  // useEffect(() => {
  //   const initializeApp = async () => {
  //     console.log('Initializing app with token and country validation...');
  //     
  //     // Check if token exists in URL first
  //     const token = extractTokenFromURL('token');
  //     
  //     if (!token) {
  //       console.log('No token found in URL');
  //       setErrorType('no_token');
  //       setIsLoading(false);
  //       return;
  //     }
  //     
  //     try {
  //       const validationResult = await validateTokenOnLoad(
  //         () => {
  //           console.log('Authentication successful - app can load');
  //           setIsAuthenticated(true);
  //         },
  //         () => {
  //           console.log('Authentication failed - app will not load');
  //           setIsAuthenticated(false);
  //           setErrorType('invalid_token');
  //         },
  //         () => {
  //           console.log('Country validation failed - page should not load');
  //           // Country validation failed, so we should not show the app
  //           setIsAuthenticated(false);
  //           setErrorType('invalid_country');
  //         }
  //       );
  //       
  //       // Store widget data and valid countries if available
  //       if (validationResult.widgetData) {
  //         setWidgetData(validationResult.widgetData);
  //       }
  //       if (validationResult.validCountries) {
  //         setValidCountries(validationResult.validCountries);
  //       }
  //       
  //       console.log('Validation result:', validationResult);
  //       setIsLoading(false);
  //     } catch (error) {
  //       console.error('Network error during validation:', error);
  //       setErrorType('network_error');
  //       setIsLoading(false);
  //     }
  //   };
  //
  //   initializeApp();
  // }, []);

  // AUTHENTICATION COMMENTED OUT - No loading state needed
  // if (isLoading) {
  //   return (
  //     <div style={{
  //       display: 'flex',
  //       justifyContent: 'center',
  //       alignItems: 'center',
  //       height: '100vh',
  //       fontFamily: 'Arial, sans-serif',
  //       backgroundColor: 'var(--color-background)'
  //     }}>
  //       <div style={{
  //         textAlign: 'center',
  //         padding: '2rem',
  //         background: 'white',
  //         borderRadius: '8px',
  //         boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
  //       }}>
  //         <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🔍</div>
  //         <h3>Validating Authentication...</h3>
  //         <p>Please wait while we verify your access token and country permissions.</p>
  //       </div>
  //     </div>
  //   );
  // }

  // AUTHENTICATION COMMENTED OUT - App now loads directly without auth check
  // if (!isAuthenticated || errorType) {
  //   return <TokenError errorType={errorType || 'invalid_token'} />;
  // }

  // Use PUBLIC_URL for production, but allow root access in development
  const basename = process.env.NODE_ENV === 'production' ? process.env.PUBLIC_URL : '';

  return (
    <Router 
      basename={basename}
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
        {/* Legacy Header removed - ModernHeader now renders in Home.jsx */}
        {/* fallback={null}: the HTML splash screen in index.html stays visible
            until the lazy chunk resolves and React renders the real content. */}
        <Suspense fallback={null}>
          <Routes>
            <Route
              path="/"
              element={
                <ErrorBoundary>
                  <Home widgetData={widgetData} validCountries={validCountries} />
                </ErrorBoundary>
              }
            />
            {/* Redirect any unknown routes to home */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
    </Router>
  );
}

export default App;
