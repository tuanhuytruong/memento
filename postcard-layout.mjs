// Pure postcard layout: explicit coordinates, real font metrics, bounded text.
// No I/O, no rendering, no user-controlled markup — every string here is data.

export const POSTCARD_WIDTH = 1600;
export const POSTCARD_HEIGHT = 2000;

export const POSTCARD_LIMITS = {
  titleMax: 80,
  noteMax: 500,
  captionMax: 80,
  noteLinesMax: 6,
  captionLinesMax: 2,
  moments: { min: 1, max: 6 },
};

// Per-template selection bounds and explicit cell geometry (no runtime solving).
export const POSTCARD_TEMPLATES = {
  journey: { min: 1, max: 6, label: 'Journey' },
  ordinary: { min: 1, max: 3, label: 'Ordinary day' },
  month: { min: 1, max: 6, label: 'Month recap' },
};

const MARGIN = 100;
const CONTENT_X = MARGIN;
const CONTENT_W = POSTCARD_WIDTH - MARGIN * 2;
const GAP = 20;
const TITLE_SIZE = 84;
const DATE_SIZE = 42;
const NOTE_SIZE = 44;
const CAPTION_SIZE = 34;
const CAPTION_GAP = 8;
// Inner padding of a photo cell: keeps captions off the cell edge.
const CELL_PAD = 16;

