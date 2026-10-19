/** Pure, account-scoped month browser navigation primitives. No private persistence. */
export type MonthKey = `${number}-${number}` | 'undated';
export type MonthSort = 'newest' | 'oldest';
export const PREVIEW_PAGE_LIMIT = 24;
export const MAX_PREVIEW_PAGES = 3;
export const isMonthKey = (value: unknown): value is MonthKey =>
  typeof value === 'string' && (value === 'undated' || /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value));

/** Validate date-only Gregorian values without timezone conversion or Date's 0–99 offset. */
export function monthKeyForDate(value: unknown): MonthKey {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return 'undated';
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] ? value.slice(0, 7) as MonthKey : 'undated';
}

/** Undated matches the feed's canonical 9999-99-99 sentinel: first newest, last oldest. */
export function orderMonths(months: readonly string[], sort: MonthSort): MonthKey[] {
  return [...new Set(months.filter(isMonthKey))].sort((a, b) => {
    const aa = a === 'undated' ? '9999-99' : a;
    const bb = b === 'undated' ? '9999-99' : b;
    return (aa < bb ? -1 : aa > bb ? 1 : 0) * (sort === 'oldest' ? 1 : -1);
  });
}
export function selectAvailableMonth(months: readonly string[], preferred: string | null | undefined, sort: MonthSort): MonthKey | null {
  const ordered = orderMonths(months, sort);
  return ordered.find(month => month === preferred) ?? ordered[0] ?? null;
}
export function clampMonthIndex(index: number, length: number): number {
  return length <= 0 ? -1 : Math.max(0, Math.min(length - 1, Number.isFinite(index) ? Math.trunc(index) : 0));
}
/** Delta follows displayed order; sparse/empty months are never synthesized. */
export function stepMonth(months: readonly string[], current: string | null, delta: number, sort: MonthSort): MonthKey | null {
  const ordered = orderMonths(months, sort);
  if (!ordered.length) return null;
  const index = ordered.findIndex(month => month === current);
  if (index < 0) return ordered[0];
  return ordered[clampMonthIndex(index + delta, ordered.length)];
}

export interface WheelGestureState { total: number; lastTime: number | null; fired: boolean }
export interface MonthWheelInput { deltaY: number; deltaX?: number; deltaMode?: number; ctrlKey?: boolean; timeStamp: number }
export const initialWheelGesture = (): WheelGestureState => ({ total: 0, lastTime: null, fired: false });
/** Call only on navigator. Caller prevents default iff handled; pinch/zoom is untouched. */
export function accumulateMonthWheel(state: WheelGestureState, input: MonthWheelInput, options: { threshold?: number; idleMs?: number; pagePixels?: number } = {}): { state: WheelGestureState; step: -1 | 0 | 1; handled: boolean } {
  if (input.ctrlKey || !Number.isFinite(input.deltaY) || !Number.isFinite(input.timeStamp) || input.deltaY === 0 || Math.abs(input.deltaX ?? 0) > Math.abs(input.deltaY)) return { state, step: 0, handled: false };
  const threshold = Math.max(1, options.threshold ?? 80);
  const idleMs = Math.max(0, options.idleMs ?? 180);
  const fresh = state.lastTime === null || input.timeStamp - state.lastTime >= idleMs || input.timeStamp < state.lastTime;
  const previous = fresh ? initialWheelGesture() : state;
  const factor = input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? (options.pagePixels ?? 800) : 1;
  const total = previous.total + input.deltaY * factor;
  const step = !previous.fired && Math.abs(total) >= threshold ? (total > 0 ? 1 : -1) : 0;
  return { state: { total, lastTime: input.timeStamp, fired: previous.fired || step !== 0 }, step, handled: true };
}

export interface NavigationIdentityInput {
  account: string; scope: string; month?: MonthKey; page?: string | number | null;
  target?: { ownerId: string; id: string } | null;
}
/** Serialize a tuple, never delimiter-join private composite identities. */
export function navigationIdentity(input: NavigationIdentityInput): string {
  return JSON.stringify([input.account, input.scope, input.month ?? null, input.page ?? null, input.target?.ownerId ?? null, input.target?.id ?? null]);
}

/** Oldest entry first. Keys MUST use navigationIdentity (including account and scope).
 * Cache only bounded endpoint pages; clear caller-owned cache on close/account/scope change.
 */
export function putPreviewPage<T>(cache: ReadonlyMap<string, T>, key: string, value: T): Map<string, T> {
  const next = new Map(cache);
  next.delete(key); next.set(key, value);
  while (next.size > MAX_PREVIEW_PAGES) next.delete(next.keys().next().value!);
  return next;
}
export function getPreviewPage<T>(cache: ReadonlyMap<string, T>, key: string): { cache: Map<string, T>; value: T | undefined } {
  const next = new Map(cache);
  const value = next.get(key);
  if (next.has(key)) { next.delete(key); next.set(key, value!); }
  return { cache: next, value };
}
