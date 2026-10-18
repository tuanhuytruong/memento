// Shared, normalized filter semantics (Phase 2 Task 2.1).
//
// One implementation is used by the client list filter, by the resurfacing
// candidate selection and — once the bounded server query lands — mirrored by
// `moment-queries.mjs`. Keeping the semantics here means a search that works
// locally cannot quietly differ from the same search on the server.
//
// Privacy: nothing in this module records, logs or transmits what was typed.
// The normalized text exists only to compare against loaded content.

/** Unicode-correct comparison form: NFC, then explicit đ handling, then diacritics. */
const DIACRITIC_MARKS = /[\u0300-\u036f]/g;
/** The Vietnamese đ has no combining-mark decomposition, so it is mapped first.
 * Plain strings, not regexes: a RegExp passed as a replacement would be
 * coerced to its source text and injected into the result. */
const DECORATED_D = /\u0111/g; // đ
const DECORATED_D_UPPER = /\u0110/g; // Đ

/**
 * Fold text for matching only. The caller's original string is never modified,
 * so display text, tags and stored values keep their exact characters.
 *
 * Order matters: NFC first so a decomposed "a" + combining grave and a
 * precomposed "à" compare equal, then đ/Đ are mapped so a search for "da lat"
 * finds "Đà Lạt" and a search for "đà" finds "Da", then combining marks are
 * dropped, then case and runs of whitespace are folded.
 */
