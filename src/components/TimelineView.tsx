import type { ReactionControlProps } from './ReactionControls';
import React from 'react';
import { TimelineEvent, EventTrack } from '../types';
import { EventCard } from './EventCard';
import { Calendar, Plus, Sparkles } from 'lucide-react';
import { trackIdentity, momentIdentity } from '../lib/resourceIdentity';
import { calendarDateToLocalInstant, memoryCalendarDate } from '../lib/localDate';

interface TimelineViewProps {
  onToggleReaction: ReactionControlProps['onToggleReaction'];
  currentUsername?: string;
  events: TimelineEvent[];
  density?: number;
  ranked?: boolean;
  savedKeys?: ReadonlySet<string>;
  onToggleSave?: (event: TimelineEvent) => Promise<void>;
  tracks: EventTrack[];
  currentTrackKey?: string;
  onSelectTrack?: (track: EventTrack) => void;
  onViewDetails: (event: TimelineEvent) => void;
  onEdit: (event: TimelineEvent) => void;
  onDelete: (event: TimelineEvent) => Promise<void>;
  onTagClick: (tag: string) => void;
  onOpenImageLightbox: (images: string[], index: number) => void;
  onAddNewEvent: () => void;
  /** Offered when the account has no track to write into yet. */
  onAddNewTrack?: () => void;
  onResetFilters?: () => void;
  isFiltered?: boolean;
  /** Server-authoritative capability: never render an unusable CTA. */
  canCreateEntry: boolean;
  /** True when the account has no track at all, so the empty state can ask for one. */
  hasAnyTrack: boolean;
  /** True when the list is empty because the Saved filter matched nothing. */
  savedOnly?: boolean;
}

export const TimelineView: React.FC<TimelineViewProps> = ({
  events, ranked = false, density = 3, savedKeys, onToggleSave,
  tracks,
  currentTrackKey = 'all',
  onSelectTrack,
  onToggleReaction,
  currentUsername,
  onViewDetails,
  onEdit,
  onDelete,
  onTagClick,
  onOpenImageLightbox,
  onAddNewEvent,
  onAddNewTrack,
  onResetFilters,
  isFiltered,
  canCreateEntry,
  hasAnyTrack,
  savedOnly = false,
}) => {
  const trackMap = new Map(tracks.map((track) => [trackIdentity(track), track]));
  const currentTrack = tracks.find((t) => trackIdentity(t) === currentTrackKey);

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
          {savedOnly && !isFiltered
            ? 'Nothing saved yet'
            : isFiltered
            ? 'No matching timeline entries'
            : !hasAnyTrack
            ? 'Create your first track'
            : !canCreateEntry
            ? 'Nothing to show here yet'
            : currentTrack
            ? `No entries in ${currentTrack.title} yet`
            : 'Your timeline is clear'}
        </h3>
        <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 mb-6 leading-relaxed">
          {savedOnly && !isFiltered
            ? 'Saved is your own private list. Nobody else can see it — not the memory\u2019s owner, not other collaborators. Open any memory and choose Save to keep it here.'
            : isFiltered
            ? 'Try adjusting your tag filters, search term, or emotion criteria.'
            : !hasAnyTrack
            ? 'Tracks group your memories into chapters — a trip, a year, a project. Create one to start logging moments.'
            : !canCreateEntry
            ? 'You have read-only access to the tracks shared with you. The owner can grant editing access if you would like to add your own memories here.'
            : currentTrack
            ? `Log the first milestone or moment for the ${currentTrack.title} event timeline.`
            : 'Start chronicling your life events, milestones, feelings, ideas, and travels.'}
        </p>
        <div className="flex items-center justify-center gap-3">
          {isFiltered && onResetFilters ? (
            <button
              onClick={onResetFilters}
              className="px-4 py-2 min-h-11 text-xs font-semibold rounded-xl border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300 transition"
            >
              Reset Filters
            </button>
          ) : null}
          {/* A zero-track account cannot create a moment at all, so the only
              usable next step is creating a track. */}
          {!isFiltered && !hasAnyTrack && onAddNewTrack ? (
            <button
              id="empty-state-add-track"
              onClick={onAddNewTrack}
              className="px-5 py-2 min-h-11 text-xs font-semibold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> Create your first track
            </button>
          ) : null}
          {!isFiltered && hasAnyTrack && canCreateEntry && (
            <button
              id="empty-state-add-event"
              onClick={onAddNewEvent}
              className="px-5 py-2 min-h-11 text-xs font-semibold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />{' '}
              {currentTrack ? `Add to ${currentTrack.title}` : 'Log First Event'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Preserve the server ordering, including across retained cursor pages.
  const groups = new Map<string, TimelineEvent[]>();
  for (const event of events) {
    const date = calendarDateToLocalInstant(memoryCalendarDate(event.date));
    const label = ranked ? 'Ranked memories' : date ? date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'Undated';
    const group = groups.get(label);
    if (group) group.push(event);
    else groups.set(label, [event]);
  }

  return (
    <div className="archival-timeline-layout"><div id="timeline-container" className="archival-chapters">
      {Array.from(groups, ([label, group]) => (
        <section key={label} id={`archive-chapter-${label.replaceAll(' ', '-')}`} className="archival-chapter" aria-label={label}>
          <div className="archival-chapter-heading"><h2>{label}</h2><span>{group.length} {group.length === 1 ? 'entry' : 'entries'} shown</span></div>
          <div className="archival-cards">
            {group.map(event => (
              <EventCard
                key={momentIdentity(event)}
                density={density} saved={savedKeys?.has(momentIdentity(event))} onToggleSave={onToggleSave}
                event={event}
                showTrack={currentTrackKey === 'all'}
                track={event.eventId ? trackMap.get(`${event.resourceOwnerId ?? 'legacy'}:${event.eventId}`) : undefined}
                onToggleReaction={onToggleReaction}
                currentUsername={currentUsername}
                onSelectTrack={onSelectTrack}
                onViewDetails={onViewDetails}
                onEdit={onEdit}
                onDelete={onDelete}
                onTagClick={onTagClick}
                onOpenImageLightbox={onOpenImageLightbox}
              />
            ))}
          </div>
        </section>
      ))}
    </div><aside className="archival-month-index" aria-label="Visible months"><p>Month index</p>{Array.from(groups, ([label]) => <button key={label} type="button" onClick={() => document.getElementById(`archive-chapter-${label.replaceAll(' ', '-')}`)?.scrollIntoView()}>{label}</button>)}</aside></div>
  );
};
