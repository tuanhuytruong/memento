import {ApiError} from './mutation-safety.mjs';
import {uuid} from './story-validation.mjs';
import {createHmac,timingSafeEqual} from 'node:crypto';
const cursorPurpose='memento-future-letters-v1';
function signLetterCursor(raw,secret){
 if(typeof secret!=='string'||secret.length<32)throw new Error('Letter signing secret required');
 return createHmac('sha256',secret).update(cursorPurpose+':'+raw).digest('base64url');
}
export function encodeLetterCursor(value,secret){
 const raw=Buffer.from(JSON.stringify({...value,purpose:cursorPurpose})).toString('base64url');
 return `${raw}.${signLetterCursor(raw,secret)}`;
}
export function decodeLetterCursor(token,scope,secret){
 const bad=()=>{throw new ApiError(400,'Invalid letter cursor');};
 if(typeof token!=='string'||token.length>2048)bad();
 const parts=token.split('.');if(parts.length!==2||!/^[A-Za-z0-9_-]+$/.test(parts[0])||!/^[A-Za-z0-9_-]{43}$/.test(parts[1]))bad();
 if(!timingSafeEqual(Buffer.from(signLetterCursor(parts[0],secret)),Buffer.from(parts[1])))bad();
 let value;try{value=JSON.parse(Buffer.from(parts[0],'base64url').toString());}catch{bad();}
 if(!value||value.purpose!==cursorPurpose||value.userId!==scope.userId||value.state!==scope.state||!uuid(value.id)||typeof value.updatedAt!=='string'||!Number.isFinite(Date.parse(value.updatedAt))||!Number.isFinite(value.expiresAt)||value.expiresAt<Date.now())bad();
 return value;
}
export const letterMissing=()=>{throw new ApiError(404,'Letter not found');};
// SQL CASE prevents unopened content and photo identities from leaving PostgreSQL.
export function letterJSON(q,content=true){return `jsonb_build_object('id',l.id,'ownerId',l.owner_id,'title',l.title,'releaseAt',l.release_at,'timezone',l.timezone,'state',CASE WHEN l.opened_at IS NOT NULL THEN 'opened' WHEN l.sealed_at IS NULL THEN 'draft' WHEN l.release_at<=statement_timestamp() THEN 'ready' ELSE 'sealed' END,'version',l.version,'sealedAt',l.sealed_at,'openedAt',l.opened_at,'createdAt',l.created_at,'updatedAt',l.updated_at,'attachmentCount',(SELECT count(*)::int FROM ${q}.future_letter_photos p WHERE p.letter_id=l.id)) ${content?`|| CASE WHEN l.sealed_at IS NULL OR l.opened_at IS NOT NULL THEN jsonb_build_object('body',l.body,'photos',coalesce((SELECT jsonb_agg(jsonb_build_object('momentId',p.moment_id,'imageId',p.image_id,'available',im.id IS NOT NULL) || CASE WHEN im.id IS NOT NULL THEN jsonb_build_object('image','/api/images/'||im.id) ELSE '{}'::jsonb END ORDER BY p.position) FROM ${q}.future_letter_photos p LEFT JOIN ${q}.moments m ON m.owner_id=l.owner_id AND m.id=p.moment_id LEFT JOIN ${q}.images im ON im.owner_id=m.owner_id AND im.moment_id=m.id AND im.id::text=p.image_id WHERE p.letter_id=l.id),'[]'::jsonb)) ELSE '{}'::jsonb END`:''}`;}
export async function readLetter(c,user,id,q){if(!uuid(id))letterMissing();const {rows:[r]}=await c.query(`SELECT ${letterJSON(q)} AS letter FROM ${q}.future_letters l WHERE l.id=$2 AND l.owner_id=$1`,[user,id]);if(!r)letterMissing();return r;}
export async function validateLetterLinks(c,user,photos,q){for(const photo of photos){const r=await c.query(`SELECT 1 FROM ${q}.images im JOIN ${q}.moments m ON m.owner_id=im.owner_id AND m.id=im.moment_id WHERE im.owner_id=$1 AND im.moment_id=$2 AND im.id::text=$3`,[user,photo.momentId,photo.imageId]);if(!r.rowCount)throw new ApiError(400,'Letter photo is unavailable');}}
export async function replaceLetterPhotos(c,user,id,photos,q){await c.query(`DELETE FROM ${q}.future_letter_photos WHERE letter_id=$1`,[id]);for(const [n,p] of photos.entries())await c.query(`INSERT INTO ${q}.future_letter_photos(letter_id,owner_id,position,moment_id,image_id) VALUES($1,$2,$3,$4,$5)`,[id,user,n,p.momentId,p.imageId]);}
export async function queryLetters(c,user,input,q,secret=process.env.SESSION_SECRET){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['state','cursor','limit'].includes(k)))throw new ApiError(400,'Invalid letter query');
 const state=input.state??null,limit=input.limit??20;if((state!==null&&!['draft','sealed','ready','opened'].includes(state))||!Number.isInteger(limit)||limit<1||limit>50)throw new ApiError(400,'Invalid letter query');
 // A separate signed navigation domain cannot accept feed/story tokens.
 const scope={userId:user,state};const cursor=input.cursor==null?null:decodeLetterCursor(input.cursor,scope,secret);
 const {rows}=await c.query(`SELECT ${letterJSON(q,false)} AS letter,to_char(l.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS time FROM ${q}.future_letters l WHERE l.owner_id=$1 AND ($2::text IS NULL OR CASE WHEN l.opened_at IS NOT NULL THEN 'opened' WHEN l.sealed_at IS NULL THEN 'draft' WHEN l.release_at<=statement_timestamp() THEN 'ready' ELSE 'sealed' END=$2) AND ($3::timestamptz IS NULL OR (l.updated_at,l.id)<($3::timestamptz,$4::uuid)) ORDER BY l.updated_at DESC,l.id DESC LIMIT $5`,[user,state,cursor?.updatedAt??null,cursor?.id??null,limit+1]);
 const page=rows.slice(0,limit),last=page.at(-1);return {letters:page.map(r=>r.letter),nextCursor:rows.length>limit?encodeLetterCursor({...scope,id:last.letter.id,updatedAt:last.time,expiresAt:Date.now()+3600000},secret):null};
}
