// DEV canary: render all three templates with a real authorized photo and
// Vietnamese text, saving artifacts for visual inspection. Synthetic layout
// fixtures only — no user content, no credentials.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const { validatePostcardRequest } = await import('../postcard-layout.mjs');
const { renderPostcard } = await import('../postcard-renderer.mjs');

const OUT = process.env.MEMENTO_UI_ARTIFACTS || '/tmp/postcard-canary';
fs.mkdirSync(OUT, { recursive: true });

// Realistic reference photos at true aspect ratios.
async function photo(width, height, background, orientation) {
  const base = sharp({ create: { width, height, channels: 3, background } });
  // A marker band so contain-fit and any accidental crop are visible.
  const band = await sharp({ create: { width: Math.max(8, Math.round(width / 12)), height, channels: 3, background: '#ff2d55' } }).png().toBuffer();
  return base.composite([{ input: band, top: 0, left: 0 }]).png().toBuffer();
}

const cases = [
  { name: 'journey-six', template: 'journey', count: 6, note: 'Sáu chặng đường của một mùa hè rất dài và ấm áp.', title: 'Hành trình Đà Nẵng – Huế' },
  // Portrait 900x1600 into a landscape cell: contain must letterbox, never stretch.
  { name: 'ordinary-portrait', template: 'ordinary', count: 1, note: 'Chỉ một buổi chiều mưa, nhưng nhớ mãi.', title: 'Một chiều mưa' },
  // Extreme 3:1 panorama: contain must letterbox vertically.
  { name: 'ordinary-panorama', template: 'ordinary', count: 1, note: 'Một bức toàn cảnh rất dài.', title: 'Toàn cảnh biển', aspect: [2400, 800, '#065f46'] },
  { name: 'month-recap', template: 'month', count: 4, note: 'Tổng kết tháng với đủ khoảnh khắc bình dị.', title: 'Tổng kết tháng Một' },
];
// Deliberately awkward sources so contain-fit is genuinely exercised: a
// landscape 4:3, a tall portrait 9:16, and an extreme 3:1 panorama.
const aspects = [[900, 1600, '#7c3aed'], [4000, 3000, '#0e7490'], [2400, 800, '#065f46']];

for (const item of cases) {
  const moments = Array.from({ length: item.count }, (_, i) => ({ ownerId: 'canary-owner', id: `m${i}` }));
  const images = Array.from({ length: item.count }, (_, i) => `img${i}`);
  const captions = Array.from({ length: item.count }, (_, i) => (i % 2 === 0 ? `Khoảnh khắc ${i + 1} với chú thích tiếng Việt` : ''));
  const spec = validatePostcardRequest({ template: item.template, moments, images, captions, title: item.title, note: item.note, showDate: true });
  const photos = [];
  for (let i = 0; i < item.count; i += 1) {
    const [w, h, bg] = item.aspect ? item.aspect : aspects[i % aspects.length];
    photos.push({ buffer: await photo(w, h, bg), contentType: 'image/png' });
  }
  const started = Date.now();
  const png = await renderPostcard({ spec, photos });
  const duration = Date.now() - started;
  const out = path.join(OUT, `${item.name}.png`);
  fs.writeFileSync(out, png);
  const meta = await sharp(png).metadata();
  console.log(`${item.name}: ${meta.width}x${meta.height} ${png.length}B ${duration}ms -> ${out}`);
}

// A text-heavy case to check wrapping and long Vietnamese diacritics.
const longNote = 'Một tấm bưu thiếp nhỏ gửi lại chính mình của nhiều năm trước, với đủ dấu tiếng Việt: ưở ữ ỡ ọ ấ ầ ể ệ ơ ư đ Đ.';
const spec = validatePostcardRequest({ template: 'ordinary', moments: [{ ownerId: 'canary-owner', id: 'm0' }], images: [null], title: 'Bưu thiếp dài', note: longNote.slice(0, 500), showDate: true });
const png = await renderPostcard({ spec, photos: [null] });
fs.writeFileSync(path.join(OUT, 'long-note.png'), png);
console.log(`long-note: ${png.length}B -> ${path.join(OUT, 'long-note.png')}`);
