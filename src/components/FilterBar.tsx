import React, { useState } from 'react';
import {
  Search,
  SlidersHorizontal,
  X,
  Star,
  Image as ImageIcon,
  ArrowUpDown,
  Calendar,
  Sparkles,
  Tag,
  LayoutList,
  Columns,
  GalleryThumbnails,
} from 'lucide-react';
import { FilterState, ViewMode, EmotionKey } from '../types';
import { EMOTIONS } from '../data/emotions';

interface FilterBarProps {
  filters: FilterState;
  onFilterChange: (updated: Partial<FilterState>) => void;
  onResetFilters: () => void;
  availableTags: { name: string; count: number }[];
  availableYears: string[];
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  totalFilteredCount: number;
  totalCount: number;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  onFilterChange,
  onResetFilters,
  availableTags,
  availableYears,
  viewMode,
  onViewModeChange,
  totalFilteredCount,
  totalCount,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const activeFiltersCount =
    (filters.search ? 1 : 0) +
    filters.selectedTags.length +
    filters.selectedEmotions.length +
    (filters.selectedYear !== 'all' ? 1 : 0) +
    (filters.milestonesOnly ? 1 : 0) +
    (filters.hasImagesOnly ? 1 : 0);

  const toggleTag = (tag: string) => {
    if (filters.selectedTags.includes(tag)) {
      onFilterChange({ selectedTags: filters.selectedTags.filter((t) => t !== tag) });
    } else {
      onFilterChange({ selectedTags: [...filters.selectedTags, tag] });
    }
  };

  const toggleEmotion = (emotion: EmotionKey) => {
    if (filters.selectedEmotions.includes(emotion)) {
      onFilterChange({
        selectedEmotions: filters.selectedEmotions.filter((e) => e !== emotion),
      });
    } else {
      onFilterChange({
        selectedEmotions: [...filters.selectedEmotions, emotion],
      });
    }
  };

