// Controlled route-intercepted synthetic fixtures, NOT authenticated live-account E2E.
// Run: NODE_PATH=<playwright installation>/node_modules node tests/ui-remediation.cjs
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('SKIP: Playwright is not installed; synthetic UI remediation not executed.'); process.exit(0); }
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const artifacts = process.env.MEMENTO_UI_ARTIFACTS || path.join(process.cwd(), 'node_modules/.ui-remediation-artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const base = process.env.MEMENTO_UI_URL || 'https://memento-dev.srv.io.vn';
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
 const state={account:'A',requests:[],puts:[],uploadIds:[],deletes:0,moments:[structuredClone(moment)],tracks:[track],visits:[],visitWrites:[],perspectives:[],postcardRenders:[],postcardPng,saved:[],savedWrites:[],saveGate:null,saveStarted:null,saveFailure:false,failImages:false,blindboxPool:[{...moment,id:'full-scope',title:'Outside loaded feed'}],perspectiveExportGate:null,perspectiveExportStarted:null,...options};
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
  if(url.pathname==='/api/discovery/blindbox') {
    const q=req.postDataJSON()||{};
    state.blindboxCalls=(state.blindboxCalls||[]).concat([q]);
    if(state.blindboxGate)await state.blindboxGate;
    // The page can abort this request (a closed dialog), so fulfilling may fail.
    const settle=async response=>{try{return await route.fulfill(response);}catch{return;}};
    if(state.blindboxFailure){state.blindboxFailure=false;return settle({status:503,json:{error:'Synthetic reveal failure'}});}
    // The fixture honours a round's seen identities the way the real query does:
    // composite identity, exclusion before selection, and null only on exhaustion.
    const seen=new Set((Array.isArray(q.seen)?q.seen:[]).map(item=>`${item?.ownerId}:${item?.id}`));
    const unseen=(state.blindboxPool||[]).filter(item=>!seen.has(`${item.resourceOwnerId}:${item.id}`));
    if(!unseen.length)return settle({status:200,contentType:'application/json',body:'null'});
    return settle({json:{event:unseen[0],fallback:false}});
  }
  if(url.pathname==='/api/discovery/postcard-picker') {
    const q=req.postDataJSON(); state.pickerRequests=(state.pickerRequests||[]).concat([q]);
    return route.fulfill({json:{moments:[{...moment,id:q.cursor?'second-page':'first-page',title:q.cursor?'Second page memory':'First page memory'}],nextCursor:q.cursor?null:'next'}});
  }
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
    // Bounded read used by the complete backup export. The fixture pages it
    // so a multi-page export is exercised, not just a single lucky page.
    const q=req.postDataJSON()||{};
    const limit=Math.min(100,Math.max(1,Number(q.limit)||40));
    const sorted=[...state.moments].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    let start=0;
    if(q.cursor){const m=/^p(\d+)$/.exec(String(q.cursor));if(!m)return route.fulfill({status:400,json:{error:'cursor does not match this query'}});start=Number(m[1]);}
    const slice=sorted.slice(start,start+limit);
    const nextIndex=start+limit;
    state.queryRequests=(state.queryRequests||0)+1;
    body={moments:slice,nextCursor:nextIndex<sorted.length?`p${nextIndex}`:null,...(q.includeTotal?{total:sorted.length}:{})};
  }
  else if(url.pathname==='/api/moments/overview' && req.method()==='GET') {
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
  else if(url.pathname==='/api/moments/qa-moment' && req.method()==='DELETE') {state.deletes++;body={};}
  else if(url.pathname==='/api/moments' && req.method()==='POST') {
    state.created=deferred(); if(state.createGate){state.createStarted?.resolve();await state.createGate.promise;}
    if(state.createFailure)return route.fulfill({status:503,json:{error:'Synthetic moment save failure'}});
    body={moment:{...moment,...req.postDataJSON(),id:'created-A',version:1}};
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
  else if(url.pathname==='/api/perspectives/export') {
    // Default: a valid, complete page. The failure journey opts in by passing
    // a gate, so a synthetic failure does not break every other export test.
    if(state.perspectiveExportGate){
      if(state.perspectiveExportStarted)state.perspectiveExportStarted.resolve();
      await state.perspectiveExportGate.promise;
      return route.fulfill({status:503,json:{error:'Synthetic export failure'}});
    }
    return route.fulfill({json:{perspectives:[],nextCursor:null}});
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
 if(state.moments.length) await page.locator('#event-card-A\\:qa-moment').waitFor();
 else await page.locator('#open-create-event-modal, #empty-state-add-track, #empty-timeline-state').first().waitFor();
 return {context,page,state,errors};
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

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/opt/hermes/tools/chromium-1208/chrome-linux/chrome',args:['--no-sandbox']});
 const passed=[];
 const openDiscovery=async page=>{await page.getByRole('button',{name:'Memory actions',exact:true}).click();await page.getByRole('button',{name:'Open a random memory',exact:true}).click();};
 const dialog=page=>page.getByRole('dialog',{name:'Blindbox memory'});
 const round=[{...moment,id:'blindbox-1',title:'First discovery'},{...moment,id:'blindbox-2',title:'Second discovery'},{...moment,id:'blindbox-3',title:'Third discovery'}];
 try {
  const {page,state,context,errors}=await fixture(browser,{reduced:true});
  await openDiscovery(page);
  await page.getByRole('heading',{name:'Outside loaded feed',exact:true}).waitFor();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByTitle('More actions',{exact:true}).click();
  await page.getByRole('menuitem',{name:'Create postcard',exact:true}).click();
  const composer=page.locator('#postcard-composer');
  await composer.locator('select').selectOption('A:qa-track');
  await composer.getByText('First page memory',{exact:true}).waitFor();
  await composer.locator('input[type=checkbox]').first().check();
  await hit(composer.getByRole('button',{name:'Next page',exact:true}));
  await composer.getByText('Second page memory',{exact:true}).waitFor();
  await composer.locator('input[type=checkbox]').first().check();
  assert((await composer.innerText()).includes('(2/6)'),'selection retained across pages');
  assert(state.pickerRequests.some(q=>q.cursor==='next'));
  assert.equal(errors.length,0,errors.join(';'));
  passed.push('Blindbox outside feed winner');
  passed.push('Postcard pagination + retained selection + mobile Next hit target');
  await context.close();

  // A round never repeats a memory, then closes on the completion scene.
  for(const viewport of [{width:1200,height:900},{width:390,height:844},{width:320,height:640}]){
   const f=await fixture(browser,{viewport,reduced:true,blindboxPool:round});
   const panel=dialog(f.page);
   await openDiscovery(f.page);
   await f.page.getByRole('heading',{name:'First discovery',exact:true}).waitFor();
   await f.page.getByRole('button',{name:'Another memory',exact:true}).click();
   await f.page.getByRole('heading',{name:'Second discovery',exact:true}).waitFor();
   await f.page.getByRole('button',{name:'Another memory',exact:true}).click();
   await f.page.getByRole('heading',{name:'Third discovery',exact:true}).waitFor();
   await f.page.getByRole('button',{name:'Another memory',exact:true}).click();
   await f.page.getByRole('heading',{name:'Every memory, revisited',exact:true}).waitFor();
   assert.deepEqual(f.state.blindboxCalls.map(c=>c.seen.length),[0,1,2,3],'each reveal carries the identities already shown');
   assert(f.state.blindboxCalls.every(c=>Array.isArray(c.seen)&&c.seen.every(s=>s&&Object.keys(s).length===2&&typeof s.ownerId==='string'&&typeof s.id==='string')),'seen payload is a composite identity list');
   assert.equal(await f.page.getByRole('button',{name:'Another memory',exact:true}).count(),0,'exhaustion hides the repeat action');
   assert((await panel.innerText()).includes("You've wandered through all your memories for now."),'completion copy');
   assert((await panel.innerText()).includes("They'll be here for your next visit."),'completion copy keeps its invitation');
   assert.equal(await f.page.getByRole('heading',{name:'Your story is just beginning',exact:true}).count(),0,'a finished round is not a first visit');
   assert(await f.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`no horizontal overflow at ${viewport.width}px`);
   const action=f.page.locator('#blindbox-completion').getByRole('button',{name:'Close',exact:true});
   assert.equal(await action.evaluate(el=>el===document.activeElement),true,'the completion action receives focus');
   await hit(action);
   await dialog(f.page).waitFor({state:'detached'});
   // Reopening starts a fresh round: the first request carries no seen history.
   await openDiscovery(f.page);
   await f.page.getByRole('heading',{name:'First discovery',exact:true}).waitFor();
   assert.equal(f.state.blindboxCalls.at(-1).seen.length,0,'reopening begins an empty round');
   if(viewport.width===1200)await f.page.keyboard.press('Escape');
   else await f.page.mouse.click(4,4);
   await dialog(f.page).waitFor({state:'detached'});
   assert.equal(f.errors.length,0,f.errors.join(';'));
   passed.push(`No-repeat round, completion scene, fresh reopen and dismiss at ${viewport.width}px`);
   await f.context.close();
  }

  // Customization keeps the same round history.
  {const f=await fixture(browser,{viewport:{width:390,height:844},reduced:true,blindboxPool:round});
   await openDiscovery(f.page);
   await f.page.getByRole('heading',{name:'First discovery',exact:true}).waitFor();
   await f.page.getByRole('button',{name:'Customize',exact:true}).click();
   await f.page.getByRole('button',{name:'Comfort',exact:true}).click();
   await f.page.getByLabel('What are you looking for?').fill('binh yen');
   await f.page.getByRole('button',{name:'Reveal a memory',exact:true}).click();
   await f.page.getByRole('heading',{name:'Second discovery',exact:true}).waitFor();
   const last=f.state.blindboxCalls.at(-1);
   assert.equal(last.intent,'comfort'); assert.equal(last.query,'binh yen');
   assert.equal(last.seen.length,1,'customize shares the round history instead of resetting it');
   passed.push('Customize keeps the round history and never reintroduces a seen memory');
   await f.context.close();}

  // A failed request is retryable, is never exhaustion, and consumes nothing.
  {const f=await fixture(browser,{viewport:{width:390,height:844},reduced:true,blindboxPool:round,blindboxFailure:true});
   await openDiscovery(f.page);
   const alert=f.page.getByRole('alert');
   await alert.waitFor();
   assert((await alert.innerText()).includes('Synthetic reveal failure'));
   assert.equal(await f.page.getByRole('heading',{name:'Every memory, revisited',exact:true}).count(),0,'a failure is never exhaustion');
   assert.equal(await f.page.getByRole('heading',{name:'Your story is just beginning',exact:true}).count(),0,'a failure is not an empty account');
   await f.page.getByRole('button',{name:'Retry',exact:true}).click();
   await f.page.getByRole('heading',{name:'First discovery',exact:true}).waitFor();
   assert.deepEqual(f.state.blindboxCalls.map(c=>c.seen.length),[0,0],'a failed request consumed no memory');
   passed.push('Network failure stays retryable, consumes nothing and is never exhaustion');
   await f.context.close();}

  // Rapid clicks cannot start overlapping selection requests.
  {const f=await fixture(browser,{viewport:{width:390,height:844},reduced:true,blindboxPool:round});
   await openDiscovery(f.page);
   await f.page.getByRole('heading',{name:'First discovery',exact:true}).waitFor();
   const before=f.state.blindboxCalls.length;
   const gate=deferred(); f.state.blindboxGate=gate.promise;
   await f.page.getByRole('button',{name:'Another memory',exact:true}).evaluate(el=>{el.click();el.click();});
   await delay(200);
   assert.equal(f.state.blindboxCalls.length-before,1,'rapid clicks start one selection request');
   f.state.blindboxGate=null; gate.resolve();
   await f.page.getByRole('heading',{name:'Second discovery',exact:true}).waitFor();
   passed.push('Rapid clicks start exactly one selection request');
   await f.context.close();}

  // A one-memory account completes after its only memory.
  {const f=await fixture(browser,{viewport:{width:390,height:844},reduced:true,blindboxPool:[round[0]]});
   await openDiscovery(f.page);
   await f.page.getByRole('heading',{name:'First discovery',exact:true}).waitFor();
   await f.page.getByRole('button',{name:'Another memory',exact:true}).click();
   await f.page.getByRole('heading',{name:'Every memory, revisited',exact:true}).waitFor();
   assert.deepEqual(f.state.blindboxCalls.map(c=>c.seen.length),[0,1]);
   await hit(f.page.locator('#blindbox-completion').getByRole('button',{name:'Close',exact:true}));
   await dialog(f.page).waitFor({state:'detached'});
   passed.push('A one-memory account completes after its only memory');
   await f.context.close();}

  // Nothing saved yet is a first visit, not a revisited round.
  {const f=await fixture(browser,{viewport:{width:390,height:844},reduced:true,moments:[],blindboxPool:[]});
   await openDiscovery(f.page);
   await f.page.getByRole('heading',{name:'Your story is just beginning',exact:true}).waitFor();
   assert.equal(await f.page.getByRole('heading',{name:'Every memory, revisited',exact:true}).count(),0,'an empty account never claims a revisited round');
   assert.equal(f.state.blindboxCalls.length,1,'the empty state answers one honest request');
   assert(await f.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
   await hit(f.page.locator('#blindbox-empty').getByRole('button',{name:'Close',exact:true}));
   await dialog(f.page).waitFor({state:'detached'});
   passed.push('An account with nothing saved sees the first-visit scene, not exhaustion');
   await f.context.close();}

  // Closing while a reveal is in flight, then switching accounts, inherits nothing.
  {const f=await fixture(browser,{viewport:{width:390,height:844},reduced:true,blindboxPool:round});
   // The modal header close is a pre-existing 36px control, so this lifecycle journey
   // reaches it by centre hit testing without claiming the 44px target.
   const dismiss=async()=>{const close=dialog(f.page).getByRole('button',{name:'Close',exact:true});
    await close.scrollIntoViewIfNeeded();
    assert(await close.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'header close is centre-reachable');
    await close.click();};
   await openDiscovery(f.page);
   await f.page.getByRole('heading',{name:'First discovery',exact:true}).waitFor();
   const gate=deferred(); f.state.blindboxGate=gate.promise;
   await f.page.getByRole('button',{name:'Another memory',exact:true}).click();
   while(f.state.blindboxCalls.length<2)await delay(20);
   await dismiss();
   await dialog(f.page).waitFor({state:'detached'});
   f.state.blindboxGate=null; gate.resolve(); await delay(250);
   assert.equal(await dialog(f.page).count(),0,'a superseded reveal cannot reopen a closed dialog');
   assert.equal(f.errors.length,0,f.errors.join(';'));
   await openDiscovery(f.page);
   await f.page.getByRole('heading',{name:'First discovery',exact:true}).waitFor();
   assert.equal(f.state.blindboxCalls.at(-1).seen.length,0,'the aborted reveal consumed nothing, so the reopened round is fresh');
   await dismiss();
   await dialog(f.page).waitFor({state:'detached'});
   await logoutAndLogin(f.page);
   await openDiscovery(f.page);
   await f.page.getByRole('heading',{name:'First discovery',exact:true}).waitFor();
   assert.equal(f.state.blindboxCalls.at(-1).seen.length,0,'the next account inherits no round history');
   assert.equal(await f.page.getByRole('heading',{name:'Every memory, revisited',exact:true}).count(),0,'the next account inherits no completion scene');
   assert.equal(f.errors.length,0,f.errors.join(';'));
   passed.push('Closing while pending, reopening and switching accounts inherits no round state');
   await f.context.close();}

  console.log(JSON.stringify({synthetic:true,journeys:passed.length,passed,cleanup:true}));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
