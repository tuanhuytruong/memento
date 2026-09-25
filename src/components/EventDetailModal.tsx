import React, { useState } from 'react';
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
import { getEmotionMeta } from '../data/emotions';
import { getEventTheme, getEventIconComponent } from '../data/eventThemes';
import { formatDateDisplay, getRelativeTime } from '../lib/storage';

interface EventDetailModalProps {
  event: TimelineEvent | null;
  tracks: EventTrack[];
  onSelectTrack?: (trackId: string) => void;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (event: TimelineEvent) => void;
  onDelete: (id: string) => Promise<void>;
  onTagClick?: (tag: string) => void;
  onOpenImageLightbox: (images: string[], index: number) => void;
}

export const EventDetailModal: React.FC<EventDetailModalProps> = ({
  event,
  tracks,
  onSelectTrack,
  isOpen,
  onClose,
  onEdit,
  onDelete,
  onTagClick,
  onOpenImageLightbox,
}) => {
  if (!isOpen || !event) return null;

  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const emotionMeta = getEmotionMeta(event.emotion);
  const relativeTime = getRelativeTime(event.date);

  const eventTrack = event.eventId ? tracks.find((t) => t.id === event.eventId) : undefined;
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
      id="event-detail-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 backdrop-blur-sm p-3 sm:p-5 overflow-y-auto"
      onClick={onClose}
    >
      <div
        id="event-detail-card"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-3xl bg-white dark:bg-stone-900 rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 overflow-hidden my-6 flex flex-col max-h-[92vh]"
      >
        {/* Header bar */}
        <div className="px-6 py-4 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between bg-stone-50/60 dark:bg-stone-900/60">
          <div className="flex items-center gap-2 flex-wrap">
            {eventTrack && trackTheme && TrackIcon && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (onSelectTrack) onSelectTrack(eventTrack.id);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition ${trackTheme.badgeClass} hover:opacity-80`}
                title={`Filter to ${eventTrack.title} timeline`}
              >
                <TrackIcon className="w-3.5 h-3.5" />
                <span>{eventTrack.title}</span>
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

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onClose();
                onEdit(event);
              }}
              className="p-2 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition"
              title="Edit event"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                if (window.confirm('Delete this timeline event?')) {
                  onDelete(event.id);
                  onClose();
                }
              }}
              className="p-2 text-stone-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
              title="Delete event"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable details */}
        <div className="p-6 sm:p-8 overflow-y-auto space-y-6">
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
                <img
                  src={event.images[activeImageIndex] || event.images[0]}
                  alt={event.title}
                  className="w-full h-full max-h-[420px] object-cover cursor-pointer hover:opacity-95 transition"
                  onClick={() => onOpenImageLightbox(event.images, activeImageIndex)}
                />
                <button
                  onClick={() => onOpenImageLightbox(event.images, activeImageIndex)}
                  className="absolute bottom-3 right-3 p-2 rounded-lg bg-black/60 text-white hover:bg-black/80 transition"
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
                      className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveImageIndex((prev) => (prev < event.images.length - 1 ? prev + 1 : 0));
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition"
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
                      key={idx}
                      onClick={() => setActiveImageIndex(idx)}
                      className={`w-16 h-16 rounded-lg overflow-hidden border-2 shrink-0 transition ${
                        activeImageIndex === idx
                          ? 'border-amber-500 scale-102'
                          : 'border-transparent opacity-60 hover:opacity-100'
                      }`}
                    >
                      <img src={img} alt="Thumbnail" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

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
                    onClose();
                    onTagClick(tag);
                  }
                }}
                className="px-3 py-1 rounded-lg text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-amber-100 dark:hover:bg-amber-950/60 hover:text-amber-900 transition"
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
