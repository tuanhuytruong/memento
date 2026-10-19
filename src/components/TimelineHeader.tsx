import React, { useEffect, useState } from 'react';
import {
  Calendar,
  Plus,
  Download,
  Image as ImageIcon,
  Sparkles,
  MoreHorizontal,
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

      <div id="memory-summary" data-summary className="mt-3 rounded-xl bg-stone-100/60 dark:bg-stone-800/40 px-3 py-2 text-xs text-stone-600 dark:text-stone-300">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span data-summary-metric className="inline-flex items-center gap-1 whitespace-nowrap"><span><strong>{totalEvents}</strong> {totalEvents === 1 ? 'memory' : 'memories'}</span></span>
          <span data-summary-metric className="inline-flex items-center gap-1 whitespace-nowrap"><span><strong>{trackCount}</strong> {trackCount === 1 ? 'timeline' : 'timelines'}</span></span>
          <span data-summary-metric className="inline-flex items-center gap-1 whitespace-nowrap"><ImageIcon size={13} /><span><strong>{totalPhotos}</strong> {totalPhotos === 1 ? 'photo' : 'photos'}</span></span>
          <span data-summary-metric className="inline-flex items-center gap-1 whitespace-nowrap"><span><strong>{milestonesCount}</strong> {milestonesCount === 1 ? 'milestone' : 'milestones'}</span></span>
          <span data-summary-metric className="inline-flex items-center gap-1 whitespace-nowrap"><span><strong>{uniquePlaces}</strong> {uniquePlaces === 1 ? 'place' : 'places'}</span></span>
        </div>
      </div>
    </header>
  );
};
