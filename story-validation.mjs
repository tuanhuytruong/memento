import { createHash } from 'node:crypto';
import { ApiError } from './mutation-safety.mjs';
const bad=()=>{throw new ApiError(400,'Invalid story document');};
export const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function storyText(value,max,required=false){if(typeof value!=='string'||value.includes('\u0000')||!value.isWellFormed()||value.length>max||(required&&!value.trim()))bad();return required?value.trim():value;}
export function validateStory(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['trackId','title','opening','closing','items','expectedVersion'].includes(k)))bad();
 const trackId=storyText(input.trackId,200,true),title=storyText(input.title,120,true),opening=storyText(input.opening??'',4000),closing=storyText(input.closing??'',4000);
 if(!Array.isArray(input.items)||input.items.length<1||input.items.length>50)bad();
 const ids=new Set(),moments=new Set();
 const items=input.items.map(i=>{if(!i||Object.keys(i).some(k=>!['itemId','momentId','note'].includes(k)))bad();const itemId=storyText(i.itemId,128,true),momentId=storyText(i.momentId,200,true),note=storyText(i.note??'',2000);if(ids.has(itemId)||moments.has(momentId))bad();ids.add(itemId);moments.add(momentId);return {itemId,momentId,note};});
 return {trackId,title,opening,closing,items};
}
export function storyOperationKey(key){if(typeof key!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(key))throw new ApiError(400,'Valid Idempotency-Key required');return key;}
export const storyHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
