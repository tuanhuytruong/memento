// Server-side postcard renderer: SVG text layer + contained photo cells via Sharp.
// SECURITY: user strings reach the SVG only through escapeXml() as literal text.
// No user HTML, no user SVG, no remote URLs, no client-supplied paths or keys.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { escapeXml, fontMetrics, layoutPostcard, POSTCARD_WIDTH, POSTCARD_HEIGHT } from './postcard-layout.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(here, 'assets', 'fonts');
const FONT_FILES = { 400: 'NotoSans-Regular.ttf', 700: 'NotoSans-Bold.ttf' };

// One render per process plus a small bounded queue. A render holds decoded
// photo bytes, so concurrency is deliberately lower than image transforms.
const MAX_ACTIVE_RENDERS = 1;
const MAX_QUEUED_RENDERS = 2;
const MAX_SOURCE_PIXELS = 40_000_000;
const MAX_SOURCE_BYTES = 24 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 30_000;

let active = 0;
const queue = [];
export function postcardRenderStats() { return { active, queued: queue.length }; }

function busy() {
  return Object.assign(new Error('Another postcard is still rendering. Please try again in a moment.'), { status: 503, retryAfter: 2, postcard: true });
}

function acquireRender(signal) {
  if (active >= MAX_ACTIVE_RENDERS && queue.length >= MAX_QUEUED_RENDERS) throw busy();
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      const index = queue.findIndex(job => job.onAbort === onAbort);
      if (index >= 0) queue.splice(index, 1);
      settled = true;
      reject(Object.assign(new Error('Postcard rendering was cancelled.'), { status: 499, postcard: true }));
    };
    const start = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      active += 1;
      resolve(() => { active -= 1; queue.shift()?.start(); });
    };
    if (active < MAX_ACTIVE_RENDERS) start();
    else {
      queue.push({ start, onAbort });
      signal?.addEventListener('abort', onAbort, { once: true });
    }
  }).then(release => ({ release, dequeue: () => {} }));
}

// The renderer never resolves its own font path from input; the bundled
// directory is registered once with fontconfig via a generated local config.
let fontConfigPromise = null;
function ensureFontConfig() {
  fontConfigPromise ??= (async () => {
    for (const [weight, file] of Object.entries(FONT_FILES)) {
      if (!fs.existsSync(path.join(FONT_DIR, file))) throw Object.assign(new Error(`Bundled font ${file} is missing. Postcards cannot be rendered.`), { status: 503, postcard: true });
      if (!fs.existsSync(path.join(FONT_DIR, `${weight === '400' ? '' : 'Bold-'}OFL.txt`)) && weight === '400') {
        if (!fs.existsSync(path.join(FONT_DIR, 'OFL.txt'))) throw Object.assign(new Error('Bundled font license is missing. Postcards cannot be rendered.'), { status: 503, postcard: true });
      }
    }
    const conf = path.join(os.tmpdir(), `memento-postcard-fonts-${process.pid}.conf`);
    fs.writeFileSync(conf, `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${escapeXml(FONT_DIR)}</dir>\n  <cachedir>${escapeXml(path.join(os.tmpdir(), 'memento-font-cache'))}</cachedir>\n</fontconfig>\n`, { mode: 0o600 });
    process.env.FONTCONFIG_FILE = conf;
    return true;
  })();
  return fontConfigPromise;
}

let metricsPromise = null;
function ensureMetrics() {
  metricsPromise ??= fontMetrics(fs.readFileSync(path.join(FONT_DIR, FONT_FILES[400])));
  return metricsPromise;
}

const svgText = item =>
  `<text x="${item.x}" y="${item.y}" font-family="Noto Sans" font-weight="${item.weight}" font-size="${item.size}" fill="${item.color}">${escapeXml(item.text)}</text>`;

