import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { imageUrl, type ImageVariant } from '../lib/imageUrl';

type Props = { src: string; variant: ImageVariant; alt: string; className?: string; loading?: 'lazy' | 'eager'; fit?: 'cover' | 'contain'; onClick?: () => void; onDecoded?: () => void };
/** Remount the request state synchronously on identity change: old events never belong to a new photo. */
export function PrivateImage(props: Props) {
  return <ImageRequest key={`${props.src}\n${props.variant}`} {...props} />;
}
const ImageRequest: React.FC<Props> = ({ src, variant, alt, className = '', loading = 'eager', fit = 'cover', onClick, onDecoded }) => {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decoded = useRef(onDecoded);
  decoded.current = onDecoded;
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current += 1; if (timer.current) clearTimeout(timer.current); }; }, []);
  const retry = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    request.current += 1;
    setLoaded(false); setFailed(false); setAttempt((value) => value + 1);
  };
  const identity = request.current;
  const handleError = () => {
    if (!alive.current || identity !== request.current || timer.current) return;
    // Only private API URLs support a cache-busting automatic retry. External URLs retry by explicit remount only.
    if (attempt === 0 && src.startsWith('/api/images/') && navigator.onLine !== false) {
      timer.current = setTimeout(() => { timer.current = null; if (alive.current && identity === request.current) retry(); }, 500);
    } else setFailed(true);
  };
  if (failed) return <div className={`relative flex min-h-20 items-center justify-center bg-stone-100 text-center text-xs text-stone-500 dark:bg-stone-800 ${className}`}><div><p role="status">Photo unavailable</p><button type="button" onClick={(event) => { event.stopPropagation(); retry(); }} className="mt-1 inline-flex min-h-11 items-center gap-1 rounded-md px-3 font-semibold hover:bg-stone-200 dark:hover:bg-stone-700"><RefreshCw className="h-3 w-3" />Retry photo</button></div></div>;
  return <div className={`relative ${className}`} onClick={onClick}>{!loaded && <div className="absolute inset-0 motion-safe:animate-pulse bg-stone-100 dark:bg-stone-800" aria-hidden="true" />}<img key={attempt} src={imageUrl(src, variant, attempt)} loading={loading} decoding="async" alt={alt} onLoad={async (event) => {
    const image = event.currentTarget;
    try { await image.decode(); } catch { handleError(); return; }
    if (!alive.current || identity !== request.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null; setLoaded(true); decoded.current?.();
  }} onError={handleError} className={`h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'} ${loaded ? 'opacity-100' : 'opacity-0'}`} /></div>;
}
