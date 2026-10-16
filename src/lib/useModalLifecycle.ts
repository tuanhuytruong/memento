import { useEffect, useRef } from 'react';

let scrollLocks = 0;
let originalOverflow = '';
const panels: HTMLElement[] = [];

/** Trap keyboard focus only in the topmost dialog, preserve scroll and restore the opener. */
export function useModalLifecycle(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!open || !ref.current) return;
    const panel = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    if (scrollLocks++ === 0) { originalOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    panels.push(panel);
    const focusable = (): HTMLElement[] => (Array.from(panel.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')) as HTMLElement[]).filter((item) => item.getClientRects().length);
    (focusable()[0] || panel).focus();
    const key = (event: KeyboardEvent) => {
      const ordered = [...panels].sort((a, b) => (Number(getComputedStyle(a).zIndex) || 0) - (Number(getComputedStyle(b).zIndex) || 0));
      const top = ordered[ordered.length - 1];
      if (top !== panel) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key === 'Tab') {
        const items = focusable(); const first = items[0]; const last = items[items.length - 1];
        if (!first) { event.preventDefault(); panel.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); const index = panels.indexOf(panel); if (index >= 0) panels.splice(index, 1); if (--scrollLocks === 0) document.body.style.overflow = originalOverflow; if (previous?.isConnected) previous.focus(); };
  }, [open]);
  return ref;
}
