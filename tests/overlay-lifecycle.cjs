// Controlled route-intercepted synthetic fixtures, NOT authenticated live-account E2E.
// Run: NODE_PATH=<playwright installation>/node_modules node tests/ui-remediation.cjs
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('SKIP: Playwright is not installed; synthetic UI remediation not executed.'); process.exit(0); }
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const artifacts = process.env.MEMENTO_UI_ARTIFACTS || path.join(process.cwd(), 'node_modules/.ui-remediation-artifacts');
fs.mkdirSync(artifacts, { recursive: true });
let base = process.env.MEMENTO_UI_URL || 'https://memento-dev.srv.io.vn';
const dimensions = [[400,1000],[1200,600],[600,600],[1800,200]];
const moment = {id:'qa-moment',resourceOwnerId:'A',eventId:'qa-track',version:3,title:'SyntheticMemory'+'X'.repeat(100),date:'2026-10-15',description:'Controlled fixture '+ 'text'.repeat(100),tags:['tag'.repeat(50)],images:dimensions.map((_,i)=>`/api/images/qa-${i}`),createdAt:'2026-10-15',updatedAt:'2026-10-15',reactions:[{emoji:'❤️',count:1,selected:false,usernames:['synthetic-actor']}]};
const track = {id:'qa-track',resourceOwnerId:'A',title:'Track'+'T'.repeat(150),description:'',color:'indigo',icon:'Heart',tags:[],createdAt:'2026-10-15',updatedAt:'2026-10-15',accessRole:'owner'};
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
const deferred = () => { let resolve; const promise = new Promise(r=>resolve=r);return {promise,resolve}; };
async function fixture(browser, options={}) {
 const context=await browser.newContext({viewport:options.viewport||{width:390,height:844},reducedMotion:options.reduced?'reduce':'no-preference'});
 if(options.saveData) await context.addInitScript(()=>Object.defineProperty(navigator,'connection',{value:{saveData:true,effectiveType:'4g'}}));
 const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // 2x2 opaque red PNG, decoded by the browser for preview and by tests for bytes.
 const postcardPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8Dwn4GBgYERABIcAgN2FBM+AAAAAElFTkSuQmCC','base64');
 const state={account:'A',requests:[],puts:[],uploadIds:[],deletes:0,moments:[structuredClone(moment)],tracks:[track],visits:[],visitWrites:[],perspectives:[],postcardRenders:[],postcardPng,saved:[],savedWrites:[],saveGate:null,saveStarted:null,saveFailure:false,failImages:false,perspectiveExportGate:null,perspectiveExportStarted:null,...options};
 if(options.resurfacing){
  const now=new Date();const yy=now.getFullYear();const pad=n=>String(n).padStart(2,'0');
  const otherDay=now.getDate()===15?16:15;
  state.tracks=[track,{...track,id:'qa-track-2',title:'Second chapter'},{...track,id:'qa-track-3',title:'Third chapter'}];
  state.moments=[structuredClone(moment),
   {...structuredClone(moment),id:'qa-anniv',eventId:'qa-track',title:'Anniversary memory',date:`${yy-2}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`,images:[],description:'anniv'},
   {...structuredClone(moment),id:'qa-monthly',eventId:'qa-track-2',title:'Monthly memory',date:`${yy-1}-${pad(now.getMonth()+1)}-${pad(otherDay)}`,images:[],description:'monthly'},
   {...structuredClone(moment),id:'qa-old',eventId:'qa-track-3',title:'Old memory',date:`${yy-3}-${String(((now.getMonth()+4)%12)+1).padStart(2,'0')}-10`,images:[],description:'old'}];
  state.visits=options.visits||[];
 }
 await page.route('**/api/**',async route=>{
  const req=route.request(); const url=new URL(req.url());state.requests.push(url.pathname+url.search);
  if(url.pathname.startsWith('/api/images/')) {
   if(state.failImages) return route.fulfill({status:503,json:{error:'synthetic image failure'}});
   if(state.holdDisplay && url.searchParams.get('variant')==='display' && url.pathname.endsWith('qa-0')) await state.holdDisplay.promise;
   const [w,h]=dimensions[Number(url.pathname.split('-').pop())]||[600,600];
   return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="teal"/><rect x="5" y="5" width="${w-10}" height="${h-10}" fill="none" stroke="orange" stroke-width="10"/></svg>`});
  }
  let body={};
  if(url.pathname==='/api/auth/me')body={user:{id:state.account,username:'synthetic-'+state.account}};
  else if(url.pathname==='/api/auth/logout') {state.account=null;}
  else if(url.pathname==='/api/auth/login') {state.account='B';state.moments=[];}
  else if(url.pathname==='/api/tracks' && req.method()==='POST') {
    state.trackSaveStarted?.resolve();
    if(state.trackSaveGate)await state.trackSaveGate.promise;
    return route.fulfill({status:503,json:{error:'Synthetic track save failure'}});
  }
  else if(url.pathname==='/api/tracks')body={tracks:state.tracks.map(t=>state.viewerTracks?{...t,accessRole:'viewer'}:t)};
  else if(url.pathname==='/api/tags')body={tags:[]};
  else if(url.pathname==='/api/moments' && req.method()==='GET') {
    if(state.refreshFailure){state.refreshFailure=false;return route.fulfill({status:503,json:{error:'synthetic refresh failure'}});}
    body={moments:state.moments};
  }
  else if(url.pathname==='/api/discovery/blindbox') {
    body=state.moments.length?{event:state.moments[0],fallback:false}:null;
  }
  else if(url.pathname==='/api/discovery/postcard-picker') {
    const q=req.postDataJSON()||{};const start=q.cursor?Number(q.cursor):0;
    const eligible=state.moments.filter(m=>m.resourceOwnerId===state.account&&(!q.trackKey||`${m.resourceOwnerId}:${m.eventId}`===q.trackKey)&&(!q.search||m.title.toLowerCase().includes(q.search.toLowerCase())));
    body={moments:eligible.slice(start,start+40),nextCursor:start+40<eligible.length?String(start+40):null};
  }
  else if(url.pathname==='/api/moments/resurfacing' && req.method()==='POST') {
    // Bounded candidate pool. The fixture serves every well-formed past memory
    // so the existing selector's outcome is unchanged here; the bound itself is
    // pinned by the DB-backed parity test, which is where it can actually be
    // measured against a real account.
    const today=String(req.postDataJSON()?.today||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(today))return route.fulfill({status:400,json:{error:'today must be a local calendar date'}});
    body={moments:state.moments.filter(m=>/^\d{4}-\d{2}-\d{2}$/.test(m.date||'')&&m.date<=today)};
  }
  else if(url.pathname==='/api/moments/query' && req.method()==='POST') {
    // Bounded main feed, independent from snapshot export pages.
    const q=req.postDataJSON()||{};
    const limit=Math.min(100,Math.max(1,Number(q.limit)||40));
    const fold=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().replace(/\s+/g,' ').trim();
    const eligible=state.moments.filter(m=>{
      if(q.trackKey&&`${m.resourceOwnerId}:${m.eventId}`!==q.trackKey)return false;
      if(q.search&&!fold([m.title,m.description,m.idea,(m.tags||[]).join(' '),m.location?.name,m.location?.city].filter(Boolean).join(' ')).includes(fold(q.search)))return false;
      if(q.dateFrom&&m.date<q.dateFrom)return false;
      if(q.dateTo&&m.date>q.dateTo)return false;
      if(!q.dateFrom&&!q.dateTo&&q.selectedYear&&q.selectedYear!=='all'&&!m.date?.startsWith(q.selectedYear))return false;
      if(q.selectedTags?.length&&!q.selectedTags.some(t=>m.tags?.includes(t)))return false;
      if(q.selectedEmotions?.length&&!q.selectedEmotions.includes(m.emotion))return false;
      if(q.milestonesOnly&&!m.isMilestone)return false;
      if(q.hasImagesOnly&&!m.images?.length)return false;
      if(q.savedOnly&&!state.saved.includes(`${m.resourceOwnerId}:${m.id}`))return false;
      return true;
    });
    const sorted=[...eligible].sort((a,b)=>((a.date||'').localeCompare(b.date||'')||(a.time||'99:99').localeCompare(b.time||'99:99')||a.id.localeCompare(b.id))*(q.sortDirection==='oldest'?1:-1));
    let start=0;
    if(q.cursor){const m=/^p(\d+)$/.exec(String(q.cursor));if(!m)return route.fulfill({status:400,json:{error:'cursor does not match this query'}});start=Number(m[1]);}
    const slice=sorted.slice(start,start+limit);
    const nextIndex=start+limit;
    state.queryRequests=(state.queryRequests||0)+1;
    body={moments:slice,nextCursor:nextIndex<sorted.length?`p${nextIndex}`:null,...(q.includeTotal?{total:sorted.length}:{})};
  }
  else if(url.pathname==='/api/moments/overview' && req.method()==='GET') {
    if(state.refreshFailure){state.refreshFailure=false;return route.fulfill({status:503,json:{error:'synthetic refresh failure'}});}
    if(state.overviewOverride)return route.fulfill({json:{overview:state.overviewOverride}});
    // Full-scope summary. Derived from the fixture's whole set for the same
    // reason the real one aggregates in SQL: header and track counts must not
    // shrink to whatever page happens to be loaded.
    const ms=state.moments;
    const trackMap=new Map();
    const tagCounts={};
    const years=new Set();
    for(const m of ms){
      const key=`${m.resourceOwnerId||'legacy'}:${m.eventId}`;
      const t=trackMap.get(key)||{trackOwnerId:m.resourceOwnerId||'legacy',trackId:m.eventId,count:0,milestones:0,photos:0,minDate:null,maxDate:null};
      t.count+=1;
      if(m.isMilestone)t.milestones+=1;
      t.photos+=(m.images?.length||0);
      if(m.date){t.minDate=!t.minDate||m.date<t.minDate?m.date:t.minDate;t.maxDate=!t.maxDate||m.date>t.maxDate?m.date:t.maxDate;}
      trackMap.set(key,t);
      for(const tag of m.tags||[])tagCounts[tag]=(tagCounts[tag]||0)+1;
      if(m.date&&m.date.length>=4)years.add(m.date.substring(0,4));
    }
    const places=new Set(ms.map(m=>m.location?.city||m.location?.name).filter(Boolean));
    const dates=ms.map(m=>m.date).filter(Boolean).sort();
    body={overview:{
      total:ms.length,
      milestones:ms.filter(m=>m.isMilestone).length,
      places:places.size,
      photos:ms.reduce((acc,m)=>acc+(m.images?.length||0),0),
      earliest:dates[0]||null,
      latest:dates[dates.length-1]||null,
      tracks:[...trackMap.values()],
      tags:Object.entries(tagCounts).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)),
      years:[...years].sort((a,b)=>b.localeCompare(a)),
    }};
  }
  else if(/^\/api\/moments\/[^/]+$/.test(url.pathname) && req.method()==='GET') {
    // Exact single-moment read used by the conflict comparison.
    state.singleMomentRequests=(state.singleMomentRequests||0)+1;
    const id=url.pathname.split('/').pop();
    const found=state.moments.find(m=>m.id===id);
    if(!found || state.singleMomentMissing) return route.fulfill({status:404,json:{error:'Moment not found'}});
    body={moment:{...found,...(state.singleMomentPatch||{})}};
  }
  else if(/^\/api\/moments\/[^/]+\/perspectives$/.test(url.pathname)&&req.method()==='GET')body={perspectives:state.perspectives,nextCursor:null,capabilities:{canRead:true,canCreate:state.perspectiveCanCreate!==false,canModerate:true}};
  else if(/^\/api\/moments\/[^/]+\/perspectives$/.test(url.pathname)&&req.method()==='POST'){const b=req.postDataJSON();const item={id:'p'+(state.perspectives.length+1),momentOwnerId:b.ownerId,momentId:url.pathname.split('/')[3],authorId:state.account,username:'synthetic-'+state.account,kind:b.kind,body:b.body,version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};state.perspectives.push(item);return route.fulfill({status:201,json:{perspective:item}});}
  else if(/^\/api\/moments\/[^/]+$/.test(url.pathname) && req.method()==='DELETE') {state.deletes++;const id=url.pathname.split('/').pop();state.moments=state.moments.filter(m=>m.id!==id);body={};}
  else if(url.pathname==='/api/moments' && req.method()==='POST') {
    state.created=deferred(); if(state.createGate){state.createStarted?.resolve();await state.createGate.promise;}
    if(state.createFailure)return route.fulfill({status:503,json:{error:'Synthetic moment save failure'}});
    body={moment:{...moment,...req.postDataJSON(),id:'created-A',version:1}};state.moments.unshift(body.moment);
  }
  else if(url.pathname==='/api/moments/qa-moment' && req.method()==='PUT') {
    const n=(state.momentPutCount=(state.momentPutCount||0)+1);
    state.puts.push(req.postDataJSON());
    // conflictCount bounds how many moment PUTs answer 409; the default keeps
    // the historical always-conflict behaviour for the existing journeys.
    if(n<=(state.conflictCount??999))return route.fulfill({status:409,json:{error:'Synthetic conflict',code:'VERSION_CONFLICT'}});
    return route.fulfill({json:{moment:{...state.moments[0],...req.postDataJSON(),version:(state.singleMomentPatch?.version??3)+1}}});
  }
  else if(url.pathname.endsWith('/reactions')) {
    state.puts.push({method:req.method(),...req.postDataJSON()});
    if(state.reactionGate){state.reactionStarted?.resolve();await state.reactionGate.promise;}
    if(state.reactionFailure)return route.fulfill({status:503,json:{error:'Synthetic reaction failure'}});
    body={reactions:[{emoji:'❤️',count:1,usernames:['synthetic-actor'],selected:req.postDataJSON().active}]};
  }
  else if(url.pathname==='/api/images') {
    const id=req.headers()['idempotency-key'];assert(id,'missing Idempotency-Key');state.uploadIds.push(id);
    if(state.uploadGate){state.uploadStarted?.resolve();await state.uploadGate.promise;}
    if(state.uploadFailure && state.uploadIds.length===2)return route.fulfill({status:503,json:{error:'Synthetic upload failure'}});
    if(state.uploadRefresh && state.uploadIds.length===3) state.refreshFailure=true;
    body={image:{id:'fixture-upload'}};
  }
  else if(url.pathname==='/api/tags')body={tags:[]};
  else if(url.pathname==='/api/track-visits'){if(state.visitFailure)return route.fulfill({status:503,json:{error:'Synthetic visit history failure'}});body={visits:state.visits};}
  else if(url.pathname==='/api/postcards/render'&&req.method()==='POST'){
    const payload=req.postDataJSON();state.postcardRenders.push(payload);
    if(state.postcardRenderFailure)return route.fulfill({status:422,json:{error:'Synthetic postcard failure'}});
    // Fixed synthetic PNG: enough for decode/dimension/same-bytes assertions.
    return route.fulfill({status:200,contentType:'image/png',headers:{'Cache-Control':'no-store','Content-Disposition':'attachment; filename="memento-postcard.png"'},body:state.postcardPng});}
  else if(/^\/api\/tracks\/[^/]+\/visit$/.test(url.pathname)&&req.method()==='PUT'){const b=req.postDataJSON();state.visitWrites.push({trackId:url.pathname.split('/')[3],...b});return route.fulfill({json:{visit:{trackOwnerId:b.ownerId||'A',trackId:url.pathname.split('/')[3],lastOpenedAt:new Date().toISOString()}}});}
  else if(url.pathname.startsWith('/api/export/')) {
    assert.equal(req.method(),'POST');
    const action=url.pathname.split('/').pop();const q=req.postDataJSON()||{};
    state.exportRequests??=[];state.exportRequests.push({action,...q});
    const fingerprint='a'.repeat(64),token='synthetic-account-bound-token';
    const components={moments:state.moments,tracks:state.exportTracks||state.tracks,tags:state.exportTags||[],perspectives:state.perspectives};
    const counts=Object.fromEntries(Object.entries(components).map(([k,v])=>[k,v.length]));
    if(action!=='start'){assert.equal(q.fingerprint,fingerprint);assert.equal(q.token,token);}
    if(state.exportFailure===action || (action==='page' && state.exportFailure===q.kind))return route.fulfill({status:409,json:{error:'Synthetic export scope changed',code:'EXPORT_SCOPE_CHANGED'}});
    if(action==='start')body={fingerprint,token,counts,scope:'all-authorized-moments;owned-perspectives',images:'references-to-stored-images-only'};
    else if(action==='finalize')body={fingerprint,token,counts,complete:true};
    else {
      assert.equal(action,'page');assert(Object.hasOwn(components,q.kind),'known snapshot component');
      assert(Number.isInteger(q.limit)&&q.limit>0&&q.limit<=100,'bounded snapshot page');
      if(q.kind==='perspectives'&&state.perspectiveExportGate){state.perspectiveExportStarted?.resolve();await state.perspectiveExportGate.promise;return route.fulfill({status:503,json:{error:'Synthetic export failure'}});}
      const start=q.cursor?Number(q.cursor):0;assert(Number.isInteger(start)&&start>=0);
      const items=components[q.kind].slice(start,start+q.limit);
      body={fingerprint,token,counts,items,nextCursor:start+q.limit<components[q.kind].length?String(start+q.limit):null};
    }
  }
  else if(url.pathname==='/api/collaboration-invitations')body={invitations:[]};
  // Wire shape: composite identities, never the raw internal key strings.
  else if(url.pathname==='/api/saved' && req.method()==='GET')body={saved:state.saved.map(k=>({ownerId:k.split(':')[0],id:k.split(':')[1]})),count:state.saved.length};
  else if(url.pathname==='/api/saved/moments' && req.method()==='GET')body={items:state.saved.map(k=>({ownerId:k.split(':')[0],id:k.split(':')[1],savedAt:new Date().toISOString()})),nextCursor:null};
  else if(/^\/api\/moments\/[^/]+\/saved$/.test(url.pathname)&&req.method()==='PUT'){
    const b=req.postDataJSON();const key=`${b.ownerId}:${url.pathname.split('/')[3]}`;
    if(state.saveGate){state.saveStarted?.resolve();await state.saveGate.promise;}
    if(state.saveFailure)return route.fulfill({status:503,json:{error:'synthetic save failure'}});
    // Server-authoritative: the response decides what the client shows.
    const saved=typeof b.active==='boolean'?b.active:!state.saved.includes(key);
    state.saved = saved ? [...new Set([...state.saved,key])] : state.saved.filter(k=>k!==key);
    state.savedWrites.push({key,active:saved});
    return route.fulfill({json:{saved:{ownerId:b.ownerId,id:key.split(':')[1],saved:saved}}});
  }
  return route.fulfill({json:body});
 });
 await page.goto(base,{waitUntil:'networkidle'});
 // Empty fixtures (no moments) wait for a stable app marker instead of a card
 // that will never render.
 if(state.moments.length) await page.locator('#event-card-A\\:qa-moment').waitFor().catch(async error=>{console.error('FIXTURE FAILED',JSON.stringify({options,requests:state.requests,moments:state.moments.map(m=>({id:m.id,date:m.date})),body:await page.locator('body').innerText()}));throw error;});
 else await page.locator('#open-create-event-modal, #empty-state-add-track, #empty-timeline-state').first().waitFor();
 return {context,page,state,errors};
}
async function feedAction(page, action, matches) {
 const response=page.waitForResponse(r=>r.url().endsWith('/api/moments/query')&&r.request().method()==='POST'&&matches(r.request().postDataJSON()));
 await action();const landed=await response;assert.equal(landed.status(),200);await landed.finished();
 await page.waitForFunction(()=>!document.querySelector('[aria-label="Loading memories"]'));
}
async function cardCount(page, id, expected, message) {
 await page.waitForFunction(({id,expected})=>document.querySelectorAll(`[id="event-card-A:${id}"]`).length===expected,{id,expected});
 assert.equal(await page.locator(`[id="event-card-A:${id}"]`).count(),expected,message);
}
async function hit(locator){
 await locator.scrollIntoViewIfNeeded();
 assert(await locator.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}), 'control center covered');
 const box=await locator.boundingBox(); assert(box.width>=44 && box.height>=44,JSON.stringify(box));
 await locator.click();
}
async function imageReady(page){await page.locator('#image-lightbox-overlay img').waitFor();await page.waitForFunction(()=>{const img=document.querySelector('#image-lightbox-overlay img');return img?.complete && img.naturalWidth>0 && getComputedStyle(img).opacity==='1';});}
async function logoutAndLogin(page){
 // close any dialog through actual Escape, then account menu.
 for(let i=0;i<3;i++)await page.keyboard.press('Escape');
 await page.getByTitle('synthetic-A',{exact:true}).click();await page.getByRole('menuitem',{name:'Sign out',exact:true}).click();
 await page.locator('input[autocomplete="username"]').fill('synthetic-B');
 await page.locator('input[type="password"]').fill('synthetic-fixture-only');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByTitle('synthetic-B',{exact:true}).waitFor();
}
// These journeys exercise the rebuilt app with controlled API fixtures, not live DB/R2.
(async()=>{
 let server,browser; const report={kind:'built-app controlled routes',checks:[]};
 try {
  const http=require('http');server=http.createServer((req,res)=>{const file=path.join(process.cwd(),'dist',req.url==='/'?'index.html':req.url.split('?')[0]);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');try{res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
  for(const [width,height,reduced] of [[320,740,false],[390,844,false],[844,390,false],[1280,800,false],[390,844,true]]){
   const {page,context,errors}=await fixture(browser,{viewport:{width,height},reduced});page.setDefaultTimeout(8000);
   const check=s=>report.checks.push(`${width}x${height}${reduced?' reduce':''}: ${s}`);
   const settled=()=>page.waitForTimeout(250);
   // Actual detail entrance, retained exit, scroll lock and nested lightbox.
   const card=page.locator('[id="event-card-A:qa-moment"] h3');await card.click();await page.locator('#event-detail-card').waitFor();await settled();
   assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
   await page.locator('#event-detail-card').getByTitle('Enlarge photo').click();await page.locator('#image-lightbox-overlay').waitFor();await settled();await page.keyboard.press('Escape');
   if(!reduced)assert.equal(await page.locator('#image-lightbox-overlay').count(),1,'exit retained');
   await page.locator('#image-lightbox-overlay').waitFor({state:'detached'});assert.equal(await page.locator('#event-detail-card').count(),1);assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
   assert(await page.locator('#event-detail-card').evaluate(el=>el.contains(document.activeElement)),'nested focus returns inside detail');
   check('detail -> lightbox -> topmost Escape retains detail lock/focus');
   await page.keyboard.press('Escape');if(!reduced){assert.equal(await page.locator('#event-detail-card').count(),1);assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');}
   await page.locator('#event-detail-card').waitFor({state:'detached'});assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');check('detail exit retained to completion, lock released');
   // Composer draft guard and exact closing content retained after owner clears props.
   await page.locator('#open-create-event-modal').click();await page.locator('#event-title-input').fill('Retained closing draft');await page.keyboard.press('Escape');await page.locator('#draft-continue-button').click();assert.equal(await page.locator('#event-title-input').inputValue(),'Retained closing draft');
   await page.keyboard.press('Escape');await page.locator('#draft-keep-button').click();if(!reduced)assert.equal(await page.locator('#event-title-input').inputValue(),'Retained closing draft');await page.locator('#event-modal-card').waitFor({state:'detached'});
   await page.locator('#open-create-event-modal').click();await page.waitForFunction(()=>document.querySelector('#event-title-input')?.value==='Retained closing draft');await page.locator('#event-title-input').fill('Discard edited draft');await page.keyboard.press('Escape');await page.locator('#draft-discard-button').click();await page.locator('#event-modal-card').waitFor({state:'detached'});check('composer cancel/continue/keep/reopen/discard');
   await page.locator('#date-range-trigger').click();await page.getByRole('dialog',{name:'Date range editor'}).waitFor();await settled();await page.locator('#filter-date-from').fill('2025-01-02');await page.getByRole('button',{name:'Cancel',exact:true}).click();if(!reduced)assert.equal(await page.locator('#filter-date-from').inputValue(),'2025-01-02');await page.getByRole('dialog',{name:'Date range editor'}).waitFor({state:'detached'});assert.equal(await page.evaluate(()=>document.activeElement.id),'date-range-trigger');check('date draft exit snapshot/focus');
   await page.locator('#floating-memory-actions').focus();await page.keyboard.press('Enter');await settled();assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'New entry');await page.keyboard.press('Tab');await page.keyboard.press('Escape');await page.locator('#memory-actions').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>document.activeElement.id),'floating-memory-actions');check('floating keyboard order/exit/focus');
   await page.screenshot({path:path.join(artifacts,`settled-${width}-${height}-${reduced}.png`)});assert.deepEqual(errors,[]);await context.close();
  }
  // Existing pending-save fixtures hold real UI operations before failure.
  for(const surface of ['moment','track']){
   const gate=deferred(),started=deferred();const opts=surface==='moment'?{createGate:gate,createStarted:started,createFailure:true}:{trackSaveGate:gate,trackSaveStarted:started};
   const {page,context}=await fixture(browser,opts);
   if(surface==='moment')await page.locator('#open-create-event-modal').click();else await page.locator('#btn-add-event-track').click();
   const title=page.locator(surface==='moment'?'#event-title-input':'#track-title-input');await title.fill('Pending lifecycle');await page.locator(surface==='moment'?'#save-event-button':'#save-track-button').click();
   // Only run gates supported by fixture; timeout is a test failure, never a skip.
   await Promise.race([started.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('pending gate not reached '+surface)),5000))]);await page.keyboard.press('Escape');assert.equal(await title.count(),1);gate.resolve();await page.getByRole('alert').filter({hasText:/Synthetic/}).waitFor();assert.equal(await title.inputValue(),'Pending lifecycle');report.checks.push(surface+' pending Escape blocked; failure retains draft');await context.close();
  }
  {const {page,context,errors}=await fixture(browser);let release;const gate=new Promise(r=>release=r);await page.route('**/assets/PostcardComposer-*.js',async route=>{await gate;await route.continue();});
   await page.getByTitle('More actions',{exact:true}).click();await page.locator('#create-postcard').click();await page.getByRole('dialog',{name:'Opening dialog'}).waitFor();assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');assert.equal(await page.locator('[id="event-card-A:qa-moment"]').count(),1);release();await page.locator('#postcard-composer').waitFor();await page.getByRole('dialog',{name:'Opening dialog'}).waitFor({state:'detached'});await page.getByRole('button',{name:'Close postcard composer',exact:true}).click();await page.locator('#postcard-composer').waitFor({state:'detached'});assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');report.checks.push('cold postcard chunk modal fallback preserves feed/lock then loaded open/close');assert.deepEqual(errors,[]);await context.close();}
  {const {page,context}=await fixture(browser);await page.locator('#floating-memory-actions').click();await page.getByRole('button',{name:'Open a random memory',exact:true}).click();await page.getByRole('dialog',{name:'Blindbox memory'}).waitFor();await page.waitForTimeout(250);await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog',{name:'Blindbox memory'}).count(),1);await page.getByRole('dialog',{name:'Blindbox memory'}).waitFor({state:'detached'});report.checks.push('blindbox entrance and retained exit');await context.close();}
  {const {page,context}=await fixture(browser);await page.locator('[id="event-card-A:qa-moment"] h3').click();await page.locator('#event-detail-card').waitFor();await page.waitForTimeout(250);await page.getByRole('button',{name:'Add your perspective',exact:true}).click();const editor=page.getByRole('dialog',{name:'Add your perspective',exact:true});await editor.waitFor();await editor.locator('textarea').fill('Exact closing perspective');page.once('dialog',d=>d.accept());await editor.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await editor.locator('textarea').inputValue(),'Exact closing perspective');await editor.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');await page.keyboard.press('Escape');await page.locator('#event-detail-card').waitFor({state:'detached'});report.checks.push('nested perspective confirmed close retains exact draft snapshot and parent lock');await context.close();}
  {const {page,context}=await fixture(browser);await page.locator('#open-create-event-modal').click();await page.locator('#event-modal-card').waitFor();await page.waitForTimeout(250);await page.keyboard.press('Escape');await page.locator('#open-create-event-modal').evaluate(el=>el.click());await page.waitForTimeout(300);assert.equal(await page.locator('#event-modal-card').count(),1);assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');await page.keyboard.press('Escape');await page.locator('#event-modal-card').waitFor({state:'detached'});assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');report.checks.push('rapid close/reopen cancels stale removal and keeps lock');await context.close();}
  {const {page,context}=await fixture(browser,{tracks:[{...track,title:'QA track'}],viewport:{width:1280,height:800}});await page.locator('#tab-event-track-A-qa-track').click();const share=page.getByRole('button',{name:'Share',exact:true});assert.equal(await share.count(),1);{await share.click();await page.getByRole('dialog',{name:/Share QA track/}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:/Share QA track/}).waitFor({state:'detached'});report.checks.push('collaboration actual open/close');}await context.close();}
  {const {page,context}=await fixture(browser);let release;const gate=new Promise(r=>release=r);await page.route('**/assets/EventModal-*.js',async route=>{await gate;await route.continue();});await page.locator('#open-create-event-modal').click();await page.getByRole('dialog',{name:'Opening dialog'}).waitFor();await page.keyboard.press('Escape');release();await page.getByRole('dialog').waitFor({state:'detached'});await page.waitForTimeout(350);assert.equal(await page.getByRole('dialog').count(),0);assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');report.checks.push('cold chunk close before resolution cannot leave ghost dialog/lock');await context.close();}
  {const {page,state,context}=await fixture(browser);await page.locator('[id="event-card-A:qa-moment"] h3').click();await page.locator('#event-detail-card').waitFor();await page.waitForTimeout(250);await page.keyboard.press('Escape');await page.getByTitle('synthetic-A',{exact:true}).evaluate(el=>el.click());await page.getByRole('menuitem',{name:'Sign out',exact:true}).evaluate(el=>el.click());assert.equal(await page.locator('#event-detail-card').count(),0);assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');report.checks.push('logout immediately clears exiting private snapshot');await context.close();}
  {const {page,context,state}=await fixture(browser);await page.locator('[id="event-card-A:qa-moment"] h3').click();await page.locator('#event-detail-card').waitFor();await page.waitForTimeout(250);
   await page.getByRole('button',{name:'Add your perspective',exact:true}).click();const editor=page.getByRole('dialog',{name:'Add your perspective',exact:true});await editor.locator('textarea').fill('Backdrop exact dirty draft');await page.waitForTimeout(250);
   await page.evaluate(()=>{window.exitConfirmCount=0;window.confirm=()=>{window.exitConfirmCount++;return false;};});
   await editor.evaluate(el=>el.parentElement.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})));assert.equal(await editor.locator('textarea').inputValue(),'Backdrop exact dirty draft');assert.equal(await editor.locator('textarea').isEnabled(),true);
   await page.evaluate(()=>{window.exitConfirmCount=0;window.confirm=()=>{window.exitConfirmCount++;return true;};});
   await editor.evaluate(el=>el.parentElement.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})));
   await page.waitForFunction(()=>document.querySelector('[aria-labelledby="perspective-dialog-title"]')?.parentElement.dataset.exiting==='true');
   await editor.evaluate(el=>{const backdrop=el.parentElement;for(let i=0;i<2;i++)backdrop.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));el.querySelector('[aria-label="Close perspective editor"]').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));});
   assert.equal(await page.evaluate(()=>window.exitConfirmCount),1,'accepted discard must not confirm again during exit');assert.equal(await editor.locator('textarea').inputValue(),'Backdrop exact dirty draft');assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');assert.equal(state.perspectives.length,0);
   await editor.waitFor({state:'detached'});assert.equal(await page.locator('#event-detail-card').count(),1);assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
   // Pending writes retain the same dismissal guard at the expanded boundary.
   await page.getByRole('button',{name:'Add your perspective',exact:true}).click();await editor.locator('textarea').fill('Pending backdrop draft');await page.waitForTimeout(250);let release;const gate=new Promise(r=>release=r);await page.route('**/api/moments/qa-moment/perspectives',async route=>{if(route.request().method()==='POST'){await gate;await route.fulfill({status:503,json:{error:'Synthetic perspective pending failure'}});}else await route.fallback();});
   const started=page.waitForRequest(r=>r.url().includes('/perspectives')&&r.method()==='POST');await editor.getByRole('button',{name:'Save',exact:true}).click();await started;await editor.evaluate(el=>el.parentElement.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})));await page.keyboard.press('Escape');assert.equal(await editor.count(),1);assert.equal(await editor.locator('textarea').inputValue(),'Pending backdrop draft');assert.equal(await page.evaluate(()=>window.exitConfirmCount),1);release();await editor.getByRole('alert').filter({hasText:'Synthetic perspective pending failure'}).waitFor();assert.equal(await editor.locator('textarea').inputValue(),'Pending backdrop draft');assert.equal(await editor.locator('textarea').isEnabled(),true);
   report.checks.push('perspective full backdrop: cancelled discard preserves draft; accepted discard plus double backdrop/close/Escape confirms once, exact exit snapshot/parent lock/no mutation; pending dismissal blocked and failure retains draft');await context.close();}
  report.passed=true;
 }catch(e){report.passed=false;report.error=e.stack;process.exitCode=1;}
 finally{if(browser)await browser.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}report.cleanup=true;fs.writeFileSync(path.join(artifacts,'overlay-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})();
