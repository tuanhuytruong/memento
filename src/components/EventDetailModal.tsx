import React, { useCallback, useState, useEffect, useRef } from 'react';
import {
  X,
  Calendar,
  Clock,
  MapPin,
  Lightbulb,
  Tag,
  Star,
  Edit,
  Trash2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Maximize2,
} from 'lucide-react';
import { TimelineEvent, EventTrack } from '../types';
import { MomentPerspectives } from './MomentPerspectives';
import { getEmotionMeta } from '../data/emotions';
import { getEventTheme, getEventIconComponent } from '../data/eventThemes';
import { formatDateDisplay, getRelativeTime } from '../lib/storage';
import { usePhotoPrefetch } from '../lib/usePhotoPrefetch';
import { useModalLifecycle } from '../lib/useModalLifecycle';
import { PrivateImage } from './PrivateImage';

interface EventDetailModalProps {
  event: TimelineEvent | null;
  tracks: EventTrack[];
  onSelectTrack?: (track: EventTrack) => void;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (event: TimelineEvent) => void;
  onDelete: (event: TimelineEvent) => Promise<void>;
  onTagClick?: (tag: string) => void;
  onOpenImageLightbox: (images: string[], index: number) => void;
  onToggleReaction: (event: TimelineEvent, emoji: '❤️' | '🥹' | '😂' | '✨' | '🙌' | '🎉') => Promise<void>;
  onCreatePerspective: (event: TimelineEvent, kind: 'perspective' | 'reflection', body: string, clientRequestId: string) => Promise<void>;
  onUpdatePerspective: (id: string, body: string, expectedVersion: number) => Promise<void>;
  onDeletePerspective: (id: string) => Promise<void>;
  sessionGeneration: number;
  currentUserId: string;
}

