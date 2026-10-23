import { useIsPresent } from 'motion/react';
import { useEffect, useRef } from 'react';

let scrollLocks = 0;
let originalOverflow = '';
const panels: HTMLElement[] = [];
const openers = new WeakMap<HTMLElement, HTMLElement | null>();
let replacementOpener: HTMLElement | null = null;

/** Trap keyboard focus only in the topmost dialog, preserve scroll and restore the opener. */
export function useModalLifecycle(open: boolean, onClose: () => void) {
  const present = useIsPresent();
  const presence = useRef(present); presence.current = present;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.dataset.exiting = String(!present); }, [present]);

  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!open || !ref.current) return;
    const panel = ref.current;
    let previous = replacementOpener || document.activeElement as HTMLElement | null;
    replacementOpener = null;
    const parent = [...panels].reverse().find(item => item.contains(previous));
    // A cold fallback or a closing surface is not a durable opener.
    if (parent && (!parent.isConnected || parent.getAttribute('aria-busy') === 'true' || parent.dataset.exiting === 'true')) previous = openers.get(parent) ?? null;
    openers.set(panel, previous);
    if (scrollLocks++ === 0) { originalOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    panels.push(panel);
    const focusable = (): HTMLElement[] => (Array.from(panel.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')) as HTMLElement[]).filter((item) => item.getClientRects().length);
    (focusable()[0] || panel).focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      const ordered = [...panels].sort((a, b) => (Number(getComputedStyle(a).zIndex) || 0) - (Number(getComputedStyle(b).zIndex) || 0));
      const top = ordered[ordered.length - 1];
      if (top !== panel) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (presence.current) close.current(); }
      if (event.key === 'Tab') {
        const items = focusable(); const first = items[0]; const last = items[items.length - 1];
        if (!first) { event.preventDefault(); panel.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    const block = (event: Event) => { if (!presence.current) { event.preventDefault(); event.stopPropagation(); } };
    for (const type of ['click', 'mousedown', 'pointerdown', 'submit', 'keydown']) panel.addEventListener(type, block, true);
    document.addEventListener('keydown', key);
    return () => { replacementOpener = previous; queueMicrotask(() => { replacementOpener = null; }); for (const type of ['click', 'mousedown', 'pointerdown', 'submit', 'keydown']) panel.removeEventListener(type, block, true); document.removeEventListener('keydown', key); const index = panels.indexOf(panel); if (index >= 0) panels.splice(index, 1); if (--scrollLocks === 0) document.body.style.overflow = originalOverflow; queueMicrotask(() => { const top = panels[panels.length - 1]; if (previous?.isConnected && (!top || top.contains(previous))) previous.focus({ preventScroll: true }); }); };
  }, [open]);
  return ref;
}
