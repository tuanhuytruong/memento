import { ApiError } from './api';
import type { PostcardRequest, PostcardTemplateKey } from '../types';

/** Selection bounds mirrored from the server contract; the server is authoritative. */
export const POSTCARD_TEMPLATES: { key: PostcardTemplateKey; label: string; min: number; max: number; hint: string }[] = [
  { key: 'journey', label: 'Journey', min: 1, max: 6, hint: 'Up to six moments from one of your own tracks.' },
  { key: 'ordinary', label: 'Ordinary day', min: 1, max: 3, hint: 'One to three moments from an ordinary day.' },
  { key: 'month', label: 'Month recap', min: 1, max: 6, hint: 'Up to six moments gathered from one month.' },
];

export const POSTCARD_LIMITS = { title: 80, note: 500, caption: 80, moments: 6 };

export function templateOf(key: PostcardTemplateKey) {
  return POSTCARD_TEMPLATES.find(template => template.key === key) ?? POSTCARD_TEMPLATES[0];
}

/**
 * Client-side guidance mirroring the server rules, so the composer can explain
 * a problem before a round trip. The server re-validates and stays authoritative.
 */
export function validatePostcard(spec: PostcardRequest): string | null {
  const template = templateOf(spec.template);
  if (spec.moments.length < template.min) return `A ${template.label} postcard needs at least ${template.min} moment.`;
  if (spec.moments.length > template.max) return `A ${template.label} postcard accepts at most ${template.max} moments.`;
  const seenMoments = new Set<string>();
  for (const moment of spec.moments) {
    const key = `${moment.ownerId}:${moment.id}`;
    if (seenMoments.has(key)) return 'The same moment was selected twice. Choose each moment once.';
    seenMoments.add(key);
  }
  const seenImages = new Set<string>();
  for (const imageId of spec.images) {
    if (!imageId) continue;
    if (seenImages.has(imageId)) return 'The same photo was selected twice. Choose each photo once.';
    seenImages.add(imageId);
  }
  if (spec.images.length !== spec.moments.length) return 'Choose at most one photo per selected moment.';
  if (!spec.title.trim()) return 'Add a short title for the postcard.';
  if (spec.title.length > POSTCARD_LIMITS.title) return `Keep the title to ${POSTCARD_LIMITS.title} characters or fewer.`;
  if (spec.note.length > POSTCARD_LIMITS.note) return `Keep the personal note to ${POSTCARD_LIMITS.note} characters or fewer.`;
  for (const caption of spec.captions) {
    if (caption.length > POSTCARD_LIMITS.caption) return `Keep each caption to ${POSTCARD_LIMITS.caption} characters or fewer.`;
  }
  return null;
}

/** A short, content-free name: nothing user-authored ever reaches the filename. */
export const POSTCARD_FILENAME = 'memento-postcard.png';

/**
 * Render a postcard and return the exact PNG bytes the server produced.
 * The caller downloads these same bytes; nothing is re-rendered at download.
 */
export async function renderPostcard(spec: PostcardRequest, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch('/api/postcards/render', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spec),
    signal,
  });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    let message = 'The postcard could not be created. Please try again.';
    if (contentType.includes('application/json')) {
      const payload = await response.json().catch(() => undefined);
      if (typeof payload?.error === 'string' && payload.error) message = payload.error;
    }
    throw new ApiError(message, response.status);
  }
  return await response.blob();
}

/** Trigger a browser download of already-rendered bytes. */
export function downloadPostcard(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = POSTCARD_FILENAME;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick so the click has consumed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A stable key for a moment's photo list, used for lazy selector thumbnails. */
export function imageIdOf(src: string): string | null {
  const match = /^\/api\/images\/([^/?#]+)/.exec(src);
  return match ? match[1] : null;
}
