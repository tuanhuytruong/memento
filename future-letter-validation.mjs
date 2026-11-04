import {ApiError} from './mutation-safety.mjs';
import {storyText} from './story-validation.mjs';
const bad=()=>{throw new ApiError(400,'Invalid letter document or opening time');};
export function validateLetterSchedule(input){
 const {releaseAt,timezone,localTime,offsetMinutes}=input;
 if(typeof timezone!=='string'||timezone.length>100||!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(timezone)||typeof localTime!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localTime)||!Number.isInteger(offsetMinutes)||Math.abs(offsetMinutes)>840||typeof releaseAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?Z$/.test(releaseAt))bad();
 const instant=Date.parse(releaseAt);if(!Number.isFinite(instant)||new Date(instant).toISOString()!==releaseAt.replace(/:00Z$/,':00.000Z'))bad();
 let parts;try{parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant);}catch{bad();}
 const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));const actual=`${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}`;
 if(actual!==localTime||(Date.parse(localTime+'Z')-instant)/60000!==offsetMinutes)bad();
 return {releaseAt:new Date(instant).toISOString(),timezone,localTime,offsetMinutes};
}
export function validateLetter(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['title','body','photos','releaseAt','timezone','localTime','offsetMinutes','expectedVersion'].includes(k)))bad();
 const title=storyText(input.title,120,true),body=storyText(input.body??'',10000);
 const photos=input.photos??[];if(!Array.isArray(photos)||photos.length>6)bad();const ids=new Set();
 const links=photos.map(i=>{if(!i||Object.keys(i).some(k=>!['momentId','imageId'].includes(k)))bad();const momentId=storyText(i.momentId,200,true),imageId=storyText(i.imageId,200,true);if(ids.has(imageId))bad();ids.add(imageId);return {momentId,imageId};});
 const hasSchedule=['releaseAt','timezone','localTime','offsetMinutes'].some(k=>input[k]!=null);
 return {title,body,photos:links,...(hasSchedule?validateLetterSchedule(input):{releaseAt:null,timezone:null})};
}
export function letterState(row,now=Date.now()){return row.opened_at?'opened':!row.sealed_at?'draft':Date.parse(row.release_at)<=now?'ready':'sealed';}
