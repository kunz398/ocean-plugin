import { useEffect, useState } from 'react';
import { fetchSeaLevelTimeseries } from '../lib/NiueSuitabilityOverlay';

// A short TTL, not an unbounded cache — this exists to avoid an extra
// /niue/status round-trip on every fetch within a session, not to lock in
// a stale answer forever. An un-expiring cache here previously meant a tab
// that first loaded while the backend's sea-level product was down would
// keep showing "unavailable" indefinitely even after the backend recovered,
// with no way to notice short of a hard reload.
const SEA_LEVEL_AVAILABILITY_TTL_MS = 60 * 1000;
const SEA_LEVEL_AVAILABILITY_CACHE = new Map();

async function seaLevelProductAvailable(apiBase) {
  const base = String(apiBase || '').replace(/\/$/, '');
  const cached = SEA_LEVEL_AVAILABILITY_CACHE.get(base);
  if (cached && Date.now() - cached.checkedAt < SEA_LEVEL_AVAILABILITY_TTL_MS) {
    return cached.available;
  }
  try {
    const resp = await fetch(`${base}/niue/status`);
    if (!resp.ok) return true;
    const status = await resp.json();
    const available = status?.exists?.sea_level_nc !== false;
    SEA_LEVEL_AVAILABILITY_CACHE.set(base, { available, checkedAt: Date.now() });
    return available;
  } catch {
    return true;
  }
}

export function useSeaLevelTimeseries(apiBase, startTime, endTime, enabled = true) {
  const [state, setState] = useState({ loading: false, error: null, data: null });

  useEffect(() => {
    if (!enabled || !apiBase || !startTime || !endTime) {
      setState({ loading: false, error: null, data: null });
      return undefined;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      const available = await seaLevelProductAvailable(apiBase);
      if (!available) {
        if (!cancelled) {
          setState({
            loading: false,
            error: 'Sea-level product is not available in this deployment.',
            data: null,
          });
        }
        return;
      }
      const data = await fetchSeaLevelTimeseries(apiBase, startTime, endTime);
      if (!cancelled) setState({ loading: false, error: null, data });
    })()
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err.message, data: null });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, apiBase, startTime, endTime]);

  return state;
}
