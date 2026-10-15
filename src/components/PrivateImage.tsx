import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { imageUrl, type ImageVariant } from '../lib/imageUrl';

type Props = { src: string; variant: ImageVariant; alt: string; className?: string; loading?: 'lazy' | 'eager'; onClick?: () => void };
export function PrivateImage({ src, variant, alt, className = '', loading = 'eager', onClick }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setAttempt(0); setFailed(false); setLoaded(false); }, [src, variant]);
  const retry = () => { setLoaded(false); setFailed(false); setAttempt((value) => value + 1); };
  const handleError = () => { if (attempt === 0 && navigator.onLine !== false) window.setTimeout(retry, 500); else setFailed(true); };
  if (failed) return <div className={`relative flex min-h-20 items-center justify-center bg-stone-100 text-center text-xs text-stone-500 dark:bg-stone-800 ${className}`}><div><p>Photo unavailable</p><button type="button" onClick={(event) => { event.stopPropagation(); retry(); }} className="mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold hover:bg-stone-200 dark:hover:bg-stone-700"><RefreshCw className="h-3 w-3" />Retry photo</button></div></div>;
  return <div className={`relative ${className}`} onClick={onClick}>{!loaded && <div className="absolute inset-0 animate-pulse bg-stone-100 dark:bg-stone-800" aria-hidden="true" />}<img src={imageUrl(src, variant, attempt)} loading={loading} decoding="async" alt={alt} onLoad={() => setLoaded(true)} onError={handleError} className={`h-full w-full object-cover ${loaded ? 'opacity-100' : 'opacity-0'}`} /></div>;
}
