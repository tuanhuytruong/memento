import React, { Suspense, lazy, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { TimelineEvent, EventTrack, FilterState, ViewMode } from './types';
import { exportTimelineData } from './lib/storage';
import { trackIdentity, momentIdentity } from './lib/resourceIdentity';
import { authApi, ApiError, dataApi, loadAccountData, type AuthUser, type ApiTag, type CollaborationInvitation } from './lib/api';
import { CollaborationModal, SharedInvitations } from './components/CollaborationModal';
import { AuthScreen } from './components/AuthScreen';
import { TimelineHeader } from './components/TimelineHeader';
import { EventTrackNav } from './components/EventTrackNav';
const EventTrackModal = lazy(() => import('./components/EventTrackModal').then(module => ({ default: module.EventTrackModal })));
import { FilterBar } from './components/FilterBar';
import { TimelineView } from './components/TimelineView';
import { CompactListView } from './components/CompactListView';
import { GalleryView } from './components/GalleryView';
const EventModal = lazy(() => import('./components/EventModal').then(module => ({ default: module.EventModal })));
const EventDetailModal = lazy(() => import('./components/EventDetailModal').then(module => ({ default: module.EventDetailModal })));
const ImageLightbox = lazy(() => import('./components/ImageLightbox').then(module => ({ default: module.ImageLightbox })));
const BlindboxMemory = lazy(() => import('./components/BlindboxMemory').then(module => ({ default: module.BlindboxMemory })));
import { Dices } from 'lucide-react';
import { MemoryResurfacing } from './components/MemoryResurfacing';
import type { MemoryVisit } from './lib/memoryResurfacing';
import { DeferredUiBoundary } from './components/DeferredUiBoundary';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<'checking' | 'anonymous' | 'authenticated' | 'error'>('checking');
  const [sessionError, setSessionError] = useState('');
  const [dataReady, setDataReady] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [uploadRunning, setUploadRunning] = useState(false);
  const [pendingImageRetry, setPendingImageRetry] = useState<{ momentId: string; ownerId: string; files: { file: File; uploadId: string }[] } | null>(null);
  const [eventTracks, setEventTracks] = useState<EventTrack[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [apiTags, setApiTags] = useState<ApiTag[]>([]);
  const [collaborationInvitations, setCollaborationInvitations] = useState<CollaborationInvitation[]>([]);
  const [visits, setVisits] = useState<MemoryVisit[]>([]);
  const visitWrites = useRef(new Map<string, number>());
  const [shareTrack, setShareTrack] = useState<EventTrack | null>(null);
  const [isBlindboxOpen, setIsBlindboxOpen] = useState(false);
  const [perspectiveError, setPerspectiveError] = useState('');
  const authGenerationRef = useRef(0);
  const uploadBusy = useRef(false);
  const reactionPending = useRef(new Set<string>());
  const assertSession = (generation: number) => { if (generation !== authGenerationRef.current) throw new Error('Session changed. Request result discarded.'); };

  const loadData = useCallback(async () => {
    const generation = authGenerationRef.current;
    setDataLoading(true);
    setDataError('');
    try {
      const [accountData, invitations] = await Promise.all([loadAccountData(), dataApi.collaborationInvitations()]);
      if (generation !== authGenerationRef.current) return;
      setEventTracks(accountData.tracks);
      setEvents(accountData.moments);
      setApiTags(accountData.tags);
      setCollaborationInvitations(invitations);
      setDataReady(true);
    } catch (error) {
      if (generation !== authGenerationRef.current) throw error;
      if (error instanceof ApiError && error.status === 401) {
        authGenerationRef.current += 1;
        resetSnapshots();
        setUser(null);
        setVisits([]);
        setAuthStatus('anonymous');
        setEventTracks([]);
        setEvents([]);
        setApiTags([]);
        setCollaborationInvitations([]);
        setDataReady(false);
        throw error;
      }
      setDataError(error instanceof Error ? error.message : 'Could not load your account data.');
      throw error;
    } finally {
      if (generation === authGenerationRef.current) setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const generation = authGenerationRef.current;
    authApi.me().then(async (currentUser) => {
      if (!active || generation !== authGenerationRef.current) return;
      setUser(currentUser);
      setAuthStatus('authenticated');
      try {
        await loadData();
      } catch (error) {
        if (active && generation === authGenerationRef.current) {
          setDataError(error instanceof Error ? error.message : 'Could not load your account data.');
          if (error instanceof ApiError && error.status === 401) setAuthStatus('anonymous');
        }
      }
      }).catch((error: unknown) => {
      if (!active || generation !== authGenerationRef.current) return;
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
    const generation = ++authGenerationRef.current;
    resetSnapshots();
    if (mode === 'register') await authApi.register(values.username, values.password, values.inviteCode);
    else await authApi.login(values.username, values.password);
    assertSession(generation);
    const currentUser = await authApi.me();
    assertSession(generation);
    setUser(currentUser);
    setAuthStatus('authenticated');
    setDataReady(false);
    setEventTracks([]);
    setEvents([]);
    setApiTags([]);
    await loadData();
  };

  const handleLogout = async () => {
    const generation = ++authGenerationRef.current;
    resetSnapshots();
    setDataReady(false);
    setEventTracks([]);
    setEvents([]);
    setApiTags([]);
    setUser(null);
    setAuthStatus('anonymous');
    setSelectedTrackKey('all');
    try {
      await authApi.logout();
    } catch (error) {
      if (generation === authGenerationRef.current) setSessionError(error instanceof Error ? error.message : 'Signed out locally, but the server could not confirm logout.');
    }
  };

  const retrySession = async () => {
    const generation = ++authGenerationRef.current;
    resetSnapshots();
    setSessionError('');
    setAuthStatus('checking');
    try {
      const currentUser = await authApi.me();
      assertSession(generation);
      setUser(currentUser);
      setAuthStatus('authenticated');
      await loadData();
    } catch (error) {
      if (generation !== authGenerationRef.current) return;
      if (error instanceof ApiError && error.status === 401) {
        setAuthStatus('anonymous');
        return;
      }
      setSessionError(error instanceof Error ? error.message : 'Unable to check your session.');
      setAuthStatus('error');
    }
  };

  // Active track selection: 'all' = Merged Timeline, or specific EventTrack ID (e.g. 'evt-ai-era')
  const [selectedTrackKey, setSelectedTrackKey] = useState<string>('all');

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

  function resetSnapshots() {
    setShareTrack(null); setCollaborationInvitations([]); setIsBlindboxOpen(false);
    setIsEventModalOpen(false); setEventToEdit(null); setEventToView(null);
    setIsEventTrackModalOpen(false); setTrackToEdit(null);
    setLightboxState({ images: [], index: 0, isOpen: false });
    setPendingImageRetry(null); setDataError(''); setSessionError(''); setPerspectiveError('');
    setDataLoading(false); setUploadRunning(false); uploadBusy.current = false; reactionPending.current.clear();
    setSelectedTrackKey('all'); setVisits([]); visitWrites.current.clear();
    setFilters((previous) => ({ ...previous, search: '', selectedEventId: 'all', selectedTags: [], selectedEmotions: [], selectedYear: 'all', milestonesOnly: false, hasImagesOnly: false }));
  }

  // Visit history is private to this visitor; a failed write or read never blocks the timeline.
  const recordVisit = useCallback((track: Pick<EventTrack, 'id' | 'resourceOwnerId'> | null | undefined) => {
    if (!track?.id || !track.resourceOwnerId) return;
    const key = `${track.resourceOwnerId}:${track.id}`;
    const now = Date.now();
    if ((visitWrites.current.get(key) ?? 0) > now - 60_000) return;
    visitWrites.current.set(key, now);
    const generation = authGenerationRef.current;
    dataApi.recordTrackVisit(track.resourceOwnerId, track.id).then(({ visit }) => {
      if (generation !== authGenerationRef.current) return;
      // A malformed response must never corrupt the private visit list.
      if (!visit?.trackId || !visit.trackOwnerId) return;
      setVisits(previous => [...previous.filter(item => `${item.trackOwnerId}:${item.trackId}` !== key), visit]);
    }).catch(() => {
      if (generation !== authGenerationRef.current) return;
      visitWrites.current.delete(key);
    });
  }, []);

  useEffect(() => {
    if (!user || !dataReady) return;
    const generation = authGenerationRef.current;
    dataApi.trackVisits()
      .then(list => { if (generation === authGenerationRef.current) setVisits(list); })
      .catch(() => { if (generation === authGenerationRef.current) setVisits([]); });
  }, [user, dataReady]);

  const openDetail = (event: TimelineEvent) => {
    const track = eventTracks.find(item => item.id === event.eventId && item.resourceOwnerId === event.resourceOwnerId);
    recordVisit(track);
    setEventToView(event);
  };

  /** Suggestion open: exact identity, no unrelated filter may hide its track. */
  const openSuggested = (event: TimelineEvent) => {
    const track = eventTracks.find(item => item.id === event.eventId && item.resourceOwnerId === event.resourceOwnerId);
    setFilters(previous => ({ ...previous, search: '', selectedTags: [], selectedEmotions: [], selectedYear: 'all', milestonesOnly: false, hasImagesOnly: false }));
    if (track) handleSelectTrack(track);
    openDetail(event);
  };

  // Handle Event Track selection
  const handleSelectTrack = (track: EventTrack | null) => {
    recordVisit(track);
    setSelectedTrackKey(track ? trackIdentity(track) : 'all');
    setFilters((prev) => ({ ...prev, selectedEventId: track?.id ?? 'all' }));
  };

  const acceptInvitation = async (id: string) => {
    const generation = authGenerationRef.current;
    await dataApi.acceptCollaborationInvitation(id);
    assertSession(generation);
    await loadData();
  };

  const handleCreatePerspective = async (event: TimelineEvent, kind: 'perspective' | 'reflection', body: string, clientRequestId: string) => {
    const generation = authGenerationRef.current;
    if (!event.resourceOwnerId) throw new Error('Memory owner could not be confirmed. Refresh and try again.');
    await dataApi.createPerspective(event.id, event.resourceOwnerId, kind, body, clientRequestId);
    assertSession(generation);
  };
  const handleUpdatePerspective = async (id: string, body: string, expectedVersion: number) => {
    const generation = authGenerationRef.current;
    await dataApi.updatePerspective(id, body, expectedVersion);
    assertSession(generation);
  };
  const handleDeletePerspective = async (id: string) => {
    const generation = authGenerationRef.current;
    await dataApi.deletePerspective(id);
    assertSession(generation);
  };
  const exportJsonWithPerspectives = async () => {
    const generation = authGenerationRef.current;
    setPerspectiveError('');
    try {
      const perspectives = await dataApi.exportPerspectives();
      assertSession(generation);
      exportTimelineData(eventTracks, events, apiTags.map((tag) => tag.name), perspectives);
    } catch (error) {
      if (generation !== authGenerationRef.current) return;
      setPerspectiveError(error instanceof Error ? error.message : 'Could not export a complete backup.');
    }
  };

  const openBlindboxMemory = (event: TimelineEvent) => {
    setIsBlindboxOpen(false);
    const track = eventTracks.find((item) => item.id === event.eventId && item.resourceOwnerId === event.resourceOwnerId);
    handleSelectTrack(track ?? null);
    setEventToView(event);
  };

  const selectedTrack = eventTracks.find((track) => trackIdentity(track) === selectedTrackKey) || null;
  const canEditSelectedTrack = selectedTrack?.accessRole === 'owner' || selectedTrack?.accessRole === 'editor';

  // Persist each change before reflecting it in the UI; failed requests leave the prior data intact.
  const handleSaveTrack = async (
    trackData: Omit<EventTrack, 'id' | 'createdAt' | 'updatedAt'>,
    editTrack?: EventTrack
  ) => {
    const generation = authGenerationRef.current;
    const saved = editTrack
      ? await dataApi.updateTrack(editTrack.id, trackData)
      : await dataApi.createTrack(trackData);
    assertSession(generation);
    setEventTracks((prev) => editTrack
      ? prev.map((track) => trackIdentity(track) === trackIdentity(editTrack) ? saved : track)
      : [...prev, saved]);
    if (!editTrack) {
      setSelectedTrackKey(trackIdentity(saved));
      setFilters((prev) => ({ ...prev, selectedEventId: saved.id }));
    }
    setTrackToEdit(null);
  };

  // Delete only after the server confirms; failed requests preserve the local row.
  const handleDeleteTrack = async (track: EventTrack) => {
    const id = track.id;
    const generation = authGenerationRef.current;
    await dataApi.deleteTrack(id);
    assertSession(generation);
    const identity = trackIdentity(track);
    setEventTracks((prev) => prev.filter((item) => trackIdentity(item) !== identity));
    setEvents((prev) => prev.filter((event) => !(event.eventId === id && event.resourceOwnerId === track.resourceOwnerId)));
    setEventToView((prev) => prev?.eventId === id && prev.resourceOwnerId === track.resourceOwnerId ? null : prev);
    if (selectedTrack && trackIdentity(selectedTrack) === identity) {
      setSelectedTrackKey('all');
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
        if (selectedTrackKey !== 'all' && (!selectedTrack || evt.eventId !== selectedTrack.id || evt.resourceOwnerId !== selectedTrack.resourceOwnerId)) return false;

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
  }, [events, selectedTrackKey, filters]);

  // Save a moment server-side first; local state changes only after a confirmed response.
  const handleSaveEvent = async (
    data: Omit<TimelineEvent, 'id' | 'createdAt' | 'updatedAt'>,
    editId?: string,
    imageFiles: File[] = [],
    eventOwnerId?: string
  ) => {
    const generation = authGenerationRef.current;
    if (uploadBusy.current || (imageFiles.length && pendingImageRetry)) throw new Error('Finish or retry the previous photo upload before attaching more files. Your draft is preserved.');
    // The loaded edit snapshot, NOT the freshest timeline, defines what this form was based on.
    if (editId && (!eventToEdit || eventToEdit.id !== editId || !Number.isInteger(eventToEdit.version))) throw new Error('This edit has no version. Close and reopen the form before saving. Your draft is unchanged.');
    const saved = editId
      ? await dataApi.updateMoment(editId, eventToEdit!.resourceOwnerId!, data, eventToEdit!.version!, eventOwnerId || eventToEdit!.resourceOwnerId!)
      : await dataApi.createMoment(data, eventOwnerId!);
    assertSession(generation);
    setEvents((prev) => editId ? prev.map((event) => event.id === editId && event.resourceOwnerId === eventToEdit?.resourceOwnerId ? saved : event) : [saved, ...prev]);
    if (imageFiles.length) {
      const queue = { momentId: saved.id, ownerId: saved.resourceOwnerId!, files: imageFiles.map((file) => ({ file, uploadId: crypto.randomUUID() })) };
      setPendingImageRetry(queue);
      await processImageQueue(queue, generation);
    }
  };

  // Delete only after the server confirms; failures do not remove data from the view.
  const handleDeleteEvent = async (target: TimelineEvent) => {
    const generation = authGenerationRef.current;
    const identity = momentIdentity(target);
    await dataApi.deleteMoment(target.id, target.resourceOwnerId || user.id);
    assertSession(generation);
    setEvents((prev) => prev.filter((event) => momentIdentity(event) !== identity));
    setEventToView((prev) => prev && momentIdentity(prev) === identity ? null : prev);
  };

  const handleToggleReaction = async (event: TimelineEvent, emoji: '❤️' | '🥹' | '😂' | '✨' | '🙌' | '🎉') => {
    const generation = authGenerationRef.current;
    const identity = momentIdentity(event);
    if (reactionPending.current.has(identity)) return;
    reactionPending.current.add(identity);
    try {
      const active = !event.reactions?.find((item) => item.emoji === emoji)?.selected;
      const response = await dataApi.setReaction(event.id, event.resourceOwnerId || user.id, emoji, active);
      assertSession(generation);
      const apply = (item: TimelineEvent) => momentIdentity(item) === identity ? { ...item, reactions: response.reactions } : item;
      setEvents((prev) => prev.map(apply));
      setEventToView((prev) => prev && momentIdentity(prev) === identity ? apply(prev) : prev);
    } finally { if (generation === authGenerationRef.current) reactionPending.current.delete(identity); }
  };

  const handleAddCustomTag = async (name: string) => {
    if (apiTags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) return;
    const generation = authGenerationRef.current;
    const created = await dataApi.createTag(name);
    assertSession(generation);
    setApiTags((prev) => prev.some((tag) => tag.id === created.id) ? prev : [...prev, created]);
  };

  const handleDeleteUnusedTag = async (id: string) => {
    const tag = apiTags.find((item) => item.id === id);
    if (!tag || events.some((event) => event.tags?.includes(tag.name))) return;
    const generation = authGenerationRef.current;
    await dataApi.deleteTag(id);
    assertSession(generation);
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
    const generation = authGenerationRef.current;
    try {
      await operation();
      assertSession(generation);
      setDataError('');
    } catch (error) {
      if (generation === authGenerationRef.current) setDataError(error instanceof Error ? error.message : 'The request failed. Your data was not changed.');
    }
  };

  async function processImageQueue(queue: NonNullable<typeof pendingImageRetry>, generation: number) {
    if (uploadBusy.current) return;
    uploadBusy.current = true; setUploadRunning(true);
    let remaining = queue.files;
    try {
      while (remaining.length) {
        assertSession(generation);
        const { file, uploadId } = remaining[0];
        await dataApi.uploadImage(file, queue.momentId, queue.ownerId, uploadId);
        assertSession(generation);
        remaining = remaining.slice(1);
        setPendingImageRetry({ ...queue, files: remaining });
      }
      const moments = await dataApi.moments();
      assertSession(generation);
      setEvents(moments); setPendingImageRetry(null); setDataError('');
    } catch (error) {
      if (generation !== authGenerationRef.current) return;
      setPendingImageRetry({ ...queue, files: remaining });
      setDataError(remaining.length ? `Moment saved; ${remaining.length} image(s) remain. Retry resumes after acknowledged files: ${error instanceof Error ? error.message : 'upload failed'}` : 'Photos uploaded. Timeline refresh failed; retry refresh without re-uploading.');
    } finally { if (generation === authGenerationRef.current) { uploadBusy.current = false; setUploadRunning(false); } }
  }
  const retryImageUploads = async () => {
    if (pendingImageRetry) await processImageQueue(pendingImageRetry, authGenerationRef.current);
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
        {dataError && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-800 dark:text-rose-200"><span>{dataError}</span><span className="flex gap-3">{pendingImageRetry && <button disabled={uploadRunning} className="font-semibold underline disabled:opacity-50" onClick={() => void retryImageUploads()}>{uploadRunning ? 'Uploading…' : pendingImageRetry.files.length ? 'Retry image upload' : 'Retry timeline refresh'}</button>}<button className="font-semibold underline" onClick={() => setDataError('')}>Dismiss</button></span></div>}
        <SharedInvitations invitations={collaborationInvitations} onAccept={(id) => runMutation(() => acceptInvitation(id))} />
        {/* Header Ribbon & Global Stats */}
        {perspectiveError && <p role="alert" className="mb-3 text-sm text-rose-700 dark:text-rose-300">Backup failed; no incomplete file was downloaded. {perspectiveError}</p>}
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
          onExportJsonAsync={exportJsonWithPerspectives}
          canCreateEntry={eventTracks.some((track) => track.accessRole === 'owner' || track.accessRole === 'editor')}
        />
        {/* Calm rediscovery: only in the all-tracks overview, never a second primary action */}
        {selectedTrackKey === 'all' && (
          <MemoryResurfacing events={events} tracks={eventTracks} visits={visits} onOpen={openSuggested} />
        )}
        {/* Event-Based Timeline Navigation & Overview */}
        <EventTrackNav
          tracks={eventTracks}
          events={events}
          selectedTrackKey={selectedTrackKey}
          onSelectTrack={handleSelectTrack}
          onAddNewTrack={() => {
            setTrackToEdit(null);
            setIsEventTrackModalOpen(true);
          }}
          onEditTrack={(track) => {
            if (track.accessRole !== 'owner') return;
            setTrackToEdit(track);
            setIsEventTrackModalOpen(true);
          }}
          onAddNewMoment={() => {
            if (!canEditSelectedTrack) return;
            setEventToEdit(null);
            setIsEventModalOpen(true);
          }}
          onShareTrack={(track) => {
            if (track.accessRole === 'owner') setShareTrack(track);
          }}
          canEditSelectedTrack={canEditSelectedTrack}
        />

        {/* Filter and Control Toolbar */}
        <div className="mb-8">
          <FilterBar
            filters={filters}
            onFilterChange={(updated) => setFilters((prev) => ({ ...prev, ...updated }))}
            onResetFilters={() =>
              setFilters({
                search: '',
                selectedEventId: selectedTrack?.id ?? 'all',
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
              selectedTrackKey === 'all'
                ? events.length
                : events.filter((e) => e.eventId === selectedTrack?.id && e.resourceOwnerId === selectedTrack?.resourceOwnerId).length
            }
          />
        </div>

        {/* View Switcher: Timeline, Compact List, or Gallery */}
        <main>
          {viewMode === 'timeline' && (
            <TimelineView
              events={filteredEvents}
              tracks={eventTracks}
              currentTrackKey={selectedTrackKey}
              onSelectTrack={handleSelectTrack}
              onViewDetails={openDetail}
              onEdit={(evt) => {
                setEventToEdit(evt);
                setIsEventModalOpen(true);
              }}
              onDelete={(event) => runMutation(() => handleDeleteEvent(event))}
              onTagClick={handleTagClick}
              onOpenImageLightbox={handleOpenLightbox}
              onAddNewEvent={() => {
                setEventToEdit(null);
                setIsEventModalOpen(true);
              }}
              onResetFilters={() =>
                setFilters({
                  search: '',
                  selectedEventId: selectedTrackKey,
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
              onViewDetails={openDetail}
              onEdit={(evt) => {
                setEventToEdit(evt);
                setIsEventModalOpen(true);
              }}
              onDelete={(event) => runMutation(() => handleDeleteEvent(event))}
              onTagClick={handleTagClick}
            />
          )}

          {viewMode === 'gallery' && (
            <GalleryView
              events={filteredEvents}
              tracks={eventTracks}
              onSelectTrack={handleSelectTrack}
              onViewDetails={openDetail}
              onTagClick={handleTagClick}
              onOpenImageLightbox={handleOpenLightbox}
            />
          )}
        </main>
      </div>

      <DeferredUiBoundary key={`${user.id}:${authGenerationRef.current}`}><Suspense fallback={<div role="status" className="fixed bottom-4 left-4 z-[100] rounded-lg bg-white p-3 text-sm shadow-lg dark:bg-stone-900">Opening…</div>}>
      {/* Create / Edit Event Track Modal */}
      {isEventTrackModalOpen && <EventTrackModal key={`${user.id}:${authGenerationRef.current}`}
        isOpen={isEventTrackModalOpen}
        trackToEdit={trackToEdit}
        onClose={() => {
          setIsEventTrackModalOpen(false);
          setTrackToEdit(null);
        }}
        onSave={(track, editTrack) => handleSaveTrack(track, editTrack)}
        onDelete={handleDeleteTrack}
      />}

      {/* Create / Edit Timeline Moment Modal */}
      {isEventModalOpen && <EventModal key={`${user.id}:${authGenerationRef.current}`}
        isOpen={isEventModalOpen}
        eventToEdit={eventToEdit}
        tracks={eventTracks}
        defaultTrackKey={selectedTrack ? trackIdentity(selectedTrack) : (() => { const ownTrack = eventTracks.find((track) => track.resourceOwnerId === user.id); return ownTrack ? trackIdentity(ownTrack) : undefined; })()}
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
      />}

      {/* Event Details View Modal */}
      {!!eventToView && <EventDetailModal key={`${user.id}:${authGenerationRef.current}`}
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
        onToggleReaction={handleToggleReaction}
        onCreatePerspective={handleCreatePerspective}
        onUpdatePerspective={handleUpdatePerspective}
        onDeletePerspective={handleDeletePerspective}
        sessionGeneration={authGenerationRef.current}
        currentUserId={user.id}
      />}

      {!!shareTrack && <CollaborationModal key={`${user.id}:${authGenerationRef.current}`}
        track={shareTrack}
        isOpen={!!shareTrack}
        onClose={() => setShareTrack(null)}
        onInvite={async (username, role) => { await dataApi.inviteCollaborator(shareTrack!.id, username, role); }}
        onLoadCollaborators={() => dataApi.collaborators(shareTrack!.id)}
        onRevoke={async (userId) => { await dataApi.revokeCollaborator(shareTrack!.id, userId); }}
        onSearchUsernames={dataApi.usernameMatches}
        invitations={collaborationInvitations}
        onAccept={acceptInvitation}
      />}
      <button type="button" onClick={() => setIsBlindboxOpen(true)} title="Open a random memory" aria-label="Open a random memory" className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-4 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full bg-amber-600 text-white shadow-lg transition hover:bg-amber-700 focus:outline-none focus:ring-4 focus:ring-amber-300 sm:right-6"><Dices className="h-5 w-5" /></button>
      {isBlindboxOpen && <BlindboxMemory open={isBlindboxOpen} events={events} tracks={eventTracks} onClose={() => setIsBlindboxOpen(false)} onOpen={openBlindboxMemory} />}
      {/* Image Lightbox viewer */}
      {lightboxState.isOpen && <ImageLightbox
        images={lightboxState.images}
        currentIndex={lightboxState.index}
        isOpen={lightboxState.isOpen}
        onClose={() => setLightboxState((prev) => ({ ...prev, isOpen: false }))}
        onNavigate={(newIndex) => setLightboxState((prev) => ({ ...prev, index: newIndex }))}
      />}
      </Suspense></DeferredUiBoundary>
    </div>
  );
}