export const EventDetailModal: React.FC<EventDetailModalProps> = (props) => props.isOpen && props.event ? <DetailBody key={`${props.event.resourceOwnerId || ''}:${props.event.id}`} {...props} /> : null;
const DetailBody: React.FC<EventDetailModalProps> = ({
  event,
  tracks,
  onSelectTrack,
  isOpen,
  onClose,
  onEdit,
  onDelete,
  onTagClick,
  onOpenImageLightbox,
  onToggleReaction,
  onCreatePerspective, onUpdatePerspective, onDeletePerspective, sessionGeneration, currentUserId,
}) => {
  const [imageIndex, setActiveImageIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showActors, setShowActors] = useState(false);
  const draftDirty = useRef(false);
  const [canContribute, setCanContribute] = useState(false);
  const [reflectionSignal, setReflectionSignal] = useState(0);
  const perspectivePending = useRef(false);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const activeImageIndex = Math.max(0, Math.min(imageIndex, (event?.images.length || 1) - 1));
  const onDecoded = usePhotoPrefetch(event?.images || [], activeImageIndex, isOpen);
  const onDraftStateChange = useCallback((dirty: boolean, pending: boolean) => { draftDirty.current = dirty; perspectivePending.current = pending; }, []);
  const confirmDraftDiscard = useCallback(() => { if (perspectivePending.current) return false; return !draftDirty.current || window.confirm('Discard your unsaved perspective?'); }, []);
  const requestClose = useCallback(() => {
    if (!confirmDraftDiscard()) return false;
    onClose();
    return true;
  }, [confirmDraftDiscard, onClose]);
  const modal = useModalLifecycle(isOpen, requestClose);
  const mutate = async (operation: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await operation(); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : 'Request failed. Please retry.'); }
    finally { if (alive.current) { pending.current = false; setBusy(false); } }
  };
  if (!isOpen || !event) return null;
  const emotionMeta = getEmotionMeta(event.emotion);
  const relativeTime = getRelativeTime(event.date);

  const eventTrack = event.eventId ? tracks.find((t) => t.id === event.eventId && t.resourceOwnerId === event.resourceOwnerId) : undefined;
  const canEdit = eventTrack ? (eventTrack.accessRole === 'owner' || eventTrack.accessRole === 'editor') : event.resourceOwnerId === currentUserId;
  const trackTheme = eventTrack ? getEventTheme(eventTrack.color) : null;
  const TrackIcon = eventTrack ? getEventIconComponent(eventTrack.icon) : null;

  // Google maps URL if location is provided
  const locationQuery = event.location
    ? [event.location.name, event.location.city, event.location.country]
        .filter(Boolean)
        .join(', ')
    : '';
  const mapsUrl = locationQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationQuery)}`
    : null;

  return (
    <div
      ref={modal} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Memory details"
      id="event-detail-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 backdrop-blur-sm p-3 sm:p-5 overflow-y-auto"
      onClick={requestClose}
    >
      <div
        id="event-detail-card"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-3xl bg-white dark:bg-stone-900 rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 overflow-hidden my-6 flex flex-col max-h-[92vh]"
      >
        {/* Header bar */}
        <div className="shrink-0 px-4 sm:px-6 py-3 border-b border-stone-100 dark:border-stone-800 flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2 justify-between bg-stone-50/60 dark:bg-stone-900/60">
          <div className="min-w-0 max-w-full flex items-center gap-2 flex-wrap">
            {eventTrack && trackTheme && TrackIcon && (
              <button
                type="button"
                onClick={() => {
                  if (requestClose() && onSelectTrack) onSelectTrack(eventTrack);
                }}
                className={`max-w-full min-w-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition ${trackTheme.badgeClass} hover:opacity-80`}
                title={`Filter to ${eventTrack.title} timeline`}
              >
                <TrackIcon className="w-3.5 h-3.5" />
                <span className="min-w-0 truncate">{eventTrack.title}</span>
              </button>
            )}
            {event.isMilestone && (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                Key Milestone
              </span>
            )}
            <span className="text-xs text-stone-500 font-medium">
              {relativeTime}
            </span>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2">
            {canEdit && <>
              <button
                onClick={() => {
                  if (requestClose()) onEdit(event);
                }}
                className="min-h-11 min-w-11 p-2 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition"
                title="Edit event"
              >
                <Edit className="w-4 h-4" />
              </button>
              <button
                disabled={busy || perspectivePending.current}
                onClick={() => { if (!perspectivePending.current && window.confirm(draftDirty.current ? 'Delete this timeline event and discard your unsaved perspective?' : 'Delete this timeline event?')) void mutate(async () => { await onDelete(event); if (alive.current) onClose(); }); }}
                className="min-h-11 min-w-11 p-2 text-stone-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                title="Delete event"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>}
            <button
              onClick={requestClose}
              aria-label="Close memory details"
              className="min-h-11 min-w-11 p-2 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable details */}
        <div className="min-h-0 break-words p-4 sm:p-8 overflow-y-auto space-y-6">
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          {/* Main Title & Date */}
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold font-display text-stone-900 dark:text-stone-100 leading-tight">
              {event.title}
            </h1>
            <div className="flex flex-wrap items-center gap-y-2 gap-x-4 mt-2 text-xs sm:text-sm text-stone-600 dark:text-stone-400">
              <span className="flex items-center gap-1.5 font-medium">
                <Calendar className="w-4 h-4 text-stone-500" />
                {formatDateDisplay(event.date, event.time)}
              </span>

              {event.location && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-rose-500" />
                  {event.location.name}
                  {event.location.city && `, ${event.location.city}`}
                  {event.location.country && `, ${event.location.country}`}
                  {mapsUrl && (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-stone-400 hover:text-amber-600 inline-flex items-center ml-0.5"
                      title="View on Map"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Emotion & Mood Indicator */}
          {emotionMeta && (
            <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl border text-xs sm:text-sm font-medium bg-stone-50/80 dark:bg-stone-800/60 border-stone-200/80 dark:border-stone-700">
              <span className="text-lg">{emotionMeta.emoji}</span>
              <div>
                <span className="font-semibold text-stone-900 dark:text-stone-100">
                  {emotionMeta.label}
                </span>
                <span className="text-stone-500 text-xs ml-1.5 hidden sm:inline">
                  — {emotionMeta.description}
                </span>
              </div>
              {event.emotionIntensity && (
                <span className="text-[11px] px-2 py-0.5 rounded-md bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-300 font-semibold ml-1">
                  Level {event.emotionIntensity}/5
                </span>
              )}
            </div>
          )}

          {/* Image carousel / display if attached */}
          {event.images && event.images.length > 0 && (
            <div className="space-y-2">
              <div className="relative group rounded-2xl overflow-hidden bg-stone-100 dark:bg-stone-800 max-h-[420px] flex items-center justify-center border border-stone-200 dark:border-stone-700">
                <PrivateImage src={event.images[activeImageIndex] || event.images[0]} variant="display" onDecoded={onDecoded} fit="contain" alt={event.title} className="h-[min(56vh,420px)] w-full cursor-pointer hover:opacity-95 transition" onClick={() => onOpenImageLightbox(event.images, activeImageIndex)} />
                <button
                  onClick={() => onOpenImageLightbox(event.images, activeImageIndex)}
                  className="absolute min-h-11 min-w-11 bottom-3 right-3 p-2 rounded-lg bg-black/60 text-white hover:bg-black/80 transition"
                  title="Enlarge photo"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>

                {event.images.length > 1 && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveImageIndex((prev) => (prev > 0 ? prev - 1 : event.images.length - 1));
                      }}
                      aria-label="Previous detail photo"
                      className="absolute min-h-11 min-w-11 left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveImageIndex((prev) => (prev < event.images.length - 1 ? prev + 1 : 0));
                      }}
                      aria-label="Next detail photo"
                      className="absolute min-h-11 min-w-11 right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>

              {event.images.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {event.images.map((img, idx) => (
                    <button
                      key={img}
                      aria-label={`Select detail photo ${idx + 1}`}
                      onClick={() => setActiveImageIndex(idx)}
                      className={`w-16 h-16 rounded-lg overflow-hidden border-2 shrink-0 transition ${
                        activeImageIndex === idx
                          ? 'border-amber-500 scale-102'
                          : 'border-transparent opacity-60 hover:opacity-100'
                      }`}
                    >
                      <PrivateImage src={img} variant="thumb" loading="lazy" alt="Thumbnail" className="h-full" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <section className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-4 dark:border-stone-800">
            <span className="mr-1 text-xs font-semibold text-stone-500">React</span>
            {(['❤️', '🥹', '😂', '✨', '🙌', '🎉'] as const).map((emoji) => {
              const reaction = event.reactions?.find((item) => item.emoji === emoji);
              return <button key={emoji} type="button" title={reaction?.usernames?.length ? reaction.usernames.join(', ') : `React ${emoji}`} disabled={busy} aria-pressed={!!reaction?.selected} aria-label={`React ${emoji}${reaction?.count ? `, ${reaction.count} reactions` : ''}`} onClick={() => void mutate(() => onToggleReaction(event, emoji))} className={`min-h-11 min-w-11 disabled:opacity-50 rounded-full border px-2 text-sm transition ${reaction?.selected ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/30' : 'border-stone-200 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800'}`}>{emoji}{reaction?.count ? <span className="ml-1 text-xs font-semibold">{reaction.count}</span> : null}</button>;
            })}
            <button type="button" className="min-h-11 px-2 text-xs underline" onClick={() => setShowActors(!showActors)} aria-expanded={showActors}>Who reacted?</button>
            {showActors && <ul className="w-full text-xs text-stone-500">{event.reactions?.filter((item) => item.count).map((item) => <li key={item.emoji}>{item.emoji} {item.usernames.join(', ')}</li>)}</ul>}
          </section>

          {/* Dedicated Idea / Key Takeaway Card */}
          {event.idea && (
            <div className="p-4 sm:p-5 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60">
              <div className="flex items-center gap-2 mb-1.5 text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-400">
                <Lightbulb className="w-4 h-4 fill-amber-500 text-amber-500" />
                Key Idea & Takeaway
              </div>
              <p className="text-sm sm:text-base italic text-stone-800 dark:text-stone-200 leading-relaxed font-serif">
                "{event.idea}"
              </p>
            </div>
          )}

          {/* Full Narrative / Description */}
          {event.description && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400">
                Story & Notes
              </h3>
              <p className="text-stone-800 dark:text-stone-200 leading-relaxed whitespace-pre-line text-sm sm:text-base">
                {event.description}
              </p>
            </div>
          )}

          {canContribute && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/20">
              <p className="min-w-0 text-xs text-stone-600 dark:text-stone-300">Remember this moment from today's distance.</p>
              <button
                type="button"
                onClick={() => setReflectionSignal(value => value + 1)}
                className="min-h-11 shrink-0 rounded-lg border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-stone-900 dark:text-amber-300 dark:hover:bg-stone-800"
              >
                Bây giờ nghĩ lại…
              </button>
            </div>
          )}

          <MomentPerspectives
            event={event}
            currentUserId={currentUserId}
            onCreate={(kind, body, requestId) => onCreatePerspective(event, kind, body, requestId)}
            onUpdate={onUpdatePerspective}
            onDelete={onDeletePerspective}
            onDraftStateChange={onDraftStateChange}
            onWriteCapabilityChange={setCanContribute}
            reflectionSignal={reflectionSignal}
          />

          {/* Tag Categorization Badges */}
          <div className="pt-4 border-t border-stone-100 dark:border-stone-800 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-stone-400 mr-1 flex items-center gap-1">
              <Tag className="w-3.5 h-3.5" /> Tags:
            </span>
            {event.tags.map((tag) => (
              <button
                key={tag}
                onClick={() => {
                  if (onTagClick) {
                    if (requestClose()) onTagClick(tag);
                  }
                }}
                className="max-w-full break-all px-3 py-1 rounded-lg text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-amber-100 dark:hover:bg-amber-950/60 hover:text-amber-900 transition"
              >
                #{tag}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
