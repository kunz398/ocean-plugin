import React from 'react';
import { reportError } from '../lib/errorReporting';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportError(error, { type: 'react-error-boundary', componentStack: info.componentStack });
  }

  render() {
    if (this.state.error) {
      const { fallback } = this.props;
      if (fallback) return fallback;
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: 12,
          fontFamily: 'system-ui, sans-serif',
          color: '#334155',
          background: '#f8fafc',
        }}>
          <div style={{ fontSize: 32 }}>⚠</div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: '#64748b', maxWidth: 400, textAlign: 'center' }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: 8, padding: '8px 20px', borderRadius: 6,
              background: '#2563eb', color: '#fff', border: 'none',
              cursor: 'pointer', fontSize: 14,
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
