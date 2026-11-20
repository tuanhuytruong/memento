import { useCallback } from 'react';
import type { StoryDetail, TimelineEvent } from '../types';
import { PrivateImage } from './PrivateImage';
import { libraryButton } from './ArchivalLibraryFrame';
type Props = {detail:StoryDetail;trackTitle?:string;onOpen?:(moment:TimelineEvent)=>void};
export function StoryContent({detail,trackTitle,onOpen}:Props) {
 const {story,items}=detail;
 return <article className="mx-auto max-w-[820px] break-words" data-story-reader>
  <header className="space-y-4 border-b border-hairline py-7 sm:py-10 dark:border-stone-700">
    <p className="font-mono text-xs text-ink-muted dark:text-stone-400">{trackTitle&&`${trackTitle} · `}{items.length} {items.length===1?'chapter':'chapters'}{story.updatedAt&&` · Updated ${story.updatedAt.slice(0,10)}`}</p>
    <h2 className="font-display text-3xl font-medium leading-tight tracking-tight sm:text-5xl">{story.title}</h2>
    {story.opening&&<p className="max-w-[62ch] whitespace-pre-wrap leading-relaxed text-ink-soft sm:text-lg dark:text-stone-300">{story.opening}</p>}
  </header>
  <ol className="divide-y divide-hairline dark:divide-stone-700">{items.map((item,index)=>{
    const moment=item.unavailable?null:item.moment;
    return <li key={item.itemId} className="space-y-4 py-7 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs text-ink-muted dark:text-stone-400">{String(index+1).padStart(2,'0')}. {moment&&`· ${moment.date||'Undated'}${moment.location?.city?` · ${moment.location.city}`:''}`}</p>
        {moment&&onOpen&&<button className={libraryButton} onClick={()=>onOpen(moment)}>View source memory</button>}
      </div>
      {moment?<>
        <h3 className="font-display text-2xl font-medium sm:text-3xl">{moment.title}</h3>
        {moment.images?.[0]&&<PrivateImage src={moment.images[0]} variant="display" loading="lazy" fit="contain" alt={moment.title} className="aspect-[16/10] max-h-[65dvh] w-full overflow-hidden rounded-2xl border border-hairline bg-linen dark:border-stone-700 dark:bg-stone-800"/>}
      </>:<p className="rounded-xl bg-linen p-4 dark:bg-stone-800">Memory no longer available</p>}
      {item.note&&<p className="max-w-[64ch] whitespace-pre-wrap font-display text-lg italic leading-relaxed">{item.note}</p>}
      {moment&&<p className="max-w-[66ch] whitespace-pre-wrap text-[15px] leading-relaxed text-ink-soft dark:text-stone-300">{moment.description}</p>}
    </li>;
  })}</ol>
  {story.closing&&<footer className="border-t border-hairline pt-8 dark:border-stone-700"><p className="mb-2 text-xs font-medium text-ink-muted dark:text-stone-400">Closing note</p><p className="max-w-[60ch] whitespace-pre-wrap font-display text-xl italic leading-relaxed">{story.closing}</p></footer>}
 </article>;
}
export function StoryReader(props:Props) {
 const interactive=!!props.onOpen;
 const focus=useCallback((node:HTMLDivElement|null)=>{if(interactive)node?.focus({preventScroll:true});},[interactive]);
 return <div ref={focus} tabIndex={-1} aria-label="Story reader"><StoryContent {...props}/></div>;
}
