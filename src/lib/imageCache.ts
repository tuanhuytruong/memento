/**
 * 24-hour local read cache for private image variants.
 *
 * This is transport, not storage: the authenticated `/api/images/:id` contract
 * and `Cache-Control: private, max-age=300, must-revalidate` stay untouched, and
 * nothing here is ever served to another account. Entries are keyed by owner,
 * image and variant, expire after a day, and are dropped on any denial.
 */
export type CacheVariant = 'thumb' | 'display';

const BUCKET = 'memento-images-v1';
/** Exported so the cache contract (and its test) can name the same numbers. */
export const IMAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const IMAGE_CACHE_MAX_ENTRIES = 200;
export const IMAGE_CACHE_MAX_BYTES = 120 * 1024 * 1024;
const ORIGIN = 'https://memento.local/images/';

type Entry = { ownerId: string; imageId: string; variant: CacheVariant; cachedAt: number; bytes: number };

function cacheKey(ownerId: string, imageId: string, variant: CacheVariant): string {
  return `${ORIGIN}${encodeURIComponent(ownerId)}/${encodeURIComponent(imageId)}/${variant}`;
}

function parseKey(url: string): Entry | null {
  if (!url.startsWith(ORIGIN)) return null;
  const [ownerId, imageId, variant] = url.slice(ORIGIN.length).split('/').map(decodeURIComponent);
  if (!ownerId || !imageId || (variant !== 'thumb' && variant !== 'display')) return null;
  return { ownerId, imageId, variant, cachedAt: 0, bytes: 0 };
}

/**
 * The signed-in owner whose bytes may live in the cache. Set once per session and
 * cleared on logout, which purges everything instead of leaving another account's
 * photos readable on the same device.
 */
let activeOwner: string | null = null;

export function setImageCacheOwner(ownerId: string | null): void {
  activeOwner = ownerId;
  if (!ownerId) void purgeImageCache();
}

export function getImageCacheOwner(): string | null {
  return activeOwner;
}

function supported(): boolean {
  try {
    return typeof caches !== 'undefined' && !!caches;
  } catch {
    return false;
  }
}

export function saveDataPreferred(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

export async function readCachedImage(ownerId: string, imageId: string, variant: CacheVariant): Promise<Blob | null> {
  if (!supported()) return null;
  try {
    const bucket = await caches.open(BUCKET);
    const response = await bucket.match(cacheKey(ownerId, imageId, variant));
    if (!response) return null;
    const cachedAt = Number(response.headers.get('x-memento-cached-at') ?? '0');
    if (!cachedAt || Date.now() - cachedAt > IMAGE_CACHE_TTL_MS) {
      await bucket.delete(cacheKey(ownerId, imageId, variant));
      return null;
    }
    return await response.blob();
  } catch {
    return null;
  }
}

export async function writeCachedImage(ownerId: string, imageId: string, variant: CacheVariant, blob: Blob): Promise<void> {
  if (!supported() || saveDataPreferred()) return;
  if (blob.size > IMAGE_CACHE_MAX_BYTES) return;
  try {
    const bucket = await caches.open(BUCKET);
    await bucket.put(
      cacheKey(ownerId, imageId, variant),
      new Response(blob, {
        headers: {
          'content-type': blob.type || 'image/jpeg',
          'x-memento-cached-at': String(Date.now()),
        },
      }),
    );
    await trimCache(bucket);
  } catch {
    /* cache is disposable: a quota failure must never surface to the reader */
  }
}

export async function purgeCachedImage(ownerId: string, imageId: string, variant?: CacheVariant): Promise<void> {
  if (!supported()) return;
  try {
    const bucket = await caches.open(BUCKET);
    if (variant) {
      await bucket.delete(cacheKey(ownerId, imageId, variant));
      return;
    }
    await bucket.delete(cacheKey(ownerId, imageId, 'thumb'));
    await bucket.delete(cacheKey(ownerId, imageId, 'display'));
  } catch {
    /* best effort */
  }
}

export async function purgeImageCache(ownerId?: string): Promise<void> {
  if (!supported()) return;
  try {
    if (!ownerId) {
      await caches.delete(BUCKET);
      return;
    }
    const bucket = await caches.open(BUCKET);
    const requests = await bucket.keys();
    for (const request of requests) {
      const parsed = parseKey(request.url);
      if (parsed && parsed.ownerId === ownerId) await bucket.delete(request);
    }
  } catch {
    /* best effort */
  }
}

async function trimCache(bucket: Cache): Promise<void> {
  const requests = await bucket.keys();
  const entries: { request: Request; cachedAt: number; bytes: number }[] = [];
  for (const request of requests) {
    const response = await bucket.match(request);
    if (!response) continue;
    const cachedAt = Number(response.headers.get('x-memento-cached-at') ?? '0');
    const bytes = Number(response.headers.get('content-length') ?? '0') || (await response.clone().blob()).size;
    entries.push({ request, cachedAt, bytes });
  }
  entries.sort((a, b) => a.cachedAt - b.cachedAt);
  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  for (let index = 0; index < entries.length; index += 1) {
    const expired = entries[index].cachedAt > 0 && Date.now() - entries[index].cachedAt > IMAGE_CACHE_TTL_MS;
    const overCount = entries.length - index > IMAGE_CACHE_MAX_ENTRIES;
    const overBytes = total > IMAGE_CACHE_MAX_BYTES;
    if (!expired && !overCount && !overBytes) break;
    await bucket.delete(entries[index].request);
    total -= entries[index].bytes;
  }
}
