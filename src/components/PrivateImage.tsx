import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { imageUrl, type ImageVariant } from '../lib/imageUrl';
import { getImageCacheOwner, purgeCachedImage, readCachedImage, writeCachedImage } from '../lib/imageCache';

type Props = {
  src: string;
  variant: ImageVariant;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  fit?: 'cover' | 'contain';
  onClick?: () => void;
  onDecoded?: () => void;
  /** A local blob URL for a photo the server has not acknowledged yet. */
  localSrc?: string;
};
/** Remount the request state synchronously on identity change: old events never belong to a new photo. */
export function PrivateImage(props: Props) {
  return <ImageRequest key={`${props.src}\n${props.variant}`} {...props} />;
}

function imageIdFromSrc(src: string): string | null {
  if (!src.startsWith('/api/images/')) return null;
  const [path] = src.split('?', 1);
  const id = path.slice('/api/images/'.length);
  return id && !id.includes('/') ? id : null;
}

const ImageRequest: React.FC<Props> = ({ src, variant, alt, className = '', loading = 'eager', fit = 'cover', onClick, onDecoded, localSrc }) => {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const alive = useRef(true);
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decoded = useRef(onDecoded);
  decoded.current = onDecoded;
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current += 1; if (timer.current) clearTimeout(timer.current); }; }, []);
  useEffect(() => {
    if (!objectUrl) return;
    return () => URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);
  const retry = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    request.current += 1;
    setLoaded(false); setFailed(false); setObjectUrl(null); setAttempt((value) => value + 1);
  };
  const identity = request.current;
  const handleError = () => {
    if (!alive.current || identity !== request.current || timer.current) return;
    // Only private API URLs support a cache-busting automatic retry. External URLs retry by explicit remount only.
    if (attempt === 0 && src.startsWith('/api/images/') && navigator.onLine !== false) {
      timer.current = setTimeout(() => { timer.current = null; if (alive.current && identity === request.current) retry(); }, 500);
    } else setFailed(true);
  };

  // Thumb and display variants are read through the 24h local cache first: a repeat
  // view costs no request, and a denial drops the entry instead of serving stale bytes.
  const cacheable = !localSrc && (variant === 'thumb' || variant === 'display') && imageIdFromSrc(src) !== null;
  useEffect(() => {
    if (!cacheable) return;
    const owner = getImageCacheOwner();
    const imageId = imageIdFromSrc(src);
    if (!owner || !imageId) return;
    let cancelled = false;
    const load = async () => {
      const cached = await readCachedImage(owner, imageId, variant);
      if (cancelled) return;
      if (cached) {
        request.current += 1;
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        setObjectUrl(URL.createObjectURL(cached));
        setLoaded(true);
        setFailed(false);
        decoded.current?.();
        return;
      }
      try {
        const response = await fetch(imageUrl(src, variant, 0), { credentials: 'same-origin' });
        if (cancelled) return;
        if (response.status === 401 || response.status === 403) {
          void purgeCachedImage(owner, imageId, variant);
          setFailed(true);
          return;
        }
        if (!response.ok) { handleError(); return; }
        const blob = await response.blob();
        if (!blob.size) { handleError(); return; }
        void writeCachedImage(owner, imageId, variant, blob);
        request.current += 1;
        setObjectUrl(URL.createObjectURL(blob));
        setLoaded(true);
        setFailed(false);
        decoded.current?.();
      } catch {
        if (!cancelled) handleError();
      }
    };
    void load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheable, src, variant, attempt]);

  const effectiveSrc = localSrc ?? objectUrl;
  if (failed && !localSrc) return <div className={`relative flex min-h-20 items-center justify-center bg-stone-100 text-center text-xs text-stone-500 dark:bg-stone-800 ${className}`}><div><p role="status">Photo unavailable</p><button type="button" onClick={(event) => { event.stopPropagation(); retry(); }} className="mt-1 inline-flex min-h-11 items-center gap-1 rounded-md px-3 font-semibold hover:bg-stone-200 dark:hover:bg-stone-700"><RefreshCw className="h-3 w-3" />Retry photo</button></div></div>;
  if (effectiveSrc) {
    return <div className={`relative ${className}`} onClick={onClick}>{!loaded && <div className="absolute inset-0 motion-safe:animate-pulse bg-stone-100 dark:bg-stone-800" aria-hidden="true" />}<img src={effectiveSrc} loading={localSrc ? 'eager' : loading} decoding="async" alt={alt} onLoad={async (event) => {
      const image = event.currentTarget;
      try { await image.decode(); } catch { if (!localSrc) handleError(); return; }
      if (!alive.current) return;
      setLoaded(true);
    }} onError={() => { if (!localSrc) handleError(); }} className={`h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'} ${loaded ? 'opacity-100' : 'opacity-0'}`} /></div>;
  }
  if (cacheable) return <div className={`relative ${className}`} onClick={onClick}><div className="absolute inset-0 motion-safe:animate-pulse bg-stone-100 dark:bg-stone-800" aria-hidden="true" /></div>;
  return <div className={`relative ${className}`} onClick={onClick}>{!loaded && <div className="absolute inset-0 motion-safe:animate-pulse bg-stone-100 dark:bg-stone-800" aria-hidden="true" />}<img key={attempt} src={imageUrl(src, variant, attempt)} loading={loading} decoding="async" alt={alt} onLoad={async (event) => {
    const image = event.currentTarget;
    try { await image.decode(); } catch { handleError(); return; }
    if (!alive.current || identity !== request.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null; setLoaded(true); decoded.current?.();
  }} onError={handleError} className={`h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'} ${loaded ? 'opacity-100' : 'opacity-0'}`} /></div>;
};
