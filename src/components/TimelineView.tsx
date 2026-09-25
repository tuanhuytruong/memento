import React from 'react';
import { TimelineEvent, EventTrack } from '../types';
import { EventCard } from './EventCard';
import { Calendar, Plus, Sparkles } from 'lucide-react';
import { getEventTheme } from '../data/eventThemes';

interface TimelineViewProps {
  events: TimelineEvent[];
  tracks: EventTrack[];
  currentTrackId?: string;
  onSelectTrack?: (trackId: string) => void;
  onViewDetails: (event: TimelineEvent) => void;
  onEdit: (event: TimelineEvent) => void;
  onDelete: (id: string) => Promise<void>;
  onTagClick: (tag: string) => void;
  onOpenImageLightbox: (images: string[], index: number) => void;
  onAddNewEvent: () => void;
  onResetFilters?: () => void;
  isFiltered?: boolean;
}

export const TimelineView: React.FC<TimelineViewProps> = ({
  events,
  tracks,
  currentTrackId = 'all',
  onSelectTrack,
  onViewDetails,
  onEdit,
  onDelete,
  onTagClick,
  onOpenImageLightbox,
  onAddNewEvent,
  onResetFilters,
  isFiltered,
}) => {
  const currentTrack = tracks.find((t) => t.id === currentTrackId);
  const trackTheme = currentTrack ? getEventTheme(currentTrack.color) : null;

  if (events.length === 0) {
    return (
      <div
        id="empty-timeline-state"
        className="py-16 px-6 text-center max-w-md mx-auto rounded-3xl border border-dashed border-stone-300 dark:border-stone-800 bg-white/50 dark:bg-stone-900/50 backdrop-blur-xs"
      >
        <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto mb-3">
          {currentTrack ? (
            <Sparkles className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          ) : (
            <Calendar className="w-6 h-6" />
          )}
        </div>
        <h3 className="text-lg font-bold font-display text-stone-900 dark:text-stone-100 mb-1">
          {isFiltered
            ? 'No matching timeline entries'
            : currentTrack
            ? `No entries in ${currentTrack.title} yet`
            : 'Your timeline is clear'}
        </h3>
        <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 mb-6 leading-relaxed">
          {isFiltered
            ? 'Try adjusting your tag filters, search term, or emotion criteria.'
            : currentTrack
            ? `Log the first milestone or moment for the ${currentTrack.title} event timeline.`
            : 'Start chronicling your life events, milestones, feelings, ideas, and travels.'}
        </p>
        <div className="flex items-center justify-center gap-3">
          {isFiltered && onResetFilters ? (
            <button
              onClick={onResetFilters}
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300 transition"
            >
              Reset Filters
            </button>
          ) : null}
          <button
            id="empty-state-add-event"
            onClick={onAddNewEvent}
            className="px-5 py-2 text-xs font-semibold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />{' '}
            {currentTrack ? `Add to ${currentTrack.title}` : 'Log First Event'}
          </button>
        </div>
      </div>
    );
  }

  // Group events by Month and Year (e.g., "August 2026")
  const groupedEvents: { [key: string]: TimelineEvent[] } = {};
  events.forEach((evt) => {
    const d = new Date(evt.date + 'T00:00:00');
    const groupKey = isNaN(d.getTime())
      ? 'General'
      : d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    if (!groupedEvents[groupKey]) {
      groupedEvents[groupKey] = [];
    }
    groupedEvents[groupKey].push(evt);
  });

  // Track map for O(1) lookup
  const trackMap = React.useMemo(() => {
    const map = new Map<string, EventTrack>();
    tracks.forEach((t) => map.set(t.id, t));
    return map;
  }, [tracks]);

  return (
    <div id="timeline-container" className="relative pl-2 sm:pl-4">
      {/* Continuous Vertical Timeline Stem Line */}
      <div
        className={`absolute left-[22px] sm:left-[27px] top-6 bottom-6 w-0.5 z-0 ${
          trackTheme
            ? `${trackTheme.accentBg} opacity-50`
            : 'bg-gradient-to-b from-amber-400 via-stone-300 to-stone-200 dark:from-amber-600 dark:via-stone-700 dark:to-stone-800'
        }`}
        aria-hidden="true"
      />

      {/* Render Groups */}
      <div className="space-y-10">
        {Object.entries(groupedEvents).map(([groupLabel, groupItems]) => {
          return (
            <div key={groupLabel} className="relative space-y-6">
              {/* Group Month/Year Divider Header */}
              <div className="relative z-10 flex items-center gap-3">
                <div
                  className={`w-10 sm:w-12 h-6 sm:h-7 rounded-full text-white text-[11px] font-bold flex items-center justify-center shadow-xs shrink-0 ${
                    trackTheme ? trackTheme.accentBg : 'bg-stone-900 dark:bg-stone-100 dark:text-stone-900'
                  }`}
                >
                  <Calendar className="w-3 h-3 mr-1 opacity-80" />
                </div>
                <div className="px-3 py-1 rounded-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-xs text-xs font-bold text-stone-800 dark:text-stone-200 flex items-center gap-2">
                  <span>{groupLabel}</span>
                  <span className="font-normal text-stone-400">
                    ({groupItems.length} {groupItems.length === 1 ? 'event' : 'events'})
                  </span>
                </div>
                <div className="h-px bg-stone-200 dark:bg-stone-800 flex-1" />
              </div>

              {/* Event Cards inside this month group */}
              <div className="space-y-6">
                {groupItems.map((evt) => {
                  const eventTrack = evt.eventId ? trackMap.get(evt.eventId) : undefined;
                  return (
                    <EventCard
                      key={evt.id}
                      event={evt}
                      track={eventTrack}
                      onSelectTrack={onSelectTrack}
                      onViewDetails={onViewDetails}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onTagClick={onTagClick}
                      onOpenImageLightbox={onOpenImageLightbox}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
