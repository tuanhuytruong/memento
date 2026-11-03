import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from './mutation-safety.mjs';
import { uuid, storyText } from './story-validation.mjs';
const missing=()=>{throw new ApiError(404,'Story not found');};
export const storyProjection=`s.id,s.owner_id AS "ownerId",s.track_id AS "trackId",s.title,s.opening,s.closing,s.version,s.created_at AS "createdAt",s.updated_at AS "updatedAt"`;
export function storyACL(q,alias='s'){return `(${alias}.owner_id=$1 OR EXISTS(SELECT 1 FROM ${q}.track_collaborators c WHERE c.owner_id=${alias}.owner_id AND c.track_id=${alias}.${alias==='t'?'id':'track_id'} AND c.recipient_id=$1 AND c.accepted_at IS NOT NULL AND c.revoked_at IS NULL))`;}
function sign(raw,secret){if(typeof secret!=='string'||secret.length<32)throw new Error('Story signing secret required');return createHmac('sha256',secret).update('memento-stories-v1:'+raw).digest('base64url');}
export function encodeStoryCursor(value,secret){const raw=Buffer.from(JSON.stringify(value)).toString('base64url');return `${raw}.${sign(raw,secret)}`;}
export function decodeStoryCursor(token,scope,secret){
 const bad=()=>{throw new ApiError(400,'Invalid story cursor');};
 if(typeof token!=='string'||token.length>2048)bad();const parts=token.split('.');if(parts.length!==2||!/^[A-Za-z0-9_-]+$/.test(parts[0])||!/^[A-Za-z0-9_-]{43}$/.test(parts[1]))bad();
 const expected=sign(parts[0],secret);if(!timingSafeEqual(Buffer.from(expected),Buffer.from(parts[1])))bad();
 let value;try{value=JSON.parse(Buffer.from(parts[0],'base64url').toString());}catch{bad();}
 if(!value||value.userId!==scope.userId||value.trackOwnerId!==scope.trackOwnerId||value.trackId!==scope.trackId||!uuid(value.id)||typeof value.updatedAt!=='string'||!Number.isFinite(Date.parse(value.updatedAt))||!Number.isFinite(value.expiresAt)||value.expiresAt<Date.now())bad();return value;
}
export async function queryStories(pool,userId,input,q,secret=process.env.SESSION_SECRET){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['trackOwnerId','trackId','cursor','limit'].includes(k)))throw new ApiError(400,'Invalid story query');
 if(!uuid(input.trackOwnerId))throw new ApiError(400,'Invalid track owner');const trackId=storyText(input.trackId,200,true),limit=input.limit??20;
 if(!Number.isInteger(limit)||limit<1||limit>50)throw new ApiError(400,'Invalid story page limit');
 const scope={userId,trackOwnerId:input.trackOwnerId,trackId};const cursor=input.cursor==null?null:decodeStoryCursor(input.cursor,scope,secret);
 // Track authorization, page and projection share one statement snapshot; no owner lock on reads.
 const {rows:[row]}=await pool.query(`WITH allowed AS MATERIALIZED (SELECT t.id FROM ${q}.tracks t WHERE t.owner_id=$2 AND t.id=$3 AND ${storyACL(q,'t')}), page AS (
 SELECT ${storyProjection},(SELECT count(*)::int FROM ${q}.story_items i WHERE i.story_id=s.id) AS "itemCount",to_char(s.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTime"
 FROM ${q}.stories s WHERE s.owner_id=$2 AND s.track_id=$3 AND EXISTS(SELECT 1 FROM allowed)
 AND ($4::timestamptz IS NULL OR (s.updated_at,s.id)<($4::timestamptz,$5::uuid)) ORDER BY s.updated_at DESC,s.id DESC LIMIT $6)
 SELECT EXISTS(SELECT 1 FROM allowed) AS allowed,coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY "cursorTime" DESC,id DESC) FROM page),'[]'::jsonb) AS stories`,[userId,input.trackOwnerId,trackId,cursor?.updatedAt??null,cursor?.id??null,limit+1]);
 if(!row.allowed)missing();const page=row.stories.slice(0,limit),last=page.at(-1);const nextCursor=row.stories.length>limit?encodeStoryCursor({...scope,id:last.id,updatedAt:last.cursorTime,expiresAt:Date.now()+3600000},secret):null;
 return {stories:page.map(({cursorTime,...story})=>story),nextCursor};
}
export async function readStory(client,userId,id,q,safeMoment){
 if(!uuid(id))missing();
 const {rows:[row]}=await client.query(`SELECT ${storyProjection},coalesce((SELECT jsonb_agg(jsonb_build_object('itemId',i.item_id,'momentId',i.moment_id,'note',i.note,'position',i.position,
 'document',m.document,'version',m.version,'images',coalesce((SELECT jsonb_agg(jsonb_build_object('id',im.id) ORDER BY im.created_at,im.id) FROM ${q}.images im WHERE im.owner_id=m.owner_id AND im.moment_id=m.id),'[]'::jsonb)) ORDER BY i.position)
 FROM ${q}.story_items i LEFT JOIN ${q}.moments m ON m.owner_id=s.owner_id AND m.id=i.moment_id AND m.event_id=s.track_id WHERE i.story_id=s.id),'[]'::jsonb) AS items
 FROM ${q}.stories s WHERE s.id=$2 AND ${storyACL(q)}`,[userId,id]);
 if(!row)missing();const {items,...story}=row;story.itemCount=items.length;
 return {story,items:items.map(({document,version,images,...item})=>({...item,moment:document?safeMoment(document,images,[],version,story.ownerId):null})),capabilities:{canEdit:story.ownerId===userId,canDelete:story.ownerId===userId}};
}
export async function validateStoryLinks(client,userId,value,q,oldId=null){
 const track=await client.query(`SELECT 1 FROM ${q}.tracks WHERE owner_id=$1 AND id=$2`,[userId,value.trackId]);if(!track.rowCount)missing();
 const {rows}=await client.query(`SELECT m.id FROM ${q}.moments m WHERE m.owner_id=$1 AND m.event_id=$2 AND m.id=ANY($3::text[])`,[userId,value.trackId,value.items.map(i=>i.momentId)]);
 const valid=new Set(rows.map(r=>r.id));
 // Only exact stored item/moment pairs may retain an unavailable source; a client cannot invent links.
 const old=oldId?(await client.query(`SELECT item_id,moment_id FROM ${q}.story_items WHERE story_id=$1 AND owner_id=$2`,[oldId,userId])).rows:[];
 for(const item of value.items)if(!valid.has(item.momentId)&&!old.some(i=>i.item_id===item.itemId&&i.moment_id===item.momentId))throw new ApiError(400,'Story memory is unavailable in this track');
}
export async function replaceStoryItems(client,storyId,ownerId,items,q){
 await client.query(`DELETE FROM ${q}.story_items WHERE story_id=$1`,[storyId]);
 await client.query(`INSERT INTO ${q}.story_items(story_id,owner_id,item_id,moment_id,note,position) SELECT $1,$2,x.value->>'itemId',x.value->>'momentId',x.value->>'note',(x.n-1)::int FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS x(value,n)`,[storyId,ownerId,JSON.stringify(items)]);
}
