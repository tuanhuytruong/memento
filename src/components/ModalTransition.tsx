import React, { Suspense, useEffect, useState } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import type { HTMLMotionProps } from 'motion/react';
import { uiMotion } from '../lib/uiMotion';
import { useModalLifecycle } from '../lib/useModalLifecycle';

/** Own presence above the conditional: exiting children keep their last props/state.
 * The account-generation keyed ancestor must remain outside this boundary. */
export function ModalTransition({ children }: { children: React.ReactNode }) {
  const onClose = React.isValidElement<{ onClose?: () => void }>(children) ? children.props.onClose : undefined;
  const reduced = useReducedMotion();
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (children) return;
    // A lazy child can resolve after close and register a fresh motion node in
    // an already exiting Suspense tree. Bound that late registration too.
    const timer = setTimeout(() => setEpoch(value => value + 1), reduced ? 0 : uiMotion.overlay * 1000 + 50);
    return () => clearTimeout(timer);
  }, [Boolean(children), reduced]);
  return <AnimatePresence key={epoch}>{children && <motion.div key="surface" style={{ display: 'contents' }} exit={{ opacity: 1 }} transition={{ duration: reduced ? 0 : uiMotion.overlay }}><Suspense fallback={<OpeningModal onClose={onClose} />}>{children}</Suspense></motion.div>}</AnimatePresence>;
}
export function useOverlayMotion() {
  const reduced = useReducedMotion();
  const transition = { duration: reduced ? 0 : uiMotion.overlay, ease: uiMotion.ease };
  return {
    backdrop: { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition },
    panel: { initial: { opacity: 0, y: reduced ? 0 : 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: reduced ? 0 : 6 }, transition },
  };
}
export function PopupPanel(props: HTMLMotionProps<'div'>) {
  const present = useIsPresent();
  return <motion.div {...props} inert={!present} />;
}
export function OpeningModal({ onClose }: { onClose?: () => void }) {
  const panel = useModalLifecycle(true, () => onClose?.());
  return <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Opening dialog" aria-busy="true" className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-950/50 p-4">
    <section className="w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-6 shadow-xl dark:border-stone-700 dark:bg-stone-900"><h2 className="font-display text-lg font-semibold">Memento</h2><p role="status" className="mt-3 text-sm text-stone-500">Opening…</p></section>
  </div>;
}