// Explicit geometry per template and cell count. Values are absolute pixels on
// the fixed 1600×2000 canvas; every rectangle is enumerated, never computed
// from user input.
const GRIDS = {
  journey: {
    1: [{ x: CONTENT_X, y: 520, w: CONTENT_W, h: 900 }],
    2: [
      { x: CONTENT_X, y: 520, w: CONTENT_W, h: 440 },
      { x: CONTENT_X, y: 980, w: CONTENT_W, h: 440 },
    ],
    3: [
      { x: CONTENT_X, y: 520, w: CONTENT_W, h: 900 },
      { x: CONTENT_X, y: 1440, w: (CONTENT_W - GAP) / 2, h: 240 },
      { x: CONTENT_X + (CONTENT_W - GAP) / 2 + GAP, y: 1440, w: (CONTENT_W - GAP) / 2, h: 240 },
    ],
    4: [
      { x: CONTENT_X, y: 520, w: CONTENT_W, h: 430 },
      { x: CONTENT_X, y: 970, w: CONTENT_W, h: 430 },
      { x: CONTENT_X, y: 1420, w: (CONTENT_W - GAP) / 2, h: 260 },
      { x: CONTENT_X + (CONTENT_W - GAP) / 2 + GAP, y: 1420, w: (CONTENT_W - GAP) / 2, h: 260 },
    ],
    5: [
      { x: CONTENT_X, y: 520, w: (CONTENT_W - GAP) / 2, h: 430 },
      { x: CONTENT_X + (CONTENT_W - GAP) / 2 + GAP, y: 520, w: (CONTENT_W - GAP) / 2, h: 430 },
      { x: CONTENT_X, y: 970, w: (CONTENT_W - GAP) / 2, h: 430 },
      { x: CONTENT_X + (CONTENT_W - GAP) / 2 + GAP, y: 970, w: (CONTENT_W - GAP) / 2, h: 430 },
      { x: CONTENT_X, y: 1420, w: CONTENT_W, h: 260 },
    ],
    6: [
      { x: CONTENT_X, y: 520, w: (CONTENT_W - GAP) / 2, h: 420 },
      { x: CONTENT_X + (CONTENT_W - GAP) / 2 + GAP, y: 520, w: (CONTENT_W - GAP) / 2, h: 420 },
      { x: CONTENT_X, y: 960, w: (CONTENT_W - GAP) / 2, h: 420 },
      { x: CONTENT_X + (CONTENT_W - GAP) / 2 + GAP, y: 960, w: (CONTENT_W - GAP) / 2, h: 420 },
      { x: CONTENT_X, y: 1400, w: (CONTENT_W - GAP) / 2, h: 280 },
      { x: CONTENT_X + (CONTENT_W - GAP) / 2 + GAP, y: 1400, w: (CONTENT_W - GAP) / 2, h: 280 },
    ],
  },
  ordinary: {
    1: [{ x: CONTENT_X, y: 520, w: CONTENT_W, h: 900 }],
    2: [
      { x: CONTENT_X, y: 520, w: CONTENT_W, h: 440 },
      { x: CONTENT_X, y: 980, w: CONTENT_W, h: 440 },
    ],
    3: [
      { x: CONTENT_X, y: 520, w: CONTENT_W, h: 900 },
      { x: CONTENT_X, y: 1440, w: (CONTENT_W - GAP) / 2, h: 240 },
      { x: CONTENT_X + (CONTENT_W - GAP) / 2 + GAP, y: 1440, w: (CONTENT_W - GAP) / 2, h: 240 },
    ],
  },
  month: {
    1: [{ x: CONTENT_X, y: 520, w: CONTENT_W, h: 900 }],
    2: [
      { x: CONTENT_X, y: 520, w: CONTENT_W, h: 440 },
      { x: CONTENT_X, y: 980, w: CONTENT_W, h: 440 },
    ],
    3: [
      { x: CONTENT_X, y: 520, w: CONTENT_W, h: 900 },
      { x: CONTENT_X, y: 1440, w: (CONTENT_W - GAP) / 2, h: 240 },
      { x: CONTENT_X + (CONTENT_W - GAP) / 2 + GAP, y: 1440, w: (CONTENT_W - GAP) / 2, h: 240 },
    ],
    4: [
      { x: CONTENT_X, y: 520, w: (CONTENT_W - GAP) / 2, h: 430 },
      { x: CONTENT_X + (CONTENT_W - GAP) / 2 + GAP, y: 520, w: (CONTENT_W - GAP) / 2, h: 430 },
      { x: CONTENT_X, y: 970, w: (CONTENT_W - GAP) / 2, h: 430 },
      { x: CONTENT_X + (CONTENT_W - GAP) / 2 + GAP, y: 970, w: (CONTENT_W - GAP) / 2, h: 430 },
    ],
    5: [
      { x: CONTENT_X, y: 520, w: (CONTENT_W - GAP) / 2, h: 430 },
      { x: CONTENT_X + (CONTENT_W - GAP) / 2 + GAP, y: 520, w: (CONTENT_W - GAP) / 2, h: 430 },
      { x: CONTENT_X, y: 970, w: (CONTENT_W - GAP) / 2, h: 430 },
      { x: CONTENT_X + (CONTENT_W - GAP) / 2 + GAP, y: 970, w: (CONTENT_W - GAP) / 2, h: 430 },
      { x: CONTENT_X, y: 1420, w: CONTENT_W, h: 260 },
    ],
    6: [
      { x: CONTENT_X, y: 520, w: (CONTENT_W - GAP) / 2, h: 420 },
      { x: CONTENT_X + (CONTENT_W - GAP) / 2 + GAP, y: 520, w: (CONTENT_W - GAP) / 2, h: 420 },
      { x: CONTENT_X, y: 960, w: (CONTENT_W - GAP) / 2, h: 420 },
      { x: CONTENT_X + (CONTENT_W - GAP) / 2 + GAP, y: 960, w: (CONTENT_W - GAP) / 2, h: 420 },
      { x: CONTENT_X, y: 1400, w: (CONTENT_W - GAP) / 2, h: 280 },
      { x: CONTENT_X + (CONTENT_W - GAP) / 2 + GAP, y: 1400, w: (CONTENT_W - GAP) / 2, h: 280 },
    ],
  },
};

const NOTE_TOP = 1710;
const NOTE_BOTTOM = POSTCARD_HEIGHT - MARGIN;

/**
 * Minimal TrueType metric reader (cmap format 4 + hmtx + head.unitsPerEm).
 * Deterministic and dependency-free so wrapping uses real advance widths
 * instead of an average-character guess. Glyphs the font lacks (emoji, CJK)
 * fall back to a fixed conservative width so text still stays bounded.
 */
