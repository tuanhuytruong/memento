import { useCallback } from 'react';
import type { StoryDetail, TimelineEvent } from '../types';
import { PrivateImage } from './PrivateImage';
export function StoryContent({detail,onOpen}:{detail:StoryDetail;onOpen?:(moment:TimelineEvent)=>void}) {
 const {story,items}=detail;
 return <article className="mx-auto max-w-3xl space-y-8 break-words" data-story-reader>
  <header><h2 className="font-display text-3xl">{story.title}</h2><p className="mt-3 text-sm text-stone-500">Linked memories update with their originals. Sharing follows this track’s access.</p></header>
  {story.opening&&<p className="whitespace-pre-wrap">{story.opening}</p>}
  {items.map((item,index)=><section key={item.itemId} className="space-y-3 border-t border-stone-200 pt-6 dark:border-stone-700">
   <p className="text-xs text-stone-500">Memory {index+1}</p>
   {item.moment&&!item.unavailable?<><h3 className="font-display text-xl">{item.moment.title}</h3><p className="text-sm text-stone-500">{item.moment.date}</p><p className="whitespace-pre-wrap">{item.moment.description}</p>
   {item.moment.images?.[0]&&<PrivateImage src={item.moment.images[0]} variant="display" loading="lazy" fit="contain" alt={item.moment.title} className="h-80 w-full"/>}
   {onOpen&&<button className="min-h-11 rounded-lg border px-4 text-sm" onClick={()=>onOpen(item.moment!)}>View source memory</button>}</>:<p className="rounded-xl bg-stone-100 p-4 dark:bg-stone-800">Memory no longer available</p>}
   {item.note&&<p className="whitespace-pre-wrap italic text-stone-600 dark:text-stone-300">{item.note}</p>}
  </section>)}
  {story.closing&&<p className="whitespace-pre-wrap border-t pt-6">{story.closing}</p>}
 </article>;
}
export function StoryReader(props:{detail:StoryDetail;onOpen?:(moment:TimelineEvent)=>void}) {
 const interactive=!!props.onOpen;
 const focus=useCallback((node:HTMLDivElement|null)=>{if(interactive)node?.focus({preventScroll:true});},[interactive]);
 return <div ref={focus} tabIndex={-1} aria-label="Story reader"><StoryContent {...props}/></div>;
}
