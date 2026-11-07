import { imageUrl } from '../lib/imageUrl';
import { useCallback } from 'react';
import type { FutureLetter } from '../types';
export function FutureLetterReader({letter}:{letter:FutureLetter}){
 const focus=useCallback((node:HTMLHeadingElement|null)=>node?.focus({preventScroll:true}),[]);
 return <article className="mx-auto max-w-[720px] space-y-5 break-words"><h2 ref={focus} tabIndex={-1} className="font-display text-3xl">{letter.title}</h2><p className="text-sm text-stone-500">{letter.state==='draft'?'Draft preview':`First opened ${letter.openedAt?new Date(letter.openedAt).toLocaleString():''}`}</p><p className="whitespace-pre-wrap">{letter.body}</p><div className="grid gap-4 sm:grid-cols-2">{letter.photos?.map((photo,index)=><figure key={photo.imageId} className="min-w-0">{photo.available&&photo.image?<img loading="lazy" src={imageUrl(photo.image,'display')} alt={`Letter photo ${index+1}`} className="max-h-96 w-full rounded-xl object-contain"/>:<figcaption className="rounded-xl border p-4">Photo no longer available</figcaption>}</figure>)}</div></article>;
}
