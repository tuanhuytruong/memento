import test from 'node:test';
import assert from 'node:assert/strict';
import {queryMoments,queryFacets,validateQueryRequest} from '../moment-queries.mjs';
import {matchesMomentFilters,EMPTY_FILTERS} from '../src/lib/momentFilters.ts';
import {searchableText} from '../moment-search.mjs';
test('all filters: complete page identities and totals equal independent JS with literal substring', {timeout:60000},async t=>{
 if(process.env.RUN_INTEGRATION!=='1')return t.skip('requires DEV DB');
 const {pool,qschema,schema}=await import('../memento-db.mjs');assert.equal(schema,'memento_dev');
 const c=await pool.connect();const owner='00000000-0000-4000-8000-000000000001';const other='00000000-0000-4000-8000-000000000002';
 try{await c.query('BEGIN');for(const table of ['moments','images','saved_moments','track_collaborators'])await c.query(`CREATE TEMP TABLE ${table} (LIKE ${qschema}.${table} INCLUDING ALL) ON COMMIT DROP`);
 const docs=Array.from({length:16},(_,i)=>({id:'p'+i,eventId:i%2?'shared':'private',title:i%2?'Đà Lạt %_\\':'Other',description:'story',idea:'idea',tags:i%3?['DU LỊCH','second']:[],emotion:i%2?'joy':'sad',date:['2026-01-10','2025-04-01','2026-02-30','legacy',null][i%5],isMilestone:i%3===0,images:[],resourceOwnerId:owner}));
 for(const d of docs)await c.query(`INSERT INTO pg_temp.moments(owner_id,id,event_id,document,search_text) VALUES($1,$2,$3,$4,$5)`,[owner,d.id,d.eventId,d,searchableText(d)]);
 await c.query(`INSERT INTO pg_temp.saved_moments(user_id,moment_owner_id,moment_id) SELECT $1,$1,id FROM pg_temp.moments WHERE id IN ('p1','p3','p5')`,[owner]);
 const inputs=[{},...['da lat','%','_','\\','lat %_','LẠT','khong co'].map(search=>({search})),{selectedTags:['du lich']},{selectedEmotions:['joy']},{milestonesOnly:true},{hasImagesOnly:true},{savedOnly:true},{selectedYear:'2025'},{dateFrom:'2026-01-01',dateTo:'2026-12-31'},{search:'da lat',selectedTags:['DU LỊCH'],selectedEmotions:['joy'],dateFrom:'2026-01-01',milestonesOnly:true},{trackKey:owner+':shared'},{search:'da lat',savedOnly:true}];
 for(const input of inputs){const req=validateQueryRequest({...input,limit:2},owner);let seen=[],cursor=null;
 do{const r=await queryMoments(c,owner,{...req,cursor},'pg_temp',{safeMoment:d=>d});seen.push(...r.moments.map(d=>d.id));cursor=r.nextCursor;}while(cursor);
 const total=await queryFacets(c,owner,req,'pg_temp');
 const filters={...EMPTY_FILTERS,...input,selectedYear:req.filters.selectedYear};
 const expected=docs.filter(d=>matchesMomentFilters({...d,date:d.date??'legacy'},filters,ev=>['p1','p3','p5'].includes(ev.id))).filter(d=>!input.trackKey||input.trackKey===owner+':'+d.eventId).map(d=>d.id).sort();
 assert.deepEqual([...seen].sort(),expected);assert.equal(total.total,expected.length);assert.equal(new Set(seen).size,seen.length);
 }
 const denied=await queryFacets(c,other,validateQueryRequest({search:'da lat'},other),'pg_temp');assert.equal(denied.total,0);
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
