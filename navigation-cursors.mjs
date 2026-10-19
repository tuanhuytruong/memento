import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {ApiError} from './mutation-safety.mjs';
// Ephemeral signing key: restart invalidates navigation, never authorization.
const key=randomBytes(32);
export function sealBrowseCursor(value,binding){const data=Buffer.from(JSON.stringify({value,binding})).toString('base64url');return `b1.${data}.${createHmac('sha256',key).update(data).digest('base64url')}`;}
export function openBrowseCursor(raw,binding){try{const [v,data,signature,...rest]=String(raw).split('.'); const expected=createHmac('sha256',key).update(data||'').digest();const actual=Buffer.from(signature||'','base64url');if(v!=='b1'||rest.length||actual.length!==expected.length||!timingSafeEqual(actual,expected))throw 0;const parsed=JSON.parse(Buffer.from(data,'base64url'));if(JSON.stringify(parsed.binding)!==JSON.stringify(binding))throw 0;return parsed.value;}catch{throw new ApiError(400,'cursor does not match this query');}}
