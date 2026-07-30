// Shared formatting for the app-wide NUT/UTC display toggle (timeDisplayZone
// state, lifted to Home.jsx). Both zones this app supports are fixed-offset
// (Pacific/Niue is UTC-11 year-round, no DST), so the datetime-local
// round-trip below is exact — no DST-transition ambiguity to handle.

export const TZ_LABELS = { UTC: 'UTC', 'Pacific/Niue': 'NUT' };

export function tzLabel(timeZone) {
  return TZ_LABELS[timeZone] || timeZone;
}

// Formats a Date for display in `timeZone`, e.g. "21/07/2026 14:05 NUT".
export function formatZoned(date, timeZone, { withLabel = true, ...fmtOpts } = {}) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...fmtOpts,
  }).format(date);
  return withLabel ? `${formatted} ${tzLabel(timeZone)}` : formatted;
}

// Hour:minute-only variant (no date part) — for "Valid HH:MM" style readouts
// where the date is implied by context.
export function formatZonedTime(date, timeZone, opts = {}) {
  return formatZoned(date, timeZone, {
    day: undefined,
    month: undefined,
    year: undefined,
    withLabel: false,
    ...opts,
  });
}

// 'YYYY-MM-DDTHH:mm' wall-clock string for `date` as it reads in `timeZone`
// — the shape a <input type="datetime-local"> value/min/max attribute needs.
export function toZonedInputValue(date, timeZone) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return undefined;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// Inverse of toZonedInputValue: interprets a 'YYYY-MM-DDTHH:mm' wall-clock
// string as a moment in `timeZone`, returns the equivalent real UTC Date.
export function fromZonedInputValue(value, timeZone) {
  if (!value) return null;
  const asIfUTC = new Date(`${value}:00.000Z`);
  if (Number.isNaN(asIfUTC.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(asIfUTC).map((p) => [p.type, p.value])
  );
  const asZoned = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  const offset = asIfUTC.getTime() - asZoned;
  return new Date(asIfUTC.getTime() + offset);
}

// Weekday-code / day-of-month / hour triple for the tabular forecast table's
// stacked column headers — zone-aware replacement for raw date.getDay() /
// .getDate() / .getHours() (which read the browser's own local time, not
// necessarily the zone the user selected).
const WEEKDAY_CODES = { Sun: 'Su', Mon: 'Mo', Tue: 'Tu', Wed: 'We', Thu: 'Th', Fri: 'Fr', Sat: 'Sa' };

export function zonedTableTimeParts(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      day: 'numeric',
      hour: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  return {
    dayCode: WEEKDAY_CODES[parts.weekday] || parts.weekday,
    dayNum: parts.day,
    hour: `${parts.hour}hr`,
  };
}