export function foldSearchText(input: string): string {
  return input
    .normalize('NFC')
    .replace(DECORATED_D_UPPER, 'D')
    .replace(DECORATED_D, 'd')
    .normalize('NFD')
    .replace(DIACRITIC_MARKS, '')
    .normalize('NFC')
    .toLowerCase()
    // Context-free sigma: PostgreSQL lower() does not apply JS final-sigma rules.
    .replace(/ς/g, 'σ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize a whole tag/label for equality comparisons. */
export function foldLabel(value: string): string {
  return foldSearchText(value);
}

/** All text fields a search covers, in one documented place. */
export function searchableText(event: {
  title?: string;
  description?: string;
  idea?: string;
  tags?: string[];
  emotion?: string;
  location?: { name?: string; city?: string; country?: string };
}): string {
  return [
    event.title ?? '',
    event.description ?? '',
    event.idea ?? '',
    ...(event.tags ?? []),
    event.emotion ?? '',
    event.location?.name ?? '',
    event.location?.city ?? '',
    event.location?.country ?? '',
  ]
    .map(foldSearchText)
    .filter(Boolean)
    .join(' ');
}

/** `YYYY-MM-DD` shape plus a real calendar date. Never browser-parsed. */
export function isDateOnlyLiteral(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/**
 * The date-independent part of the app's filter state. The app's `FilterState`
 * adds `selectedEventId` (which track is focused) on top of this, and the
 * server query mirrors the same fields, so the semantics are shared rather
 * than duplicated per consumer.
 */
export interface MomentFilterState {
  search: string;
  selectedTags: string[];
  selectedEmotions: string[];
  selectedYear: string;
  /** Inclusive local calendar bounds, `''` when unset. */
  dateFrom: string;
  dateTo: string;
  milestonesOnly: boolean;
  hasImagesOnly: boolean;
  /**
   * Restrict to the caller's own saved memories. The saved set is supplied by
   * the caller because it is private state the server owns; this module only
   * decides membership, never who is on the list.
   */
  savedOnly: boolean;
  sortDirection: 'newest' | 'oldest';
}

export type MomentFilterPatch = Partial<MomentFilterState>;

/**
 * One rule for the two overlapping date controls: picking a year replaces any
 * range, and typing a range clears the year. Both directions are explicit so
 * the two never silently combine into an empty result.
 */
export function applyFilterPatch<T extends MomentFilterState>(current: T, patch: MomentFilterPatch): T {
  const next = { ...current, ...patch } as T;
  if (patch.selectedYear != null && patch.selectedYear !== 'all' && patch.dateFrom === undefined && patch.dateTo === undefined) {
    next.dateFrom = '';
    next.dateTo = '';
  }
  if (patch.dateFrom !== undefined || patch.dateTo !== undefined) {
    if (patch.selectedYear === undefined) next.selectedYear = 'all';
  }
  return next;
}

/**
 * Range validation. Returns the offending bound's message, or null when valid.
 * Only real `YYYY-MM-DD` literals or an empty string are accepted, and the
 * range must not be inverted.
 */
export function validateDateRange(dateFrom: string, dateTo: string): string | null {
  for (const [label, value] of [['From', dateFrom], ['To', dateTo]] as const) {
    if (value === '') continue;
    if (!isDateOnlyLiteral(value)) return `${label} date must be a real calendar date.`;
  }
  if (dateFrom && dateTo && dateFrom > dateTo) return 'The From date must not be after the To date.';
  return null;
}

export type MomentLike = {
  title: string;
  description?: string;
  idea?: string;
  tags?: string[];
  emotion?: string;
  location?: { name?: string; city?: string; country?: string };
  date: string;
  time?: string;
  isMilestone?: boolean;
  images?: string[];
  resourceOwnerId?: string;
  id?: string;
};

/** Inclusive range on the local calendar date; a malformed date is "unknown". */
function withinDateRange(date: string, dateFrom: string, dateTo: string): boolean {
  if (!dateFrom && !dateTo) return true;
  if (!isDateOnlyLiteral(date)) return true; // never silently hide an undated memory
  if (dateFrom && date < dateFrom) return false;
  if (dateTo && date > dateTo) return false;
  return true;
}

export function matchesMomentFilters(event: MomentLike, filters: MomentFilterState, isSaved?: (event: MomentLike) => boolean): boolean {
  const needle = foldSearchText(filters.search);
  if (needle && !searchableText(event).includes(needle)) return false;

  if (filters.selectedYear !== 'all' && !event.date.startsWith(filters.selectedYear)) return false;
  if (!withinDateRange(event.date, filters.dateFrom, filters.dateTo)) return false;

  // Selected tags are OR semantics: any one match is enough.
  if (filters.selectedTags.length > 0) {
    const wanted = new Set(filters.selectedTags.map(foldLabel));
    if (!(event.tags ?? []).some((tag) => wanted.has(foldLabel(tag)))) return false;
  }

  if (filters.selectedEmotions.length > 0) {
    if (!event.emotion || !filters.selectedEmotions.includes(event.emotion)) return false;
  }

  if (filters.savedOnly && (isSaved ? !isSaved(event) : false)) return false;
  if (filters.milestonesOnly && !event.isMilestone) return false;
  if (filters.hasImagesOnly && (!event.images || event.images.length === 0)) return false;
  return true;
}

/**
 * Canonical sort key: the memory's own calendar date, then its time as an
 * `HH:MM` fallback, then owner id and moment id so two memories with identical
 * content still order the same way on every machine and on the server.
 *
 * A malformed date sorts last rather than being parsed by the browser, which
 * would make the order depend on the viewer's locale and timezone.
 */
export function momentSortTuple(event: { date: string; time?: string; resourceOwnerId?: string; id?: string }): [string, string, string, string] {
  const date = isDateOnlyLiteral(event.date) ? event.date : '9999-99-99';
  const time = /^\d{2}:\d{2}$/.test(event.time ?? '') ? (event.time as string) : '99:99';
  return [date, time, event.resourceOwnerId ?? '', event.id ?? ''];
}

export function compareMoments(a: MomentLike, b: MomentLike, direction: 'newest' | 'oldest'): number {
  const tupleA = momentSortTuple(a);
  const tupleB = momentSortTuple(b);
  const sign = direction === 'newest' ? -1 : 1;
  for (let index = 0; index < tupleA.length; index += 1) {
    if (tupleA[index] === tupleB[index]) continue;
    return tupleA[index] < tupleB[index] ? -sign : sign;
  }
  return 0;
}

/**
 * Project the app's wider filter state (which also carries the focused track)
 * onto the shared predicate's shape, so callers never hand-copy fields and
 * silently drop one.
 */
export function filterProjection(state: MomentFilterState): MomentFilterState {
  return {
    search: state.search,
    selectedTags: state.selectedTags,
    selectedEmotions: state.selectedEmotions,
    selectedYear: state.selectedYear,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    milestonesOnly: state.milestonesOnly,
    hasImagesOnly: state.hasImagesOnly,
    savedOnly: state.savedOnly,
    sortDirection: state.sortDirection,
  };
}

export const EMPTY_FILTERS: MomentFilterState = {
  search: '',
  selectedTags: [],
  selectedEmotions: [],
  selectedYear: 'all',
  dateFrom: '',
  dateTo: '',
  milestonesOnly: false,
  hasImagesOnly: false,
  savedOnly: false,
  sortDirection: 'newest',
};
