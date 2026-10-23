// One incoming surface, never per-card stagger or layout animation.
export const uiMotion = { press: 0.11, content: 0.16, overlay: 0.2, ease: [0.2, 0, 0, 1] as const };
export function contentMotion(reducedMotion: boolean) {
  return {
    initial: reducedMotion ? false as const : { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: reducedMotion ? 0 : uiMotion.content, ease: uiMotion.ease },
  };
}
