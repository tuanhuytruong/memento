import { DateRangePicker } from './DateRangePicker';
import React, { useState } from 'react';
import {
  Search,
  SlidersHorizontal,
  X,
  Star,
  ArrowUpDown,
  Calendar,
  Sparkles,
  Bookmark,
  Camera,
  Tag,
} from 'lucide-react';
import type { MomentSortBy } from '../lib/useMomentFeed';
import { FilterState, EmotionKey } from '../types';
import { EMOTIONS } from '../data/emotions';
import { validateDateRange } from '../lib/momentFilters';

interface FilterBarProps {
  filters: FilterState;
  sortBy?: MomentSortBy;
  onSortBy?: (mode: MomentSortBy) => void;
  onFilterChange: (updated: Partial<FilterState>) => void;
  onResetFilters: () => void;
  availableTags: { name: string; count: number }[];
  availableYears: string[];
  searchPending?: boolean;
  onSearchEnter?: () => void;
  onSearchCompositionStart?: () => void;
  onSearchCompositionEnd?: () => void;
  totalFilteredCount: number;
  totalCount: number;
  /** The caller's own saved count, from the server. */
  savedCount: number;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  filters, sortBy = 'date', onSortBy,
  onFilterChange,
  onResetFilters,
  availableTags,
  availableYears,
  totalFilteredCount,
  totalCount,
  savedCount,
  searchPending, onSearchEnter, onSearchCompositionStart, onSearchCompositionEnd,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [forward, reverse] = sortBy === 'relevance' ? ['Top first', 'Quietest first'] : sortBy === 'intensity' ? ['High to low', 'Low to high'] : ['Newest first', 'Oldest first'];

  const activeFiltersCount =
    (filters.search ? 1 : 0) +
    filters.selectedTags.length +
    filters.selectedEmotions.length +
    (filters.selectedYear !== 'all' ? 1 : 0) +
    (filters.dateFrom || filters.dateTo ? 1 : 0) +
    (filters.milestonesOnly ? 1 : 0) +
    (filters.hasImagesOnly ? 1 : 0) +
    (filters.savedOnly ? 1 : 0);
  // Shared with the server query: the same message for the same bad range.
  const rangeError = validateDateRange(filters.dateFrom, filters.dateTo);

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
    <section id="filter-toolbar" className="archival-toolbar" aria-label="Search and filter memories">
      <div className="archival-search-row">
        <div className="archival-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="text"
            id="timeline-search-input"
            aria-label="Search memories"
            value={filters.search}
            onChange={event => onFilterChange({ search: event.target.value })}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) onSearchEnter?.(); }}
            onCompositionStart={onSearchCompositionStart}
            onCompositionEnd={onSearchCompositionEnd}
            placeholder="Search titles, reflections, places, or perspectives..."
          />
          {filters.search && <button type="button" aria-label="Clear search" className="archival-icon-button" onClick={() => onFilterChange({ search: '' })}><X size={16} /></button>}
        </div>
        <div className="archival-quick-filters">
          <button type="button" className="archival-control" aria-pressed={filters.milestonesOnly} onClick={() => onFilterChange({ milestonesOnly: !filters.milestonesOnly })}><Star size={14} /><span>Milestones</span></button>
          <button type="button" id="filter-saved-only" className="archival-control" aria-pressed={filters.savedOnly} onClick={() => onFilterChange({ savedOnly: !filters.savedOnly })}>
            <Bookmark size={14} /><span>Saved</span>
          </button>
          <button type="button" className="archival-control" aria-pressed={filters.hasImagesOnly} onClick={() => onFilterChange({ hasImagesOnly: !filters.hasImagesOnly })}><Camera size={14} /><span>Photos</span></button>
          <button type="button" id="toggle-advanced-filters" className="archival-control" aria-expanded={showAdvanced} aria-controls="archival-filter-panel" onClick={() => setShowAdvanced(value => !value)}>
            <SlidersHorizontal size={14} /><span>Filters</span>{activeFiltersCount > 0 && <small>({activeFiltersCount})</small>}
          </button>
        </div>
      </div>
      <div className="archival-view-row">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Smart sort"><span className="text-xs mr-1">Smart sort</span>{([['date', 'Date'], ['relevance', 'Relevance'], ['intensity', 'Mood intensity']] as const).map(([key, label]) => <button key={key} type="button" className="archival-control" aria-pressed={key === sortBy} onClick={() => onSortBy?.(key)}>{label}</button>)}</div>
        <button
          type="button"
          id="toggle-sort-direction"
          className="archival-control"
          aria-label={filters.sortDirection === 'newest' ? `Sorted ${forward.toLowerCase()}. Activate to sort ${reverse.toLowerCase()}` : `Sorted ${reverse.toLowerCase()}. Activate to sort ${forward.toLowerCase()}`}
          onClick={() => onFilterChange({ sortDirection: filters.sortDirection === 'newest' ? 'oldest' : 'newest' })}
        ><ArrowUpDown size={14} />{filters.sortDirection === 'newest' ? forward : reverse}</button>
      </div>
      {rangeError && <p role="alert" id="filter-range-error" className="text-xs text-rose-700 dark:text-rose-300">{rangeError}</p>}
      {showAdvanced && (
        <div className="archival-filter-panel" id="archival-filter-panel">
          {/* Quick year pills */}
          <div className="archival-year-filters">
            <span className="text-stone-400 font-medium mr-1 shrink-0 flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Year:
            </span>
            <button
              type="button"
              aria-pressed={filters.selectedYear === 'all'}
              onClick={() => onFilterChange({ selectedYear: 'all' })}
              className="archival-control"
            >
              All Years
            </button>
            {availableYears.map((yr) => (
              <button
                key={yr}
                type="button"
                aria-pressed={filters.selectedYear === yr}
                onClick={() => onFilterChange({ selectedYear: yr })}
                className="archival-control"
              >
                {yr}
              </button>
            ))}

            {/* Date range: an optional inclusive local-calendar window. Picking a
                year clears it and vice versa, through one shared rule. */}
            <DateRangePicker dateFrom={filters.dateFrom} dateTo={filters.dateTo} onChange={onFilterChange} />

          </div>

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
                  className="ui-action text-[11px] text-stone-400 hover:text-stone-600"
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
                    className={`ui-action max-w-full break-all px-2.5 py-1 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
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
                  className="ui-action text-[11px] text-stone-400 hover:text-stone-600"
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
                    className={`ui-action max-w-full break-all px-2.5 py-1 rounded-lg text-xs font-medium transition flex items-center gap-1.5 border ${
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
      {(activeFiltersCount > 0 || searchPending) && <div className="archival-filter-status">
        <span role="status" aria-live="polite" aria-busy={searchPending}>{searchPending ? 'Updating memories…' : <><strong>{totalFilteredCount}</strong> of {totalCount} memories match{filters.savedOnly ? ` · ${savedCount} saved in your archive` : ''}</>}</span>
        {activeFiltersCount > 0 && <button type="button" aria-label="Reset all filters" onClick={onResetFilters}><X size={14} />Reset all</button>}
      </div>}
    </section>
  );
};
