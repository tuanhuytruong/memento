import React, { useState, useEffect, useMemo } from 'react';
import { TimelineEvent, EventTrack, FilterState, ViewMode } from './types';
import {
  loadStoredEventTracks,
  saveStoredEventTracks,
  loadStoredEvents,
  saveStoredEvents,
  loadStoredCustomTags,
  saveStoredCustomTags,
  exportTimelineData,
} from './lib/storage';
import { INITIAL_EVENT_TRACKS, INITIAL_EVENTS } from './data/initialEvents';
import { TimelineHeader } from './components/TimelineHeader';
import { EventTrackNav } from './components/EventTrackNav';
import { EventTrackModal } from './components/EventTrackModal';
import { FilterBar } from './components/FilterBar';
import { TimelineView } from './components/TimelineView';
import { CompactListView } from './components/CompactListView';
import { GalleryView } from './components/GalleryView';
import { EventModal } from './components/EventModal';
import { EventDetailModal } from './components/EventDetailModal';
import { ImageLightbox } from './components/ImageLightbox';

export default function App() {
  const [eventTracks, setEventTracks] = useState<EventTrack[]>(() => loadStoredEventTracks());
  const [events, setEvents] = useState<TimelineEvent[]>(() => loadStoredEvents(eventTracks));
  const [customTags, setCustomTags] = useState<string[]>(() => loadStoredCustomTags());

  // Active track selection: 'all' = Merged Timeline, or specific EventTrack ID (e.g. 'evt-ai-era')
  const [selectedTrackId, setSelectedTrackId] = useState<string>('all');

  // Filters state
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    selectedEventId: 'all',
    selectedTags: [],
    selectedEmotions: [],
    selectedYear: 'all',
    milestonesOnly: false,
    hasImagesOnly: false,
    sortDirection: 'newest',
  });

  const [viewMode, setViewMode] = useState<ViewMode>('timeline');

  // Modals state
  const [isEventTrackModalOpen, setIsEventTrackModalOpen] = useState(false);
  const [trackToEdit, setTrackToEdit] = useState<EventTrack | null>(null);

  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [eventToEdit, setEventToEdit] = useState<TimelineEvent | null>(null);
  const [eventToView, setEventToView] = useState<TimelineEvent | null>(null);

  // Lightbox state
  const [lightboxState, setLightboxState] = useState<{
    images: string[];
    index: number;
    isOpen: boolean;
  }>({
    images: [],
    index: 0,
    isOpen: false,
  });

  // Sync event tracks to local storage
  useEffect(() => {
    saveStoredEventTracks(eventTracks);
  }, [eventTracks]);

  // Sync events to local storage
  useEffect(() => {
    saveStoredEvents(events);
  }, [events]);

  // Sync custom tags
  useEffect(() => {
    saveStoredCustomTags(customTags);
  }, [customTags]);

  // Handle Event Track selection
  const handleSelectTrack = (trackId: string) => {
    setSelectedTrackId(trackId);
    setFilters((prev) => ({ ...prev, selectedEventId: trackId }));
  };

  // Create or Update Event Track
  const handleSaveTrack = (
    trackData: Omit<EventTrack, 'id' | 'createdAt' | 'updatedAt'>,
    editId?: string
  ) => {
    const nowIso = new Date().toISOString();
    if (editId) {
      setEventTracks((prev) =>
        prev.map((t) =>
          t.id === editId
            ? {
                ...t,
                ...trackData,
                updatedAt: nowIso,
              }
            : t
        )
      );
    } else {
      const newId = 'evt-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6);
      const newTrack: EventTrack = {
        ...trackData,
        id: newId,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      setEventTracks((prev) => [...prev, newTrack]);
      // Switch focus to the newly created track
      setSelectedTrackId(newId);
      setFilters((prev) => ({ ...prev, selectedEventId: newId }));
    }
    setTrackToEdit(null);
  };

  // Delete Event Track
  const handleDeleteTrack = (id: string) => {
    setEventTracks((prev) => prev.filter((t) => t.id !== id));
    if (selectedTrackId === id) {
      setSelectedTrackId('all');
      setFilters((prev) => ({ ...prev, selectedEventId: 'all' }));
    }
  };

  // Compute available tags with frequency count
  const availableTags = useMemo(() => {
    const tagCountMap: { [key: string]: number } = {};
    events.forEach((evt) => {
      evt.tags?.forEach((t) => {
        tagCountMap[t] = (tagCountMap[t] || 0) + 1;
      });
    });
    // Add custom tags with 0 count if not used
    customTags.forEach((t) => {
      if (!tagCountMap[t]) tagCountMap[t] = 0;
    });

    return Object.entries(tagCountMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [events, customTags]);

  // Compute available distinct years from events
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    events.forEach((evt) => {
      if (evt.date && evt.date.length >= 4) {
        years.add(evt.date.substring(0, 4));
      }
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [events]);

  // Filter & Sort events
  const filteredEvents = useMemo(() => {
    return events
      .filter((evt) => {
        // Event Track Filter (unless 'all' / Merged view is active)
        if (selectedTrackId !== 'all') {
          if (evt.eventId !== selectedTrackId) {
            return false;
          }
        }

        // Search term matching
        if (filters.search.trim()) {
          const q = filters.search.toLowerCase().trim();
          const matchTitle = evt.title.toLowerCase().includes(q);
          const matchDesc = evt.description?.toLowerCase().includes(q);
          const matchIdea = evt.idea?.toLowerCase().includes(q);
          const matchLocation =
            evt.location?.name?.toLowerCase().includes(q) ||
            evt.location?.city?.toLowerCase().includes(q) ||
            evt.location?.country?.toLowerCase().includes(q);
          const matchTags = evt.tags?.some((t) => t.toLowerCase().includes(q));
          const matchEmotion = evt.emotion?.toLowerCase().includes(q);

          if (!matchTitle && !matchDesc && !matchIdea && !matchLocation && !matchTags && !matchEmotion) {
            return false;
          }
        }

        // Year filter
        if (filters.selectedYear !== 'all') {
          if (!evt.date.startsWith(filters.selectedYear)) {
            return false;
          }
        }

        // Tag filter (match any selected tag)
        if (filters.selectedTags.length > 0) {
          const hasMatchingTag = evt.tags?.some((t) => filters.selectedTags.includes(t));
          if (!hasMatchingTag) return false;
        }

        // Emotion filter
        if (filters.selectedEmotions.length > 0) {
          if (!evt.emotion || !filters.selectedEmotions.includes(evt.emotion)) {
            return false;
          }
        }

        // Milestones only
        if (filters.milestonesOnly && !evt.isMilestone) {
          return false;
        }

        // Has photos only
        if (filters.hasImagesOnly && (!evt.images || evt.images.length === 0)) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        const timeA = `${a.date} ${a.time || '00:00'}`;
        const timeB = `${b.date} ${b.time || '00:00'}`;
        if (filters.sortDirection === 'newest') {
          return timeB.localeCompare(timeA);
        } else {
          return timeA.localeCompare(timeB);
        }
      });
  }, [events, selectedTrackId, filters]);

  // Save (create or update) timeline moment
  const handleSaveEvent = (
    data: Omit<TimelineEvent, 'id' | 'createdAt' | 'updatedAt'>,
    editId?: string
  ) => {
    const nowIso = new Date().toISOString();
    if (editId) {
      setEvents((prev) =>
        prev.map((e) =>
          e.id === editId
            ? {
                ...e,
                ...data,
                updatedAt: nowIso,
              }
            : e
        )
      );
    } else {
      const newEvt: TimelineEvent = {
        ...data,
        id: 'moment-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      setEvents((prev) => [newEvt, ...prev]);
    }
    setEventToEdit(null);
  };

  // Delete event
  const handleDeleteEvent = (id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    if (eventToView?.id === id) {
      setEventToView(null);
    }
  };

  // Tag filter shortcut
  const handleTagClick = (tag: string) => {
    if (!filters.selectedTags.includes(tag)) {
      setFilters((prev) => ({
        ...prev,
        selectedTags: [...prev.selectedTags, tag],
      }));
    }
  };

  // Lightbox opener
  const handleOpenLightbox = (images: string[], index: number) => {
    setLightboxState({
      images,
      index,
      isOpen: true,
    });
  };

  // Reset demo data
  const handleResetToDemo = () => {
    if (
      window.confirm(
        'Reset all timeline events back to the sample memories (AI Era, New Company, Kyoto Ceramics)? Current changes will be replaced.'
      )
    ) {
      setEventTracks(INITIAL_EVENT_TRACKS);
      setEvents(INITIAL_EVENTS);
      setSelectedTrackId('all');
      setFilters({
        search: '',
        selectedEventId: 'all',
        selectedTags: [],
        selectedEmotions: [],
        selectedYear: 'all',
        milestonesOnly: false,
        hasImagesOnly: false,
        sortDirection: 'newest',
      });
    }
  };

  // Import JSON backup
  const handleImportJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content);
        if (parsed.eventTracks && Array.isArray(parsed.eventTracks) && Array.isArray(parsed.events)) {
          setEventTracks(parsed.eventTracks);
          setEvents(parsed.events);
          if (parsed.customTags && Array.isArray(parsed.customTags)) {
            setCustomTags(parsed.customTags);
          }
          alert(
            `Successfully restored ${parsed.eventTracks.length} event tracks and ${parsed.events.length} timeline entries!`
          );
        } else if (Array.isArray(parsed) && parsed.length > 0) {
          // Legacy array format
          const defaultTrackId = eventTracks[0]?.id || 'evt-ai-era';
          const migrated = parsed.map((item: any) => ({
            ...item,
            eventId: item.eventId || defaultTrackId,
          }));
          setEvents(migrated);
          alert(`Successfully restored ${migrated.length} timeline events!`);
        } else {
          alert('Invalid backup format. Expected a JSON object with event tracks and events.');
        }
      } catch (err) {
        alert('Could not parse JSON file.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 transition-colors">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Header Ribbon & Global Stats */}
        <TimelineHeader
          events={events}
          trackCount={eventTracks.length}
          onAddNewEvent={() => {
            setEventToEdit(null);
            setIsEventModalOpen(true);
          }}
          onAddNewTrack={() => {
            setTrackToEdit(null);
            setIsEventTrackModalOpen(true);
          }}
          onExportJson={() => exportTimelineData(eventTracks, events, customTags)}
          onImportJson={handleImportJson}
          onResetToDemo={handleResetToDemo}
        />

        {/* Event-Based Timeline Navigation & Overview */}
        <EventTrackNav
          tracks={eventTracks}
          events={events}
          selectedTrackId={selectedTrackId}
          onSelectTrack={handleSelectTrack}
          onAddNewTrack={() => {
            setTrackToEdit(null);
            setIsEventTrackModalOpen(true);
          }}
          onEditTrack={(track) => {
            setTrackToEdit(track);
            setIsEventTrackModalOpen(true);
          }}
          onAddNewMoment={() => {
            setEventToEdit(null);
            setIsEventModalOpen(true);
          }}
        />

        {/* Filter and Control Toolbar */}
        <div className="mb-8">
          <FilterBar
            filters={filters}
            onFilterChange={(updated) => setFilters((prev) => ({ ...prev, ...updated }))}
            onResetFilters={() =>
              setFilters({
                search: '',
                selectedEventId: selectedTrackId,
                selectedTags: [],
                selectedEmotions: [],
                selectedYear: 'all',
                milestonesOnly: false,
                hasImagesOnly: false,
                sortDirection: 'newest',
              })
            }
            availableTags={availableTags}
            availableYears={availableYears}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            totalFilteredCount={filteredEvents.length}
            totalCount={
              selectedTrackId === 'all'
                ? events.length
                : events.filter((e) => e.eventId === selectedTrackId).length
            }
          />
        </div>

        {/* View Switcher: Timeline, Compact List, or Gallery */}
        <main>
          {viewMode === 'timeline' && (
            <TimelineView
              events={filteredEvents}
              tracks={eventTracks}
              currentTrackId={selectedTrackId}
              onSelectTrack={handleSelectTrack}
              onViewDetails={(evt) => setEventToView(evt)}
              onEdit={(evt) => {
                setEventToEdit(evt);
                setIsEventModalOpen(true);
              }}
              onDelete={handleDeleteEvent}
              onTagClick={handleTagClick}
              onOpenImageLightbox={handleOpenLightbox}
              onAddNewEvent={() => {
                setEventToEdit(null);
                setIsEventModalOpen(true);
              }}
              onResetFilters={() =>
                setFilters({
                  search: '',
                  selectedEventId: selectedTrackId,
                  selectedTags: [],
                  selectedEmotions: [],
                  selectedYear: 'all',
                  milestonesOnly: false,
                  hasImagesOnly: false,
                  sortDirection: 'newest',
                })
              }
              isFiltered={
                Boolean(filters.search) ||
                filters.selectedTags.length > 0 ||
                filters.selectedEmotions.length > 0 ||
                filters.selectedYear !== 'all' ||
                filters.milestonesOnly ||
                filters.hasImagesOnly
              }
            />
          )}

          {viewMode === 'compact' && (
            <CompactListView
              events={filteredEvents}
              tracks={eventTracks}
              onSelectTrack={handleSelectTrack}
              onViewDetails={(evt) => setEventToView(evt)}
              onEdit={(evt) => {
                setEventToEdit(evt);
                setIsEventModalOpen(true);
              }}
              onDelete={handleDeleteEvent}
              onTagClick={handleTagClick}
            />
          )}

          {viewMode === 'gallery' && (
            <GalleryView
              events={filteredEvents}
              tracks={eventTracks}
              onSelectTrack={handleSelectTrack}
              onViewDetails={(evt) => setEventToView(evt)}
              onTagClick={handleTagClick}
              onOpenImageLightbox={handleOpenLightbox}
            />
          )}
        </main>
      </div>

      {/* Create / Edit Event Track Modal */}
      <EventTrackModal
        isOpen={isEventTrackModalOpen}
        trackToEdit={trackToEdit}
        onClose={() => {
          setIsEventTrackModalOpen(false);
          setTrackToEdit(null);
        }}
        onSave={handleSaveTrack}
        onDelete={handleDeleteTrack}
      />

      {/* Create / Edit Timeline Moment Modal */}
      <EventModal
        isOpen={isEventModalOpen}
        eventToEdit={eventToEdit}
        tracks={eventTracks}
        defaultTrackId={selectedTrackId !== 'all' ? selectedTrackId : eventTracks[0]?.id}
        existingTags={availableTags.map((t) => t.name)}
        onClose={() => {
          setIsEventModalOpen(false);
          setEventToEdit(null);
        }}
        onSave={handleSaveEvent}
        onCreateNewTrack={() => {
          setIsEventModalOpen(false);
          setTrackToEdit(null);
          setIsEventTrackModalOpen(true);
        }}
        onAddCustomTag={(tag) => {
          if (!customTags.includes(tag)) {
            setCustomTags((prev) => [...prev, tag]);
          }
        }}
      />

      {/* Event Details View Modal */}
      <EventDetailModal
        event={eventToView}
        tracks={eventTracks}
        onSelectTrack={handleSelectTrack}
        isOpen={!!eventToView}
        onClose={() => setEventToView(null)}
        onEdit={(evt) => {
          setEventToEdit(evt);
          setIsEventModalOpen(true);
        }}
        onDelete={handleDeleteEvent}
        onTagClick={handleTagClick}
        onOpenImageLightbox={handleOpenLightbox}
      />

      {/* Image Lightbox viewer */}
      <ImageLightbox
        images={lightboxState.images}
        currentIndex={lightboxState.index}
        isOpen={lightboxState.isOpen}
        onClose={() => setLightboxState((prev) => ({ ...prev, isOpen: false }))}
        onNavigate={(newIndex) => setLightboxState((prev) => ({ ...prev, index: newIndex }))}
      />
    </div>
  );
}
