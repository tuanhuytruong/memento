// Canonical main-feed search v1. Private derived data; never serialize search_text.
// Discovery intentionally retains its own field semantics.
export const SEARCH_VERSION = 1;
export function foldNeedle(input) {
  return String(input).normalize('NFC').replace(/Đ/g, 'D').replace(/đ/g, 'd')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
export function sqlFold(expression) {
  // Use the same decomposition/mark interval as JS, not a Vietnamese-only map.
  return `btrim(regexp_replace(lower(normalize(regexp_replace(normalize(translate(normalize(${expression}, NFC), 'Đđ', 'Dd'), NFD), '[̀-ͯ]', '', 'g'), NFC)), '[[:space:]   -     　﻿]+', ' ', 'g'))`;
}
const stringField = (doc, key) => `CASE WHEN jsonb_typeof(${doc}->'${key}') = 'string' THEN ${doc}->>'${key}' ELSE '' END`;
export function sqlSearchCorpus(doc = 'document') {
  const fields = ['title', 'description', 'idea'].map(k => stringField(doc,k));
  const tags = `CASE WHEN jsonb_typeof(${doc}->'tags') = 'array' THEN ${doc}->'tags' ELSE '[]'::jsonb END`;
  const tail = [stringField(doc,'emotion'), ...['name','city','country'].map(k => stringField(`(${doc}->'location')`,k))];
  const values = [...fields.map((f,i)=>`SELECT ${i}::bigint AS position, ${f} AS value`),
    `SELECT 3 + ordinality AS position, CASE WHEN jsonb_typeof(value)='string' THEN value #>> '{}' ELSE '' END AS value FROM jsonb_array_elements(${tags}) WITH ORDINALITY`,
    ...tail.map((f,i)=>`SELECT ${1000000+i}::bigint AS position, ${f} AS value`)];
  return `(SELECT coalesce(string_agg(folded, ' ' ORDER BY position), '') FROM (SELECT position, ${sqlFold('value')} AS folded FROM (${values.join(' UNION ALL ')}) fields) normalized WHERE folded <> '')`;
}
export function searchableText(document = {}) {
  const text = value => typeof value === 'string' ? value : '';
  return [document.title, document.description, document.idea,
    ...(Array.isArray(document.tags) ? document.tags : []), document.emotion,
    document.location?.name, document.location?.city, document.location?.country]
    .map(text).map(foldNeedle).filter(Boolean).join(' ');
}
export function literalSearchPattern(input) {
  return `%${foldNeedle(input).replace(/[\\%_]/g, '\\$&')}%`;
}
export function corpusMigration() {
  return `-- Generated from moment-search.mjs: corpusMigration(); parity checked in tests.\nSET LOCAL lock_timeout = '3s';\nALTER TABLE "memento_dev".moments ADD COLUMN search_text text;\nCREATE FUNCTION "memento_dev".moment_search_text_v1(document jsonb) RETURNS text\nLANGUAGE sql IMMUTABLE PARALLEL SAFE RETURN ${sqlSearchCorpus('document')};\nCREATE FUNCTION "memento_dev".maintain_moment_search_v1() RETURNS trigger\nLANGUAGE plpgsql AS $$ BEGIN NEW.search_text := "memento_dev".moment_search_text_v1(NEW.document); RETURN NEW; END $$;\nCREATE TRIGGER moment_search_v1 BEFORE INSERT OR UPDATE OF document ON "memento_dev".moments\nFOR EACH ROW EXECUTE FUNCTION "memento_dev".maintain_moment_search_v1();\n`;
}
