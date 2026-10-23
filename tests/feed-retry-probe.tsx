import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{useMomentFeed}from'../src/lib/useMomentFeed';
const w=window as any;w.jobs=[];w.seeks=[];
const fetchPage=(args:any)=>new Promise<import("../src/lib/useMomentFeed").MomentFeedPage>((resolve,reject)=>w.jobs.push({args,resolve,reject}));
const fetchSeek=(...args:any[])=>new Promise<import("../src/lib/useMomentFeed").MomentFeedPage>((resolve,reject)=>w.seeks.push({args,resolve,reject}));
function Probe(){const[o,set]=React.useState({query:{search:''},generation:1,enabled:true,paused:false});w.configure=(patch:any)=>flushSync(()=>set(old=>({...old,...patch})));const f=useMomentFeed({...o,fetchPage,fetchSeek});w.feed=f;React.useLayoutEffect(()=>{if(w.onLayout){const cb=w.onLayout;w.onLayout=null;cb();}},[o]);return <div>{f.items.map((m:any)=><span key={m.id}>{m.id}</span>)}</div>;}createRoot(document.getElementById('root')!).render(<Probe/>);
