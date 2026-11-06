// One incoming surface only: no per-card layout motion, exit-before-enter, or queued stagger.
export const uiMotion = { press: 0.12, content: 0.18, overlay: 0.18, ease: [0.2, 0, 0, 1] as const };
export function contentMotion(reducedMotion: boolean) {
  return {
    initial: reducedMotion ? false as const : { opacity: 0, y: 5 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reducedMotion ? 0 : uiMotion.content, ease: uiMotion.ease },
  };
}
