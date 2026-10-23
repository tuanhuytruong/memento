import React from 'react';
import type { ViewMode } from '../types';
/** Geometry only: no pretend memory text or private bytes before the first result. */
export function FeedLoadingState({ view }: { view: ViewMode }) {
  return <section role="status" aria-label="Loading memories" data-feed-skeleton={view}>
    <span className="sr-only">Loading memories…</span>
    <div aria-hidden="true" className={view === 'gallery' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5' : 'space-y-6'}>
      {Array.from({length: view === 'compact' ? 7 : 3}, (_, i) => <div key={i} className={`rounded-2xl border border-stone-200 dark:border-stone-800 p-5 ${view === 'timeline' ? 'ml-12' : ''}`}>
        {view === 'gallery' && <div className="feed-skeleton-block h-40 mb-4" />}
        <div className="feed-skeleton-block h-4 w-1/3 mb-3" />
        <div className="feed-skeleton-block h-5 w-2/3 mb-3" />
        {view !== 'compact' && <div className="feed-skeleton-block h-16 w-full" />}
      </div>)}
    </div>
  </section>;
}
