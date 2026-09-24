import { INITIAL_EVENT_TRACKS, INITIAL_EVENTS } from '../data/initialEvents';
import { EventTrack, TimelineEvent } from '../types';

const TRACKS_STORAGE_KEY = 'timeline_event_tracks_v1';
const EVENTS_STORAGE_KEY = 'timeline_moments_v1';
const CUSTOM_TAGS_KEY = 'timeline_custom_tags_v2';

export const loadStoredEventTracks = (): EventTrack[] => {
  try {
    const raw = localStorage.getItem(TRACKS_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(TRACKS_STORAGE_KEY, JSON.stringify(INITIAL_EVENT_TRACKS));
      return INITIAL_EVENT_TRACKS;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return INITIAL_EVENT_TRACKS;
  } catch (err) {
    console.error('Failed to load event tracks from localStorage:', err);
    return INITIAL_EVENT_TRACKS;
  }
};

export const saveStoredEventTracks = (tracks: EventTrack[]): void => {
  try {
    localStorage.setItem(TRACKS_STORAGE_KEY, JSON.stringify(tracks));
  } catch (err) {
    console.error('Failed to save event tracks to localStorage:', err);
  }
};

export const loadStoredEvents = (existingTracks?: EventTrack[]): TimelineEvent[] => {
  try {
    const raw = localStorage.getItem(EVENTS_STORAGE_KEY);
    if (!raw) {
      // Check legacy storage
      const legacyRaw = localStorage.getItem('timeline_events_v2');
      if (legacyRaw) {
        try {
          const legacyParsed = JSON.parse(legacyRaw);
          if (Array.isArray(legacyParsed) && legacyParsed.length > 0) {
            const defaultTrackId = existingTracks?.[0]?.id || 'evt-ai-era';
            const migrated = legacyParsed.map((item: any) => ({
              ...item,
              eventId: item.eventId || defaultTrackId,
            }));
            localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(migrated));
            return migrated;
          }
        } catch {}
      }
      localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(INITIAL_EVENTS));
      return INITIAL_EVENTS;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const defaultTrackId = existingTracks?.[0]?.id || 'evt-ai-era';
      return parsed.map((item: any) => ({
        ...item,
        eventId: item.eventId || defaultTrackId,
      }));
    }
    return INITIAL_EVENTS;
  } catch (err) {
    console.error('Failed to load events from localStorage:', err);
    return INITIAL_EVENTS;
  }
};

export const saveStoredEvents = (events: TimelineEvent[]): void => {
  try {
    localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events));
  } catch (err) {
    console.error('Failed to save events to localStorage:', err);
  }
};

export const loadStoredCustomTags = (): string[] => {
  try {
    const raw = localStorage.getItem(CUSTOM_TAGS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const saveStoredCustomTags = (tags: string[]): void => {
  try {
    localStorage.setItem(CUSTOM_TAGS_KEY, JSON.stringify(tags));
  } catch (err) {
    console.error('Failed to save custom tags:', err);
  }
};

export interface TimelineBackupPayload {
  version: string;
  exportedAt: string;
  eventTracks: EventTrack[];
  events: TimelineEvent[];
  customTags?: string[];
}

export const exportTimelineData = (
  tracks: EventTrack[],
  events: TimelineEvent[],
  tags: string[]
) => {
  const payload: TimelineBackupPayload = {
    version: '2.0',
    exportedAt: new Date().toISOString(),
    eventTracks: tracks,
    events: events,
    customTags: tags,
  };

  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', dataStr);
  const now = new Date().toISOString().split('T')[0];
  downloadAnchor.setAttribute('download', `timeline_events_backup_${now}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
};

export const formatDateDisplay = (dateString: string, timeString?: string): string => {
  try {
    const dateObj = new Date(dateString + 'T00:00:00');
    if (isNaN(dateObj.getTime())) return dateString;

    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    };
    const formattedDate = dateObj.toLocaleDateString('en-US', options);
    if (timeString) {
      return `${formattedDate} · ${timeString}`;
    }
    return formattedDate;
  } catch {
    return dateString;
  }
};

export const getRelativeTime = (dateString: string): string => {
  try {
    const now = new Date();
    const eventDate = new Date(dateString + 'T00:00:00');
    const diffMs = now.getTime() - eventDate.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays === -1) return 'Tomorrow';
    if (diffDays > 1 && diffDays < 7) return `${diffDays} days ago`;
    if (diffDays >= 7 && diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
    }
    if (diffDays >= 30 && diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} ${months === 1 ? 'month' : 'months'} ago`;
    }
    if (diffDays >= 365) {
      const years = Math.floor(diffDays / 365);
      return `${years} ${years === 1 ? 'year' : 'years'} ago`;
    }
    return 'Upcoming';
  } catch {
    return '';
  }
};
