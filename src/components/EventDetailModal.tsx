import { motion } from 'motion/react';
import { useOverlayMotion } from './ModalTransition';
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
  Bookmark,
  BookmarkCheck,
} from 'lucide-react';
import { TimelineEvent, EventTrack } from '../types';
import { MomentPerspectives } from './MomentPerspectives';
import { getEmotionMeta } from '../data/emotions';
import { getEventTheme, getEventIconComponent } from '../data/eventThemes';
import { formatDateDisplay, getRelativeTime } from '../lib/storage';
import { usePhotoPrefetch } from '../lib/usePhotoPrefetch';
import { useModalLifecycle } from '../lib/useModalLifecycle';
import { PrivateImage } from './PrivateImage';
import { setReactionState } from '../lib/reactionState';

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
  onToggleReaction: (event: TimelineEvent, emoji: '❤️' | '🥹' | '😂' | '✨' | '🙌' | '🎉', active?: boolean, signal?: AbortSignal) => Promise<void>;
  onCreatePerspective: (event: TimelineEvent, kind: 'perspective' | 'reflection', body: string, clientRequestId: string) => Promise<void>;
  onUpdatePerspective: (id: string, body: string, expectedVersion: number) => Promise<void>;
  onDeletePerspective: (id: string) => Promise<void>;
  sessionGeneration: number;
  currentUserId: string;
  currentUsername: string;
  /** Caller's own save state for this memory, from the server. */
  isSaved: boolean;
  /** 'idle' while settled, 'pending' during the request, 'error' if it failed. */
  saveState: 'idle' | 'pending' | 'error';
  onToggleSave: (event: TimelineEvent) => Promise<void>;
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
  isSaved, saveState, onToggleSave, currentUsername,
}) => {
  const overlayMotion = useOverlayMotion();
  const [imageIndex, setActiveImageIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showActors, setShowActors] = useState(false);
  const reactionClicks = useRef(new Map<string, number>());
  const reactionLocal = useRef(event?.reactions || []);
  reactionLocal.current = event?.reactions || [];
  const reactionCount = useRef(0);
  const [reactionPending, setReactionPending] = useState(false);
  const [reactionError, setReactionError] = useState('');
  const [reactionRetry, setReactionRetry] = useState<{ emoji: NonNullable<TimelineEvent['reactions']>[number]['emoji']; active: boolean } | null>(null);
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
  const reactions = event.reactions || [];
  const persistReaction = async (emoji: NonNullable<TimelineEvent['reactions']>[number]['emoji'], active: boolean) => {
    const sequence = (reactionClicks.current.get(emoji) || 0) + 1;
    reactionClicks.current.set(emoji, sequence);
    reactionLocal.current = setReactionState(reactionLocal.current, emoji, active, currentUsername);
    reactionCount.current += 1;
    setReactionPending(true); setReactionError(''); setReactionRetry(null);
    try { await onToggleReaction(event, emoji, active); }
    catch (failure) {
      if (alive.current && reactionClicks.current.get(emoji) === sequence) {
        setReactionError(failure instanceof Error ? failure.message : 'Could not save your reaction.');
        setReactionRetry({ emoji, active });
      }
    } finally {
      reactionCount.current -= 1;
      if (alive.current) setReactionPending(reactionCount.current > 0);
    }
  };
  const toggleReaction = (emoji: NonNullable<TimelineEvent['reactions']>[number]['emoji']) => persistReaction(emoji, !reactionLocal.current.find(item => item.emoji === emoji)?.selected);
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
    <motion.div {...overlayMotion.backdrop}
      ref={modal} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Memory details"
      id="event-detail-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 backdrop-blur-sm p-3 sm:p-5 overflow-y-auto"
      onClick={requestClose}
    >
      <motion.div {...overlayMotion.panel}
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
            {/* One save control for the caller's own list. It is personal
                bookkeeping: it grants no edit or export right and is invisible
                to the memory's owner and other collaborators. */}
            <button
              type="button"
              id="toggle-save-memory"
              aria-pressed={isSaved}
              aria-label={isSaved ? 'Saved. Activate to remove from Saved' : 'Save for me'}
              aria-busy={saveState === 'pending'}
              disabled={busy || saveState === 'pending'}
              onClick={() => void mutate(() => onToggleSave(event))}
              className={`min-h-11 inline-flex items-center gap-1.5 px-3 rounded-xl text-xs font-semibold border transition disabled:opacity-60 ${
                isSaved
                  ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
                  : 'border-stone-200 text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'
              }`}
            >
              {isSaved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
              {saveState === 'pending' ? 'Saving…' : isSaved ? 'Saved' : 'Save'}
            </button>
            {/* Announced state: a screen-reader user hears the pending and the
                failure without the button having to change size or move. */}
            <span className="sr-only" role="status" aria-live="polite" id="save-memory-status">
              {saveState === 'pending' ? 'Saving your memory' : saveState === 'error' ? 'Could not save. Please retry.' : isSaved ? 'Saved' : ''}
            </span>
            {saveState === 'error' && (
              <p role="alert" className="text-xs text-rose-700 dark:text-rose-300 max-w-[12rem]">
                Could not update Saved. Nothing else changed.
              </p>
            )}
            {canEdit && <>
              <button
                onClick={() => {
                  if (requestClose()) onEdit(event);
                }}
                className="inline-flex items-center justify-center min-h-11 min-w-11 p-2 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition"
                title="Edit event"
              >
                <Edit className="w-4 h-4" />
              </button>
              <button
                disabled={busy || perspectivePending.current}
                onClick={() => { if (!perspectivePending.current && window.confirm(draftDirty.current ? 'Delete this timeline event and discard your unsaved perspective?' : 'Delete this timeline event?')) void mutate(async () => { await onDelete(event); if (alive.current) onClose(); }); }}
                className="inline-flex items-center justify-center min-h-11 min-w-11 p-2 text-stone-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
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
              const reaction = reactions.find((item) => item.emoji === emoji);
              return <button key={emoji} type="button" title={reaction?.usernames?.length ? reaction.usernames.join(', ') : `React ${emoji}`} aria-busy={reactionPending} aria-pressed={!!reaction?.selected} aria-label={`React ${emoji}${reaction?.count ? `, ${reaction.count} reactions` : ''}`} onClick={() => void toggleReaction(emoji)} className={`min-h-11 min-w-11 rounded-full border px-2 text-sm transition ${reaction?.selected ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/30' : 'border-stone-200 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800'}`}>{emoji}{reaction?.count ? <span className="ml-1 text-xs font-semibold">{reaction.count}</span> : null}</button>;
            })}
            <span className="sr-only" role="status" aria-live="polite">{reactionPending ? 'Saving reactions' : ''}</span>
            <button type="button" className="min-h-11 px-2 text-xs underline" onClick={() => setShowActors(!showActors)} aria-expanded={showActors}>Who reacted?</button>
            {reactionError && <div className="flex w-full items-center gap-2 text-xs text-rose-700 dark:text-rose-300" role="alert"><span>{reactionError}</span>{reactionRetry && <button type="button" className="min-h-11 rounded-lg px-3 underline" disabled={reactionPending} onClick={() => void persistReaction(reactionRetry.emoji, reactionRetry.active)}>Retry reaction</button>}</div>}
            {showActors && <ul className="w-full text-xs text-stone-500">{reactions.filter((item) => item.count).map((item) => <li key={item.emoji}>{item.emoji} {item.usernames.join(', ')}</li>)}</ul>}
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
      </motion.div>
    </motion.div>
  );
};
