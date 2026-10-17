import React from 'react';
import { ChevronDown, RefreshCw, RotateCcw } from 'lucide-react';

/**
 * Explicit paging control (Phase 3 Task 3.2).
 *
 * Deliberately not an infinite scroll: the caller decides when to fetch the
 * next page, so the request count is observable and the retained window stays
 * bounded. When older pages have been dropped to stay inside that window, the
 * control says so rather than silently losing them, and offers a way back.
 */
export const LoadMoreMemories: React.FC<{
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  windowShifted: boolean;
  loadedCount: number;
  totalCount: number | null;
  onLoadMore: () => void;
  onNewer: () => void;
  onRefresh: () => void;
}> = ({ hasMore, loading, error, windowShifted, loadedCount, totalCount, onLoadMore, onNewer, onRefresh }) => (
  <div id="moment-feed-pager" className="pt-2 pb-8 space-y-3">
    {windowShifted && (
      <p className="text-xs text-stone-500 dark:text-stone-400 text-center">
        Older memories were released to keep this list light.
        <button
          type="button"
          id="feed-newer"
          onClick={onNewer}
          className="ml-1.5 inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400 hover:underline min-h-11"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Back to the newest memories
        </button>
      </p>
    )}

    {error && (
      <div className="rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
        <p role="alert">{error}</p>
        <button
          type="button"
          id="feed-retry"
          onClick={onRefresh}
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white px-3 text-xs font-semibold transition"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    )}

    {hasMore && !error && (
      <div className="flex justify-center">
        <button
          type="button"
          id="feed-load-more"
          onClick={onLoadMore}
          disabled={loading}
          aria-busy={loading}
          className="min-h-11 inline-flex items-center gap-2 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-5 text-xs sm:text-sm font-semibold text-stone-700 dark:text-stone-300 hover:border-amber-400 transition disabled:opacity-60"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${loading ? 'animate-pulse' : ''}`} />
          {loading ? 'Loading…' : 'Load more memories'}
        </button>
      </div>
    )}

    {typeof totalCount === 'number' && !loading && (
      <p className="text-[11px] text-stone-400 dark:text-stone-500 text-center" id="feed-progress">
        Showing {loadedCount} of {totalCount}
      </p>
    )}
  </div>
);
