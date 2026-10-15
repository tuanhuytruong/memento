import sharp from 'sharp';

export const VARIANT_CACHE_CONTROL = 'private, max-age=300, must-revalidate';
const ANIMATED_TYPES = new Set(['image/gif']);

export async function makeImageVariants(buffer, contentType) {
  if (ANIMATED_TYPES.has(contentType)) return { width: null, height: null, thumb: null, display: null };
  const source = sharp(buffer, { animated: false }).rotate();
  const metadata = await source.metadata();
  const build = (width, quality) => sharp(buffer, { animated: false }).rotate().resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer();
  const [thumbBody, displayBody] = await Promise.all([build(480, 72), build(1280, 80)]);
  return { width: metadata.width || null, height: metadata.height || null, thumb: { body: thumbBody, size: thumbBody.length }, display: { body: displayBody, size: displayBody.length } };
}

export function resolveVariant(image, requested) {
  if (!['original', 'thumb', 'display'].includes(requested)) return null;
  if (requested === 'thumb' && image.thumb_object_key) return { key: image.thumb_object_key, size: image.thumb_size, contentType: 'image/webp' };
  if (requested === 'display' && image.display_object_key) return { key: image.display_object_key, size: image.display_size, contentType: 'image/webp' };
  return { key: image.object_key, size: image.size, contentType: image.content_type };
}
