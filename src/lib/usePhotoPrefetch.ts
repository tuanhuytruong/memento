import { useEffect, useMemo, useState } from 'react';
import { imageUrl } from './imageUrl';

/** Decode current first; then at most next + previous display, sequentially. Never originals. */
export function usePhotoPrefetch(images: string[], index: number, enabled = true) {
  const current = images[index];
  const selection = useMemo(() => ({ source: current }), [current, enabled]);
  const [decoded, setDecoded] = useState<object | null>(null);
  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (!enabled || !current || decoded !== selection || connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '')) return;
    let cancelled = false;
    let preload: HTMLImageElement | null = null;
    void (async () => {
      for (const source of [...new Set([images[index + 1], images[index - 1]])].filter(Boolean)) {
        if (cancelled) break;
        preload = new Image(); preload.src = imageUrl(source, 'display');
        try { await preload.decode(); } catch { /* No speculative retries. */ }
      }
    })();
    return () => { cancelled = true; if (preload) preload.removeAttribute('src'); };
  }, [images, index, enabled, current, decoded, selection]);
  return () => setDecoded(selection);
}
