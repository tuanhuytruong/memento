import type { MemoryReaction } from "../types";

/** Return an immutable optimistic projection for the caller's desired reaction state. */
export function setReactionState(reactions: readonly MemoryReaction[] | undefined, emoji: MemoryReaction["emoji"], active: boolean, currentUsername?: string): MemoryReaction[] {
  const current = reactions ?? [];
  const found = current.find((reaction) => reaction.emoji === emoji);
  const count = Math.max(0, (found?.count ?? 0) + (active ? (found?.selected ? 0 : 1) : (found?.selected ? -1 : 0)));
  const next = current.filter((reaction) => reaction.emoji !== emoji).map((reaction) => ({ ...reaction, usernames: [...reaction.usernames] }));
  const usernames = [...new Set(found?.usernames ?? [])];
  if (currentUsername) {
    const withoutCurrent = usernames.filter((name) => name !== currentUsername);
    if (active) withoutCurrent.push(currentUsername);
    usernames.splice(0, usernames.length, ...withoutCurrent);
  }
  if (count > 0 || active) next.push({ emoji, count, usernames, selected: active });
  return next;
}
