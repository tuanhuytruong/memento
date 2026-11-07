export interface LetterTimeChoice {releaseAt:string;offsetMinutes:number}
/** Enumerate actual instants, never let Date silently normalise a DST gap. */
export function localTimeCandidates(localTime:string,timezone:string):LetterTimeChoice[]{
 if(!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(timezone)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localTime))return [];
 const wall=Date.parse(localTime+'Z');if(!Number.isFinite(wall)||new Date(wall).toISOString().slice(0,16)!==localTime)return [];
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const offsets=new Set<number>();for(let h=-48;h<=48;h+=6){const instant=wall+h*3600000;const p=Object.fromEntries(formatter.formatToParts(instant).map(p=>[p.type,p.value]));offsets.add((Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}Z`)-instant)/60000);}
 return [...offsets].flatMap(offsetMinutes=>{const instant=wall-offsetMinutes*60000;const p=Object.fromEntries(formatter.formatToParts(instant).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`===localTime?[{releaseAt:new Date(instant).toISOString(),offsetMinutes}]:[];}).sort((a,b)=>a.releaseAt.localeCompare(b.releaseAt));
}
export function resolveLocalTime(localTime:string,timezone:string,offsetMinutes?:number):LetterTimeChoice{
 const choices=localTimeCandidates(localTime,timezone);const choice=offsetMinutes===undefined?(choices.length===1?choices[0]:undefined):choices.find(c=>c.offsetMinutes===offsetMinutes);
 if(!choice)throw new Error(choices.length?'Choose an explicit timezone offset for this ambiguous time.':'This local time does not exist.');return choice;
}
export function formatLetterTime(releaseAt:string,timezone:string):string{return new Intl.DateTimeFormat(undefined,{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(releaseAt));}
