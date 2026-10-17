// Local calendar-date construction. A new memory defaults to TODAY in the
// viewer's own calendar, never to the UTC date that toISOString() reports —
// around local midnight those can be different days.
//
// The server stores date-only memories literally (frozen Phase 0 contract), so
// this helper only ever produces/consumes `YYYY-MM-DD` strings. It never
// rewrites an existing memory's date and never touches server timestamps.

const pad = (value: number) => String(value).padStart(2, '0');

/** `YYYY-MM-DD` for the given instant in the runtime's local calendar. */
export function localCalendarDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `HH:mm` (24h) for the given instant in the runtime's local calendar. */
export function localClockTime(now: Date = new Date()): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** Strict `YYYY-MM-DD` shape check; shape only, not calendar validity. */
export function isCalendarDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Calendar validity for a `YYYY-MM-DD` string: rejects overflow dates such as
 * 2026-02-30 that a permissive parser would silently roll into March.
 */
export function isRealCalendarDate(value: unknown): value is string {
  if (!isCalendarDateString(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * Local midnight instant for a calendar date, in the runtime's own zone. Used
 * for inclusive From/To comparisons so a date-only boundary never shifts.
 * Returns null for a malformed or impossible date instead of guessing.
 */
export function calendarDateToLocalInstant(value: string): Date | null {
  if (!isRealCalendarDate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The calendar date a memory falls on, taken from its literal date part.
 * A timestamp-form date keeps its own explicit offset: we slice the date part
 * rather than re-rendering the instant in local time, because the author chose
 * that calendar day deliberately.
 */
export function memoryCalendarDate(date: string): string {
  // Narrowing by an "is string" guard would collapse the else branch to
  // `never`, so the shape check is applied to a copy instead.
  const value: unknown = date;
  return isCalendarDateString(value) ? value : String(date).slice(0, 10);
}
