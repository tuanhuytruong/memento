const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.82;
const MAX_ACCEPT_BYTES = 25 * 1024 * 1024;

function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read this image file.'));
    };
    img.src = url;
  });
}

/** Downscale oversized photos to JPEG so phone uploads stop hitting the 10MB server limit. */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error(`"${file.name}" is not an image.`);
  if (file.size > MAX_ACCEPT_BYTES) {
    throw new Error(`"${file.name}" is too large (${Math.round(file.size / 1048576)}MB). Please pick a file under 25MB.`);
  }
  if (file.size <= 512 * 1024) return file;
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    return file;
  }
  const width = bitmap.width;
  const height = bitmap.height;
  if (!width || !height) return file;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  if (scale >= 1 && file.type === 'image/jpeg') return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (typeof (bitmap as ImageBitmap).close === 'function') (bitmap as ImageBitmap).close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob || blob.size >= file.size) return file;
  const name = file.name.replace(/\.(png|webp|gif|heic|heif)$/i, '') || 'photo';
  return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
}
