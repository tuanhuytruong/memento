import type { MemoryReaction } from '../types';
import { setReactionState } from './reactionState';

type Emoji = MemoryReaction['emoji'];
type Intent = { emoji: Emoji; active: boolean; resolve: () => void; reject: (error: unknown) => void };

/** One writer per composite memory. Rebase newer intent on every server snapshot. */
export function createReactionQueue(initial: MemoryReaction[], write: (emoji: Emoji, active: boolean) => Promise<MemoryReaction[]>, publish: (reactions: MemoryReaction[]) => void, valid: () => boolean, username?: string) {
  let confirmed = initial;
  const pending: Intent[] = [];
  let running = false;
  const projection = () => pending.reduce((state, intent) => setReactionState(state, intent.emoji, intent.active, username), confirmed);
  const paint = () => { if (valid()) publish(projection()); };
  const drain = async () => {
    if (running) return;
    running = true;
    try {
      while (pending.length) {
        const intent = pending[0];
        let failure: unknown;
        try {
          if (!valid()) throw new Error('Session changed. Request discarded.');
          confirmed = await write(intent.emoji, intent.active);
          if (!valid()) throw new Error('Session changed. Request result discarded.');
        } catch (error) { failure = error; }
        pending.shift();
        paint();
        if (failure) intent.reject(failure); else intent.resolve();
      }
    } finally { running = false; }
  };
  return {
    enqueue(emoji: Emoji, active?: boolean): Promise<void> {
      const desired = active ?? !projection().find(item => item.emoji === emoji)?.selected;
      const result = new Promise<void>((resolve, reject) => pending.push({ emoji, active: desired, resolve, reject }));
      paint();
      void drain();
      return result;
    },
    get idle() { return !running && pending.length === 0; },
  };
}
