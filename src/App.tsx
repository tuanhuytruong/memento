import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { TimelineEvent, EventTrack, FilterState, ViewMode } from './types';
import { exportTimelineData } from './lib/storage';
import { authApi, ApiError, dataApi, loadAccountData, type AuthUser, type ApiTag } from './lib/api';
import { AuthScreen } from './components/AuthScreen';
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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<'checking' | 'anonymous' | 'authenticated' | 'error'>('checking');
  const [sessionError, setSessionError] = useState('');
  const [dataReady, setDataReady] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [pendingImageRetry, setPendingImageRetry] = useState<{ momentId: string; files: File[] } | null>(null);
  const [eventTracks, setEventTracks] = useState<EventTrack[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [apiTags, setApiTags] = useState<ApiTag[]>([]);
  const authGenerationRef = useRef(0);

  const loadData = useCallback(async () => {
    const generation = authGenerationRef.current;
    setDataLoading(true);
    setDataError('');
    try {
      const accountData = await loadAccountData();
      if (generation !== authGenerationRef.current) return;
      setEventTracks(accountData.tracks);
      setEvents(accountData.moments);
      setApiTags(accountData.tags);
      setDataReady(true);
    } catch (error) {
      if (generation !== authGenerationRef.current) throw error;
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setAuthStatus('anonymous');
        setEventTracks([]);
        setEvents([]);
        setApiTags([]);
        setDataReady(false);
      }
      setDataError(error instanceof Error ? error.message : 'Could not load your account data.');
      throw error;
    } finally {
      if (generation === authGenerationRef.current) setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    authApi.me().then(async (currentUser) => {
      if (!active) return;
      setUser(currentUser);
      setAuthStatus('authenticated');
      try {
        await loadData();
      } catch (error) {
        if (active) {
          setDataError(error instanceof Error ? error.message : 'Could not load your account data.');
          if (error instanceof ApiError && error.status === 401) setAuthStatus('anonymous');
        }
      }
      }).catch((error: unknown) => {
      if (!active) return;
      if (error instanceof ApiError && error.status === 401) {
        setAuthStatus('anonymous');
        setSessionError('');
      } else {
        setAuthStatus('error');
        setSessionError(error instanceof Error ? error.message : 'Unable to check your session.');
      }
    });
    return () => { active = false; };
  }, [loadData]);

  const handleAuthSubmit = async (mode: 'login' | 'register', values: { username: string; password: string; inviteCode: string }) => {
    if (mode === 'register') await authApi.register(values.username, values.password, values.inviteCode);
    else await authApi.login(values.username, values.password);
    const currentUser = await authApi.me();
    authGenerationRef.current += 1;
    setUser(currentUser);
    setAuthStatus('authenticated');
    setDataReady(false);
    setEventTracks([]);
    setEvents([]);
    setApiTags([]);
    await loadData();
  };

  const handleLogout = async () => {
    authGenerationRef.current += 1;
    setDataReady(false);
    setEventTracks([]);
    setEvents([]);
    setApiTags([]);
    setUser(null);
    setAuthStatus('anonymous');
    setSelectedTrackId('all');
    try {
      await authApi.logout();
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Signed out locally, but the server could not confirm logout.');
    }
  };

  const retrySession = async () => {
    setSessionError('');
    setAuthStatus('checking');
    try {
      const currentUser = await authApi.me();
      setUser(currentUser);
      setAuthStatus('authenticated');
      await loadData();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuthStatus('anonymous');
        return;
      }
      setSessionError(error instanceof Error ? error.message : 'Unable to check your session.');
      setAuthStatus('error');
    }
  };

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

  // Handle Event Track selection
  const handleSelectTrack = (trackId: string) => {
    setSelectedTrackId(trackId);
    setFilters((prev) => ({ ...prev, selectedEventId: trackId }));
  };

  // Persist each change before reflecting it in the UI; failed requests leave the prior data intact.
  const handleSaveTrack = async (
    trackData: Omit<EventTrack, 'id' | 'createdAt' | 'updatedAt'>,
    editId?: string
  ) => {
    const saved = editId
      ? await dataApi.updateTrack(editId, trackData)
      : await dataApi.createTrack(trackData);
    setEventTracks((prev) => editId
      ? prev.map((track) => track.id === editId ? saved : track)
      : [...prev, saved]);
    if (!editId) {
      setSelectedTrackId(saved.id);
      setFilters((prev) => ({ ...prev, selectedEventId: saved.id }));
    }
    setTrackToEdit(null);
  };

  // Delete only after the server confirms; failed requests preserve the local row.
  const handleDeleteTrack = async (id: string) => {
    await dataApi.deleteTrack(id);
    setEventTracks((prev) => prev.filter((track) => track.id !== id));
    if (selectedTrackId === id) {
      setSelectedTrackId('all');
      setFilters((prev) => ({ ...prev, selectedEventId: 'all' }));
    }
  };

  // Combine server-managed tags with occurrence counts from server-backed moments.
  const availableTags = useMemo(() => {
    const tagCountMap: { [key: string]: number } = {};
    events.forEach((evt) => evt.tags?.forEach((tag) => {
      tagCountMap[tag] = (tagCountMap[tag] || 0) + 1;
    }));
    apiTags.forEach((tag) => {
      if (!(tag.name in tagCountMap)) tagCountMap[tag.name] = 0;
    });
    return Object.entries(tagCountMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [events, apiTags]);

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

  // Save a moment server-side first; local state changes only after a confirmed response.
  const handleSaveEvent = async (
    data: Omit<TimelineEvent, 'id' | 'createdAt' | 'updatedAt'>,
    editId?: string,
    imageFiles: File[] = []
  ) => {
    const saved = editId
      ? await dataApi.updateMoment(editId, data)
      : await dataApi.createMoment(data);
    setEvents((prev) => editId
      ? prev.map((event) => event.id === editId ? saved : event)
      : [saved, ...prev]);
    setEventToEdit(null);
    if (imageFiles.length) {
      let uploaded = 0;
      try {
        for (; uploaded < imageFiles.length; uploaded += 1) await dataApi.uploadImage(imageFiles[uploaded], saved.id);
        const refreshedMoments = await dataApi.moments();
        setEvents(refreshedMoments);
      } catch (error) {
        const remaining = imageFiles.slice(uploaded);
        if (remaining.length) setPendingImageRetry({ momentId: saved.id, files: remaining });
        setDataError(`Moment saved; ${uploaded} image(s) uploaded. ${remaining.length} remain and can be retried: ${error instanceof Error ? error.message : 'upload failed'}`);
      }
    }
  };

  // Delete only after the server confirms; failures do not remove data from the view.
  const handleDeleteEvent = async (id: string) => {
    await dataApi.deleteMoment(id);
    setEvents((prev) => prev.filter((event) => event.id !== id));
    if (eventToView?.id === id) setEventToView(null);
  };

  const handleAddCustomTag = async (name: string) => {
    if (apiTags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) return;
    const created = await dataApi.createTag(name);
    setApiTags((prev) => prev.some((tag) => tag.id === created.id) ? prev : [...prev, created]);
  };

  const handleDeleteUnusedTag = async (id: string) => {
    const tag = apiTags.find((item) => item.id === id);
    if (!tag || events.some((event) => event.tags?.includes(tag.name))) return;
    await dataApi.deleteTag(id);
    setApiTags((prev) => prev.filter((item) => item.id !== id));
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
    setLightboxState({ images, index, isOpen: true });
  };

  const runMutation = async (operation: () => Promise<void>) => {
    try {
      await operation();
      setDataError('');
    } catch (error) {
      setDataError(error instanceof Error ? error.message : 'The request failed. Your data was not changed.');
    }
  };

  const retryImageUploads = async () => {
    if (!pendingImageRetry) return;
    try {
      for (const file of pendingImageRetry.files) await dataApi.uploadImage(file, pendingImageRetry.momentId);
      const moments = await dataApi.moments();
      setEvents(moments);
      setPendingImageRetry(null);
      setDataError('');
    } catch (error) {
      setDataError(`Image upload did not finish: ${error instanceof Error ? error.message : 'unknown error'}. Retry without losing the saved moment.`);
    }
  };

  if (authStatus === 'checking') {
    return <main className="min-h-screen bg-stone-50 dark:bg-stone-950 flex items-center justify-center text-stone-500">Checking your session…</main>;
  }
  if (authStatus === 'error') {
    return <main className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex items-center justify-center p-4"><section className="max-w-md rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 p-6"><h1 className="text-xl font-bold mb-2">Memento is temporarily unavailable</h1><p role="alert" className="text-sm text-stone-600 dark:text-stone-300 mb-4">{sessionError}</p><button className="rounded-xl bg-amber-600 text-white px-4 py-2 font-semibold" onClick={() => void retrySession()}>Retry connection</button></section></main>;
  }
  if (authStatus === 'anonymous' || !user) {
    return <AuthScreen initialError={sessionError} onSubmit={handleAuthSubmit} />;
  }
  if (!dataReady) {
    return <main className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex items-center justify-center p-4"><section className="max-w-md text-center rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 p-6"><h1 className="text-xl font-bold mb-2">Loading your timeline</h1>{dataLoading ? <p className="text-sm text-stone-500">Fetching account data…</p> : <><p role="alert" className="text-sm text-rose-700 dark:text-rose-300 mb-4">{dataError || 'Your account data could not be loaded. No local sample data was substituted.'}</p><button className="rounded-xl bg-amber-600 text-white px-4 py-2 font-semibold" onClick={() => void loadData().catch(() => undefined)}>Retry loading</button><button className="ml-2 text-sm text-stone-500 underline" onClick={() => void handleLogout()}>Sign out</button></>}</section></main>;
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 transition-colors">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {dataError && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-800 dark:text-rose-200"><span>{dataError}</span><span className="flex gap-3">{pendingImageRetry && <button className="font-semibold underline" onClick={() => void retryImageUploads()}>Retry image upload</button>}<button className="font-semibold underline" onClick={() => setDataError('')}>Dismiss</button></span></div>}
        {/* Header Ribbon & Global Stats */}
        <TimelineHeader
          events={events}
          trackCount={eventTracks.length}
          username={user.username}
          onLogout={() => void handleLogout()}
          onAddNewEvent={() => {
            setEventToEdit(null);
            setIsEventModalOpen(true);
          }}
          onExportJson={() => exportTimelineData(eventTracks, events, apiTags.map((tag) => tag.name))}
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
              onDelete={(id) => runMutation(() => handleDeleteEvent(id))}
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
              onDelete={(id) => runMutation(() => handleDeleteEvent(id))}
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
        onSave={(track, editId) => handleSaveTrack(track, editId)}
        onDelete={(id) => runMutation(() => handleDeleteTrack(id))}
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
        onAddCustomTag={handleAddCustomTag}
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
