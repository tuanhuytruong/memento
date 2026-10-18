import { useCallback, useEffect, useRef, useState } from 'react';
/** Input remains controlled by caller. A generation owns every timer/commit. */
export function useDebouncedSearch(raw: string, generation: number, delay = 275) {
  const [committed, setCommitted] = useState({ value: raw, generation });
  const [composing, setComposing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef({raw,generation});
  current.current = {raw,generation};
  const cancel = useCallback(() => { if(timer.current) clearTimeout(timer.current); timer.current=null; }, []);
  const flush = useCallback(() => {cancel();setCommitted({value:current.current.raw,generation:current.current.generation});},[cancel]);
  useEffect(() => {
    cancel();
    if (!raw) {setCommitted({value:'',generation});return;}
    if (composing) return;
    const capturedGeneration=generation;
    timer.current=setTimeout(()=>{if(current.current.generation===capturedGeneration) setCommitted({value:raw,generation});},delay);
    return cancel;
  },[raw,generation,delay,composing,cancel]);
  useEffect(()=>{setComposing(false);return cancel;},[generation,cancel]);
  const value = !raw || committed.generation!==generation ? '' : committed.value;
  return {value,pending:composing || raw!==value,flush,
    compositionStart:()=>{cancel();setComposing(true);},compositionEnd:()=>setComposing(false)};
}
