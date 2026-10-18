import React, { useEffect, useRef, useState } from 'react';
import {
  Calendar,
  Plus,
  Download,
  Star,
  MapPin,
  Image as ImageIcon,
  Sparkles,
  MoreHorizontal,
  ChevronDown,
} from 'lucide-react';
import { AccountOverview } from '../types';

interface TimelineHeaderProps {
  /**
   * Full-scope summary from the server. Deliberately not the loaded list:
   * with a paginated feed these metrics must not shrink to the first page.
   * Null while the first summary is still in flight.
   */
  overview: AccountOverview | null;
  trackCount: number;
  onAddNewEvent: () => void;
  onExportJson: () => void | Promise<void>;
  /** Hidden entirely when the signed-in user owns no track. */
  onCreatePostcard?: () => void;
  username?: string;
  onLogout?: () => void;
  canCreateEntry?: boolean;
}

export const TimelineHeader: React.FC<TimelineHeaderProps> = ({
  overview,
  trackCount,
  onAddNewEvent,
  onExportJson,
  onCreatePostcard,
  username,
  onLogout,
  canCreateEntry = true,
}) => {
  const [accountOpen, setAccountOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Mobile shows one compact summary line; the full ribbon sits behind an
  // explicit Details toggle so the first memory is closer to the top.
  const [showMetrics, setShowMetrics] = useState(false);

  // Close dropdowns on outside click.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-account-menu]')) setAccountOpen(false);
      if (!target.closest('[data-overflow-menu]')) setMenuOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  // Read straight from the summary; nothing here is derived from a page.
  const totalEvents = overview?.total ?? 0;
  const milestonesCount = overview?.milestones ?? 0;
  const totalPhotos = overview?.photos ?? 0;
  const uniquePlaces = overview?.places ?? 0;

  return (
    <header className="mb-6 sm:mb-8">
      {/* Top Banner — single lean row */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-stone-200 dark:border-stone-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-xl bg-amber-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <Calendar className="w-4 h-4" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold font-display text-stone-900 dark:text-stone-100 tracking-tight">
              Memento
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 max-w-xl">
            Mend your memory, together.
          </p>
        </div>

        {/* Actions: 1 primary + overflow + avatar */}
        <div className="flex items-center gap-2 shrink-0">
          {canCreateEntry && <button
            id="open-create-event-modal"
            onClick={onAddNewEvent}
            className="min-h-11 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition flex items-center gap-2 active:scale-98 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>New entry</span>
          </button>}

          <div className="relative" data-overflow-menu>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              title="More actions"
              className="min-h-11 min-w-11 px-3 py-2 rounded-xl text-xs font-semibold border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 hover:bg-stone-50 dark:hover:bg-stone-700"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 mt-2 w-48 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-lg p-1.5 z-50">
                <button
                  type="button"
                  role="menuitem"
                  id="export-timeline-json"
                  onClick={() => {
                    setMenuOpen(false);
                    void onExportJson();
                  }}
                  title="Export timeline data as JSON backup"
                  className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium hover:bg-stone-100 dark:hover:bg-stone-800 flex items-center gap-2"
                >
                  <Download className="w-3.5 h-3.5 text-stone-500" />
                  Export backup (JSON)
                </button>
                {onCreatePostcard && (
                  <button
                    type="button"
                    role="menuitem"
                    id="create-postcard"
                    onClick={() => { setMenuOpen(false); onCreatePostcard(); }}
                    title="Create a private postcard from your own moments"
                    className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium hover:bg-stone-100 dark:hover:bg-stone-800 flex items-center gap-2"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    Create postcard
                  </button>
                )}
              </div>
            )}
          </div>

          {username && onLogout && (
            <div className="relative" data-account-menu>
              <button
                type="button"
                onClick={() => setAccountOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                title={username}
                className="w-11 h-11 rounded-full bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 text-xs font-bold flex items-center justify-center shrink-0"
              >
                {username.slice(0, 1).toUpperCase()}
              </button>
              {accountOpen && (
                <div role="menu" className="absolute right-0 mt-2 w-48 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-lg p-1.5 z-50">
                  <p className="px-3 py-2 text-xs text-stone-500 truncate">{username}</p>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAccountOpen(false);
                      onLogout();
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold hover:bg-stone-100 dark:hover:bg-stone-800"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Metrics: one compact summary line on mobile, the full ribbon on
          sm and above. Details expands the ribbon on narrow screens. */}
      <div className="pt-4">
        <div className="flex items-center justify-between gap-3 sm:hidden">
          <p className="text-xs text-stone-600 dark:text-stone-300 min-w-0 truncate">
            <span className="font-bold text-stone-900 dark:text-stone-100">{totalEvents}</span> memories
            <span className="text-stone-400"> · </span>
            <span className="font-bold text-stone-900 dark:text-stone-100">{trackCount}</span> {trackCount === 1 ? 'timeline' : 'timelines'}
            {milestonesCount > 0 && (<><span className="text-stone-400"> · </span><span className="font-bold text-amber-700 dark:text-amber-400">{milestonesCount}</span> milestones</>)}
          </p>
          <button
            type="button"
            id="toggle-metrics-details"
            aria-expanded={showMetrics}
            onClick={() => setShowMetrics((prev) => !prev)}
            className="inline-flex min-h-11 items-center gap-1 px-3 text-[11px] font-semibold rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition shrink-0"
          >
            Details
            <ChevronDown className={`w-3 h-3 transition-transform ${showMetrics ? 'rotate-180' : ''}`} />
          </button>
        </div>

        <div className={`${showMetrics ? 'grid' : 'hidden'} grid-cols-2 gap-2 mt-2 sm:grid sm:mt-0`}>
          <div className="px-3 py-2 rounded-xl bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800 shadow-xs flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100 leading-none">
                {trackCount}
              </div>
              <div className="text-[11px] text-stone-400 font-medium mt-0.5">
                Event Timelines
              </div>
            </div>
          </div>

          <div className="px-3 py-2 rounded-xl bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800 shadow-xs flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 flex items-center justify-center shrink-0">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <div className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100 leading-none">
                {totalEvents}
              </div>
              <div className="text-[11px] text-stone-400 font-medium mt-0.5">
                Total Logged
              </div>
            </div>
          </div>

          <div className="px-3 py-2 rounded-xl bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800 shadow-xs flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
              <Star className="w-4 h-4 fill-current" />
            </div>
            <div>
              <div className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100 leading-none">
                {milestonesCount}
              </div>
              <div className="text-[11px] text-stone-400 font-medium mt-0.5">
                Milestones
              </div>
            </div>
          </div>

          <div className="px-3 py-2 rounded-xl bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800 shadow-xs flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 flex items-center justify-center shrink-0">
              <ImageIcon className="w-4 h-4" />
            </div>
            <div>
              <div className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100 leading-none">
                {totalPhotos}
              </div>
              <div className="text-[11px] text-stone-400 font-medium mt-0.5">
                Attached Photos
              </div>
            </div>
          </div>

          <div className="px-3 py-2 rounded-xl bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800 shadow-xs flex items-center gap-3 col-span-2 sm:col-span-1">
            <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 flex items-center justify-center shrink-0">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <div className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100 leading-none">
                {uniquePlaces}
              </div>
              <div className="text-[11px] text-stone-400 font-medium mt-0.5">
                Unique Places
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
