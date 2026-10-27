import { useEffect, useRef, useState } from 'react';
import type { TimelineEvent } from '../types';
import { setReactionState } from '../lib/reactionState';
import { reactionSummaryLabel, recentReactorText } from '../lib/reactionPresentation';
export interface ReactionControlProps {
  event: TimelineEvent;
  onToggleReaction: (event: TimelineEvent, emoji: NonNullable<TimelineEvent['reactions']>[number]['emoji'], active?: boolean) => Promise<void>;
  currentUsername?: string;
}
export function ReactionControls({ event, onToggleReaction, currentUsername, className = '' }: ReactionControlProps & { className?: string }) {
  const reactionClicks = useRef(new Map<string, number>());
  const reactionLocal = useRef(event?.reactions || []);
  reactionLocal.current = event?.reactions || [];
  const reactionCount = useRef(0);
  const [reactionPending, setReactionPending] = useState(false);
  const [reactionError, setReactionError] = useState('');
  const [reactionRetry, setReactionRetry] = useState<{ emoji: NonNullable<TimelineEvent['reactions']>[number]['emoji']; active: boolean } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
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
  return (<section aria-label="Reaction controls" data-reaction-controls onClick={e => e.stopPropagation()} className={`flex flex-wrap items-center gap-1.5 ${className}`}>

            {(['❤️', '🥹', '😂', '✨', '🙌', '🎉'] as const).map((emoji) => {
              const reaction = reactions.find((item) => item.emoji === emoji);
              const reactorText = reaction ? recentReactorText(reaction) : '';
              return <button key={emoji} type="button" title={reactorText || `React ${emoji}`} aria-busy={reactionPending} aria-pressed={!!reaction?.selected} aria-label={reaction ? `React ${reactionSummaryLabel(reaction)}` : `React ${emoji}`} onClick={() => void toggleReaction(emoji)} data-reaction-summary={emoji} className={`group/reaction relative ui-action min-h-11 min-w-11 rounded-full border px-2 text-sm transition ${reaction?.selected ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/30' : 'border-stone-200 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800'}`}><span className="reaction-visual"><span className="reaction-glyph">{emoji}</span>{reaction?.count ? <span className="reaction-count ml-1 text-xs font-semibold"><span className="reaction-count-full">{reaction.count}</span><span className="reaction-count-compact" aria-hidden="true">{reaction.count > 99 ? '99+' : reaction.count}</span></span> : null}</span>{reactorText && <span data-reaction-tooltip role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 hidden w-max max-w-[min(18rem,calc(100vw-2rem))] whitespace-normal break-words rounded-lg bg-stone-900 px-2.5 py-1.5 text-xs font-normal leading-relaxed text-white shadow-lg group-hover/reaction:block group-focus/reaction:block">{reactorText}</span>}</button>;
            })}
            <span className="sr-only" role="status" aria-live="polite">{reactionPending ? 'Saving reactions' : ''}</span>
            {reactionError && <div className="flex w-full items-center gap-2 text-xs text-rose-700 dark:text-rose-300" role="alert"><span>{reactionError}</span>{reactionRetry && <button type="button" className="ui-action min-h-11 rounded-lg px-3 underline" disabled={reactionPending} onClick={() => void persistReaction(reactionRetry.emoji, reactionRetry.active)}>Retry reaction</button>}</div>}
          </section>);
}
