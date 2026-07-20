// withRetry.js — retry an async operation with exponential backoff.
// Used by overlay classes so transient network blips during playback
// (fetch failures for a timestep's data/image) don't surface as a fatal
// error — they just get retried a few times in the background first.

const DEFAULT_MAX_ATTEMPTS = 12;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 20000;

export async function withRetry(fn, {
  shouldAbort,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  onRetry,
} = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (shouldAbort?.() || attempt >= maxAttempts) throw err;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      onRetry?.(err, attempt, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (shouldAbort?.()) throw err;
    }
  }
}
