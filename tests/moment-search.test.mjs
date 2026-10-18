import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { searchableText, foldNeedle, sqlSearchCorpus, literalSearchPattern, corpusMigration } from '../moment-search.mjs';

test('canonical field order, empty and malformed optional fields', () => {
 assert.equal(searchableText({title:' Đà  Lạt ',description:'\tSương',idea:'',tags:['',null,'vui'],emotion:'joy',location:{name:'Hồ',city:'Huế',country:'Việt Nam'}}),'da lat suong vui joy ho hue viet nam');
 assert.equal(searchableText({tags:{},title:null,location:2}),'');
 assert.equal(literalSearchPattern(' %_\\ '),'%\\%\\_\\\\%');
});
test('migration is generated from canonical builder', async()=>assert.equal(await fs.readFile(new URL('../migrations/010-moment-search-corpus.sql',import.meta.url),'utf8'),corpusMigration()));
test('SQL corpus parity, trigger atomicity and private column', {timeout:60000}, async t => {
 if(process.env.RUN_INTEGRATION!=='1') return t.skip('requires DB');
 const {pool,qschema,schema}=await import('../memento-db.mjs');
 assert.equal(schema,'memento_dev');
 const c=await pool.connect();
 try {
  const letters='àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ';
  const texts=['title description','%_\\\' DROP TABLE x; --','😀 東京 Ελληνικά café Ångström Ç ñ',' x \t\n y ',letters,letters.toUpperCase(),letters.normalize('NFD'),'a\u00a0b\u2003c'];
  for(const text of texts){const doc={title:text,description:'story',tags:['',text],location:{city:text}};const r=await c.query(`SELECT ${sqlSearchCorpus('$1::jsonb')} AS corpus`,[doc]);assert.equal(r.rows[0].corpus,searchableText(doc));}
  for(const doc of [{tags:null},{tags:'legacy'},{title:12,tags:[false,12,{},'tag'],location:[]}]) assert.equal((await c.query(`SELECT ${sqlSearchCorpus('$1::jsonb')} AS corpus`,[doc])).rows[0].corpus,searchableText(doc));
  await c.query('BEGIN');
  await c.query(`CREATE TEMP TABLE search_trigger_probe (LIKE ${qschema}.moments INCLUDING ALL) ON COMMIT DROP`);
  await c.query(`CREATE TRIGGER search_probe BEFORE INSERT OR UPDATE OF document ON search_trigger_probe FOR EACH ROW EXECUTE FUNCTION ${qschema}.maintain_moment_search_v1()`);
  await c.query(`INSERT INTO search_trigger_probe(owner_id,id,event_id,document) VALUES('00000000-0000-4000-8000-000000000001','probe','track',$1)`,[{id:'probe',eventId:'track',title:'Old',tags:[]}]);
  await c.query('SAVEPOINT before_change');
  await c.query(`UPDATE search_trigger_probe SET document=jsonb_set(document,'{title}','"New"')`);
  assert.equal((await c.query('SELECT search_text FROM search_trigger_probe')).rows[0].search_text,'new');
  await c.query('ROLLBACK TO before_change');
  const row=(await c.query('SELECT * FROM search_trigger_probe')).rows[0];assert.equal(row.search_text,'old');
  await c.query(`UPDATE search_trigger_probe SET document=jsonb_set(document,'{tags}','["Đổi tên"]')`);
  assert.equal((await c.query('SELECT search_text FROM search_trigger_probe')).rows[0].search_text,'old doi ten');
  await c.query('ROLLBACK');
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