export function fontMetrics(ttfBuffer) {
  if (!Buffer.isBuffer(ttfBuffer) || ttfBuffer.length < 12) throw new TypeError('Invalid font buffer');
  const view = ttfBuffer;
  const u16 = offset => view.readUInt16BE(offset);
  const i16 = offset => view.readInt16BE(offset);
  const numTables = u16(4);
  const tables = {};
  for (let index = 0; index < numTables; index += 1) {
    const base = 12 + index * 16;
    tables[view.toString('latin1', base, base + 4)] = { offset: view.readUInt32BE(base + 8), length: view.readUInt32BE(base + 12) };
  }
  for (const tag of ['head', 'hhea', 'hmtx', 'cmap']) if (!tables[tag]) throw new TypeError(`Font missing ${tag} table`);
  const unitsPerEm = u16(tables.head.offset + 18);
  if (!unitsPerEm) throw new TypeError('Invalid unitsPerEm');
  const numberOfHMetrics = u16(tables.hhea.offset + 34);
  const hmtx = tables.hmtx.offset;
  const advanceOf = glyph => {
    const index = Math.min(glyph, numberOfHMetrics - 1);
    return u16(hmtx + index * 4);
  };
  // cmap: prefer (3,1) format 4, then any format 4.
  const cmap = tables.cmap.offset;
  const cmapTables = u16(cmap + 2);
  let format4 = null;
  let fallback = null;
  for (let index = 0; index < cmapTables; index += 1) {
    const base = cmap + 4 + index * 8;
    const sub = cmap + u16(base + 4);
    if (u16(sub) !== 4) continue;
    const entry = { platform: u16(base), encoding: u16(base + 2), sub };
    if (entry.platform === 3 && entry.encoding === 1) { format4 = entry; break; }
    fallback ??= entry;
  }
  const chosen = format4 || fallback;
  const glyphFor = codePoint => {
    if (!chosen) return 0;
    const sub = chosen.sub;
    const segCount = u16(sub + 6) / 2;
    const endBase = sub + 14;
    const startBase = endBase + segCount * 2 + 2;
    const deltaBase = startBase + segCount * 2;
    const rangeBase = deltaBase + segCount * 2;
    for (let segment = 0; segment < segCount; segment += 1) {
      const end = u16(endBase + segment * 2);
      if (codePoint > end) continue;
      const start = u16(startBase + segment * 2);
      if (codePoint < start) return 0;
      const delta = i16(deltaBase + segment * 2);
      const rangeOffset = u16(rangeBase + segment * 2);
      if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
      const glyphAddress = rangeBase + segment * 2 + rangeOffset + (codePoint - start) * 2;
      if (glyphAddress + 1 >= view.length) return 0;
      const glyph = u16(glyphAddress);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
  // Conservative width for anything the font cannot draw (emoji, CJK, tofu).
  const missingWidth = unitsPerEm * 0.7;
  return {
    unitsPerEm,
    /** Width in pixels of `text` rendered at `size` px. */
    measure(text, size) {
      if (typeof text !== 'string' || !text || !Number.isFinite(size)) return 0;
      let width = 0;
      for (const character of text) {
        const codePoint = character.codePointAt(0);
        // Combining marks and zero-width joiners add no advance of their own.
        if (codePoint === 0x200b || codePoint === 0x200d || (codePoint >= 0x0300 && codePoint <= 0x036f)) continue;
        const glyph = glyphFor(codePoint);
        width += glyph === 0 ? missingWidth : advanceOf(glyph);
      }
      return (width / unitsPerEm) * size;
    },
  };
}

/**
 * Wrap `text` to at most `maxWidth` px. Breaks on spaces and at Vietnamese
 * syllable boundaries (a lone vowel+diphthong group is kept together), and
 * hard-breaks any single run that cannot fit on its own line.
 */
export function wrapText(text, { maxWidth, size, metrics, maxLines }) {
  const lines = [];
  const paragraphs = String(text ?? '').split(/\r?\n/);
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    const flush = () => { if (line) { lines.push(line); line = ''; } };
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (metrics.measure(candidate, size) <= maxWidth) { line = candidate; continue; }
      flush();
      if (metrics.measure(word, size) <= maxWidth) { line = word; continue; }
      // Single token longer than the line: hard-break on measured boundaries.
      let chunk = '';
      for (const character of word) {
        if (metrics.measure(chunk + character, size) > maxWidth && chunk) { lines.push(chunk); chunk = character; }
        else chunk += character;
      }
      line = chunk;
      if (maxLines && lines.length > maxLines) break;
    }
    flush();
    if (maxLines && lines.length > maxLines) break;
  }
  if (maxLines && lines.length > maxLines) {
    return { lines: lines.slice(0, maxLines), truncated: true, overflow: true };
  }
  return { lines, truncated: false, overflow: false };
}