/** Strip every metadata/EXIF block: the output carries no source provenance. */
async function decodeCell(buffer, width, height) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_SOURCE_BYTES) {
    throw Object.assign(new Error('One of the chosen photos could not be read. Remove it and try again.'), { status: 422, postcard: true });
  }
  const options = { animated: false, limitInputPixels: MAX_SOURCE_PIXELS, failOn: 'warning' };
  let metadata;
  try { metadata = await sharp(buffer, options).metadata(); }
  catch {
    throw Object.assign(new Error('One of the chosen photos is not a supported image. Remove it and try again.'), { status: 422, postcard: true });
  }
  if (!metadata.width || !metadata.height) {
    throw Object.assign(new Error('One of the chosen photos could not be measured. Remove it and try again.'), { status: 422, postcard: true });
  }
  if (metadata.format === 'gif' || (metadata.pages || 1) > 1) {
    throw Object.assign(new Error('Animated photos are not supported. Choose a still photo instead.'), { status: 422, postcard: true });
  }
  if (metadata.width * metadata.height > MAX_SOURCE_PIXELS) {
    throw Object.assign(new Error('One of the chosen photos has too many pixels. Choose a smaller photo.'), { status: 422, postcard: true });
  }
  // 'contain' keeps the whole photo visible; nothing is cropped by default.
  return sharp(buffer, options)
    .resize(width, height, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 }, withoutEnlargement: false })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Render a validated postcard.
 * @param spec result of validatePostcardRequest()
 * @param photos array aligned with spec.images: { buffer, contentType } or null for text-only cells
 * @param signal aborts queued work and bounds the render itself
 */
export async function renderPostcard({ spec, photos, signal }) {
  if (!spec || typeof spec !== 'object') throw Object.assign(new Error('Invalid postcard.'), { status: 400, postcard: true });
  if (!Array.isArray(photos) || photos.length !== spec.images.length) throw Object.assign(new Error('Each selected photo is missing.'), { status: 400, postcard: true });
  await ensureFontConfig();
  const { release } = await acquireRender(signal);
  try {
    throwIfAborted(signal);
    return await withTimeout(render(spec, photos), RENDER_TIMEOUT_MS, signal);
  } finally {
    release();
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw Object.assign(new Error('Postcard rendering was cancelled.'), { status: 499, postcard: true });
}

function withTimeout(work, timeoutMs, signal) {
  // A signal aborted before the race starts must still reject: an already
  // aborted signal never fires its listener again.
  throwIfAborted(signal);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('Postcard rendering took too long. Please try again.'), { status: 503, retryAfter: 2, postcard: true })), timeoutMs);
    timer.unref?.();
  });
  const abort = new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(Object.assign(new Error('Postcard rendering was cancelled.'), { status: 499, postcard: true })), { once: true });
  });
  return Promise.race([work, timeout, abort]).finally(() => clearTimeout(timer));
}

async function render(spec, photos) {
  const cells = spec.images.map((imageId, index) => ({
      imageId,
      caption: spec.captions[index] ?? '',
    date: spec.showDate ? (photos[index]?.date ?? null) : null,
  }));
  const layout = layoutPostcard({ template: spec.template, title: spec.title, note: spec.note, showDate: spec.showDate, cells, metrics: ensureMetrics() });

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">`,
    `<rect width="${layout.width}" height="${layout.height}" fill="${layout.background}"/>`,
    ...layout.text.map(svgText),
    '</svg>',
  ].join('');

  const overlays = [];
  for (let index = 0; index < layout.cells.length; index += 1) {
    const box = layout.cells[index];
    const photo = photos[index];
    if (!photo) continue; // deliberate text-only cell
    const decoded = await decodeCell(photo.buffer, Math.round(box.w), Math.round(box.h));
    overlays.push({ input: decoded, left: Math.round(box.x), top: Math.round(box.y) });
  }

  // sharp rejects an undefined composite list, so the chain is built in two
  // shapes: text-only, or text plus contained photos.
  // density 72 makes one SVG unit one output pixel, so the explicit layout
  // coordinates are the final pixel geometry — no silent rescaling.
  const base = sharp(Buffer.from(svg), { density: 72 }).png({ compressionLevel: 9, effort: 7 });
  const output = await (overlays.length ? base.composite(overlays).toBuffer() : base.toBuffer());
  const meta = await sharp(output).metadata();
  if (meta.width !== POSTCARD_WIDTH || meta.height !== POSTCARD_HEIGHT) {
    throw Object.assign(new Error('The postcard could not be rendered at the expected size. Please try again.'), { status: 500, postcard: true });
  }
  return output;
}
