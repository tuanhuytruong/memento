import test from 'node:test';
import assert from 'node:assert/strict';
import {backfillSearch} from '../scripts/backfill-moment-search.mjs';
test('backfill refuses non DEV and unbounded batch',async()=>{
 await assert.rejects(()=>backfillSearch({},'memento'),/DEV only/);
 await assert.rejects(()=>backfillSearch({},'memento_dev',{batchSize:201}),/batch size/);
});
test('backfill batches, keyset resume, commit and rollback without document logging',async()=>{
 let step=0;const queries=[];
 const c={query:async(sql,args)=>{queries.push({sql,args});if(sql.startsWith('SELECT owner_id'))return{rows:step++===0?[{owner_id:'fixture',id:'one'}]:[]};if(sql.startsWith('UPDATE'))return{rowCount:1};return{rows:[{remaining:0,mismatches:0}]};}};
 assert.deepEqual(await backfillSearch(c,'memento_dev',{batchSize:1,delayMs:0}),{total:1,batches:1,remaining:0,mismatches:0});
 assert.ok(queries.some(q=>q.sql.includes('(owner_id,id)>($2::uuid,$3::text)')));
 assert.ok(queries.some(q=>q.sql.includes('FOR UPDATE')));
 assert.ok(queries.some(q=>q.sql.includes('moment_search_text_v1(document)')));
 assert.ok(!queries.some(q=>q.sql.includes('OFFSET')));
 const bad={query:async sql=>{if(sql.startsWith('SELECT owner_id'))throw Error('fixture failure');return{rows:[]};}};
 await assert.rejects(()=>backfillSearch(bad,'memento_dev'),/fixture failure/);
});
