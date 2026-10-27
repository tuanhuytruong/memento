import type { MemoryReaction } from '../types';

/** Bounded, newest-first reactor wording shared by feed and detail reaction UI. */
export function recentReactorText(reaction: Pick<MemoryReaction, 'count' | 'usernames'>): string {
  if (reaction.count <= 0) return '';
  const names = reaction.usernames.slice(0, Math.min(5, reaction.count));
  const overflow = Math.max(0, reaction.count - names.length);
  return [...names, ...(overflow ? [`and ${overflow} more`] : [])].join(', ');
}

export function reactionSummaryLabel(reaction: Pick<MemoryReaction, 'emoji' | 'count' | 'usernames'>): string {
  const reactors = recentReactorText(reaction);
  return reactors ? `${reaction.emoji} ${reaction.count} reactions: ${reactors}` : `${reaction.emoji} ${reaction.count} reactions`;
}
