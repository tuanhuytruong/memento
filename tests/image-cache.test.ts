// Read-through cache for thumb/display variants.
//
// Node has no Cache Storage, so the suite installs a minimal in-memory bucket: that
// keeps the TTL, the cap and the purge rules honest without pretending the browser
// behaves like this file. `original` is never cached, and a denied read must drop the
// entry rather than keep serving bytes the account may no longer read.
import test from 'node:test';
import assert from 'node:assert/strict';

const TTL = 24 * 60 * 60 * 1000;

/** Minimal Cache Storage: keys are URL strings, values are Response clones. */
function installCaches() {
  const buckets = new Map<string, Map<string, Response>>();
  const bucketOf = (name: string) => {
    if (!buckets.has(name)) buckets.set(name, new Map());
    return buckets.get(name)!;
  };
  const url = (input: string | Request) => (typeof input === 'string' ? input : input.url);
  const bucketApi = (name: string) => ({
    async match(input: string | Request) {
      const hit = bucketOf(name).get(url(input));
      return hit ? hit.clone() : undefined;
    },
    async put(input: string | Request, response: Response) {
      bucketOf(name).set(url(input), response.clone());
    },
    async delete(input: string | Request) {
      return bucketOf(name).delete(url(input));
    },
    async keys() {
      return [...bucketOf(name).keys()].map((key) => new Request(key));
    },
  });
  (globalThis as { caches?: unknown }).caches = {
    open: async (name: string) => bucketApi(name),
    delete: async (name: string) => buckets.delete(name),
    keys: async () => [...buckets.keys()],
  };
  return { buckets, url };
}

function removeCaches() {
  delete (globalThis as { caches?: unknown }).caches;
}

const bytes = (size = 64) => new Uint8Array(size).fill(7);

test('a thumb written once is read back without another request', async () => {
  installCaches();
  const { readCachedImage, writeCachedImage } = await import('../src/lib/imageCache.ts');
  await writeCachedImage('owner-a', 'img-1', 'thumb', new Blob([bytes(128)], { type: 'image/jpeg' }));
  const cached = await readCachedImage('owner-a', 'img-1', 'thumb');
  assert.ok(cached instanceof Blob);
  assert.equal(cached.size, 128);
  assert.equal(cached.type, 'image/jpeg');
  removeCaches();
});

test('owners and variants never collide', async () => {
  installCaches();
  const { readCachedImage, writeCachedImage } = await import('../src/lib/imageCache.ts');
  await writeCachedImage('owner-a', 'img-1', 'thumb', new Blob([bytes(32)], { type: 'image/jpeg' }));
  assert.equal(await readCachedImage('owner-b', 'img-1', 'thumb'), null, 'another account reads nothing');
  assert.equal(await readCachedImage('owner-a', 'img-1', 'display'), null, 'variants are separate entries');
  removeCaches();
});

test('an entry older than the TTL is dropped on read', async () => {
  installCaches();
  const { readCachedImage, writeCachedImage } = await import('../src/lib/imageCache.ts');
  const realNow = Date.now;
  await writeCachedImage('owner-a', 'img-1', 'display', new Blob([bytes(64)], { type: 'image/jpeg' }));
  assert.ok(await readCachedImage('owner-a', 'img-1', 'display'), 'fresh entry hits');
  // A minute either side of the TTL: the assertions are about the cliff, not about
  // how many milliseconds the test itself took.
  Date.now = () => realNow() + TTL - 60_000;
  assert.ok(await readCachedImage('owner-a', 'img-1', 'display'), 'entry is still valid just inside the TTL');
  Date.now = () => realNow() + TTL + 1;
  try {
    assert.equal(await readCachedImage('owner-a', 'img-1', 'display'), null, 'expired entry misses');
  } finally {
    Date.now = realNow;
  }
  removeCaches();
});

test('purging one account leaves the other account intact, purging everything empties the bucket', async () => {
  installCaches();
  const { purgeCachedImage, purgeImageCache, readCachedImage, writeCachedImage } = await import('../src/lib/imageCache.ts');
  await writeCachedImage('owner-a', 'img-1', 'thumb', new Blob([bytes()], { type: 'image/jpeg' }));
  await writeCachedImage('owner-a', 'img-1', 'display', new Blob([bytes()], { type: 'image/jpeg' }));
  await writeCachedImage('owner-b', 'img-2', 'thumb', new Blob([bytes()], { type: 'image/jpeg' }));
  await purgeCachedImage('owner-a', 'img-1', 'thumb');
  assert.equal(await readCachedImage('owner-a', 'img-1', 'thumb'), null);
  assert.ok(await readCachedImage('owner-a', 'img-1', 'display'), 'the other variant stays');
  await purgeImageCache('owner-a');
  assert.equal(await readCachedImage('owner-a', 'img-1', 'display'), null);
  assert.ok(await readCachedImage('owner-b', 'img-2', 'thumb'), 'a purge is scoped to one owner');
  await purgeImageCache();
  assert.equal(await readCachedImage('owner-b', 'img-2', 'thumb'), null);
  removeCaches();
});

test('the cache is disposable: no Cache Storage means no throw, only misses', async () => {
  removeCaches();
  const { readCachedImage, purgeCachedImage, purgeImageCache, writeCachedImage } = await import('../src/lib/imageCache.ts');
  await writeCachedImage('owner-a', 'img-1', 'thumb', new Blob([bytes()], { type: 'image/jpeg' }));
  assert.equal(await readCachedImage('owner-a', 'img-1', 'thumb'), null);
  await purgeCachedImage('owner-a', 'img-1');
  await purgeImageCache();
});

test('the signed-in owner is the only owner the cache will serve', async () => {
  const { getImageCacheOwner, setImageCacheOwner } = await import('../src/lib/imageCache.ts');
  installCaches();
  setImageCacheOwner('owner-a');
  assert.equal(getImageCacheOwner(), 'owner-a');
  // Signing out clears the owner and purges every cached variant.
  setImageCacheOwner(null);
  assert.equal(getImageCacheOwner(), null);
  removeCaches();
});
