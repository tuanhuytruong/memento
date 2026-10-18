import React, { Suspense, lazy, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AccountOverview, TimelineEvent, EventTrack, FilterState, ViewMode } from './types';
import { buildCompleteBackup, downloadBackup } from './lib/exportBackup';
import { trackIdentity, momentIdentity } from './lib/resourceIdentity';
import { matchesMomentFilters, compareMoments, filterProjection, applyFilterPatch } from './lib/momentFilters';
import { releaseAllMomentDrafts } from './lib/useMomentDraft';
import { useMomentFeed } from './lib/useMomentFeed';
import { useDebouncedSearch } from './lib/useDebouncedSearch';
import { LoadMoreMemories } from './components/LoadMoreMemories';
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
// Postcard rendering is a heavy, rarely-used flow; it never joins the initial bundle.
const PostcardComposer = lazy(() => import('./components/PostcardComposer').then(module => ({ default: module.PostcardComposer })));
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
  const [invitationError, setInvitationError] = useState('');
  const [visitError, setVisitError] = useState('');
  const [feedRevision, setFeedRevision] = useState(0);
  const [uploadRunning, setUploadRunning] = useState(false);
  const [pendingImageRetry, setPendingImageRetry] = useState<{ momentId: string; ownerId: string; files: { file: File; uploadId: string }[] } | null>(null);
  const [eventTracks, setEventTracks] = useState<EventTrack[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [apiTags, setApiTags] = useState<ApiTag[]>([]);
  const [collaborationInvitations, setCollaborationInvitations] = useState<CollaborationInvitation[]>([]);
  const [visits, setVisits] = useState<MemoryVisit[]>([]);
  // Phase 2: the caller's own saves. Server-authoritative; the client only
  // reports intent and rolls back when the server disagrees.
  // Full-scope account summary. Served separately from the list so header
  // metrics and track counts stay correct once the list is paginated.
  const [overview, setOverview] = useState<AccountOverview | null>(null);
  const [savedKeys, setSavedKeys] = useState<ReadonlySet<string>>(new Set());
  const [savedCount, setSavedCount] = useState(0);
  const [saveState, setSaveState] = useState<'idle' | 'pending' | 'error'>('idle');
  const saveGeneration = useRef(0);
  const visitWrites = useRef(new Map<string, number>());
  const [shareTrack, setShareTrack] = useState<EventTrack | null>(null);
  const [isBlindboxOpen, setIsBlindboxOpen] = useState(false);
  const [perspectiveError, setPerspectiveError] = useState('');
  const authGenerationRef = useRef(0);
  // Which card opened the detail view, so closing can return focus and scroll.
  const detailOpenerKey = useRef<string | null>(null);
  const uploadBusy = useRef(false);
  const reactionPending = useRef(new Set<string>());
  const assertSession = (generation: number) => { if (generation !== authGenerationRef.current) throw new Error('Session changed. Request result discarded.'); };

  const loadData = useCallback(async () => {
    const generation = authGenerationRef.current;
    setDataLoading(true);
    setDataError('');
    try {
      const [accountData, invitations] = await Promise.all([loadAccountData(), dataApi.collaborationInvitations().catch(() => { if (generation === authGenerationRef.current) setInvitationError('Invitations unavailable. Retry invitations.'); return []; })]);
      if (generation !== authGenerationRef.current) return;
      setEventTracks(accountData.tracks);
      setOverview(accountData.overview);
      setFeedRevision(n => n + 1);
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
        setOverview(null); // never carry one account's counts into another session
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
    setOverview(null); // never carry one account's counts into another session
    setApiTags([]);
    await loadData();
  };

  const handleLogout = async () => {
    const generation = ++authGenerationRef.current;
    resetSnapshots();
    setDataReady(false);
    setEventTracks([]);
    setEvents([]);
    setOverview(null); // never carry one account's counts into another session
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
    dateFrom: '',
    dateTo: '',
    milestonesOnly: false,
    hasImagesOnly: false,
    savedOnly: false,
    sortDirection: 'newest',
  });

  const [viewMode, setViewMode] = useState<ViewMode>('timeline');

  // Modals state
  const [isEventTrackModalOpen, setIsEventTrackModalOpen] = useState(false);
  const [trackToEdit, setTrackToEdit] = useState<EventTrack | null>(null);

  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isPostcardOpen, setIsPostcardOpen] = useState(false);
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
    setIsPostcardOpen(false);
    // No private draft crosses an account or session boundary.
    releaseAllMomentDrafts().forEach((url) => { try { URL.revokeObjectURL(url); } catch { /* already revoked */ } });
    setFilters((previous) => ({ ...previous, search: '', selectedEventId: 'all', selectedTags: [], selectedEmotions: [], selectedYear: 'all', dateFrom: '', dateTo: '', milestonesOnly: false, hasImagesOnly: false, savedOnly: false }));
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
      .catch(() => { if (generation === authGenerationRef.current) { setVisits([]); setVisitError('Visit history unavailable.'); } });
  }, [user, dataReady]);

  // Loads alongside the rest of the caller's own data, fenced by session
  // generation so a previous account's saves can never populate this one.
  useEffect(() => {
    if (!user || !dataReady) return;
    const generation = authGenerationRef.current;
    dataApi.saved()
      .then(result => {
        if (generation !== authGenerationRef.current) return;
        setSavedKeys(new Set(result.saved.map(item => `${item.ownerId}:${item.id}`)));
        setSavedCount(result.count);
      })
      .catch(() => {
        if (generation !== authGenerationRef.current) return;
        setSavedKeys(new Set());
        setSavedCount(0);
      });
  }, [user, dataReady]);

  /**
   * Toggle the caller's own save. The server is the authority: the list is
   * updated optimistically so the control feels immediate, then corrected from
   * the response, and rolled back entirely on any failure. A generation bump
   * mid-flight discards the result rather than writing into the next session.
   */
  const handleToggleSave = useCallback(async (event: TimelineEvent) => {
    const ownerId = event.resourceOwnerId;
    const key = `${ownerId}:${event.id}`;
    if (!ownerId) return;
    const generation = authGenerationRef.current;
    const requestGeneration = ++saveGeneration.current;
    const wasSaved = savedKeys.has(key);
    setSaveState('pending');
    // Flip locally first; a revoke or a slow network must not feel stuck.
    setSavedKeys(previous => {
      const next = new Set(previous);
      if (wasSaved) next.delete(key); else next.add(key);
      return next;
    });
    setSavedCount(count => Math.max(0, count + (wasSaved ? -1 : 1)));
    try {
      const result = await dataApi.setSaved(ownerId, event.id, !wasSaved);
      if (generation !== authGenerationRef.current || requestGeneration !== saveGeneration.current) return;
      const saved = Boolean(result.saved?.saved);
      setSavedKeys(previous => {
        const next = new Set(previous);
        if (saved) next.add(key); else next.delete(key);
        return next;
      });
      setSavedCount(previous => Math.max(0, previous + (saved === !wasSaved ? 0 : saved ? 1 : -1)));
      setSaveState('idle');
      if (filters.savedOnly) setFeedRevision(n => n + 1);
    } catch {
      if (generation !== authGenerationRef.current || requestGeneration !== saveGeneration.current) return;
      // Roll back to what the server actually holds.
      setSavedKeys(previous => {
        const next = new Set(previous);
        if (wasSaved) next.add(key); else next.delete(key);
        return next;
      });
      setSavedCount(count => Math.max(0, count + (wasSaved ? 1 : -1)));
      setSaveState('error');
    }
  }, [savedKeys, filters.savedOnly]);

  const openDetail = (event: TimelineEvent) => {
    const track = eventTracks.find(item => item.id === event.eventId && item.resourceOwnerId === event.resourceOwnerId);
    // Remember where the user came from so closing returns focus and scroll to
    // that card instead of dropping them at the top of the page.
    detailOpenerKey.current = momentIdentity(event);
    recordVisit(track);
    setEventToView(event);
  };

  /** Close the detail and put the user back where they were in the list. */
  const closeDetail = () => {
    const key = detailOpenerKey.current;
    detailOpenerKey.current = null;
    setEventToView(null);
    if (!key) return;
    window.requestAnimationFrame(() => {
      const card = document.getElementById(`event-card-${key}`);
      if (!card) return;
      card.focus({ preventScroll: true });
      card.scrollIntoView({ block: 'nearest' });
    });
  };

  /** Suggestion open: exact identity, no unrelated filter may hide its track. */
  const openSuggested = async (event: TimelineEvent) => {
    const generation = authGenerationRef.current;
    try { event = await dataApi.moment(event.id, event.resourceOwnerId!); assertSession(generation); } catch { if (generation === authGenerationRef.current) { setFeedRevision(n => n + 1); setDataError("This memory is no longer available. Refresh your timeline."); } return; }
    const track = eventTracks.find(item => item.id === event.eventId && item.resourceOwnerId === event.resourceOwnerId);
    setFilters(previous => ({ ...previous, search: '', selectedTags: [], selectedEmotions: [], selectedYear: 'all', dateFrom: '', dateTo: '', milestonesOnly: false, hasImagesOnly: false, savedOnly: false }));
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
  /**
   * Complete backup: pages through every memory and perspective on the
   * server, independent of what the list currently has loaded. It fails
   * closed — if any page, the perspective set or the session itself cannot be
   * read in full, no file is written and the user is told, because a backup
   * that looks complete but is not is worse than no backup at all.
   */
  const exportJsonWithPerspectives = async () => {
    const generation = authGenerationRef.current;
    setPerspectiveError('');
    try {
      const start = await dataApi.exportSnapshot('start', {});
      assertSession(generation);
      const collections: Record<string, any[]> = {};
      for (const kind of ['moments', 'tracks', 'tags', 'perspectives']) {
        const items: any[] = []; const cursors = new Set<string>(); let cursor: string | null = null;
        do {
          const page = await dataApi.exportSnapshot('page', { fingerprint: start.fingerprint, token: start.token, kind, cursor, limit: 100 });
          assertSession(generation);
          if (!Array.isArray(page.items) || page.fingerprint !== start.fingerprint || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) throw new Error('Invalid backup page.');
          items.push(...page.items); cursor = page.nextCursor;
          if (cursor) { if (cursors.has(cursor)) throw new Error('Backup cursor repeated.'); cursors.add(cursor); }
        } while (cursor);
        if (items.length !== start.counts[kind]) throw new Error('Backup component count changed.');
        const keys = items.map(item => kind === 'moments' || kind === 'tracks' ? `${item.resourceOwnerId}:${item.id}` : kind === 'tags' ? item : item.id);
        if (new Set(keys).size !== keys.length) throw new Error('Duplicate backup identities.');
        collections[kind] = items;
      }
      const final = await dataApi.exportSnapshot('finalize', { fingerprint: start.fingerprint, token: start.token });
      assertSession(generation);
      if (final.complete !== true || final.fingerprint !== start.fingerprint) throw new Error('Backup could not be finalized.');
      const payload = {
        version: '4.0', complete: true, exportedAt: new Date().toISOString(),
        scope: { ownerScope: 'all-authorized', ownerUserId: user.id, capturedUnder: 'server-validated-fingerprint', perspectives: 'owned-moments-only', images: 'references-to-stored-images-only' },
        counts: start.counts, events: collections.moments, eventTracks: collections.tracks,
        customTags: collections.tags, perspectives: collections.perspectives,
      };
      downloadBackup(payload);
    } catch (error) {
      if (generation !== authGenerationRef.current) return;
      setPerspectiveError(error instanceof Error ? error.message : 'Could not export a complete backup.');
    }
  };

  const openBlindboxMemory = async (event: TimelineEvent) => {
    const generation = authGenerationRef.current;
    try { event = await dataApi.moment(event.id, event.resourceOwnerId!); assertSession(generation); } catch { if (generation === authGenerationRef.current) setDataError("This memory is no longer available."); return; }
    setIsBlindboxOpen(false);
    const track = eventTracks.find((item) => item.id === event.eventId && item.resourceOwnerId === event.resourceOwnerId);
    handleSelectTrack(track ?? null);
    setEventToView(event);
  };

  const selectedTrack = eventTracks.find((track) => trackIdentity(track) === selectedTrackKey) || null;
  const canEditSelectedTrack = selectedTrack?.accessRole === 'owner' || selectedTrack?.accessRole === 'editor';
  // Account-level write capability: one source for every create entry point,
  // derived from server-authoritative roles rather than local UI state.
  const canCreateEntry = eventTracks.some((track) => track.accessRole === 'owner' || track.accessRole === 'editor');

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
  // Composite-key maps: one pass over moments and one over tracks, never a
  // repeated tracks.find inside the event iteration.
  const trackByComposite = useMemo(() => {
    const map = new Map<string, EventTrack>();
    eventTracks.forEach((track) => map.set(trackIdentity(track), track));
    return map;
  }, [eventTracks]);

  // Tag and year options come from the full-scope summary, so the filter bar
  // offers every option the account has rather than only those present in the
  // page currently on screen. Server-managed tags with no memories yet still
  // appear, at zero, because they are a real choice the user can make.
  const availableTags = useMemo(() => {
    const tagCountMap: { [key: string]: number } = {};
    (overview?.tags ?? []).forEach(({ name, count }) => { tagCountMap[name] = count; });
    apiTags.forEach((tag) => {
      if (!(tag.name in tagCountMap)) tagCountMap[tag.name] = 0;
    });
    return Object.entries(tagCountMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [overview, apiTags]);

  const availableYears = useMemo(() => overview?.years ?? [], [overview]);

  const search = useDebouncedSearch(filters.search, authGenerationRef.current);
  const feedQuery = useMemo(() => ({ ...filterProjection(filters), search: search.value, sortDirection: filters.sortDirection,
    trackKey: selectedTrackKey === 'all' ? null : selectedTrackKey, limit: 40 }), [filters, selectedTrackKey, search.value]);
  const fetchFeedPage = useCallback(({ cursor, query, signal }: any) =>
    dataApi.queryMoments({ ...query, cursor, includeTotal: cursor === null }, signal), []);
  const feed = useMomentFeed({ query: feedQuery, generation: authGenerationRef.current,
    enabled: !!user && dataReady && !search.pending, fetchPage: fetchFeedPage, maxRetainedPages: 5 });
  useEffect(() => { feed.refresh(); }, [feedRevision]);
  useEffect(() => { setEvents(feed.items); }, [feed.items.map(momentIdentity).join('|'), feed.loading]);
  const filteredEvents = feed.items.map(item => events.find(local => momentIdentity(local) === momentIdentity(item)) ?? item);

  // Save a moment server-side first; local state changes only after a confirmed response.
  // expectedVersion is optional: the composer passes the version it displayed,
  // or the freshly reviewed one after a conflict rebase.
  const handleSaveEvent = async (
    data: Omit<TimelineEvent, 'id' | 'createdAt' | 'updatedAt'>,
    editId?: string,
    imageFiles: File[] = [],
    eventOwnerId?: string,
    expectedVersion?: number
  ) => {
    const generation = authGenerationRef.current;
    if (uploadBusy.current || (imageFiles.length && pendingImageRetry)) throw new Error('Finish or retry the previous photo upload before attaching more files. Your draft is preserved.');
    // The loaded edit snapshot, NOT the freshest timeline, defines what this form was based on.
    if (editId && (!eventToEdit || eventToEdit.id !== editId)) throw new Error('This edit is no longer open. Close and reopen the form before saving. Your draft is unchanged.');
    const version = expectedVersion ?? eventToEdit?.version;
    if (editId && !Number.isInteger(version)) throw new Error('This edit has no version. Close and reopen the form before saving. Your draft is unchanged.');
    const saved = editId
      ? await dataApi.updateMoment(editId, eventToEdit!.resourceOwnerId!, data, version!, eventOwnerId || eventToEdit!.resourceOwnerId!)
      : await dataApi.createMoment(data, eventOwnerId!);
    assertSession(generation);
    setEvents((prev) => editId ? prev.map((event) => event.id === editId && event.resourceOwnerId === eventToEdit?.resourceOwnerId ? saved : event) : [saved, ...prev]);
    await loadData();
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
    await loadData();
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
    if (!tag || (overview?.tags.find(item => item.name === tag.name)?.count ?? 0) > 0) return;
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
      await loadData();
      assertSession(generation);
      setPendingImageRetry(null); setDataError('');
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
        {invitationError && <p role="status">{invitationError} <button onClick={() => { setInvitationError(''); void loadData(); }}>Retry invitations</button></p>}
        {visitError && <p role="status">{visitError} <button onClick={() => { const generation = authGenerationRef.current; void dataApi.trackVisits().then(rows => { if (generation === authGenerationRef.current) { setVisits(rows); setVisitError(''); } }).catch(() => { if (generation === authGenerationRef.current) setVisitError('Visit history unavailable.'); }); }}>Retry visit history</button></p>}
        <TimelineHeader
          overview={overview}
          trackCount={eventTracks.length}
          username={user.username}
          onLogout={() => void handleLogout()}
          onAddNewEvent={() => {
            setEventToEdit(null);
            setIsEventModalOpen(true);
          }}
          // One export path only: a second, lighter one would be the route a
          // partial backup escapes through.
          onExportJson={exportJsonWithPerspectives}
          // Export is owner-only, so the entry point disappears without an owned track.
          onCreatePostcard={eventTracks.some((track) => track.accessRole === 'owner' && track.resourceOwnerId === user.id) ? () => setIsPostcardOpen(true) : undefined}
          canCreateEntry={canCreateEntry}
        />
        {/* Calm rediscovery: only in the all-tracks overview, never a second primary action */}
        {selectedTrackKey === 'all' && (
          <MemoryResurfacing tracks={eventTracks} visits={visits} sessionGeneration={authGenerationRef.current} revision={feedRevision} onOpen={openSuggested} />
        )}
        {/* Event-Based Timeline Navigation & Overview */}
        <EventTrackNav
          tracks={eventTracks}
          overview={overview}
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
            // Role decides the CTA, including in the merged overview where no
            // single track is selected.
            if (!canCreateEntry) return;
            setEventToEdit(null);
            setIsEventModalOpen(true);
          }}
          onShareTrack={(track) => {
            if (track.accessRole === 'owner') setShareTrack(track);
          }}
          canEditSelectedTrack={canCreateEntry}
        />

        {/* Filter and Control Toolbar */}
        <div className="mb-8">
          <FilterBar
            filters={filters}
            onFilterChange={(updated) => setFilters((prev) => applyFilterPatch(prev, updated))}
            onResetFilters={() =>
              setFilters({
                search: '',
                selectedEventId: selectedTrack?.id ?? 'all',
                selectedTags: [],
                selectedEmotions: [],
                selectedYear: 'all',
                dateFrom: '',
                dateTo: '',
                milestonesOnly: false,
                hasImagesOnly: false,
                savedOnly: false,
                sortDirection: 'newest',
              })
            }
            availableTags={availableTags}
            availableYears={availableYears}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            searchPending={search.pending || feed.loading}
            onSearchEnter={search.flush}
            onSearchCompositionStart={search.compositionStart}
            onSearchCompositionEnd={search.compositionEnd}
            totalFilteredCount={feed.total ?? 0}
            savedCount={savedCount}
            totalCount={
              selectedTrackKey === 'all'
                ? (overview?.total ?? 0)
                : (overview?.tracks.find(row => `${row.trackOwnerId}:${row.trackId}` === selectedTrackKey)?.count ?? 0)
            }
          />
        </div>

        {/* View Switcher: Timeline, Compact List, or Gallery */}
        <main aria-busy={search.pending || feed.loading}>
          {(search.pending || feed.loading) && <div role="status" className="min-h-48 py-16 text-center">Updating memories…</div>}
          {!search.pending && !feed.loading && viewMode === 'timeline' && (
            <TimelineView
              events={filteredEvents}
              tracks={eventTracks}
              currentTrackKey={selectedTrackKey}
              canCreateEntry={selectedTrack ? canEditSelectedTrack : canCreateEntry}
              hasAnyTrack={eventTracks.length > 0}
              savedOnly={filters.savedOnly}
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
              onAddNewTrack={() => {
                setTrackToEdit(null);
                setIsEventTrackModalOpen(true);
              }}
              onResetFilters={() =>
                setFilters({
                  search: '',
                  selectedEventId: selectedTrackKey,
                  selectedTags: [],
                  selectedEmotions: [],
                  selectedYear: 'all',
                  dateFrom: '',
                  dateTo: '',
                  milestonesOnly: false,
                  hasImagesOnly: false,
                  savedOnly: false,
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

          {!search.pending && !feed.loading && viewMode === 'compact' && (
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

          {!search.pending && !feed.loading && viewMode === 'gallery' && (
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
        defaultTrackKey={selectedTrack ? trackIdentity(selectedTrack) : undefined}
        existingTags={availableTags.map((t) => t.name)}
        sessionGeneration={authGenerationRef.current}
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
        onClose={closeDetail}
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
        isSaved={eventToView ? savedKeys.has(`${eventToView.resourceOwnerId}:${eventToView.id}`) : false}
        saveState={saveState}
        onToggleSave={handleToggleSave}
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
      <LoadMoreMemories hasMore={feed.hasMore && !search.pending} loading={feed.loading || search.pending} error={feed.error}
        windowShifted={feed.windowShifted} loadedCount={feed.items.length} totalCount={feed.total}
        onLoadMore={feed.loadMore} onNewer={feed.newer} onRefresh={feed.refresh} />
      {isBlindboxOpen && <BlindboxMemory key={authGenerationRef.current} currentUserId={user.id} open={isBlindboxOpen} tracks={eventTracks} onClose={() => setIsBlindboxOpen(false)} onOpen={openBlindboxMemory} />}
      {/* Image Lightbox viewer */}
      {lightboxState.isOpen && <ImageLightbox
        images={lightboxState.images}
        currentIndex={lightboxState.index}
        isOpen={lightboxState.isOpen}
        onClose={() => setLightboxState((prev) => ({ ...prev, isOpen: false }))}
        onNavigate={(newIndex) => setLightboxState((prev) => ({ ...prev, index: newIndex }))}
      />}
      {isPostcardOpen && <PostcardComposer
        key={`${user.id}:${authGenerationRef.current}`}
        isOpen={isPostcardOpen}
        tracks={eventTracks}
        currentUserId={user.id}
        onClose={() => setIsPostcardOpen(false)}
      />}
      </Suspense></DeferredUiBoundary>
    </div>
  );
}
