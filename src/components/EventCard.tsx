import React from 'react';
import {
  Calendar,
  MapPin,
  Lightbulb,
  Star,
  Edit2,
  Trash2,
  ExternalLink,
  Tag,
  ImageIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import { TimelineEvent, EventTrack } from '../types';
import { getEmotionMeta } from '../data/emotions';
import { getEventTheme, getEventIconComponent } from '../data/eventThemes';
import { formatDateDisplay, getRelativeTime } from '../lib/storage';

interface EventCardProps {
  event: TimelineEvent;
  track?: EventTrack;
  onSelectTrack?: (trackId: string) => void;
  isAlternate?: boolean;
  onViewDetails: (event: TimelineEvent) => void;
  onEdit: (event: TimelineEvent) => void;
  onDelete: (id: string) => Promise<void>;
  onTagClick: (tag: string) => void;
  onOpenImageLightbox: (images: string[], index: number) => void;
}

export const EventCard: React.FC<EventCardProps> = ({
  event,
  track,
  onSelectTrack,
  onViewDetails,
  onEdit,
  onDelete,
  onTagClick,
  onOpenImageLightbox,
}) => {
  const emotionMeta = getEmotionMeta(event.emotion);
  const relativeTime = getRelativeTime(event.date);
  const trackTheme = track ? getEventTheme(track.color) : null;
  const TrackIcon = track ? getEventIconComponent(track.icon) : null;

  const locationLabel = event.location
    ? [event.location.name, event.location.city].filter(Boolean).join(', ')
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="relative flex items-start gap-4 sm:gap-6 group"
    >
      {/* Node Marker on the timeline stem */}
      <div className="relative z-10 flex flex-col items-center mt-1.5 shrink-0">
        <div
          className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border-2 transition-transform duration-300 group-hover:scale-110 shadow-sm ${
            event.isMilestone
              ? 'bg-amber-500 border-amber-300 text-white ring-4 ring-amber-100 dark:ring-amber-950/60'
              : emotionMeta
              ? `${emotionMeta.badgeBg} ${emotionMeta.borderColor} text-stone-800`
              : 'bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-600'
          }`}
        >
          {event.isMilestone ? (
            <Star className="w-4 h-4 fill-white text-white" />
          ) : emotionMeta ? (
            <span className="text-base sm:text-lg leading-none select-none">
              {emotionMeta.emoji}
            </span>
          ) : (
            <Calendar className="w-4 h-4 text-stone-500" />
          )}
        </div>
      </div>

      {/* Main Event Card */}
      <div
        id={`event-card-${event.id}`}
        onClick={() => onViewDetails(event)}
        className={`flex-1 rounded-2xl p-4 sm:p-5 transition-all duration-200 cursor-pointer bg-white dark:bg-stone-900 border ${
          event.isMilestone
            ? 'border-amber-300 dark:border-amber-800/80 shadow-md ring-1 ring-amber-400/20'
            : 'border-stone-200/80 dark:border-stone-800 shadow-xs hover:shadow-md hover:border-stone-300 dark:hover:border-stone-700'
        }`}
      >
        {/* Top bar: Date, Emotion pill, and Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-stone-500" />
              {formatDateDisplay(event.date, event.time)}
            </span>
            {relativeTime && (
              <span className="text-xs text-stone-500 dark:text-stone-400 font-medium">
                ({relativeTime})
              </span>
            )}
            {event.isMilestone && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                Milestone
              </span>
            )}

            {track && trackTheme && TrackIcon && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onSelectTrack) onSelectTrack(track.id);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border transition ${trackTheme.badgeClass} hover:scale-102`}
                title={`View ${track.title} timeline`}
              >
                <TrackIcon className="w-3 h-3" />
                <span>{track.title}</span>
              </button>
            )}
          </div>

          {/* Quick Actions */}
          <div
            className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => onEdit(event)}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition"
              title="Edit event"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                if (window.confirm('Delete this event?')) {
                  onDelete(event.id);
                }
              }}
              className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
              title="Delete event"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Title & Emotion */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="text-base sm:text-lg font-bold font-display text-stone-900 dark:text-stone-100 leading-snug group-hover:text-amber-700 dark:group-hover:text-amber-400 transition-colors">
            {event.title}
          </h3>

          {emotionMeta && (
            <span
              className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${emotionMeta.badgeBg} ${emotionMeta.badgeText} ${emotionMeta.borderColor} border`}
            >
              <span>{emotionMeta.emoji}</span>
              <span>{emotionMeta.label}</span>
              {event.emotionIntensity && (
                <span className="opacity-70 text-[10px]">
                  L{event.emotionIntensity}
                </span>
              )}
            </span>
          )}
        </div>

        {/* Location metadata */}
        {locationLabel && (
          <div className="flex items-center gap-1.5 text-xs text-stone-600 dark:text-stone-400 mb-3">
            <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
            <span className="truncate">{locationLabel}</span>
            {event.location?.country && (
              <span className="text-stone-400">· {event.location.country}</span>
            )}
          </div>
        )}

        {/* Attached image preview (single or multi-thumbnail) */}
        {event.images && event.images.length > 0 && (
          <div
            className="mb-3 rounded-xl overflow-hidden bg-stone-100 dark:bg-stone-800"
            onClick={(e) => {
              e.stopPropagation();
              onOpenImageLightbox(event.images, 0);
            }}
          >
            {event.images.length === 1 ? (
              <div className="relative group/img max-h-60 overflow-hidden">
                <img
                  src={event.images[0]}
                  alt={event.title}
                  className="w-full h-48 sm:h-56 object-cover hover:scale-103 transition-transform duration-500"
                />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5 max-h-40 overflow-hidden p-1">
                {event.images.slice(0, 3).map((img, idx) => (
                  <div
                    key={idx}
                    className="relative h-28 rounded-lg overflow-hidden bg-stone-200 dark:bg-stone-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenImageLightbox(event.images, idx);
                    }}
                  >
                    <img
                      src={img}
                      alt="Thumbnail"
                      className="w-full h-full object-cover hover:scale-105 transition-transform"
                    />
                    {idx === 2 && event.images.length > 3 && (
                      <div className="absolute inset-0 bg-black/60 text-white font-bold text-xs flex items-center justify-center">
                        +{event.images.length - 3} more
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Idea / Insight Callout Banner */}
        {event.idea && (
          <div className="mb-3 p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/40 text-xs">
            <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[11px] text-amber-800 dark:text-amber-400 mb-1">
              <Lightbulb className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
              Idea / Takeaway
            </div>
            <p className="italic text-stone-700 dark:text-stone-300 line-clamp-2">
              "{event.idea}"
            </p>
          </div>
        )}

        {/* Narrative excerpt */}
        {event.description && (
          <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 line-clamp-2 sm:line-clamp-3 mb-3 leading-relaxed">
            {event.description}
          </p>
        )}

        {/* Bottom Tag Categorization Chips */}
        {event.tags && event.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-stone-100 dark:border-stone-800/80">
            {event.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTagClick(tag);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-amber-100 hover:text-amber-900 dark:hover:bg-amber-950/60 dark:hover:text-amber-300 transition"
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
};
