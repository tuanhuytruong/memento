import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { imageUrl, type ImageVariant } from '../lib/imageUrl';
import { getImageCacheOwner, purgeCachedImage, readCachedImage, writeCachedImage } from '../lib/imageCache';

type Props = {
  src: string; variant: ImageVariant; alt: string; className?: string;
  loading?: 'lazy' | 'eager'; fit?: 'cover' | 'contain';
  onClick?: () => void; onDecoded?: () => void; localSrc?: string;
};
/** Identity changes synchronously detach old pixels and fence every continuation. */
export function PrivateImage(props: Props) {
  return <ImageRequest key={JSON.stringify([getImageCacheOwner(), props.src, props.variant, props.localSrc])} {...props} />;
}
function imageIdFromSrc(src: string): string | null {
  if (!src.startsWith('/api/images/')) return null;
  const id = src.split('?')[0].slice('/api/images/'.length);
  return id && !id.includes('/') ? id : null;
}
function ImageRequest({ src, variant, alt, className = '', loading = 'eager', fit = 'cover', onClick, onDecoded, localSrc }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [delivery, setDelivery] = useState<{ url: string; warm: boolean } | null>(null);
  const [memoryHit, setMemoryHit] = useState(false);
  const alive = useRef(true), generation = useRef(0), notified = useRef(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const decoding = useRef<HTMLImageElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decoded = useRef(onDecoded); decoded.current = onDecoded;
  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); };
  }, []);
  const owner = getImageCacheOwner(), imageId = imageIdFromSrc(src);
  const cacheable = !localSrc && !!owner && !!imageId && (variant === 'thumb' || variant === 'display');
  const token = generation.current;
  const current = () => alive.current && token === generation.current;
  const retry = () => {
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null; decoding.current = null;
    setReady(false); setFailed(false); setDelivery(null); setMemoryHit(false); setAttempt(value => value + 1);
  };
  const handleError = () => {
    if (!current() || timer.current || notified.current) return;
    if (cacheable) void purgeCachedImage(owner!, imageId!, variant);
    if (attempt === 0 && !localSrc && src.startsWith('/api/images/') && navigator.onLine !== false) {
      timer.current = setTimeout(() => { timer.current = null; if (current()) retry(); }, 500);
    } else setFailed(true);
  };
  // Bytes, even cached bytes, are not readiness: only the rendered element decodes.
  useEffect(() => {
    if (!cacheable) return;
    let cancelled = false, objectUrl: string | null = null;
    const controller = new AbortController();
    void (async () => {
      try {
        const cached = attempt === 0 ? await readCachedImage(owner!, imageId!, variant) : null;
        if (cancelled || !current()) return;
        let blob = cached;
        if (!blob) {
          const response = await fetch(imageUrl(src, variant, attempt), { credentials: 'same-origin', signal: controller.signal });
          if (cancelled || !current()) return;
          if (response.status === 401 || response.status === 403) { void purgeCachedImage(owner!, imageId!, variant); setFailed(true); return; }
          if (!response.ok) { handleError(); return; }
          blob = await response.blob();
          if (cancelled || !current()) return;
          if (!blob.size) { handleError(); return; }
          void writeCachedImage(owner!, imageId!, variant, blob);
        }
        objectUrl = URL.createObjectURL(blob);
        setDelivery({ url: objectUrl, warm: !!cached });
      } catch { if (!cancelled) handleError(); }
    })();
    return () => { cancelled = true; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    // All other inputs are immutable for this keyed identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheable, attempt]);
  const decodeImage = async (image: HTMLImageElement) => {
    if (!current() || notified.current || decoding.current === image) return;
    decoding.current = image;
    try { await image.decode(); } catch { if (current() && imageRef.current === image) handleError(); return; }
    if (!current() || imageRef.current !== image || !image.isConnected) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null; notified.current = true;
    setReady(true); decoded.current?.();
  };
  const effectiveSrc = localSrc || delivery?.url || (!cacheable ? imageUrl(src, variant, attempt) : null);
  if (failed) return <div className={`relative flex min-h-20 items-center justify-center bg-stone-100 text-center text-xs text-stone-500 dark:bg-stone-800 ${className}`}><div><p role="status">Photo unavailable</p><button type="button" onClick={event => { event.stopPropagation(); retry(); }} className="ui-action mt-1 inline-flex min-h-11 items-center gap-1 rounded-md px-3 font-semibold hover:bg-stone-200 dark:hover:bg-stone-700"><RefreshCw className="h-3 w-3" />Retry photo</button></div></div>;
  return <div className={`relative ${className}`} data-photo-state={ready ? 'decoded' : 'loading'} onClick={onClick}>
    {!ready && <div className="absolute inset-0 motion-safe:animate-pulse bg-stone-100 dark:bg-stone-800" aria-hidden="true" />}
    {effectiveSrc && <img key={attempt} ref={image => {
      imageRef.current = image;
      if (image?.complete && image.naturalWidth > 0 && decoding.current !== image) { setMemoryHit(true); void decodeImage(image); }
    }} src={effectiveSrc} loading={localSrc ? 'eager' : loading} decoding="async" alt={alt} onLoad={event => void decodeImage(event.currentTarget)} onError={handleError} className={`private-image h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`} style={{ opacity: ready ? 1 : 0, transitionDuration: localSrc || delivery?.warm || memoryHit ? '0ms' : undefined }} />}
  </div>;
}
