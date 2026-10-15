import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env.local', quiet: true });
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { pool, qschema } from '../memento-db.mjs';
import { makeImageVariants } from '../image-variants.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback) => { const index = args.indexOf(flag); return index < 0 ? fallback : args[index + 1]; };
const dryRun = args.includes('--dry-run');
const limit = Math.min(Math.max(Number(value('--limit', 10)), 1), 100);
if (!dryRun && process.env.CONFIRM_IMAGE_VARIANT_BACKFILL !== '1') throw new Error('Set CONFIRM_IMAGE_VARIANT_BACKFILL=1 or use --dry-run');
const schema = process.env.DB_SCHEMA;
const prefix = process.env.R2_PREFIX || `${schema}/`;
if (!['memento', 'memento_dev'].includes(schema) || prefix !== `${schema}/`) throw new Error('Refusing backfill: schema/prefix mismatch');
const s3 = new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
const streamBuffer = async stream => Buffer.concat(await (async () => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks; })());
const { rows } = await pool.query(`SELECT id,object_key,content_type,thumb_object_key,display_object_key FROM ${qschema}.images WHERE thumb_object_key IS NULL OR display_object_key IS NULL ORDER BY id LIMIT $1`, [limit]);
let processed = 0, skipped = 0, failed = 0, bytes = 0;
for (const row of rows) {
  try {
    if (!row.object_key.startsWith(prefix)) throw new Error('object prefix mismatch');
    const source = await s3.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: row.object_key }));
    const variants = await makeImageVariants(await streamBuffer(source.Body), row.content_type);
    if (!variants.thumb || !variants.display) { skipped++; console.log(`skip ${row.id}: no static derivatives`); continue; }
    const base = row.object_key.replace(/\/original$/, '');
    const thumbKey = `${base}/thumb.webp`, displayKey = `${base}/display.webp`;
    if (!dryRun) {
      if (!row.thumb_object_key) await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: thumbKey, Body: variants.thumb.body, ContentType: 'image/webp', CacheControl: 'private, no-store' }));
      if (!row.display_object_key) await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: displayKey, Body: variants.display.body, ContentType: 'image/webp', CacheControl: 'private, no-store' }));
      await pool.query(`UPDATE ${qschema}.images SET thumb_object_key=COALESCE(thumb_object_key,$2),display_object_key=COALESCE(display_object_key,$3),thumb_size=COALESCE(thumb_size,$4),display_size=COALESCE(display_size,$5),width=COALESCE(width,$6),height=COALESCE(height,$7) WHERE id=$1`, [row.id, thumbKey, displayKey, variants.thumb.size, variants.display.size, variants.width, variants.height]);
    }
    processed++; bytes += variants.thumb.size + variants.display.size; console.log(`${dryRun ? 'would process' : 'processed'} ${row.id}`);
  } catch (error) { failed++; console.error(`failed ${row.id}: ${error.message}`); }
}
console.log(JSON.stringify({ dryRun, candidates: rows.length, processed, skipped, failed, derivativeBytes: bytes }));
await pool.end();
