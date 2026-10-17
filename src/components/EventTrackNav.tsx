import React from 'react';
import {
  Layers,
  Plus,
  Edit2,
  Calendar,
  Sparkles,
  Star,
  Image as ImageIcon,
  CheckCircle2,
  Clock,
  Archive,
  Share2,
} from 'lucide-react';
import { EventTrack, TimelineEvent } from '../types';
import {
  EVENT_COLORS,
  getEventTheme,
  getEventIconComponent,
} from '../data/eventThemes';
import { formatDateDisplay } from '../lib/storage';
import { trackIdentity } from '../lib/resourceIdentity';

interface EventTrackNavProps {
  tracks: EventTrack[];
  events: TimelineEvent[];
  selectedTrackKey: string; // 'all' or composite owner+track identity
  onSelectTrack: (track: EventTrack | null) => void;
  onAddNewTrack: () => void;
  onEditTrack: (track: EventTrack) => void;
  onAddNewMoment: () => void;
  onShareTrack: (track: EventTrack) => void;
  canEditSelectedTrack: boolean;
}

/** Above this many tracks the strip collapses behind an explicit Show all. */
const TRACK_PREVIEW_LIMIT = 8;

export const EventTrackNav: React.FC<EventTrackNavProps> = ({
  tracks,
  events,
  selectedTrackKey,
  onSelectTrack,
  onAddNewTrack,
  onEditTrack,
  onAddNewMoment,
  onShareTrack,
  canEditSelectedTrack,
}) => {
  const [trackGroup, setTrackGroup] = React.useState<'only' | 'withYou' | 'byYou'>('only');
  const [showAllTracks, setShowAllTracks] = React.useState(false);
  const [trackQuery, setTrackQuery] = React.useState('');
  const activeTrack = tracks.find((t) => trackIdentity(t) === selectedTrackKey);
  const isMergedView = selectedTrackKey === 'all';
  const groupedTracks = tracks.filter((track) => trackGroup === 'only'
    ? track.accessRole === 'owner' && !track.sharedByYou
    : trackGroup === 'byYou'
      ? track.accessRole === 'owner' && track.sharedByYou
      : track.accessRole === 'viewer' || track.accessRole === 'editor');
  const groupCounts = {
    only: tracks.filter((track) => track.accessRole === 'owner' && !track.sharedByYou).length,
    withYou: tracks.filter((track) => track.accessRole === 'viewer' || track.accessRole === 'editor').length,
    byYou: tracks.filter((track) => track.accessRole === 'owner' && track.sharedByYou).length,
  };

  // Composite-key map: one pass over moments, never tracks.find per event.
  const trackStatsMap = React.useMemo(() => {
    const map: Record<string, { count: number; milestones: number; photos: number; minDate?: string; maxDate?: string }> = {};
    tracks.forEach((t) => {
      map[trackIdentity(t)] = { count: 0, milestones: 0, photos: 0 };
    });
    events.forEach((e) => {
      const key = `${e.resourceOwnerId ?? 'legacy'}:${e.eventId}`;
      const stats = map[key];
      if (!stats) return;
      stats.count += 1;
      if (e.isMilestone) stats.milestones += 1;
      stats.photos += (e.images?.length || 0);
      if (!stats.minDate || e.date < stats.minDate) stats.minDate = e.date;
      if (!stats.maxDate || e.date > stats.maxDate) stats.maxDate = e.date;
    });
    return map;
  }, [tracks, events]);

  const activeTrackStats = activeTrack ? trackStatsMap[trackIdentity(activeTrack)] : null;

  // Bounded preview: the selected track always stays visible even when it
  // falls outside the preview window, and a search narrows the strip.
  const query = trackQuery.trim().toLowerCase();
  const matched = query
    ? groupedTracks.filter((track) => track.title.toLowerCase().includes(query))
    : groupedTracks;
  const needsCollapse = !query && matched.length > TRACK_PREVIEW_LIMIT;
  const selectedInGroup = groupedTracks.find((track) => trackIdentity(track) === selectedTrackKey);
  const visibleTracks = needsCollapse && !showAllTracks
    ? (() => {
        const preview = matched.slice(0, TRACK_PREVIEW_LIMIT);
        // Keep the current selection in view even if it is not in the preview.
        if (selectedInGroup && !preview.some((track) => trackIdentity(track) === trackIdentity(selectedInGroup))) {
          preview[preview.length - 1] = selectedInGroup;
        }
        return preview;
      })()
    : matched;

  return (
    <div className="min-w-0 space-y-4 mb-6">
      {/* Ownership grouping makes private and collaborative tracks easier to scan. */}
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Track groups">
        {([['only', 'Only you'], ['withYou', 'Shared with you'], ['byYou', 'Shared by you']] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setTrackGroup(key)} className={`rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${trackGroup === key ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900' : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'}`}>{label} <span className="opacity-70">{groupCounts[key]}</span></button>)}
      </div>
      {/* Horizontal Tabs: All Events (Merged Timeline) + Individual Event Tracks + New Track Button */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2.5 pt-1 no-scrollbar scroll-smooth">
        {/* "All Events (Merged Timeline)" Button */}
        <button
          id="tab-all-events-merged"
          type="button"
          aria-pressed={isMergedView}
          onClick={() => onSelectTrack(null)}
          className={`group flex items-center gap-2 px-3.5 py-2 min-h-11 rounded-xl text-xs sm:text-sm font-semibold transition-all shrink-0 border whitespace-nowrap ${
            isMergedView
              ? 'bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100 shadow-sm'
              : 'bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-800 hover:border-stone-400 dark:hover:border-stone-700'
          }`}
        >
          <Layers className="w-4 h-4 text-amber-500" />
          <span>All Events (Merged Timeline)</span>
          <span
            className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold ${
              isMergedView
                ? 'bg-stone-800 text-stone-300 dark:bg-stone-200 dark:text-stone-800'
                : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'
            }`}
          >
            {events.length}
          </span>
        </button>

        {/* Individual Event Track Tabs (bounded preview) */}
        {visibleTracks.map((track) => {
          const isSelected = selectedTrackKey === trackIdentity(track);
          const IconComp = getEventIconComponent(track.icon);
          const theme = getEventTheme(track.color);
          const stats = trackStatsMap[trackIdentity(track)] || { count: 0, milestones: 0, photos: 0 };

          return (
            <button
              key={trackIdentity(track)}
              id={`tab-event-track-${track.resourceOwnerId}-${track.id}`}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelectTrack(track)}
              className={`group flex items-center gap-2 px-3.5 py-2 min-h-11 rounded-xl text-xs sm:text-sm font-semibold transition-all shrink-0 border whitespace-nowrap ${
                isSelected
                  ? `${theme.bgLight} ${theme.bgDark} ${theme.textLight} ${theme.textDark} ${theme.borderLight} ${theme.borderDark} ring-2 ring-amber-500/20 shadow-xs`
                  : 'bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-700'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-md flex items-center justify-center text-white ${
                  theme.accentBg
                }`}
              >
                <IconComp className="w-3 h-3" />
              </div>
              <span className="max-w-48 truncate" title={track.title}>{track.title}</span>
              <span
                className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold ${
                  isSelected
                    ? 'bg-white/80 dark:bg-stone-800/80'
                    : 'bg-stone-100 dark:bg-stone-800 text-stone-500'
                }`}
              >
                {stats.count}
              </span>
            </button>
          );
        })}

        {/* "+ New Event Track" CTA - directly in the sequence without overlapping */}
        <button
          id="btn-add-event-track"
          type="button"
          onClick={onAddNewTrack}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold text-stone-700 dark:text-stone-300 bg-white dark:bg-stone-900 border border-dashed border-stone-300 dark:border-stone-700 hover:border-amber-500 dark:hover:border-amber-500 hover:text-amber-600 dark:hover:text-amber-400 transition shrink-0 whitespace-nowrap shadow-2xs active:scale-98"
          title="Create a separated timeline for a new event (e.g. AI era, New company)"
        >
          <Plus className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          <span>New Track</span>
        </button>
      </div>

      {/* Bounded strip controls: only shown when the list is long enough to
          need them, so small accounts keep the quiet single row. */}
      {(needsCollapse || groupedTracks.length > TRACK_PREVIEW_LIMIT) && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="track-nav-search" className="sr-only">Search tracks by name</label>
          <input
            id="track-nav-search"
            type="search"
            value={trackQuery}
            onChange={(e) => setTrackQuery(e.target.value)}
            placeholder="Search tracks…"
            className="px-3 py-1.5 min-h-11 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 w-40"
          />
          {needsCollapse && (
            <button
              type="button"
              id="toggle-show-all-tracks"
              aria-expanded={showAllTracks}
              onClick={() => setShowAllTracks((prev) => !prev)}
              className="px-3 py-1.5 min-h-11 text-xs font-semibold rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition"
            >
              {showAllTracks ? 'Show fewer' : `Show all ${matched.length} tracks`}
            </button>
          )}
        </div>
      )}

      {/* Overview Banner for Selected State */}
      {isMergedView ? (
        <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-stone-900 to-stone-800 text-white shadow-sm">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-300 shrink-0">
              <Layers className="w-6 h-6" />
            </div>
            <div className="min-w-0 break-words">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-bold font-display">
                  Merged Timeline · All Events
                </h2>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-stone-700 text-stone-200">
                  Global View
                </span>
              </div>
              <p className="text-xs sm:text-sm text-stone-300 mt-0.5 max-w-xl leading-relaxed">
                {tracks.length === 0
                  ? 'No tracks yet — create one to start grouping your memories.'
                  : `Viewing merged chronological progression across ${tracks.length} ${tracks.length === 1 ? 'timeline' : 'timelines'}. Pick a track above to focus on one chapter.`}
              </p>
            </div>
          </div>
        </div>
      ) : activeTrack ? (
        (() => {
          const theme = getEventTheme(activeTrack.color);
          const IconComp = getEventIconComponent(activeTrack.icon);
          const stats = activeTrackStats || { count: 0, milestones: 0, photos: 0 };
          const dateSpan =
            stats.minDate && stats.maxDate
              ? `${formatDateDisplay(stats.minDate)} — ${formatDateDisplay(stats.maxDate)}`
              : 'No entries yet';

          return (
            <div
              className={`p-4 sm:p-5 rounded-2xl border transition-all ${theme.bgLight} ${theme.bgDark} ${theme.borderLight} ${theme.borderDark} shadow-xs`}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start sm:items-center gap-3.5">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shrink-0 shadow-sm ${theme.accentBg}`}
                  >
                    <IconComp className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 break-words">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-lg sm:text-xl font-bold font-display text-stone-900 dark:text-stone-100">
                        {activeTrack.title}
                      </h2>
                      <span
                        className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                          activeTrack.status === 'completed'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : activeTrack.status === 'archived'
                            ? 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300'
                            : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300'
                        }`}
                      >
                        {activeTrack.status || 'active'}
                      </span>
                      <span className="text-xs text-stone-500 font-medium">
                        Timeline of {stats.count} {stats.count === 1 ? 'event' : 'events'}
                      </span>
                    </div>

                    {activeTrack.description && (
                      <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-300 mt-1 max-w-xl leading-relaxed">
                        {activeTrack.description}
                      </p>
                    )}

                    {/* Meta stats ribbon */}
                    <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-stone-500 dark:text-stone-400">
                      <span className="flex items-center gap-1 font-medium">
                        <Calendar className="w-3.5 h-3.5 text-stone-400" />
                        {dateSpan}
                      </span>
                      {stats.milestones > 0 && (
                        <span className="flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                          <Star className="w-3.5 h-3.5 fill-current" />
                          {stats.milestones} {stats.milestones === 1 ? 'milestone' : 'milestones'}
                        </span>
                      )}
                      {stats.photos > 0 && (
                        <span className="flex items-center gap-1 font-medium text-sky-700 dark:text-sky-400">
                          <ImageIcon className="w-3.5 h-3.5" />
                          {stats.photos} {stats.photos === 1 ? 'photo' : 'photos'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Track owners manage sharing; shared viewers have no mutation controls. */}
                <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
                  {activeTrack.accessRole === 'owner' && <button onClick={() => onShareTrack(activeTrack)} className="px-3 py-2 min-h-11 rounded-xl text-xs font-semibold border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-50 transition flex items-center gap-1.5 shadow-xs"><Share2 className="w-3.5 h-3.5" /><span>Share</span></button>}
                  {activeTrack.accessRole === 'owner' && <button onClick={() => onEditTrack(activeTrack)} className="px-3 py-2 min-h-11 rounded-xl text-xs font-semibold border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-50 transition flex items-center gap-1.5 shadow-xs" title="Edit Event Track title, color, or icon"><Edit2 className="w-3.5 h-3.5" /><span>Edit Track</span></button>}
                  {canEditSelectedTrack && <button onClick={onAddNewMoment} className={`px-4 py-2 min-h-11 rounded-xl text-xs sm:text-sm font-semibold text-white shadow-xs transition flex items-center gap-1.5 active:scale-98 ${theme.accentBg} hover:opacity-90`}><Plus className="w-4 h-4" /><span>Add to {activeTrack.title}</span></button>}
                </div>
              </div>
            </div>
          );
        })()
      ) : null}
    </div>
  );
};
