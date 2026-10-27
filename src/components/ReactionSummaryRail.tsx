import type { MemoryReaction } from '../types';
import { reactionSummaryLabel, recentReactorText } from '../lib/reactionPresentation';

interface Props { reactions?: MemoryReaction[]; className?: string; }

/** Read-only feed summary; mutations remain in the detail reaction controls. */
export function ReactionSummaryRail({ reactions, className = '' }: Props) {
  const visible = (reactions ?? []).filter(reaction => reaction.count > 0);
  if (!visible.length) return null;
  return <div aria-label="Reaction summary" className={`relative flex flex-wrap gap-1.5 ${className}`}>
    {visible.map(reaction => {
      const text = recentReactorText(reaction);
      return <span key={reaction.emoji} data-reaction-summary={reaction.emoji} tabIndex={0} aria-label={reactionSummaryLabel(reaction)} className="group/reaction relative inline-flex min-h-8 items-center rounded-full border border-stone-200 bg-white px-2 text-xs font-semibold text-stone-600 shadow-sm outline-none transition hover:border-amber-300 focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
        <span aria-hidden="true">{reaction.emoji}</span><span className="ml-1">{reaction.count}</span>
        {text && <span data-reaction-tooltip role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 hidden w-max max-w-[min(18rem,calc(100vw-2rem))] whitespace-normal break-words rounded-lg bg-stone-900 px-2.5 py-1.5 text-xs font-normal leading-relaxed text-white shadow-lg group-hover/reaction:block group-focus/reaction:block">{text}</span>}
      </span>;
    })}
  </div>;
}
