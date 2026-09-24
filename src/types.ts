export type EmotionKey =
  | 'joyful'
  | 'grateful'
  | 'inspired'
  | 'excited'
  | 'serene'
  | 'reflective'
  | 'focused'
  | 'challenged'
  | 'nostalgic'
  | 'proud';

export interface EmotionOption {
  key: EmotionKey;
  label: string;
  emoji: string;
  color: string; // Tailwind color class or hex
  badgeBg: string;
  badgeText: string;
  borderColor: string;
  description: string;
}

export interface LocationMetadata {
  name: string;
  city?: string;
  country?: string;
  lat?: number;
  lng?: number;
}

export interface EventTrack {
  id: string;
  title: string; // e.g. "AI Era", "New Company"
  description: string;
  color: string; // 'indigo' | 'amber' | 'emerald' | 'rose' | 'sky' | 'purple' | 'teal'
  icon: string; // e.g. 'Cpu', 'Rocket', 'Palette', 'Compass', 'Briefcase', 'Heart', 'Sparkles'
  tags: string[];
  status?: 'active' | 'completed' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEvent {
  id: string;
  eventId: string; // ID of the parent EventTrack (e.g. 'ai-era', 'new-company')
  title: string;
  date: string; // YYYY-MM-DD or ISO timestamp
  time?: string; // HH:mm
  description: string;
  tags: string[];
  images: string[];
  emotion?: EmotionKey;
  emotionIntensity?: number; // 1 to 5
  idea?: string; // Key insight, reflection, or breakthrough
  location?: LocationMetadata;
  isMilestone?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ViewMode = 'timeline' | 'compact' | 'gallery';

export interface FilterState {
  search: string;
  selectedEventId: string; // 'all' or specific event track id
  selectedTags: string[];
  selectedEmotions: EmotionKey[];
  selectedYear: string; // 'all' or '2026', '2025', etc.
  milestonesOnly: boolean;
  hasImagesOnly: boolean;
  sortDirection: 'newest' | 'oldest';
}
