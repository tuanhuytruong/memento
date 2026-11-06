import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export function usePreviewMotion(enabled: boolean) {
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return enabled && !reduced;
}

export function MotionText({children, active, delay = 0, className = ''}: {children: ReactNode; active: number; delay?: number; className?: string}) {
  return <span key={active} className={`ivora-motion-text ${className}`} style={{animationDelay: `${delay}ms`}}>{children}</span>;
}

export function FeedTransition({children, revision, enabled}: {children: ReactNode; revision: number; enabled: boolean}) {
  return <div key={revision} className={enabled ? 'ivora-feed-transition' : ''}>{children}</div>;
}

export function useExitPresence(open: boolean, enabled: boolean, duration = 160) {
  const [present, setPresent] = useState(open);
  const [exiting, setExiting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useLayoutEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (open) { setPresent(true); setExiting(false); return; }
    if (!present) return;
    if (!enabled) { setPresent(false); setExiting(false); return; }
    setExiting(true);
    timer.current = setTimeout(() => { setPresent(false); setExiting(false); }, duration);
  }, [open, enabled, duration, present]);
  return {present, exiting};
}