  return (
    <div
      id="filter-toolbar"
      className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200/80 dark:border-stone-800 shadow-xs p-4 sm:p-5 space-y-4"
    >
      {/* Top row: Search input + View Switcher + Sort */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 justify-between">
        {/* Search input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            id="timeline-search-input"
            value={filters.search}
            onChange={(e) => onFilterChange({ search: e.target.value })}
            placeholder="Search events, ideas, emotions, cities, or stories..."
            className="w-full pl-9 pr-8 py-2 rounded-xl text-xs sm:text-sm border border-stone-200 dark:border-stone-700 bg-stone-50/50 dark:bg-stone-800 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition"
          />
          {filters.search && (
            <button
              onClick={() => onFilterChange({ search: '' })}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* View Mode Switcher + Sort + Advanced Toggle */}
        <div className="flex items-center gap-2 justify-between sm:justify-end">
          {/* View toggle tabs */}
          <div className="flex items-center p-1 rounded-xl bg-stone-100 dark:bg-stone-800 border border-stone-200/60 dark:border-stone-700">
            <button
              id="view-timeline-btn"
              onClick={() => onViewModeChange('timeline')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                viewMode === 'timeline'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
              }`}
              title="Timeline View"
            >
              <LayoutList className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Timeline</span>
            </button>

            <button
              id="view-compact-btn"
              onClick={() => onViewModeChange('compact')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                viewMode === 'compact'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
              }`}
              title="Compact Table List"
            >
              <Columns className="w-3.5 h-3.5" />
              <span className="hidden md:inline">List</span>
            </button>

            <button
              id="view-gallery-btn"
              onClick={() => onViewModeChange('gallery')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                viewMode === 'gallery'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
              }`}
              title="Gallery Grid"
            >
              <GalleryThumbnails className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Cards</span>
            </button>
          </div>

          {/* Sort Direction Toggle */}
          <button
            id="toggle-sort-direction"
            onClick={() =>
              onFilterChange({
                sortDirection: filters.sortDirection === 'newest' ? 'oldest' : 'newest',
              })
            }
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:border-stone-300"
            title="Sort direction"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-stone-500" />
            <span className="hidden sm:inline">
              {filters.sortDirection === 'newest' ? 'Newest first' : 'Oldest first'}
            </span>
          </button>

          {/* More Filters Toggle */}
          <button
            id="toggle-advanced-filters"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={`flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium transition ${
              showAdvanced || activeFiltersCount > 0
                ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                : 'border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:border-stone-300'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Filters</span>
            {activeFiltersCount > 0 && (
              <span className="ml-1 w-4 h-4 rounded-full bg-amber-600 text-white text-[10px] flex items-center justify-center font-bold">
                {activeFiltersCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Quick year pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
        <span className="text-stone-400 font-medium mr-1 shrink-0 flex items-center gap-1">
          <Calendar className="w-3 h-3" /> Year:
        </span>
        <button
          onClick={() => onFilterChange({ selectedYear: 'all' })}
          className={`px-3 py-1 rounded-full font-medium transition shrink-0 ${
            filters.selectedYear === 'all'
              ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
              : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200'
          }`}
        >
          All Years
        </button>
        {availableYears.map((yr) => (
          <button
            key={yr}
            onClick={() => onFilterChange({ selectedYear: yr })}
            className={`px-3 py-1 rounded-full font-medium transition shrink-0 ${
              filters.selectedYear === yr
                ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200'
            }`}
          >
            {yr}
          </button>
        ))}

        {/* Quick toggle chips */}
        <div className="h-4 w-px bg-stone-200 dark:bg-stone-700 mx-1 shrink-0" />

        <button
          onClick={() => onFilterChange({ milestonesOnly: !filters.milestonesOnly })}
          className={`px-3 py-1 rounded-full font-medium transition flex items-center gap-1 shrink-0 ${
            filters.milestonesOnly
              ? 'bg-amber-500 text-white shadow-xs'
              : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200'
          }`}
        >
          <Star className="w-3 h-3 fill-current" /> Milestones
        </button>

        <button
          onClick={() => onFilterChange({ hasImagesOnly: !filters.hasImagesOnly })}
          className={`px-3 py-1 rounded-full font-medium transition flex items-center gap-1 shrink-0 ${
            filters.hasImagesOnly
              ? 'bg-sky-600 text-white shadow-xs'
              : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200'
          }`}
        >
          <ImageIcon className="w-3 h-3" /> With Photos
        </button>

        {activeFiltersCount > 0 && (
          <button
            onClick={onResetFilters}
            className="text-stone-500 hover:text-rose-600 text-xs ml-auto shrink-0 flex items-center gap-1 hover:underline"
          >
            <X className="w-3 h-3" /> Reset all
          </button>
        )}
      </div>

      {/* Advanced Tag & Emotion Filters drawer */}
      {showAdvanced && (
        <div className="pt-3 border-t border-stone-100 dark:border-stone-800 space-y-3.5">
          {/* Tag Categorization selector */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-stone-700 dark:text-stone-300 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                Filter by Tags
              </span>
              {filters.selectedTags.length > 0 && (
                <button
                  onClick={() => onFilterChange({ selectedTags: [] })}
                  className="text-[11px] text-stone-400 hover:text-stone-600"
                >
                  Clear tags
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
              {availableTags.map((tagObj) => {
                const isSelected = filters.selectedTags.includes(tagObj.name);
                return (
                  <button
                    key={tagObj.name}
                    onClick={() => toggleTag(tagObj.name)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700'
                    }`}
                  >
                    <span>#{tagObj.name}</span>
                    <span
                      className={`text-[10px] px-1 rounded-full ${
                        isSelected
                          ? 'bg-amber-700 text-white'
                          : 'bg-stone-200 dark:bg-stone-700 text-stone-500'
                      }`}
                    >
                      {tagObj.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Emotion filter pills */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-stone-700 dark:text-stone-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                Filter by Emotion
              </span>
              {filters.selectedEmotions.length > 0 && (
                <button
                  onClick={() => onFilterChange({ selectedEmotions: [] })}
                  className="text-[11px] text-stone-400 hover:text-stone-600"
                >
                  Clear emotions
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {EMOTIONS.map((emo) => {
                const isSelected = filters.selectedEmotions.includes(emo.key);
                return (
                  <button
                    key={emo.key}
                    onClick={() => toggleEmotion(emo.key)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition flex items-center gap-1.5 border ${
                      isSelected
                        ? `${emo.badgeBg} ${emo.badgeText} ${emo.borderColor} shadow-xs font-semibold`
                        : 'bg-stone-50 dark:bg-stone-800/60 border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:border-stone-300'
                    }`}
                  >
                    <span>{emo.emoji}</span>
                    <span>{emo.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Filter status summary */}
      <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400 pt-1">
        <span>
          Showing <strong className="text-stone-900 dark:text-stone-100">{totalFilteredCount}</strong> of{' '}
          {totalCount} events
        </span>
        {activeFiltersCount > 0 && (
          <span className="text-amber-700 dark:text-amber-400 font-medium">
            Active filters applied
          </span>
        )}
      </div>
    </div>
  );
};
