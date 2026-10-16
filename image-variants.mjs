import sharp from 'sharp';

export const VARIANT_CACHE_CONTROL = 'private, max-age=300, must-revalidate';
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_IMAGE_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_TRANSFORMS = 2;
const MAX_QUEUE = 4;
const MAX_PENDING_BYTES = 48 * 1024 * 1024;
let active = 0, pendingBytes = 0;
const queue = [];
function failure(code, message) { return Object.assign(new Error(message), { code }); }
function acquire(bytes) {
  if (pendingBytes + bytes > MAX_PENDING_BYTES || (active >= MAX_TRANSFORMS && queue.length >= MAX_QUEUE)) throw failure('IMAGE_TRANSFORM_BUSY', 'Image processing is busy. Please try again shortly.');
  pendingBytes += bytes;
  return new Promise(resolve => {
    const start = () => {
      active++;
      resolve(() => { active--; pendingBytes -= bytes; queue.shift()?.(); });
    };
    if (active < MAX_TRANSFORMS) start(); else queue.push(start);
  });
}
export function imageTransformStats() { return { active, queued: queue.length, pendingBytes }; }
const empty = (width = null, height = null) => ({ width, height, thumb: null, display: null });

export async function makeImageVariants(buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw failure('IMAGE_INVALID', 'This image is invalid or unsupported. Please choose another file.');
  if (buffer.length > MAX_IMAGE_INPUT_BYTES) throw failure('IMAGE_TOO_LARGE', 'This image is too large. Please choose a smaller file.');
  const release = await acquire(buffer.length);
  const options = { animated: false, limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' };
  try {
    const metadata = await sharp(buffer, options).metadata();
    if (!['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff'].includes(metadata.format) || !metadata.width || !metadata.height) throw failure('IMAGE_INVALID', 'This image is invalid or unsupported. Please choose another file.');
    const pages = metadata.pages || 1;
    const height = metadata.pageHeight || metadata.height;
    if (metadata.width * height > MAX_IMAGE_PIXELS) throw failure('IMAGE_TOO_LARGE', 'This image has too many pixels. Please choose a smaller file.');
    const rotated = [5, 6, 7, 8].includes(metadata.orientation);
    const dimensions = rotated ? [height, metadata.width] : [metadata.width, height];
    // Never flatten animations (including animated WebP/APNG) or multi-page files.
    // GIF retains the established original-only policy, even for a single frame.
    if (contentType === 'image/gif' || metadata.format === 'gif' || pages > 1) return empty(...dimensions);
    const build = (width, quality) => sharp(buffer, options).rotate().resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer();
    // Sequential outputs: max TWO actual Sharp transforms process-wide, not four.
    const thumbBody = await build(480, 72);
    const displayBody = await build(1280, 80);
    return { width: dimensions[0], height: dimensions[1], thumb: { body: thumbBody, size: thumbBody.length }, display: { body: displayBody, size: displayBody.length } };
  } catch (error) {
    if (['IMAGE_INVALID', 'IMAGE_TOO_LARGE'].includes(error.code)) throw error;
    if (/pixel limit/i.test(error.message)) throw failure('IMAGE_TOO_LARGE', 'This image has too many pixels. Please choose a smaller file.');
    throw failure('IMAGE_INVALID', 'This image is invalid or unsupported. Please choose another file.');
  } finally { release(); }
}

export function resolveVariant(image, requested) {
  if (!['original', 'thumb', 'display'].includes(requested)) return null;
  if (requested === 'thumb' && image.thumb_object_key) return { key: image.thumb_object_key, size: Number(image.thumb_size), contentType: 'image/webp', variant: 'thumb' };
  if (requested === 'display' && image.display_object_key) return { key: image.display_object_key, size: Number(image.display_size), contentType: 'image/webp', variant: 'display' };
  return { key: image.object_key, size: Number(image.size), contentType: image.content_type, variant: 'original' };
}
