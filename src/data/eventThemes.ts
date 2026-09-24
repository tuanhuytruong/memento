import React from 'react';
import {
  Cpu,
  Rocket,
  Palette,
  Compass,
  Briefcase,
  Sparkles,
  Heart,
  Flame,
  BookOpen,
  Award,
  Workflow,
  Target,
  Globe,
  Building2,
  Atom,
  LucideIcon,
} from 'lucide-react';

export interface EventThemeConfig {
  colorKey: string;
  label: string;
  bgLight: string;
  bgDark: string;
  textLight: string;
  textDark: string;
  borderLight: string;
  borderDark: string;
  badgeClass: string;
  accentBg: string;
  dotColor: string;
}

export const EVENT_COLORS: Record<string, EventThemeConfig> = {
  indigo: {
    colorKey: 'indigo',
    label: 'Indigo AI',
    bgLight: 'bg-indigo-50',
    bgDark: 'dark:bg-indigo-950/40',
    textLight: 'text-indigo-700',
    textDark: 'dark:text-indigo-300',
    borderLight: 'border-indigo-200',
    borderDark: 'dark:border-indigo-800',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800',
    accentBg: 'bg-indigo-600',
    dotColor: 'bg-indigo-500',
  },
  amber: {
    colorKey: 'amber',
    label: 'Amber Horizon',
    bgLight: 'bg-amber-50',
    bgDark: 'dark:bg-amber-950/40',
    textLight: 'text-amber-700',
    textDark: 'dark:text-amber-300',
    borderLight: 'border-amber-200',
    borderDark: 'dark:border-amber-800',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
    accentBg: 'bg-amber-600',
    dotColor: 'bg-amber-500',
  },
  emerald: {
    colorKey: 'emerald',
    label: 'Emerald Craft',
    bgLight: 'bg-emerald-50',
    bgDark: 'dark:bg-emerald-950/40',
    textLight: 'text-emerald-700',
    textDark: 'dark:text-emerald-300',
    borderLight: 'border-emerald-200',
    borderDark: 'dark:border-emerald-800',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
    accentBg: 'bg-emerald-600',
    dotColor: 'bg-emerald-500',
  },
  rose: {
    colorKey: 'rose',
    label: 'Rose Vitality',
    bgLight: 'bg-rose-50',
    bgDark: 'dark:bg-rose-950/40',
    textLight: 'text-rose-700',
    textDark: 'dark:text-rose-300',
    borderLight: 'border-rose-200',
    borderDark: 'dark:border-rose-800',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800',
    accentBg: 'bg-rose-600',
    dotColor: 'bg-rose-500',
  },
  sky: {
    colorKey: 'sky',
    label: 'Sky Pacific',
    bgLight: 'bg-sky-50',
    bgDark: 'dark:bg-sky-950/40',
    textLight: 'text-sky-700',
    textDark: 'dark:text-sky-300',
    borderLight: 'border-sky-200',
    borderDark: 'dark:border-sky-800',
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800',
    accentBg: 'bg-sky-600',
    dotColor: 'bg-sky-500',
  },
  purple: {
    colorKey: 'purple',
    label: 'Purple Mystique',
    bgLight: 'bg-purple-50',
    bgDark: 'dark:bg-purple-950/40',
    textLight: 'text-purple-700',
    textDark: 'dark:text-purple-300',
    borderLight: 'border-purple-200',
    borderDark: 'dark:border-purple-800',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800',
    accentBg: 'bg-purple-600',
    dotColor: 'bg-purple-500',
  },
  teal: {
    colorKey: 'teal',
    label: 'Teal Wilderness',
    bgLight: 'bg-teal-50',
    bgDark: 'dark:bg-teal-950/40',
    textLight: 'text-teal-700',
    textDark: 'dark:text-teal-300',
    borderLight: 'border-teal-200',
    borderDark: 'dark:border-teal-800',
    badgeClass: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800',
    accentBg: 'bg-teal-600',
    dotColor: 'bg-teal-500',
  },
  orange: {
    colorKey: 'orange',
    label: 'Orange Ignition',
    bgLight: 'bg-orange-50',
    bgDark: 'dark:bg-orange-950/40',
    textLight: 'text-orange-700',
    textDark: 'dark:text-orange-300',
    borderLight: 'border-orange-200',
    borderDark: 'dark:border-orange-800',
    badgeClass: 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-800',
    accentBg: 'bg-orange-600',
    dotColor: 'bg-orange-500',
  },
};

export const AVAILABLE_ICONS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'Cpu', label: 'AI / Tech', icon: Cpu },
  { key: 'Rocket', label: 'Company / Startup', icon: Rocket },
  { key: 'Palette', label: 'Art / Ceramics', icon: Palette },
  { key: 'Compass', label: 'Adventures / Outdoors', icon: Compass },
  { key: 'Briefcase', label: 'Career / Work', icon: Briefcase },
  { key: 'Sparkles', label: 'Inspiration / Life', icon: Sparkles },
  { key: 'Building2', label: 'Enterprise / Real Estate', icon: Building2 },
  { key: 'Flame', label: 'Passion / Sprint', icon: Flame },
  { key: 'Heart', label: 'Family / Wellbeing', icon: Heart },
  { key: 'BookOpen', label: 'Learning / Research', icon: BookOpen },
  { key: 'Award', label: 'Milestone / Honor', icon: Award },
  { key: 'Workflow', label: 'Process / Systems', icon: Workflow },
  { key: 'Target', label: 'Goals / Focus', icon: Target },
  { key: 'Globe', label: 'Travel / Global', icon: Globe },
  { key: 'Atom', label: 'Deep Science', icon: Atom },
];

export const getEventTheme = (colorKey?: string): EventThemeConfig => {
  if (colorKey && EVENT_COLORS[colorKey]) {
    return EVENT_COLORS[colorKey];
  }
  return EVENT_COLORS.indigo;
};

export const getEventIconComponent = (iconKey?: string): LucideIcon => {
  const match = AVAILABLE_ICONS.find((i) => i.key === iconKey);
  return match ? match.icon : Sparkles;
};
