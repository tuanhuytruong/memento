import React, { useState, useEffect, useRef } from 'react';
import { PrivateImage } from './PrivateImage';
import { ApiError, dataApi } from '../lib/api';
import { useModalLifecycle } from '../lib/useModalLifecycle';
import {
  X,
  Calendar,
  Clock,
  MapPin,
  Lightbulb,
  Sparkles,
  Tag,
  Image as ImageIcon,
  Plus,
  Trash2,
  Navigation,
  Star,
  UploadCloud,
  Check,
  ChevronDown,
  Save,
} from 'lucide-react';
import { TimelineEvent, EmotionKey, LocationMetadata, EventTrack } from '../types';
import { trackIdentity } from '../lib/resourceIdentity';
import { localCalendarDate, localClockTime } from '../lib/localDate';
import { EMOTIONS, DEFAULT_TAGS } from '../data/emotions';
import { getEventTheme, getEventIconComponent } from '../data/eventThemes';
import { compressImage } from '../lib/images';
import {
  draftScopeKey,
  readMomentDraft,
  clearMomentDraft,
  isDraftDirty,
  useDraftDismissal,
  type MomentDraftFields,
} from '../lib/useMomentDraft';
import { MomentConflictPanel, type ConflictState } from './MomentConflictPanel';

interface EventModalProps {
  isOpen: boolean;
  eventToEdit?: TimelineEvent | null;
  tracks: EventTrack[];
  defaultTrackKey?: string;
  existingTags: string[];
  /** Auth generation fence: a draft never crosses an account or session boundary. */
  sessionGeneration: number;
  onClose: () => void;
  onSave: (eventData: Omit<TimelineEvent, 'id' | 'createdAt' | 'updatedAt'>, editId?: string, imageFiles?: File[], eventOwnerId?: string, expectedVersion?: number) => Promise<void>;
  onAddCustomTag?: (newTag: string) => Promise<void>;
  onCreateNewTrack?: () => void;
}

