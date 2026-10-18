// Resolve a validated postcard's photos into ready-to-render bytes.
// AUTHORIZATION BOUNDARY: owner-only export. Every moment and image is
// re-checked against a FRESH read immediately before its bytes are requested;
// nothing is fetched from a client-supplied key, and no DB transaction is held
// across R2 reads or rendering.
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { ApiError } from './mutation-safety.mjs';

const MAX_CONCURRENT_FETCHES = 3;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_SOURCE_BYTES = 24 * 1024 * 1024;

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function readStream(stream, limit, signal) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    if (signal?.aborted) { stream.destroy(signal.reason); throw signal.reason; }
    total += chunk.length;
    if (total > limit) { stream.destroy(); throw new ApiError(422, 'One of the chosen photos is too large. Choose a smaller photo.'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * @param spec validated postcard spec (validatePostcardRequest output)
 * @param deps { userId, pool, qschema, s3, bucket, prefix, resolveVariant, exactMomentAccess, imageAccess, sourceSlot }
 * @param signal aborts on client disconnect
 * @returns { photos } aligned with spec.images; null for text-only cells
 */
export async function resolvePostcardPhotos(spec, deps, signal) {
  const { userId, pool, qschema, s3, bucket, prefix, resolveVariant, exactMomentAccess, imageAccess, sourceSlot } = deps;
  const postError = message => new ApiError(422, message);

  // 1) Fresh owner-only access check for every selected moment. Export is an
  //    owner capability: an editor or viewer of somebody else's track is
  //    refused even though they can read the same moments.
  const moments = await mapLimit(spec.moments, MAX_CONCURRENT_FETCHES, async ref => {
    const access = await exactMomentAccess(userId, ref, pool);
    if (!access) throw new ApiError(404, 'One of the selected moments is no longer available.');
    if (access.role !== 'owner' || access.owner_id !== userId) {
      throw new ApiError(403, 'Postcards can only be created from your own moments.');
    }
    return access;
  });

  // 2) Every photo must belong to the moment it was selected under.
  const selections = spec.images.map((imageId, index) => ({ imageId, moment: moments[index] }));
  const wanted = selections.filter(selection => selection.imageId);
  const membership = wanted.length
    ? (await pool.query(
        `SELECT i.id,i.moment_id,i.owner_id FROM ${qschema}.images i
         WHERE i.owner_id=$1 AND i.id = ANY($2::uuid[])`,
        [userId, wanted.map(selection => selection.imageId)],
      )).rows
    : [];
  const ownedByMoment = new Map(membership.map(row => [`${row.owner_id}:${row.moment_id}`, new Set()]));
  for (const row of membership) ownedByMoment.get(`${row.owner_id}:${row.moment_id}`)?.add(row.id);

  for (const selection of wanted) {
    const key = `${selection.moment.owner_id}:${selection.moment.id}`;
    if (!ownedByMoment.get(key)?.has(selection.imageId)) {
      throw postError('Each photo must come from the moment it is shown under.');
    }
  }

  // 3) Fresh image access + namespace check immediately before each byte read.
  //    The shared sourceSlot bounds aggregate read concurrency across all
  //    in-flight postcards; each slot is released when its read settles.
  const photos = await mapLimit(selections, MAX_CONCURRENT_FETCHES, async selection => {
    if (!selection.imageId) return null;
    if (signal?.aborted) throw signal.reason;
    const releaseSlot = sourceSlot ? await sourceSlot() : null;
    try {
      const image = await imageAccess(userId, selection.imageId, pool);
      if (!image || image.moment_id !== selection.moment.id || image.owner_id !== userId) {
        throw postError('One of the chosen photos was removed. Update your selection and try again.');
      }
      const variant = resolveVariant(image, 'display') || resolveVariant(image, 'original');
      if (!variant || !variant.key.startsWith(prefix)) throw new ApiError(502, 'Image storage is temporarily unavailable.');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new ApiError(504, 'One of the chosen photos took too long to load. Try again.')), FETCH_TIMEOUT_MS);
      timer.unref?.();
      const onParentAbort = () => controller.abort(signal.reason || new ApiError(499, 'Postcard rendering was cancelled.'));
      signal?.addEventListener('abort', onParentAbort, { once: true });
      try {
        const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: variant.key }), { abortSignal: controller.signal });
        const buffer = await readStream(object.Body, MAX_SOURCE_BYTES, controller.signal);
        return { buffer, contentType: image.content_type };
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (controller.signal.aborted) throw controller.signal.reason;
        throw postError('One of the chosen photos could not be loaded. Remove it and try again.');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onParentAbort);
      }
    } finally {
      releaseSlot?.();
    }
  });

  return photos;
}
