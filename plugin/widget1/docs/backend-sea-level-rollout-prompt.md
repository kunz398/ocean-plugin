# Backend Prompt: Niue Sea-Level / Tide Support

Implement backend support for the Niue frontend sea-level rollout.

Required endpoint:

```http
GET /niue/sea-level/timeseries?start_time=<ISO8601>&end_time=<ISO8601>
```

Contract:

```json
{
  "timesteps": [
    {
      "valid_time_utc": "2026-07-11T18:00:00Z",
      "tide_m": 0.12,
      "total_sea_level_m": 0.18,
      "inverse_barometer_m": 0.02,
      "sla_m": 0.04
    }
  ],
  "source": "SPC sea-level forecast",
  "units": "m"
}
```

Backend requirements:

- Return a domain-wide Niue sea-level series; do not require lon/lat for this endpoint.
- Accept inclusive `start_time` and `end_time` ISO timestamps and return chronological timesteps clipped to that window.
- Use `valid_time_utc` as the canonical timestamp field. Keep `tide_m` and `total_sea_level_m` in metres.
- Keep cadence aligned with the forecast window where possible so the frontend can match tide values to landing-area timesteps, route ETAs, and inundation chart times.
- Configure CORS or proxy routing so this endpoint is reachable from the same API base currently used by vessel suitability.
- Return a useful non-200 error when the sea-level product is unavailable; do not fabricate tide values.
- Add backend tests or curl checks for clipped ranges, empty/out-of-window ranges, missing data, and chronological ordering.

Optional but recommended:

- Add metadata such as `model_run_time_utc`, `forecast_start_utc`, and `forecast_end_utc` if genuinely available from source data. Omit it when not available rather than deriving a misleading model age.
- For operational map render endpoints used by PDF capture, support `show_stats=false` to suppress diagnostic/stat overlays in export images.
- If backend-rendered suitability maps include class colors, keep them aligned with the frontend map classes: Suitable `#2A9D8F`, Caution `#FB8C00`, Avoid `#E53935`, No Data light grey.
- Ensure the deployment pipeline copies/publishes the generated sea-level zarr/json product alongside the existing suitability and inundation products.