export const EventModal: React.FC<EventModalProps> = ({
  isOpen,
  eventToEdit,
  tracks,
  defaultTrackKey,
  existingTags,
  sessionGeneration,
  onClose,
  onSave,
  onAddCustomTag,
  onCreateNewTrack,
}) => {
  const alive = useRef(true);
  const initialized = useRef(false);
  const blobs = useRef<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const busy = isSaving || isCompressing;

  // Local calendar, never the UTC date that toISOString() reports: around
  // local midnight those can be different days.
  const todayStr = localCalendarDate();
  const currentTimeStr = localClockTime();

  // Only tracks this account can actually write to may be preselected or
  // chosen for new content; a viewer-only account gets an explicit message
  // instead of an unusable composer.
  const writableTracks = tracks.filter((track) => track.accessRole === 'owner' || track.accessRole === 'editor');
  const hasWritableTrack = writableTracks.length > 0;

  const [eventTrackKey, setEventTrackKey] = useState<string>(() => defaultTrackKey || (writableTracks[0] ? trackIdentity(writableTracks[0]) : ''));
  const selectedTrack = writableTracks.find((track) => trackIdentity(track) === eventTrackKey) || null;
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayStr);
  const [time, setTime] = useState(currentTimeStr);
  const [description, setDescription] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [showNewTagInput, setShowNewTagInput] = useState(false);

  // Optional metadata: all neutral by default. Never imply a feeling or a
  // significance the author did not choose.
  const [selectedEmotion, setSelectedEmotion] = useState<EmotionKey | undefined>(undefined);
  const [emotionIntensity, setEmotionIntensity] = useState<number>(4);
  const [idea, setIdea] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationCity, setLocationCity] = useState('');
  const [locationCountry, setLocationCountry] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const [isMilestone, setIsMilestone] = useState(false);

  // Images: existing server URLs and new local files are tracked separately.
  const [images, setImages] = useState<string[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [showMore, setShowMore] = useState(false);
  // Set after "Use latest saved values": the next save targets the version the
  // user just reviewed instead of the stale one this form opened with.
  const [adoptedVersion, setAdoptedVersion] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const baselineRef = useRef<MomentDraftFields | null>(null);

  const mode: 'create' | 'edit' = eventToEdit ? 'edit' : 'create';
  const scopeKey = draftScopeKey({
    authGeneration: sessionGeneration,
    mode,
    momentId: eventToEdit?.id,
    ownerId: eventToEdit?.resourceOwnerId,
    expectedVersion: eventToEdit?.version,
  });

  const currentFields = (): MomentDraftFields => ({
    trackKey: eventTrackKey,
    title,
    date,
    time,
    description,
    tags: selectedTags,
    emotion: selectedEmotion,
    emotionIntensity,
    idea,
    locationName,
    locationCity,
    locationCountry,
    isMilestone,
    images,
    imageFiles,
  });

  const dirty = baselineRef.current ? isDraftDirty(baselineRef.current, currentFields()) : false;

  // Every dismissal path — backdrop, Escape, header X, Cancel, New track —
  // funnels through requestDismiss. useModalLifecycle owns Escape, so it calls
  // a stable wrapper that always reaches the latest decision boundary.
  const requestDismissRef = useRef<() => void>(() => {});
  const closeForm = () => requestDismissRef.current();
  const modal = useModalLifecycle(isOpen, closeForm);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Revoke only the previews this mount still owns. Blob URLs that a
      // stored draft holds (a kept draft reopened, then closed clean) belong to
      // that draft and must survive this unmount.
      const storedUrls = new Set(readMomentDraft(scopeKey)?.blobUrls ?? []);
      blobs.current.forEach((url) => { if (!storedUrls.has(url)) URL.revokeObjectURL(url); });
      blobs.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prefill on edit, restore a kept draft, or reset on create.
  useEffect(() => {
    if (!isOpen || initialized.current) return;
    initialized.current = true;
    setSaveError('');
    setConflict(null);
    const kept = readMomentDraft(scopeKey);
    const base: MomentDraftFields = eventToEdit
      ? {
          trackKey: (() => { const editTrack = tracks.find((track) => track.id === eventToEdit.eventId && track.resourceOwnerId === eventToEdit.resourceOwnerId); return editTrack && (editTrack.accessRole === 'owner' || editTrack.accessRole === 'editor') ? trackIdentity(editTrack) : ''; })(),
          title: eventToEdit.title,
          date: eventToEdit.date,
          time: eventToEdit.time || '',
          description: eventToEdit.description,
          tags: eventToEdit.tags || [],
          emotion: eventToEdit.emotion,
          emotionIntensity: eventToEdit.emotionIntensity || 4,
          idea: eventToEdit.idea || '',
          locationName: eventToEdit.location?.name || '',
          locationCity: eventToEdit.location?.city || '',
          locationCountry: eventToEdit.location?.country || '',
          isMilestone: !!eventToEdit.isMilestone,
          images: eventToEdit.images || [],
          imageFiles: [],
        }
      : {
          trackKey: (() => { const wanted = writableTracks.find((track) => trackIdentity(track) === defaultTrackKey); return wanted ? trackIdentity(wanted) : (writableTracks[0] ? trackIdentity(writableTracks[0]) : ''); })(),
          title: '',
          date: todayStr,
          time: currentTimeStr,
          description: '',
          tags: [],
          emotion: undefined,
          emotionIntensity: 4,
          idea: '',
          locationName: '',
          locationCity: '',
          locationCountry: '',
          isMilestone: false,
          images: [],
          imageFiles: [],
        };
    // A kept draft wins over the server snapshot for the same scope, but a
    // track that vanished or lost write access is never restored blindly.
    let applied = base;
    if (kept) {
      const trackStillWritable = kept.fields.trackKey && writableTracks.some((track) => trackIdentity(track) === kept.fields.trackKey);
      applied = { ...kept.fields, trackKey: trackStillWritable ? kept.fields.trackKey : base.trackKey };
      // Blob previews from the kept draft are re-owned by this mount so a later
      // unmount does not revoke previews that still belong to the draft.
      blobs.current.push(...kept.blobUrls.filter((url) => url.startsWith('blob:') && !blobs.current.includes(url)));
      setDraftRestored(true);
    }
    setEventTrackKey(applied.trackKey);
    setTitle(applied.title);
    setDate(applied.date);
    setTime(applied.time);
    setDescription(applied.description);
    setSelectedTags(applied.tags);
    setSelectedEmotion(applied.emotion);
    setEmotionIntensity(applied.emotionIntensity);
    setIdea(applied.idea);
    setLocationName(applied.locationName);
    setLocationCity(applied.locationCity);
    setLocationCountry(applied.locationCountry);
    setIsMilestone(applied.isMilestone);
    setImages(applied.images);
    setImageFiles(applied.imageFiles);
    // Existing optional metadata must stay discoverable on edit.
    const hasMetadata = applied.tags.length > 0 || Boolean(applied.emotion) || Boolean(applied.idea)
      || Boolean(applied.locationName || applied.locationCity || applied.locationCountry) || applied.isMilestone;
    setShowMore(mode === 'edit' ? hasMetadata : false);
    baselineRef.current = { ...applied, imageFiles: [] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissal = useDraftDismissal({ dirty, busy, onClose });

  /** Every dismissal path funnels through here so the boundary is one place. */
  const pendingTransition = useRef<null | (() => void)>(null);
  const requestDismiss = (after?: () => void) => {
    if (busy) return;
    pendingTransition.current = after ?? null;
    const decision = dismissal.requestDismiss();
    // A clean form closes directly and any queued navigation (New track) runs.
    if (decision === 'close' && after) after();
  };
  // Escape reaches the modal lifecycle, which only holds this stable wrapper.
  requestDismissRef.current = () => requestDismiss();
  const finishDraft = (keep: boolean) => {
    const fields = currentFields();
    if (keep) {
      const owned = blobs.current;
      blobs.current = []; // the stored draft now owns these previews
      dismissal.keepDraft(scopeKey, fields, owned);
    } else {
      clearMomentDraft(scopeKey);
      dismissal.discard();
    }
    const after = pendingTransition.current;
    pendingTransition.current = null;
    // Both "Keep draft and close" and "Discard changes" carry out a queued
    // navigation: the user has explicitly decided to leave the form.
    if (after) after();
  };

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter((t) => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const handleAddNewTag = async () => {
    const trimmed = newTagInput.trim();
    if (!trimmed) return;
    try {
      if (onAddCustomTag) await onAddCustomTag(trimmed);
      if (!alive.current) return;
      if (!selectedTags.includes(trimmed)) setSelectedTags((prev) => [...prev, trimmed]);
      setNewTagInput('');
      setShowNewTagInput(false);
    } catch (error) {
      if (alive.current) setSaveError(error instanceof Error ? error.message : 'Could not save this tag. Please retry.');
    }
  };

  // Keep local files for the authenticated upload endpoint and use object URLs only for previews.
  // Photos are downscaled before upload so phone pictures stop hitting the server size limit.
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = (Array.from(e.target.files || []) as File[]).filter((file) => file.type.startsWith('image/'));
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!picked.length) return;
    setSaveError('');
    setIsCompressing(true);
    (async () => {
      const ready: File[] = [];
      for (const file of picked) {
        try {
          const prepared = await compressImage(file);
          if (!alive.current) return;
          ready.push(prepared);
        } catch (error) {
          if (!alive.current) return;
          setSaveError(error instanceof Error ? error.message : `Could not prepare "${file.name}".`);
        }
      }
      if (ready.length) {
        setImageFiles((prev) => [...prev, ...ready]);
        const urls = ready.map((file) => URL.createObjectURL(file));
        blobs.current.push(...urls);
        setImages((prev) => [...prev, ...urls]);
      }
    })().finally(() => { if (alive.current) setIsCompressing(false); });
  };

  const handleAddImageUrl = () => {
    if (imageUrlInput.trim()) {
      setImages((prev) => [...prev, imageUrlInput.trim()]);
      setImageUrlInput('');
      setIsAddingUrl(false);
    }
  };

  const removeImage = (index: number) => {
    const localIndex = images.slice(0, index + 1).filter((image) => image.startsWith('blob:')).length - 1;
    if (images[index]?.startsWith('blob:') && localIndex >= 0 && localIndex < imageFiles.length) {
      URL.revokeObjectURL(images[index]);
      blobs.current = blobs.current.filter((url) => url !== images[index]);
      setImageFiles((prev) => prev.filter((_, i) => i !== localIndex));
    }
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  // Geolocation detector
  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (!alive.current) return;
        const { latitude, longitude } = pos.coords;
        try {
          // Attempt reverse geocode using public nominatim
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
          );
          if (res.ok) {
            const data = await res.json();
            if (!alive.current) return;
            const address = data.address || {};
            const city = address.city || address.town || address.village || address.county || '';
            const country = address.country || '';
            const venue = data.name || address.suburb || 'Current Location';

            setLocationName(venue);
            setLocationCity(city);
            setLocationCountry(country);
          } else {
            if (!alive.current) return;
            setLocationName(`Lat: ${latitude.toFixed(3)}, Lng: ${longitude.toFixed(3)}`);
          }
        } catch {
          if (!alive.current) return;
          setLocationName(`Lat: ${latitude.toFixed(3)}, Lng: ${longitude.toFixed(3)}`);
        } finally {
          if (alive.current) setIsLocating(false);
        }
      },
      (err) => {
        if (!alive.current) return;
        console.warn('Geolocation failed:', err.message);
        setIsLocating(false);
        alert('Could not retrieve coordinates. Please enter location manually.');
      },
      { timeout: 8000 }
    );
  };

  const draftSummary = () => ({
    title: title.trim(),
    date,
    time: time.trim() || undefined,
    description: description.trim(),
    tags: selectedTags,
    idea: idea.trim() || undefined,
    isMilestone,
  });

  const buildPayload = (imageRefs: string[]): Omit<TimelineEvent, 'id' | 'createdAt' | 'updatedAt'> => {
    let locationMeta: LocationMetadata | undefined = undefined;
    if (locationName.trim() || locationCity.trim() || locationCountry.trim()) {
      locationMeta = {
        name: locationName.trim() || locationCity.trim() || 'Specified Location',
        city: locationCity.trim() || undefined,
        country: locationCountry.trim() || undefined,
      };
    }
    return {
      eventId: selectedTrack!.id,
      title: title.trim(),
      date,
      time: time.trim() || undefined,
      description: description.trim(),
      tags: selectedTags.length > 0 ? selectedTags : ['General'],
      // Draft blob URLs are never sent: only real server references count.
      images: imageRefs.filter((image) => !image.startsWith('blob:')),
      emotion: selectedEmotion,
      emotionIntensity: selectedEmotion ? emotionIntensity : undefined,
      idea: idea.trim() || undefined,
      location: locationMeta,
      isMilestone,
    };
  };

  /** Load the current version through the exact (ownerId, id) read. */
  const loadLatest = async (id: string, ownerId: string) => dataApi.moment(id, ownerId);

  const succeedAndClose = () => {
    if (!alive.current) return;
    clearMomentDraft(scopeKey);
    images.filter((image) => image.startsWith('blob:')).forEach((image) => URL.revokeObjectURL(image));
    blobs.current = [];
    onClose();
  };

  const toConflictOrError = async (error: unknown, id: string, ownerId: string) => {
    if (!alive.current) return;
    if (error instanceof ApiError && error.status === 409) {
      // Keep the draft on screen and load the current version for comparison;
      // never ask the user to copy text into another application.
      try {
        const latest = await loadLatest(id, ownerId);
        if (!alive.current) return;
        setConflict({ kind: 'comparison', latest, draft: draftSummary() });
        setSaveError('This memory changed since you opened it. Nothing was overwritten — compare the versions below.');
      } catch (loadError) {
        if (!alive.current) return;
        if (loadError instanceof ApiError && loadError.status === 404) {
          setConflict({ kind: 'lost', message: 'It was deleted, or your access to it was removed. Your text below is still yours to copy.', draft: draftSummary() });
          setSaveError('');
        } else {
          setSaveError('This memory changed since you opened it, and the latest version could not be loaded. Your draft is preserved here. Please retry.');
        }
      }
      return;
    }
    if (error instanceof ApiError && error.status === 404 && mode === 'edit') {
      setConflict({ kind: 'lost', message: 'It was deleted, or your access to it was removed. Your text below is still yours to copy.', draft: draftSummary() });
      setSaveError('');
      return;
    }
    setSaveError(error instanceof Error ? error.message : 'Could not save this moment. Your edits are still here; retry when ready.');
  };

  /** Explicit rebase: the draft is saved against the freshly reviewed version. */
  const keepMyEdits = async (latest: TimelineEvent) => {
    if (!selectedTrack) return;
    const payload = buildPayload(latest.images || []);
    setSaveError('');
    setIsSaving(true);
    try {
      await onSave(payload, eventToEdit?.id, imageFiles, selectedTrack.resourceOwnerId, latest.version);
      succeedAndClose();
    } catch (error) {
      // A further conflict returns to comparison; nothing is force-overwritten.
      await toConflictOrError(error, latest.id, latest.resourceOwnerId || selectedTrack.resourceOwnerId);
    } finally {
      if (alive.current) setIsSaving(false);
    }
  };

  const useLatestValues = (latest: TimelineEvent) => {
    // Adopt the server state wholesale, including its version, so the next
    // save targets the version the user just reviewed.
    setTitle(latest.title);
    setDate(latest.date);
    setTime(latest.time || '');
    setDescription(latest.description);
    setSelectedTags(latest.tags || []);
    setSelectedEmotion(latest.emotion);
    setEmotionIntensity(latest.emotionIntensity || 4);
    setIdea(latest.idea || '');
    setLocationName(latest.location?.name || '');
    setLocationCity(latest.location?.city || '');
    setLocationCountry(latest.location?.country || '');
    setIsMilestone(!!latest.isMilestone);
    // Only attachments still present on the server are kept; pending local
    // files remain for upload. Draft image URLs are never treated as authority.
    const serverImages = latest.images || [];
    const keptBlobs = images.filter((image) => image.startsWith('blob:'));
    setImages([...serverImages, ...keptBlobs]);
    // The form is now based on the fetched version: the baseline moves with it
    // and the next save carries that version, so a further 409 re-opens this
    // comparison instead of overwriting blindly.
    baselineRef.current = {
      ...currentFields(),
      title: latest.title,
      date: latest.date,
      time: latest.time || '',
      description: latest.description,
      tags: latest.tags || [],
      emotion: latest.emotion,
      emotionIntensity: latest.emotionIntensity || 4,
      idea: latest.idea || '',
      locationName: latest.location?.name || '',
      locationCity: latest.location?.city || '',
      locationCountry: latest.location?.country || '',
      isMilestone: !!latest.isMilestone,
      images: serverImages,
      imageFiles: [],
    };
    setAdoptedVersion(latest.version ?? null);
    setConflict(null);
    setSaveError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setConflict(null);
    const effectiveVersion = adoptedVersion ?? eventToEdit?.version;
    if (!hasWritableTrack || !selectedTrack) {
      setSaveError('Choose a track you can write to before saving this moment.');
      trackRef.current?.querySelector('button')?.focus();
      return;
    }
    if (!title.trim()) { setSaveError('Give this memory a title so you can find it later.'); titleRef.current?.focus(); return; }
    if (!date) { setSaveError('Choose the day this memory belongs to.'); dateRef.current?.focus(); return; }
    if (mode === 'edit' && !Number.isInteger(effectiveVersion)) {
      setSaveError('This edit has no version. Close and reopen the form before saving. Your draft is unchanged.');
      return;
    }

    const payload = buildPayload(images);
    setSaveError('');
    setIsSaving(true);
    onSave(payload, eventToEdit?.id, imageFiles, selectedTrack.resourceOwnerId, effectiveVersion)
      .then(succeedAndClose)
      .catch((error: unknown) => toConflictOrError(error, eventToEdit!.id, eventToEdit?.resourceOwnerId || selectedTrack.resourceOwnerId))
      .finally(() => { if (alive.current) setIsSaving(false); });
  };

  // Combine default tags with existing tags
  const allTagOptions = Array.from(new Set([...DEFAULT_TAGS, ...existingTags]));

  const metadataSummary = [
    selectedTags.length ? `${selectedTags.length} tag${selectedTags.length === 1 ? '' : 's'}` : '',
    selectedEmotion ? EMOTIONS.find((emo) => emo.key === selectedEmotion)?.label ?? '' : '',
    idea.trim() ? 'insight' : '',
    (locationName || locationCity || locationCountry) ? 'location' : '',
    isMilestone ? 'milestone' : '',
  ].filter(Boolean).join(' · ');

  if (!isOpen) return null;

  return (
    <div
      ref={modal} tabIndex={-1} role="dialog" aria-modal="true" aria-label={eventToEdit ? 'Edit memory' : 'New memory'}
      id="event-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 backdrop-blur-sm p-3 sm:p-5 overflow-y-auto"
      onClick={() => requestDismiss()}
    >
      <div
        id="event-modal-card"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl bg-white dark:bg-stone-900 rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 overflow-hidden my-6 flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between bg-stone-50/50 dark:bg-stone-900/50 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold font-display text-stone-900 dark:text-stone-100 truncate">
              {eventToEdit ? 'Edit Timeline Event' : 'Log New Timeline Event'}
            </h2>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5 truncate">
              Tell the story first; everything else is optional.
            </p>
          </div>
          <button
            id="close-event-modal"
            type="button"
            aria-label="Close memory composer"
            onClick={() => requestDismiss()}
            disabled={busy}
            className="min-h-11 min-w-11 flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body. The footer is a flex SIBLING below, so Save/Cancel
            are always reachable and never overlay the photo grid. */}
        <form id="event-modal-form" onSubmit={handleSubmit} className="px-4 sm:px-6 py-5 space-y-5 overflow-y-auto flex-1 text-sm">
          {!hasWritableTrack && (
            <p role="status" className="rounded-xl border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-800/50 px-4 py-3 text-sm text-stone-600 dark:text-stone-300">
              You do not have a track you can write to yet. Create your first track to start logging memories, or ask an owner to share one with editing access.
            </p>
          )}

          {/* 1. Parent Event Track */}
          <div className="bg-stone-50/70 dark:bg-stone-800/50 p-3.5 rounded-xl border border-stone-200/80 dark:border-stone-800">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                <span>Belongs to Event Track</span>
                <span className="text-rose-500" aria-hidden="true">*</span>
              </span>
              {onCreateNewTrack && (
                <button
                  type="button"
                  id="modal-new-track-button"
                  onClick={() => requestDismiss(onCreateNewTrack)}
                  className="text-xs text-amber-700 dark:text-amber-400 font-semibold hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> New Event Track
                </button>
              )}
            </div>

            <div ref={trackRef} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {writableTracks.map((t) => {
                const isSelected = eventTrackKey === trackIdentity(t);
                const theme = getEventTheme(t.color);
                const IconComp = getEventIconComponent(t.icon);

                return (
                  <button
                    key={trackIdentity(t)}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setEventTrackKey(trackIdentity(t))}
                    className={`p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${
                      isSelected
                        ? `${theme.bgLight} ${theme.bgDark} ${theme.borderLight} ${theme.borderDark} ring-2 ring-amber-500/20 shadow-xs font-semibold`
                        : 'bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-700 hover:border-stone-300 text-stone-700 dark:text-stone-300'
                    }`}
                  >
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0 ${theme.accentBg}`}
                    >
                      <IconComp className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold truncate">{t.title}</div>
                      <div className="text-[10px] text-stone-400 truncate">{t.description || 'Event timeline'}</div>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Title */}
          <div>
            <label htmlFor="event-title-input" className="font-semibold text-stone-800 dark:text-stone-200 mb-1.5 block">
              Event Title <span className="text-rose-500" aria-hidden="true">*</span>
            </label>
            <input
              type="text"
              required
              id="event-title-input"
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., a first trip, a released project..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition text-base"
              autoFocus
            />
          </div>

          {/* 3. Date & Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="event-date-input" className="font-semibold text-stone-800 dark:text-stone-200 mb-1.5 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-stone-500" />
                Date <span className="text-rose-500" aria-hidden="true">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  required
                  id="event-date-input"
                  ref={dateRef}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition"
                />
                <button
                  type="button"
                  id="set-today-button"
                  aria-label="Set date to today"
                  onClick={() => setDate(localCalendarDate())}
                  className="px-2.5 py-1 min-h-11 text-xs font-medium rounded-lg bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 shrink-0"
                >
                  Today
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="event-time-input" className="font-semibold text-stone-800 dark:text-stone-200 mb-1.5 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-stone-500" />
                Time (Optional)
              </label>
              <input
                type="time"
                id="event-time-input"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition"
              />
            </div>
          </div>

          {/* 4. Story: the primary reason people open this form */}
          <div>
            <label htmlFor="event-description-input" className="font-semibold text-stone-800 dark:text-stone-200 mb-1.5 block">
              Event Story / Journal Notes
            </label>
            <textarea
              id="event-description-input"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What happened? Who was there? Tell the story of this event..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition"
            />
          </div>

          {/* 5. Photos */}
          <div className="bg-stone-50/70 dark:bg-stone-800/40 p-3.5 rounded-xl border border-stone-200/70 dark:border-stone-800">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-sky-500" />
                Photos
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  id="add-image-url-toggle"
                  onClick={() => setIsAddingUrl(!isAddingUrl)}
                  className="text-xs text-amber-700 dark:text-amber-400 hover:underline"
                >
                  {isAddingUrl ? 'Cancel URL' : '+ Image Link'}
                </button>
                <button
                  type="button"
                  id="upload-image-button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs px-2.5 py-1 rounded-md bg-stone-200 dark:bg-stone-700 hover:bg-stone-300 dark:hover:bg-stone-600 text-stone-800 dark:text-stone-200 flex items-center gap-1"
                >
                  <UploadCloud className="w-3.5 h-3.5" /> Upload File
                </button>
              </div>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/*"
              multiple
              className="hidden"
            />

            {isAddingUrl && (
              <div className="flex gap-2 mb-3">
                <input
                  type="url"
                  aria-label="Web image URL"
                  value={imageUrlInput}
                  onChange={(e) => setImageUrlInput(e.target.value)}
                  placeholder="Paste web image URL (https://...)"
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100"
                />
                <button
                  type="button"
                  onClick={handleAddImageUrl}
                  className="px-3 py-1.5 min-h-11 text-xs rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 font-medium"
                >
                  Attach
                </button>
              </div>
            )}

            {images.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {images.map((img, idx) => (
                  <div
                    key={idx}
                    className="relative group w-20 h-20 rounded-lg overflow-hidden border border-stone-200 dark:border-stone-700 bg-stone-100"
                  >
                    <PrivateImage src={img} variant="thumb" loading="lazy" alt="Attachment" className="w-full h-full" />
                    <button
                      type="button"
                      onClick={() => removeImage(idx)}
                      className="absolute inset-0 bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                      aria-label="Remove image"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-stone-400 italic">
                No photos yet. Upload from your camera or paste a web URL — you can also save now and add them later.
              </p>
            )}
          </div>

          {/* 6. More details: everything optional, collapsed by default */}
          <div className="rounded-xl border border-stone-200/70 dark:border-stone-800 overflow-hidden">
            <button
              type="button"
              id="toggle-more-details"
              aria-expanded={showMore}
              onClick={() => setShowMore((prev) => !prev)}
              className="w-full min-h-11 flex items-center justify-between gap-2 px-3.5 py-3 bg-stone-50/70 dark:bg-stone-800/40 hover:bg-stone-100 dark:hover:bg-stone-800/70 transition text-left"
            >
              <span className="font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-violet-500" />
                More details
              </span>
              <span className="flex items-center gap-2 min-w-0">
                {metadataSummary && (
                  <span className="text-xs text-stone-500 dark:text-stone-400 truncate max-w-[10rem] sm:max-w-xs">{metadataSummary}</span>
                )}
                <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform ${showMore ? 'rotate-180' : ''}`} />
              </span>
            </button>

            {showMore && (
              <div className="p-3.5 space-y-5 border-t border-stone-200/70 dark:border-stone-800">
                {/* Milestone flag */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-stone-800 dark:text-stone-200">Mark as a key milestone</span>
                  <button
                    type="button"
                    id="toggle-milestone-button"
                    aria-pressed={isMilestone}
                    onClick={() => setIsMilestone(!isMilestone)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition ${
                      isMilestone
                        ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                        : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400 hover:bg-stone-200'
                    }`}
                  >
                    <Star
                      className={`w-3.5 h-3.5 ${
                        isMilestone ? 'fill-amber-500 text-amber-500' : 'text-stone-400'
                      }`}
                    />
                    {isMilestone ? 'Key Milestone' : 'Mark as Milestone'}
                  </button>
                </div>

                {/* Tags */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                      <Tag className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      Categorize by Tags
                    </span>
                    <span className="text-xs text-stone-500">
                      {selectedTags.length} selected
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-2.5 max-h-28 overflow-y-auto pr-1">
                    {allTagOptions.map((tag) => {
                      const isSelected = selectedTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => toggleTag(tag)}
                          className={`px-3 py-2 min-h-11 rounded-lg text-xs font-medium transition flex items-center gap-1 ${
                            isSelected
                              ? 'bg-amber-600 text-white shadow-xs'
                              : 'bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-200 dark:border-stone-700 hover:border-stone-400'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3" />}
                          {tag}
                        </button>
                      );
                    })}
                  </div>

                  {showNewTagInput ? (
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="text"
                        aria-label="New tag name"
                        value={newTagInput}
                        onChange={(e) => setNewTagInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddNewTag())}
                        placeholder="New tag name..."
                        className="px-3 py-1.5 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-500"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={handleAddNewTag}
                        className="px-3 py-1.5 min-h-11 text-xs rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 font-medium"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel new tag"
                        onClick={() => setShowNewTagInput(false)}
                        className="p-1.5 min-h-11 min-w-11 flex items-center justify-center text-stone-400 hover:text-stone-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      id="create-custom-tag-button"
                      onClick={() => setShowNewTagInput(true)}
                      className="text-xs text-amber-700 dark:text-amber-400 font-medium hover:underline flex items-center gap-1 mt-1 min-h-11"
                    >
                      <Plus className="w-3 h-3" /> Create new custom tag
                    </button>
                  )}
                </div>

                {/* Emotion */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-violet-500" />
                      Emotion & Mood
                    </span>
                    {selectedEmotion && (
                      <button
                        type="button"
                        onClick={() => setSelectedEmotion(undefined)}
                        className="text-xs text-stone-400 hover:text-stone-600"
                      >
                        Clear emotion
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
                    {EMOTIONS.map((emo) => {
                      const isSelected = selectedEmotion === emo.key;
                      return (
                        <button
                          key={emo.key}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setSelectedEmotion(emo.key)}
                          className={`p-2 min-h-11 rounded-xl text-left border transition flex items-center gap-2 ${
                            isSelected
                              ? `${emo.badgeBg} ${emo.borderColor} ring-2 ring-amber-500/20 shadow-xs font-semibold`
                              : 'bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700 hover:border-stone-300 text-stone-700 dark:text-stone-300'
                          }`}
                        >
                          <span className="text-lg">{emo.emoji}</span>
                          <span className="text-xs truncate">{emo.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {selectedEmotion && (
                    <div className="flex items-center gap-3 pt-2 border-t border-stone-200/60 dark:border-stone-700/60">
                      <span className="text-xs text-stone-500 font-medium">Intensity:</span>
                      <div className="flex items-center gap-1.5">
                        {[1, 2, 3, 4, 5].map((level) => (
                          <button
                            key={level}
                            type="button"
                            aria-label={`Intensity ${level}`}
                            aria-pressed={emotionIntensity >= level}
                            onClick={() => setEmotionIntensity(level)}
                            className={`w-11 h-11 rounded-full text-xs font-semibold flex items-center justify-center transition ${
                              emotionIntensity >= level
                                ? 'bg-amber-600 text-white'
                                : 'bg-stone-200 dark:bg-stone-700 text-stone-500 hover:bg-stone-300'
                            }`}
                          >
                            {level}
                          </button>
                        ))}
                      </div>
                      <span className="text-xs text-stone-400 ml-auto">
                        {emotionIntensity === 5 ? 'Profound' : emotionIntensity >= 3 ? 'Strong' : 'Subtle'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Insight */}
                <div className="bg-amber-50/50 dark:bg-amber-950/20 p-3.5 rounded-xl border border-amber-200/60 dark:border-amber-900/40">
                  <label htmlFor="event-idea-input" className="font-semibold text-stone-800 dark:text-stone-200 mb-1 flex items-center gap-1.5">
                    <Lightbulb className="w-4 h-4 text-amber-500 fill-amber-500" />
                    Idea, Key Insight, or Reflection
                  </label>
                  <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">
                    Capture a realization, philosophy, creative idea, or takeaway from this moment.
                  </p>
                  <textarea
                    id="event-idea-input"
                    rows={2}
                    value={idea}
                    onChange={(e) => setIdea(e.target.value)}
                    placeholder="e.g. In quiet moments between meetings, the most creative architectural breakthroughs occur..."
                    className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-amber-200 dark:border-amber-800/80 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  />
                </div>

                {/* Location */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                      <MapPin className="w-4 h-4 text-rose-500" />
                      Location Context
                    </span>
                    <button
                      type="button"
                      id="detect-location-button"
                      onClick={handleDetectLocation}
                      disabled={isLocating}
                      className="text-xs text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white flex items-center gap-1 px-2.5 py-1 rounded-md bg-stone-200/70 dark:bg-stone-700 hover:bg-stone-300 transition"
                    >
                      <Navigation className={`w-3 h-3 ${isLocating ? 'animate-spin' : ''}`} />
                      {isLocating ? 'Detecting...' : 'Use current location'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <input
                        type="text"
                        id="event-location-name"
                        aria-label="Venue or landmark"
                        value={locationName}
                        onChange={(e) => setLocationName(e.target.value)}
                        placeholder="Venue or landmark (e.g. Louvre Museum)"
                        className="w-full px-3 py-2 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        id="event-location-city"
                        aria-label="City"
                        value={locationCity}
                        onChange={(e) => setLocationCity(e.target.value)}
                        placeholder="City (e.g. Paris)"
                        className="w-full px-3 py-2 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        id="event-location-country"
                        aria-label="Country"
                        value={locationCountry}
                        onChange={(e) => setLocationCountry(e.target.value)}
                        placeholder="Country (e.g. France)"
                        className="w-full px-3 py-2 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {draftRestored && !dirty && (
            <p role="status" className="text-xs text-stone-500 dark:text-stone-400">
              Your earlier draft for this memory was restored. It stays only until you save, discard it, or sign out.
            </p>
          )}

          {conflict?.kind === 'comparison' && (
            <MomentConflictPanel
              state={conflict}
              busy={busy}
              onUseLatest={() => useLatestValues(conflict.latest)}
              onKeepMine={() => { void keepMyEdits(conflict.latest); }}
              onDismiss={() => setConflict(null)}
            />
          )}
          {conflict?.kind === 'lost' && (
            <MomentConflictPanel
              state={conflict}
              busy={busy}
              onUseLatest={() => undefined}
              onKeepMine={() => undefined}
              onDismiss={() => setConflict(null)}
            />
          )}

          {saveError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">{saveError} Your changes are preserved; please retry.</p>}
        </form>

        {/* Draft dismissal: one decision boundary for backdrop, Escape, X,
            Cancel and the New-track transition. */}
        {dismissal.asking && (
          <div
            id="draft-dismissal-panel"
            role="alertdialog"
            aria-labelledby="draft-dismissal-title"
            className="border-t border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/30 px-4 sm:px-6 py-4 shrink-0"
          >
            <h3 id="draft-dismissal-title" className="text-sm font-bold text-amber-900 dark:text-amber-200">
              Keep this draft?
            </h3>
            <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5 mb-3">
              You have unsaved changes. A kept draft stays available while you remain signed in on this page; closing the tab or reloading can lose it.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                id="draft-continue-button"
                onClick={dismissal.continueEditing}
                className="px-3.5 py-2 min-h-11 text-xs font-semibold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition"
              >
                Continue editing
              </button>
              <button
                type="button"
                id="draft-keep-button"
                onClick={() => finishDraft(true)}
                className="px-3.5 py-2 min-h-11 text-xs font-semibold rounded-xl border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300 transition"
              >
                Keep draft and close
              </button>
              <button
                type="button"
                id="draft-discard-button"
                onClick={() => finishDraft(false)}
                className="px-3.5 py-2 min-h-11 text-xs font-semibold rounded-xl text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/40 transition"
              >
                Discard changes
              </button>
            </div>
          </div>
        )}

        {/* Footer: a flex sibling of the scroll region, so Save and Cancel are
            always reachable and never overlay the photo grid. pb respects the
            mobile safe area. */}
        <div className="border-t border-stone-200 dark:border-stone-800 bg-white/95 dark:bg-stone-900/95 px-4 sm:px-6 py-3 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-stone-400 dark:text-stone-500 hidden sm:block truncate min-w-0">
              {busy ? (isSaving ? 'Saving…' : 'Preparing photos…') : 'Story and title are enough.'}
            </p>
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                id="cancel-event-button"
                onClick={() => requestDismiss()}
                disabled={busy}
                className="px-5 py-2.5 min-h-11 text-xs font-semibold rounded-xl text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="event-modal-form"
                id="save-event-button"
                disabled={busy}
                className="px-6 py-2.5 min-h-11 text-xs font-semibold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition disabled:opacity-60 inline-flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                {isSaving ? 'Saving…' : isCompressing ? 'Preparing photos…' : eventToEdit ? 'Save Changes' : 'Add to Timeline'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