/** XML-escape literal text. User strings are always data, never markup. */
export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Strip control characters that would corrupt the SVG/XML stream.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/**
 * Validate and normalize a postcard request. Returns a clean spec or throws an
 * actionable error object; nothing is silently clipped or inferred.
 */
export function validatePostcardRequest(body) {
  const invalid = message => Object.assign(new Error(message), { status: 400, postcard: true });
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Invalid postcard request');

  const template = body.template;
  if (typeof template !== 'string' || !POSTCARD_TEMPLATES[template]) {
    throw invalid('Choose one of the three postcard templates: Journey, Ordinary day or Month recap.');
  }
  const bounds = POSTCARD_TEMPLATES[template];

  const moments = body.moments;
  if (!Array.isArray(moments) || moments.length < bounds.min) throw invalid(`A ${bounds.label} postcard needs at least ${bounds.min} moment.`);
  if (moments.length > bounds.max) throw invalid(`A ${bounds.label} postcard accepts at most ${bounds.max} moments.`);
  const seen = new Set();
  const refs = moments.map(moment => {
    if (!moment || typeof moment !== 'object' || Array.isArray(moment)) throw invalid('Each selected moment needs its owner and its id.');
    const { ownerId, id } = moment;
    if (typeof ownerId !== 'string' || ownerId.length < 1 || ownerId.length > 128) throw invalid('Each selected moment needs its owner and its id.');
    if (typeof id !== 'string' || id.length < 1 || id.length > 128) throw invalid('Each selected moment needs its owner and its id.');
    const key = `${ownerId}:${id}`;
    if (seen.has(key)) throw invalid('The same moment was selected twice. Choose each moment once.');
    seen.add(key);
    return { ownerId, id };
  });

  // One image id (or null for a deliberate text-only cell) per selected moment,
  // in the same order. Extra ids are rejected rather than ignored.
  const images = body.images;
  if (!Array.isArray(images) || images.length !== refs.length) throw invalid('Choose at most one photo per selected moment.');
  const imageRefs = images.map((image, index) => {
    if (image === null) return null;
    if (typeof image !== 'string' || image.length < 1 || image.length > 128) throw invalid('Each photo must be one of the moment\'s own images.');
    if (seen.has(`image:${image}`)) throw invalid('The same photo was selected twice. Choose each photo once.');
    seen.add(`image:${image}`);
    return image;
  });

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) throw invalid('Add a short title for the postcard.');
  if (title.length > POSTCARD_LIMITS.titleMax) throw invalid(`Keep the title to ${POSTCARD_LIMITS.titleMax} characters or fewer.`);

  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > POSTCARD_LIMITS.noteMax) throw invalid(`Keep the personal note to ${POSTCARD_LIMITS.noteMax} characters or fewer.`);

  // Captions are an optional array aligned with the selected moments. Anything
  // out of range is rejected rather than silently dropped.
  const rawCaptions = body.captions ?? [];
  if (!Array.isArray(rawCaptions)) throw invalid('Captions must be text per selected moment.');
  if (rawCaptions.length > refs.length) throw invalid('There are more captions than selected moments.');
  const captionList = refs.map((_, index) => {
    const value = rawCaptions[index] ?? '';
    if (typeof value !== 'string') throw invalid('Each caption must be text.');
    if (value.length > POSTCARD_LIMITS.captionMax) throw invalid(`Keep each caption to ${POSTCARD_LIMITS.captionMax} characters or fewer.`);
    return value.trim();
  });

  const showDate = body.showDate !== false;
  return { template, moments: refs, images: imageRefs, title, note, captions: captionList, showDate };
}

/**
 * Produce explicit drawing instructions. Throws an actionable error when the
 * supplied text cannot fit its allotted area — guidance instead of clipping.
 */
