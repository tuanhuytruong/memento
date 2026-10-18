import { pathToFileURL } from 'node:url';
export async function backfillSearch(client, schema, {batchSize=200,delayMs=25,onBatch=()=>{}}={}) {
 if(schema!=='memento_dev') throw new Error('DEV only');
 if(!Number.isInteger(batchSize)||batchSize<1||batchSize>200)throw new Error('batch size 1..200');
 let key=null,total=0,batches=0;
 while(true){
  await client.query('BEGIN');
  try{
   await client.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='10s'");
   const rows=(await client.query(`SELECT owner_id,id FROM "memento_dev".moments WHERE search_text IS NULL ${key?'AND (owner_id,id)>($2::uuid,$3::text)':''} ORDER BY owner_id,id LIMIT $1 FOR UPDATE`,key?[batchSize,...key]:[batchSize])).rows;
   if(!rows.length){await client.query('COMMIT');break;}
   const result=await client.query(`UPDATE "memento_dev".moments SET search_text="memento_dev".moment_search_text_v1(document) WHERE (owner_id,id) IN (SELECT * FROM unnest($1::uuid[],$2::text[]))`,[rows.map(r=>r.owner_id),rows.map(r=>r.id)]);
   key=[rows.at(-1).owner_id,rows.at(-1).id]; total+=result.rowCount;batches++;
   await client.query('COMMIT');onBatch({rows:result.rowCount,batches});
  }catch(e){await client.query('ROLLBACK');throw e;}
  await new Promise(r=>setTimeout(r,delayMs));
 }
 const check=(await client.query(`SELECT count(*) FILTER(WHERE search_text IS NULL)::int AS remaining,count(*) FILTER(WHERE search_text IS DISTINCT FROM "memento_dev".moment_search_text_v1(document))::int AS mismatches FROM "memento_dev".moments`)).rows[0];
 if(check.remaining||check.mismatches)throw new Error('Search backfill verification failed; rerun safely');
 return {total,batches,...check};
}
if(import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.includes('--help')){console.log('DEV only. Dry run: node scripts/backfill-moment-search.mjs. Apply: --apply --confirm=dwh.memento_dev. Batches 200, one connection, lock 2s/statement 10s, delay 25ms. Resume by NULL rows; no IDs logged.');process.exit(0);}
 const {pool,schema}=await import('../memento-db.mjs');const c=await pool.connect();
 try{
  if(schema!=='memento_dev'||(await c.query('SELECT current_database() AS db')).rows[0].db!=='dwh')throw new Error('DEV target mismatch');
  if(process.argv.includes('--apply')){
   if(!process.argv.includes('--confirm=dwh.memento_dev'))throw new Error('Explicit target confirmation required');
   console.log(JSON.stringify(await backfillSearch(c,schema)));
  }else console.log(JSON.stringify({dryRun:true,...(await c.query('SELECT count(*)::int AS remaining FROM memento_dev.moments WHERE search_text IS NULL')).rows[0]}));
 }finally{c.release();await pool.end();}
}
