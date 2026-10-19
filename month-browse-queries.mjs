import {ApiError} from './mutation-safety.mjs';
import {AUTHORIZED_SCOPE,buildMomentPredicates,sqlCalendarDate,dateKey,timeKey,scopeHash,validateQueryRequest,queryMoments,queryFacets} from './moment-queries.mjs';
import {sealBrowseCursor,openBrowseCursor} from './navigation-cursors.mjs';
export {sealBrowseCursor,openBrowseCursor};
const invalid=message=>{throw new ApiError(400,message);};
export function validateMonth(month){if(typeof month!=='string'||!(month==='undated'||/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)))invalid('invalid month');return month;}
export function validateBrowseRequest(body={},purpose){
 const max=purpose==='months'?120:purpose==='preview'?40:100;
 const limit=body.limit??(purpose==='months'?120:purpose==='preview'?24:40);
 if(!Number.isInteger(limit)||limit<1||limit>max)invalid('invalid limit');
 if(body.navigation!=null&&!['next','previous'].includes(body.navigation))invalid('invalid navigation');
 if(body.cursor!=null&&(typeof body.cursor!=='string'||body.cursor.length>8192))invalid('invalid cursor');
 if(purpose==='preview')validateMonth(body.month);
 if(purpose==='months'&&body.year!=null&&(typeof body.year!=='string'||!/^\d{4}$/.test(body.year)))invalid('invalid year');
 if(purpose==='seek'){
  const target=body.target;
  if(!target||typeof target!=='object'||Array.isArray(target))invalid('invalid target');
  if(Object.keys(target).length===1&&'month'in target)validateMonth(target.month);
  else if(Object.keys(target).length!==2||typeof target.id!=='string'||!target.id||target.id.length>512||typeof target.ownerId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target.ownerId))invalid('invalid target');
 }
 return {...body,limit,navigation:body.navigation??'next'};
}
function base(user,request,schema){const {args,where}=buildMomentPredicates(user,request.filters);return {args,where,cte:`WITH authorized AS (${AUTHORIZED_SCOPE.replace('m.document, m.version','m.document, m.version, m.search_text')}), q AS (SELECT * FROM authorized)`.replaceAll('{schema}',schema)};}
function monthPredicate(month,args){const valid=sqlCalendarDate("q.document->>'date'");if(month==='undated')return `NOT coalesce(${valid},false)`;args.push(month);return `${valid} AND left(q.document->>'date',7)=$${args.length}`;}
const tuple=alias=>`(${dateKey(alias)},${timeKey(alias)},${alias}.owner_id,${alias}.id)`;
function order(direction,reverse=false){const d=(direction==='newest')!==reverse?'DESC':'ASC';return `${dateKey('q')} ${d},${timeKey('q')} ${d},q.owner_id ${d},q.id ${d}`;}
export async function browseMonths(client,user,body,schema){
 const input=validateBrowseRequest(body,'months');const request=validateQueryRequest({...body,limit:40},user);const scope=scopeHash(request.filters,request.direction,user);
 const {args,where,cte}=base(user,request,schema);const valid=sqlCalendarDate("q.document->>'date'");
 const aggregate=await client.query(`${cte} SELECT CASE WHEN ${valid} THEN left(q.document->>'date',4) ELSE null END AS year,count(*)::int AS count FROM q ${where.length?'WHERE '+where.join(' AND '):''} GROUP BY 1 ORDER BY 1 ${request.direction==='newest'?'DESC':'ASC'} NULLS LAST`.replaceAll('{schema}',schema),args);
 const years=aggregate.rows.filter(r=>r.year!==null);const undatedCount=aggregate.rows.find(r=>r.year===null)?.count??0;
 const binding={user,scope,purpose:'months',year:input.year??null,navigation:input.navigation};
 const cursor=input.cursor?openBrowseCursor(input.cursor,binding):null;
 where.push(valid);if(input.year){args.push(input.year);where.push(`left(q.document->>'date',4)=$${args.length}`);}
 const reverse=input.navigation==='previous';const descending=(request.direction==='newest')!==reverse;
 const having=cursor?(args.push(cursor.key),`HAVING left(q.document->>'date',7) ${descending?'<':'>'} $${args.length}`):'';
 args.push(input.limit+1);
 const result=await client.query(`${cte} SELECT left(q.document->>'date',7) AS key,count(*)::int AS count FROM q WHERE ${where.join(' AND ')} GROUP BY 1 ${having} ORDER BY 1 ${descending?'DESC':'ASC'} LIMIT $${args.length}`.replaceAll('{schema}',schema),args);
 const hasMore=result.rows.length>input.limit;const months=result.rows.slice(0,input.limit);if(reverse)months.reverse();
 const token=(row,navigation)=>row?sealBrowseCursor({key:row.key},{...binding,navigation}):null;
 return {scope,years,months,undatedCount,nextCursor:(reverse?!!cursor:hasMore)?token(months.at(-1),'next'):null,previousCursor:(reverse?hasMore:!!cursor)?token(months[0],'previous'):null};
}
export async function browsePreview(client,user,body,schema){
 const input=validateBrowseRequest(body,'preview');const request=validateQueryRequest(input,user);const scope=scopeHash(request.filters,request.direction,user);
 const {args,where,cte}=base(user,request,schema);where.push(monthPredicate(input.month,args));
 const total=(await client.query(`${cte} SELECT count(*)::int AS total FROM q WHERE ${where.join(' AND ')}`.replaceAll('{schema}',schema),args)).rows[0].total;
 const binding={user,scope,month:input.month,purpose:'preview',navigation:input.navigation};const cursor=input.cursor?openBrowseCursor(input.cursor,binding):null;
 const reverse=input.navigation==='previous';if(cursor){args.push(cursor.date,cursor.time,cursor.ownerId,cursor.id);where.push(`${tuple('q')} ${(request.direction==='newest')!==reverse?'<':'>'} ($${args.length-3},$${args.length-2},$${args.length-1},$${args.length})`);}
 args.push(input.limit+1);
 // The lateral index lookup returns only one image per bounded candidate. No album metadata leaves this query.
 const result=await client.query(`${cte} SELECT q.owner_id,q.id,q.event_id,q.document->>'date' AS date,q.document->>'time' AS time,left(q.document->>'title',300) AS title,left(coalesce(nullif(q.document->>'description',''),q.document->>'idea',''),200) AS excerpt,${dateKey('q')} AS sort_date,${timeKey('q')} AS sort_time,(SELECT i.id FROM ${schema}.images i WHERE i.owner_id=q.owner_id AND i.moment_id=q.id ORDER BY i.created_at,i.id LIMIT 1) AS image_id FROM q WHERE ${where.join(' AND ')} ORDER BY ${order(request.direction,reverse)} LIMIT $${args.length}`.replaceAll('{schema}',schema),args);
 const hasMore=result.rows.length>input.limit;const rows=result.rows.slice(0,input.limit);if(reverse)rows.reverse();
 const token=(row,navigation)=>row?sealBrowseCursor({date:row.sort_date,time:row.sort_time,ownerId:row.owner_id,id:row.id},{...binding,navigation}):null;
 return {scope,month:input.month,total,items:rows.map(r=>({ownerId:r.owner_id,id:r.id,eventId:r.event_id,date:r.date,time:r.time,title:r.title||'',excerpt:r.excerpt,thumbUrl:r.image_id?`/api/images/${encodeURIComponent(r.image_id)}?variant=thumb`:null})),nextCursor:(reverse?!!cursor:hasMore)?token(rows.at(-1),'next'):null,previousCursor:(reverse?hasMore:!!cursor)?token(rows[0],'previous'):null};
}
export async function seekMoments(client,user,body,schema,helpers){
 const input=validateBrowseRequest(body,'seek');const request=validateQueryRequest(input,user);const {args,where,cte}=base(user,request,schema);
 if('month'in input.target)where.push(monthPredicate(input.target.month,args));else{args.push(input.target.ownerId,input.target.id);where.push(`q.owner_id=$${args.length-1} AND q.id=$${args.length}`);}
 const {rows}=await client.query(`${cte} SELECT q.owner_id,q.id,${dateKey('q')} AS date,${timeKey('q')} AS time FROM q WHERE ${where.length?where.join(' AND '):'true'} ORDER BY ${order(request.direction)} LIMIT 1`.replaceAll('{schema}',schema),args);
 if(!rows.length)throw new ApiError(404,'Memory not available within current filters');const row=rows[0];
 const page=await queryMoments(client,user,{...request,seekTuple:{date:row.date,time:row.time,ownerId:row.owner_id,id:row.id}},schema,helpers);
 if(!page.moments.some(m=>m.id===row.id&&m.resourceOwnerId===row.owner_id))throw new ApiError(404,'Memory not available within current filters');
 const facets=await queryFacets(client,user,request,schema);
 return {...page,total:facets.total,target:{ownerId:row.owner_id,id:row.id},month:'month'in input.target?input.target.month:null};
}
