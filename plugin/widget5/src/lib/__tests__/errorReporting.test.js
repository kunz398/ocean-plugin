import { reportError, getRecentErrors, installGlobalErrorHandlers } from '../errorReporting';

describe('errorReporting', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    // Drain the module-level ring buffer between tests by filling it past its
    // cap with disposable entries rather than reaching into its internals.
    for (let i = 0; i < 25; i += 1) reportError(new Error(`flush-${i}`));
    consoleErrorSpy.mockClear();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('logs a structured entry to the console', () => {
    reportError(new Error('boom'), { type: 'test' });

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [, message, entry] = consoleErrorSpy.mock.calls[0];
    expect(message).toBe('boom');
    expect(entry.context).toEqual({ type: 'test' });
    expect(typeof entry.time).toBe('string');
  });

  test('accepts non-Error values without throwing', () => {
    expect(() => reportError('just a string')).not.toThrow();
    const [, message] = consoleErrorSpy.mock.calls[0];
    expect(message).toBe('just a string');
  });

  test('keeps only the most recent errors, capped', () => {
    for (let i = 0; i < 30; i += 1) reportError(new Error(`err-${i}`));

    const recent = getRecentErrors();
    expect(recent.length).toBeLessThanOrEqual(20);
    // The buffer should hold the tail of the sequence, not the head.
    expect(recent[recent.length - 1].message).toBe('err-29');
  });

  test('installGlobalErrorHandlers registers window listeners exactly once each', () => {
    const addSpy = jest.spyOn(window, 'addEventListener');

    installGlobalErrorHandlers();

    expect(addSpy).toHaveBeenCalledWith('error', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));

    addSpy.mockRestore();
  });

  test('window error events are reported with context', () => {
    installGlobalErrorHandlers();
    consoleErrorSpy.mockClear();

    const error = new Error('window boom');
    window.dispatchEvent(Object.assign(new Event('error'), {
      error,
      message: error.message,
      filename: 'app.js',
      lineno: 12,
      colno: 3,
    }));

    expect(consoleErrorSpy).toHaveBeenCalled();
    const entry = getRecentErrors().slice(-1)[0];
    expect(entry.message).toBe('window boom');
    expect(entry.context).toMatchObject({ type: 'window.onerror', filename: 'app.js' });
  });

  test('unhandled promise rejections are reported', () => {
    installGlobalErrorHandlers();
    consoleErrorSpy.mockClear();

    const rejectionEvent = new Event('unhandledrejection');
    Object.defineProperty(rejectionEvent, 'reason', { value: new Error('rejected!') });
    window.dispatchEvent(rejectionEvent);

    const entry = getRecentErrors().slice(-1)[0];
    expect(entry.message).toBe('rejected!');
    expect(entry.context).toEqual({ type: 'unhandledrejection' });
  });
});
