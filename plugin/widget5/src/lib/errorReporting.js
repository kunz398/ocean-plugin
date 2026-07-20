// Centralized error reporting. No APM/error-tracking service (Sentry, etc.) is
// wired up yet — this just logs structured entries to the console and keeps a
// small in-memory buffer. It exists as the single choke point to plug a real
// service into later without touching every call site that reports an error.

const MAX_RECENT_ERRORS = 20;
const recentErrors = [];

export function reportError(error, context = {}) {
  const entry = {
    message: error?.message || String(error),
    stack: error?.stack || null,
    context,
    time: new Date().toISOString(),
  };

  recentErrors.push(entry);
  if (recentErrors.length > MAX_RECENT_ERRORS) recentErrors.shift();

  // eslint-disable-next-line no-console
  console.error('[widget5]', entry.message, entry);

  // TODO: forward to an APM/error-tracking service here (e.g.
  // Sentry.captureException(error, { extra: context })) once a DSN/account
  // is available for this deployment.
}

export function getRecentErrors() {
  return [...recentErrors];
}

// Catches errors React's ErrorBoundary can't: those thrown in event handlers,
// timers, or async callbacks outside the render cycle, plus unhandled promise
// rejections (the majority of failures in this app, given how fetch-heavy the
// provider layer is).
export function installGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    reportError(event.error || new Error(event.message), {
      type: 'window.onerror',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    reportError(reason instanceof Error ? reason : new Error(String(reason)), {
      type: 'unhandledrejection',
    });
  });
}