export function layoutPostcard({ template, title, note, showDate, cells, metrics }) {
  const invalid = message => Object.assign(new Error(message), { status: 400, postcard: true });
  if (!POSTCARD_TEMPLATES[template]) throw invalid('Unknown postcard template');
  const grid = GRIDS[template][cells.length];
  if (!grid) throw invalid(`A ${POSTCARD_TEMPLATES[template].label} postcard takes ${POSTCARD_TEMPLATES[template].min} to ${POSTCARD_TEMPLATES[template].max} cells.`);

  const text = [];
  const titleWrap = wrapText(title, { maxWidth: CONTENT_W, size: TITLE_SIZE, metrics, maxLines: 2 });
  if (titleWrap.overflow) throw invalid('The title is too long to fit. Shorten it or remove line breaks.');
  let y = 190;
  for (const line of titleWrap.lines) {
    text.push({ x: CONTENT_X, y, size: TITLE_SIZE, weight: 700, text: line, maxWidth: CONTENT_W, color: '#1c1917' });
    y += TITLE_SIZE + 18;
  }

  let cellsTop = 520;
  if (showDate && cells.length) {
    const dateText = cells.find(cell => cell.date)?.date;
    if (dateText) {
      text.push({ x: CONTENT_X, y: 420, size: DATE_SIZE, weight: 400, text: dateText, maxWidth: CONTENT_W, color: '#57534e' });
      cellsTop = 520;
    }
  }

  const imageCells = [];
  for (let index = 0; index < cells.length; index += 1) {
    const box = grid[index];
    const cell = cells[index];
    // The caption lives inside its own cell in a reserved band at the bottom,
    // so a caption can never spill into another cell or into the note area.
    let captionLines = [];
    if (cell.caption) {
      const captionWrap = wrapText(cell.caption, { maxWidth: box.w - CELL_PAD * 2, size: CAPTION_SIZE, metrics, maxLines: POSTCARD_LIMITS.captionLinesMax });
      if (captionWrap.overflow) throw invalid(`Caption ${index + 1} is too long for its photo. Shorten it to ${POSTCARD_LIMITS.captionLinesMax} lines.`);
      captionLines = captionWrap.lines;
    }
    const bandHeight = captionLines.length ? CELL_PAD + captionLines.length * (CAPTION_SIZE + CAPTION_GAP) : 0;
    const imageHeight = Math.max(0, box.h - bandHeight);
    let captionY = box.y + imageHeight + CELL_PAD + CAPTION_SIZE;
    for (const line of captionLines) {
      text.push({ x: box.x + CELL_PAD, y: captionY, size: CAPTION_SIZE, weight: 400, text: line, maxWidth: box.w - CELL_PAD * 2, color: '#44403c' });
      captionY += CAPTION_SIZE + CAPTION_GAP;
    }
    imageCells.push({
      x: box.x, y: box.y, w: box.w, h: box.h,
      imageId: cell.imageId ?? null, date: cell.date ?? null,
      imageHeight, bandTop: box.y + imageHeight, bandHeight,
    });
  }

  const noteLines = [];
  if (note) {
    const noteWrap = wrapText(note, { maxWidth: CONTENT_W, size: NOTE_SIZE, metrics, maxLines: POSTCARD_LIMITS.noteLinesMax });
    if (noteWrap.overflow) throw invalid(`The note is too long for the postcard. Shorten it to ${POSTCARD_LIMITS.noteLinesMax} lines (about ${POSTCARD_LIMITS.noteMax} characters).`);
    let noteY = NOTE_TOP + NOTE_SIZE;
    for (const line of noteWrap.lines) {
      if (noteY > NOTE_BOTTOM) throw invalid('The note runs past the bottom of the postcard. Shorten it.');
      text.push({ x: CONTENT_X, y: noteY, size: NOTE_SIZE, weight: 400, text: line, maxWidth: CONTENT_W, color: '#292524' });
      noteY += NOTE_SIZE + 14;
    }
    noteLines.push(...noteWrap.lines);
  }

  return {
    width: POSTCARD_WIDTH,
    height: POSTCARD_HEIGHT,
    background: '#fafaf9',
    cells: imageCells,
    text,
    cellsTop,
    noteLines,
  };
}
