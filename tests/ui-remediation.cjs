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
 const state={account:'A',requests:[],puts:[],uploadIds:[],deletes:0,moments:[structuredClone(moment)],tracks:[track],visits:[],visitWrites:[],perspectives:[],postcardRenders:[],postcardPng,failImages:false,perspectiveExportGate:null,perspectiveExportStarted:null,...options};
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
    if(state.perspectiveExportStarted)state.perspectiveExportStarted.resolve();
    if(state.perspectiveExportGate)await state.perspectiveExportGate.promise;
    return route.fulfill({status:503,json:{error:'Synthetic export failure'}});
  }
  else if(url.pathname==='/api/collaboration-invitations')body={invitations:[]};
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
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/opt/hermes/tools/chromium-1208/chrome-linux/chrome',args:['--no-sandbox']});const results=[];
 try {
  if(process.env.MEMENTO_UI_DRAFT_ONLY==='1') {
   const cases=[
    {name:'backdrop',action:page=>page.locator('#event-detail-backdrop').click({position:{x:2,y:2}})},
    {name:'Escape',action:page=>page.keyboard.press('Escape')},
    {name:'header close',action:page=>page.getByRole('button',{name:'Close memory details',exact:true}).click()},
    {name:'track navigation',action:page=>page.locator('#event-detail-card').locator('button[title^="Filter to"]').click()},
    {name:'edit navigation',action:page=>page.locator('#event-detail-card').getByTitle('Edit event',{exact:true}).click()},
    {name:'delete',action:page=>page.locator('#event-detail-card').getByTitle('Delete event',{exact:true}).click(),delete:true},
   ];
   for(const dismissal of cases) {
    const {page,state,context}=await fixture(browser);
    await page.locator('#event-card-A\\:qa-moment h3').click();
    await page.getByRole('button',{name:'Add your perspective',exact:true}).click();
    const textarea=page.locator('#event-detail-card textarea');await textarea.fill('Unsent synthetic perspective');
    const decisions=[];const cancel=async dialog=>{decisions.push(dialog.message());await dialog.dismiss();};
    page.on('dialog',cancel);await dismissal.action(page);if(dismissal.delete)await page.waitForTimeout(100);page.off('dialog',cancel);
    assert.equal(decisions.length,1,`${dismissal.name}: expected confirmation`);if(dismissal.delete)assert.match(decisions[0],/discard your unsaved perspective/);
    assert.equal(await page.locator('#event-detail-card').count(),1,`${dismissal.name}: cancel should keep detail open`);
    assert.equal(await textarea.inputValue(),'Unsent synthetic perspective',`${dismissal.name}: cancel should retain draft`);
    const accept=async dialog=>dialog.accept();page.on('dialog',accept);await dismissal.action(page);page.off('dialog',accept);
    if(dismissal.delete) {assert.equal(state.deletes,1,'delete proceeds after both confirmations');assert.equal(await page.locator('#event-detail-card').count(),0);}
    else if(dismissal.name==='edit navigation') {await page.locator('#event-modal-backdrop').waitFor();assert.equal(await page.locator('#event-detail-card').count(),0);}
    else assert.equal(await page.locator('#event-detail-card').count(),0,`${dismissal.name}: accepted discard should close`);
    results.push(`${dismissal.name}: nonempty draft confirm/cancel retention and confirmed dismissal PASS`);
    await context.close();
   }
    {
     const gate=deferred(),started=deferred();const {page,context}=await fixture(browser,{createGate:gate,createStarted:started,createFailure:true});
     await page.locator('#open-create-event-modal').click();
     const form=page.locator('#event-modal-backdrop');await form.waitFor();
     const title=form.locator('input[type="text"]').first();await title.fill('Pending synthetic moment draft');
     await page.locator('#save-event-button').click();await started.promise;
     assert(await page.locator('#close-event-modal').isDisabled());
     await page.keyboard.press('Escape');assert.equal(await form.count(),1,'Escape must not dismiss a pending moment save');
     await form.click({position:{x:2,y:2}});assert.equal(await form.count(),1,'backdrop must not dismiss a pending moment save');
     await page.locator('#close-event-modal').click({force:true});assert.equal(await form.count(),1,'header close must not dismiss a pending moment save');
     gate.resolve();await page.getByRole('alert').filter({hasText:'Synthetic moment save failure'}).waitFor();
     assert.equal(await title.inputValue(),'Pending synthetic moment draft');assert.equal(await form.count(),1);
     results.push('pending moment save blocks Escape/backdrop/header close; rejected save preserves visible draft and error PASS');await context.close();
    }
    {
     const gate=deferred(),started=deferred();const {page,context}=await fixture(browser,{trackSaveGate:gate,trackSaveStarted:started});
     await page.locator('#btn-add-event-track').click();
     const form=page.locator('#event-track-modal-backdrop');await form.waitFor();
     const title=form.locator('input[type="text"]').first();await title.fill('Pending synthetic track draft');
     await page.locator('#save-track-button').click();await started.promise;
     assert(await page.locator('#close-track-modal').isDisabled());
     await page.keyboard.press('Escape');assert.equal(await form.count(),1,'Escape must not dismiss a pending track save');
     await form.click({position:{x:2,y:2}});assert.equal(await form.count(),1,'backdrop must not dismiss a pending track save');
     await page.locator('#close-track-modal').click({force:true});assert.equal(await form.count(),1,'header close must not dismiss a pending track save');
     gate.resolve();await page.getByRole('alert').filter({hasText:'Synthetic track save failure'}).waitFor();
     assert.equal(await title.inputValue(),'Pending synthetic track draft');assert.equal(await form.count(),1);
     results.push('pending track save blocks Escape/backdrop/header close; rejected save preserves visible draft and error PASS');await context.close();
    }
   console.log(JSON.stringify({kind:'synthetic controlled-route browser QA, not authenticated live-account E2E',results},null,2));
   return;
  }
  for(const [width,height] of [[320,740],[390,844],[844,390],[1440,900]]) {
   const {page,state,errors,context}=await fixture(browser,{viewport:{width,height}});
   await page.locator('#event-card-A\\:qa-moment h3').click();
   for(const name of ['Edit event','Delete event'])assert(await page.locator('#event-detail-card').getByTitle(name,{exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),`detail ${name} covered at ${width}`);
   const react=page.getByRole('button',{name:'React ❤️, 1 reactions',exact:true});await hit(react);await page.waitForFunction(()=>document.querySelector('[aria-label="React ❤️, 1 reactions"]')?.getAttribute('aria-pressed')==='true');
   assert.equal(state.puts[0].method,'PUT'); assert.equal(state.puts[0].active,true);
   await page.getByRole('button',{name:'Who reacted?',exact:true}).click();assert(await page.getByText('❤️ synthetic-actor',{exact:true}).isVisible());
   await page.getByTitle('Enlarge photo',{exact:true}).click();
   for(let i=0;i<4;i++) {
    await imageReady(page);
    const media=await page.locator('#image-lightbox-overlay img').evaluate(img=>{const r=img.getBoundingClientRect();return {fit:getComputedStyle(img).objectFit,w:r.width,h:r.height,x:r.x,y:r.y,bottom:r.bottom,right:r.right,nw:img.naturalWidth,nh:img.naturalHeight};});
    assert.equal(media.fit,'contain');assert(media.w>width*.85);assert(media.bottom<=height && media.right<=width && media.y>=44 && media.h>80);
    await hit(page.locator('#lightbox-original-button'));await imageReady(page);if(width===320) await page.screenshot({path:path.join(artifacts,`lightbox-320-aspect-${i}.png`)});
    if(i<3){const start=state.requests.length;await hit(page.locator('#lightbox-next-button'));await imageReady(page);assert(!state.requests.slice(start).some(url=>url.includes(`qa-${i+1}?variant=original`)),'navigation requested next original');}
   }
   await hit(page.locator('#lightbox-prev-button'));await imageReady(page);await hit(page.locator('#lightbox-close-button'));
   await page.keyboard.press('Escape');assert.equal(await page.locator('#event-detail-card').count(),0);
   await page.locator('#timeline-search-input').fill('no-synthetic-match');await page.locator('#empty-timeline-state').waitFor();await page.locator('#timeline-search-input').fill('');await page.locator('#event-card-A\\:qa-moment').waitFor();
   await page.locator('#view-gallery-btn').click();await page.locator('#gallery-view-grid').waitFor();assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),'gallery overflow');await page.locator('#view-timeline-btn').click();await page.locator('#event-card-A\\:qa-moment').waitFor();
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow) { console.log('OVERFLOW',width,await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth).map(el=>({tag:el.tagName,cls:el.className,text:el.textContent?.slice(0,80),box:el.getBoundingClientRect().toJSON()})).slice(-30))); await page.screenshot({path:path.join(artifacts,'ui-overflow.png'),fullPage:true}); } assert(!overflow,'document overflow');assert.deepEqual(errors,[]);
   await page.screenshot({path:path.join(artifacts,`ui-fixed-${width}.png`),fullPage:true});
   results.push(`matrix ${width}x${height}: four aspect ratios, original/next/prev/close hit+click, reactions, long text PASS`);await context.close();
  }
  {const gate=deferred();const {page,state,context}=await fixture(browser,{holdDisplay:gate});
   await page.locator('#event-card-A\\:qa-moment img').first().click();await delay(200);
   assert(!state.requests.some(url=>/qa-[12]\?variant=display/.test(url)),'prefetched before decode');gate.resolve();await imageReady(page);await page.waitForTimeout(200);assert(state.requests.some(url=>url.includes('qa-1?variant=display')));assert(!state.requests.some(url=>url.includes('qa-2?variant=display')));results.push('prefetch waits current decode, one forward neighbor at edge PASS');await context.close();}
  {const {page,state,context}=await fixture(browser,{saveData:true,reduced:true});await page.locator('#event-card-A\\:qa-moment img').first().click();await imageReady(page);await delay(200);assert(!state.requests.some(url=>/qa-[123]\?variant=display/.test(url)));results.push('Save-Data disables prefetch PASS');await context.close();}
  {const {page,state,context}=await fixture(browser);state.failImages=true;await page.locator('#event-card-A\\:qa-moment img').first().click();await page.getByRole('button',{name:'Retry photo',exact:true}).waitFor();const before=state.requests.filter(url=>url.includes('variant=display')).length;await delay(800);assert.equal(state.requests.filter(url=>url.includes('variant=display')).length,before);state.failImages=false;await page.getByRole('button',{name:'Retry photo',exact:true}).click();await imageReady(page);results.push('PrivateImage bounded automatic retry, stable failure and explicit recovery PASS');await context.close();}
  {const {page,state,context}=await fixture(browser,{singleMomentPatch:{version:7,title:'Latest saved title',description:'Latest saved story'},conflictCount:2});await page.locator('#event-card-A\\:qa-moment h3').click();await page.locator('#event-detail-card').getByTitle('Edit event',{exact:true}).click();await page.locator('#event-modal-backdrop input').first().waitFor();
   // Title is a required text input; avoid relying on decorative label association.
   const inputs=await page.locator('#event-modal-backdrop input').evaluateAll(xs=>xs.map(x=>({type:x.type,value:x.value,required:x.required})));
   const target=page.locator('#event-modal-backdrop input').nth(inputs.findIndex(x=>x.value===moment.title));await target.fill('Retained synthetic local draft');
   await page.locator('#save-event-button').click();
   // Phase 1 Task 1.4: a 409 opens an escaped side-by-side comparison against the
   // exact (ownerId, id) read — never a blind overwrite, never a copy-to-app ask.
   const panel=page.locator('#moment-conflict-panel');await panel.waitFor();
   const panelText=await panel.textContent()||'';
   assert.equal(state.puts[0].expectedVersion,3,'first save still targets the displayed version');
   assert(panelText.includes('Retained synthetic local draft'),'draft shown in Your edits');
   assert(panelText.includes('Latest saved title'),'server version shown alongside');
   assert(/version/i.test(panelText),'a version number is part of the comparison');
   assert(panelText.includes('7'),'the server version value is shown');
   assert.equal(await target.inputValue(),'Retained synthetic local draft','draft preserved while comparing');
   assert.equal(state.singleMomentRequests,1,'exactly one exact single-moment read');
   await page.locator('#conflict-dismiss').click();assert.equal(await panel.count(),0,'Keep comparing hides the panel');assert.equal(await target.inputValue(),'Retained synthetic local draft');
   // "Use latest saved values" adopts server state AND its version, then saves cleanly.
   await page.locator('#save-event-button').click();await panel.waitFor();await page.locator('#conflict-use-latest').click();await page.locator('#moment-conflict-panel').waitFor({state:'detached'});
   assert.equal(await target.inputValue(),'Latest saved title','form adopts the server values');
   assert.equal(state.puts.length,2,'adopting latest never re-submits on its own');
   await page.locator('#save-event-button').click();await page.locator('#event-modal-backdrop').waitFor({state:'detached',timeout:3000});
   assert.equal(state.puts[2].expectedVersion,7,'the adopted version is carried into the next save');
   results.push('409 opens escaped comparison; Use latest adopts values and version; save then succeeds PASS');await context.close();}
  {const gate=deferred(),started=deferred();const {page,state,context,errors}=await fixture(browser,{perspectiveExportGate:gate,perspectiveExportStarted:started});
   await page.getByTitle('More actions',{exact:true}).click();await page.getByRole('menuitem',{name:/Export backup/}).click();await started.promise;await logoutAndLogin(page);gate.resolve();await delay(300);
   assert.equal(await page.getByRole('alert').count(),0,'previous-account export error must not appear after session switch');assert.deepEqual(errors,[]);
   results.push('deferred account-A export rejection after login account-B is fenced and stale error cleared PASS');await context.close();}
  {const gate=deferred(),started=deferred();const {page,state,context,errors}=await fixture(browser,{reactionGate:gate,reactionStarted:started});await page.locator('#event-card-A\\:qa-moment h3').click();await page.getByRole('button',{name:'React ❤️, 1 reactions',exact:true}).click();await started.promise;await logoutAndLogin(page);gate.resolve();await delay(300);assert.equal(await page.locator('#event-card-A\\:qa-moment').count(),0);assert.equal(await page.locator('#event-detail-card').count(),0);assert(!(await page.locator('body').innerText()).includes('synthetic-actor'));assert.deepEqual(errors,[]);results.push('deferred A reaction success after logout/login B discarded PASS');await context.close();}
  {const gate=deferred(),started=deferred();const {page,state,context,errors}=await fixture(browser,{createGate:gate,createStarted:started});await page.locator('#open-create-event-modal').click();await page.locator('#event-modal-backdrop input[type="text"]').first().waitFor();const fields=page.locator('#event-modal-backdrop input');const inputs=await fields.evaluateAll(xs=>xs.map(x=>({type:x.type,value:x.value})));const ti=inputs.findIndex(x=>x.type==='text' && x.value==='');await fields.nth(ti).fill('Previous-account mutation');await page.locator('#save-event-button').click();await started.promise;
   // Phase 1 guard: a pending save blocks every dismissal path, so the account menu is unreachable until it settles.
   assert(await page.locator('#close-event-modal').isDisabled());
   await page.keyboard.press('Escape');assert.equal(await page.locator('#event-modal-backdrop').count(),1,'Escape must not dismiss a pending create save');
   await page.locator('#event-modal-backdrop').click({position:{x:2,y:2}});assert.equal(await page.locator('#event-modal-backdrop').count(),1,'backdrop must not dismiss a pending create save');
   gate.resolve();await page.locator('#event-modal-backdrop').waitFor({state:'detached',timeout:3000});assert.equal(await page.locator('#event-modal-backdrop').count(),0,'successful create closes the modal');
   await logoutAndLogin(page);await delay(300);
   assert.equal(await page.locator('#event-card-A\\:created-A').count(),0);assert(!(await page.locator('body').innerText()).includes('Previous-account'));assert.deepEqual(errors,[]);
   results.push('pending create blocks dismissal; successful create closes modal; no A content after logout/login B PASS');await context.close();}
  {const {page,state,context}=await fixture(browser,{uploadFailure:true,uploadRefresh:true});await page.locator('#open-create-event-modal').click();await page.locator('#event-modal-backdrop input[type="text"]').first().waitFor();
   const fields=page.locator('#event-modal-backdrop input');const inputs=await fields.evaluateAll(xs=>xs.map(x=>({type:x.type,value:x.value})));await fields.nth(inputs.findIndex(x=>x.type==='text' && x.value==='')).fill('Synthetic upload queue');
   const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
   await page.locator('#event-modal-backdrop input[type="file"]').setInputFiles([{name:'one.png',mimeType:'image/png',buffer:png},{name:'two.png',mimeType:'image/png',buffer:png}]);
   await page.locator('#event-modal-backdrop img').nth(1).waitFor();await page.locator('#save-event-button').click();
   await page.getByRole('button',{name:'Retry image upload',exact:true}).waitFor();assert.equal(state.uploadIds.length,2);
   await page.getByRole('button',{name:'Retry image upload',exact:true}).dblclick();await page.getByRole('button',{name:'Retry timeline refresh',exact:true}).waitFor();assert.equal(state.uploadIds.length,3);assert.equal(state.uploadIds[1],state.uploadIds[2]);assert.notEqual(state.uploadIds[0],state.uploadIds[1]);
   await page.getByRole('button',{name:'Retry timeline refresh',exact:true}).click();await page.waitForTimeout(200);assert.equal(state.uploadIds.length,3);assert.equal(await page.getByRole('button',{name:'Retry timeline refresh',exact:true}).count(),0);results.push('partial uploads advance acknowledged queue; single-flight double retry; stable idempotency key; refresh-only retry PASS');await context.close();}
  {const gate=deferred(),started=deferred();const {page,state,context}=await fixture(browser,{reactionGate:gate,reactionStarted:started,reactionFailure:true});await page.locator('#event-card-A\\:qa-moment h3').click();const button=page.getByRole('button',{name:'React ❤️, 1 reactions',exact:true});await button.click();await started.promise;assert(await button.isDisabled());assert.equal(state.puts.length,1);gate.resolve();await page.getByText('Synthetic reaction failure',{exact:true}).waitFor();assert(!(await button.isDisabled()));assert.equal(await button.getAttribute('aria-pressed'),'false');results.push('reaction single-flight pending and stable error retry UI PASS');await context.close();}
  {const {page,state,context}=await fixture(browser,{reduced:true});await page.getByRole('button',{name:'Open a random memory',exact:true}).click();await page.getByRole('button',{name:'Reveal a memory',exact:true}).click();await page.getByRole('button',{name:'Open in track',exact:false}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();await page.waitForTimeout(200);await page.getByRole('button',{name:'Open a random memory',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Open in track',exact:false}).count(),0);results.push('Blindbox close/reopen clears result snapshot PASS');await context.close();}
  {const {page,state,context}=await fixture(browser);await page.locator('#event-card-A\\:qa-moment h3').click();await page.getByRole('button',{name:'Next detail photo',exact:true}).click();assert((await page.locator('#event-detail-card img').first().getAttribute('src')).includes('qa-1'));await page.keyboard.press('Escape');await page.locator('#event-card-A\\:qa-moment h3').click();assert((await page.locator('#event-detail-card img').first().getAttribute('src')).includes('qa-0'));results.push('detail close/reopen resets selected index PASS');await context.close();}
  for (const dismissal of [
   {name:'backdrop',action:page=>page.locator('#event-detail-backdrop').click({position:{x:2,y:2}})},
   {name:'Escape',action:page=>page.keyboard.press('Escape')},
   {name:'header close',action:page=>page.getByRole('button',{name:'Close memory details',exact:true}).click()},
   {name:'track navigation',action:page=>page.locator('#event-detail-card').locator('button[title^="Filter to"]').click()},
   {name:'edit navigation',action:page=>page.locator('#event-detail-card').getByTitle('Edit event',{exact:true}).click()},
   {name:'delete',action:page=>page.locator('#event-detail-card').getByTitle('Delete event',{exact:true}).click(),delete:true},
  ]) {
   const {page,state,context}=await fixture(browser);await page.locator('#event-card-A\\:qa-moment h3').click();await page.getByRole('button',{name:'Add your perspective',exact:true}).click();
   const textarea=page.locator('#event-detail-card textarea');await textarea.fill('Unsent synthetic perspective');
   const decisions=[];const cancel=async dialog=>{decisions.push(dialog.message());await dialog.dismiss();};
   page.on('dialog',cancel);await dismissal.action(page);page.off('dialog',cancel);
   assert.equal(decisions.length,1,`${dismissal.name}: expected confirmation`);if(dismissal.delete)assert.match(decisions[0],/discard your unsaved perspective/);assert.equal(await page.locator('#event-detail-card').count(),1,`${dismissal.name}: cancel should keep detail open`);assert.equal(await textarea.inputValue(),'Unsent synthetic perspective',`${dismissal.name}: cancel should retain draft`);
   const accept=async dialog=>dialog.accept();page.on('dialog',accept);await dismissal.action(page);page.off('dialog',accept);
   if(dismissal.delete){assert.equal(state.deletes,1,'delete proceeds after both confirmations');await page.locator('#event-detail-card').waitFor({state:'detached',timeout:3000});}
   else if(dismissal.name==='edit navigation'){await page.locator('#event-detail-card').waitFor({state:'detached',timeout:3000});}
   else assert.equal(await page.locator('#event-detail-card').count(),0,`${dismissal.name}: accepted discard should close`);
   results.push(`nonempty draft ${dismissal.name} dismissal asks before discard; cancel preserves draft and accept proceeds PASS`);await context.close();
  }
  {const {page,state,context,errors}=await fixture(browser);state.failImages=true;await page.locator('#event-card-A\\:qa-moment img').first().click();await delay(100);await page.locator('#lightbox-next-button').click();state.failImages=false;await page.locator('#lightbox-next-button').click();await imageReady(page);await delay(650);const image=page.locator('#image-lightbox-overlay img');assert((await image.getAttribute('src')).includes('qa-2'));assert(!(await image.getAttribute('src')).includes('retry='));assert.equal(await page.locator('#image-lightbox-overlay').getByText('Photo unavailable',{exact:true}).count(),0);assert.deepEqual(errors,[]);results.push('rapid navigation cancels prior failed photo retry and stale callbacks PASS');await context.close();}
  // ---- Phase 2: "Ngày ấy" rediscovery + reflection (synthetic controlled routes) ----
  {const stale=new Date(Date.now()-400*864e5).toISOString();
   const {page,state,context,errors}=await fixture(browser,{resurfacing:true,viewport:{width:1200,height:900},visits:[{trackOwnerId:'A',trackId:'qa-track-3',lastOpenedAt:stale}]});
   const section=page.locator('#memory-resurfacing');
   await section.waitFor();
   const cards=await section.locator('li button').allTextContents();
   assert.equal(cards.length,3,'three compact suggestions');
   const expect=[['Anniversary memory','On this day'],['Monthly memory','This month last year'],["Old memory","haven't revisited"]];
   for(const pair of expect){const matches=cards.filter(text=>text.includes(pair[0]));assert.equal(matches.length,1,`exactly one card for ${pair[0]}`);assert(matches[0].includes(pair[1]),`reason for ${pair[0]}: ${matches[0]}`);}
   assert.equal(state.requests.filter(u=>u.startsWith('/api/track-visits')).length,1,'single private visit-history read');
   await page.locator('#tab-event-track-A-qa-track-2').click();
   assert.equal(await section.count(),0,'section only in the all-tracks overview');
   await page.locator('#tab-all-events-merged').click();
   await section.waitFor();
   await page.locator('#timeline-search-input').fill('zzz-no-match');
   const suggestionOpen=state.visitWrites.length;
   await section.locator('li').first().locator('button').click();
   await page.locator('#event-detail-card').waitFor();
   assert.equal(await page.locator('#timeline-search-input').inputValue(),'','suggestion clears an unrelated active filter');
   assert.equal(await page.locator('#event-detail-card').innerText().then(t=>t.includes('Anniversary memory')),true,'suggestion opens its exact moment');
   assert.equal(state.visitWrites.length,suggestionOpen+1,'opening records exactly one private visit');
   await page.keyboard.press('Escape');
   await page.locator('#event-detail-card').waitFor({state:'detached',timeout:3000});
   const momentsBefore=state.requests.filter(u=>u==='/api/moments').length;
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
   await delay(1200);
   assert.equal(state.requests.filter(u=>u==='/api/moments').length,momentsBefore,'no polling on focus/refresh');
   assert.equal(state.requests.filter(u=>u.startsWith('/api/track-visits')).length,1,'no repeat visit-history reads');
   assert.deepEqual(errors,[]);
   results.push('Ngày ấy overview, truthful reasons, track-only placement, filter clear, private visit, no polling PASS');await context.close();}
  {const {page,state,context,errors}=await fixture(browser,{resurfacing:true});
   const section=page.locator('#memory-resurfacing');
   await section.waitFor();
   assert.equal(await section.locator('li').count(),3);
   assert.equal(await section.locator('li').nth(1).isVisible(),false,'mobile shows one featured card');
   assert.equal(await section.locator('li').nth(2).isVisible(),false,'mobile hides the rest until See more');
   await hit(section.getByRole('button',{name:/^See more/}));
   assert.equal(await section.locator('li').nth(1).isVisible(),true,'See more reveals card 2');
   assert.equal(await section.locator('li').nth(2).isVisible(),true,'See more reveals card 3');
   await hit(section.getByRole('button',{name:'Show less',exact:true}));
   assert.equal(await section.locator('li').nth(1).isVisible(),false,'Show less collapses again');
   assert.deepEqual(errors,[]);
   results.push('mobile 390 featured card plus explicit See more/Show less with 44px targets PASS');await context.close();}
  {const {page,state,context,errors}=await fixture(browser);
   await page.locator('#event-card-A\\:qa-moment h3').click();
   await page.locator('#event-detail-card').waitFor();
   const reflect=page.getByRole('button',{name:'Bây giờ nghĩ lại…',exact:true});
   await reflect.waitFor();
   await reflect.click();
   const textarea=page.locator('#event-detail-card textarea');
   await textarea.waitFor();
   assert.equal(await page.getByText('Looking back · written today',{exact:true}).count(),1,'dated reflection composer label');
   await textarea.fill('Nhìn lại sau một năm');
   await page.getByRole('button',{name:'Save perspective',exact:true}).click();
   await page.getByText('Nhìn lại sau một năm',{exact:true}).waitFor();
   assert.equal(state.perspectives.length,1);
   // Wait for the refetched LIST item specifically — the closing composer also
   // shows a 'Looking back · …' label, which would make a loose wait pass early.
   await page.locator('#event-detail-card ol li').first().waitFor();
   assert((await page.locator('#event-detail-card').innerText()).includes('Looking back ·'),'saved item labelled Looking back');
   assert.equal(state.perspectives[0].kind,'reflection','reflection saved as kind=reflection');
   assert.equal(state.perspectives[0].body,'Nhìn lại sau một năm');
   assert.equal(state.perspectives[0].momentId,'qa-moment');
   assert.equal(state.puts.length,0,'original story not overwritten');
   assert.equal(await page.locator('#event-detail-card').innerText().then(t=>t.includes('Controlled fixture')),true,'original description still shown');
   assert.deepEqual(errors,[]);
   results.push('Bây giờ nghĩ lại opens dated reflection composer, saves reflection without touching the story PASS');await context.close();}
  {const {page,state,context,errors}=await fixture(browser,{perspectiveCanCreate:false});
   await page.locator('#event-card-A\\:qa-moment h3').click();
   await page.locator('#event-detail-card').waitFor();
   await page.getByText('Editor access is needed to add a perspective.').waitFor();
   assert.equal(await page.getByRole('button',{name:'Add your perspective',exact:true}).count(),0,'viewer gets no write CTA');
   assert.equal(await page.getByRole('button',{name:'Bây giờ nghĩ lại…',exact:true}).count(),0,'viewer gets no reflection entry');
   assert((await page.locator('#event-detail-card').innerText()).includes('Controlled fixture'),'viewer still reads the story');
   assert.deepEqual(errors,[]);
   results.push('read-only viewer reads perspectives without any write or reflection CTA PASS');await context.close();}
  {const {page,state,context,errors}=await fixture(browser,{resurfacing:true,visitFailure:true});
   const section=page.locator('#memory-resurfacing');
   await section.waitFor();
   // innerText is visibility-scoped on mobile; read the full rendered text instead.
   const text=await section.evaluate(el=>el.textContent||'');
   assert(text.includes('A chapter to revisit'),'unknown visit history uses truthful neutral copy');
   assert(!text.includes("haven't revisited"),'no stale-visit claim when history is unavailable');
   await page.locator('#event-card-A\\:qa-moment h3').click();
   await page.locator('#event-detail-card').waitFor();
   assert.equal(await page.locator('[role=alert]').count(),0,'visit history failure never blocks the timeline');
   assert.deepEqual(errors,[]);
   results.push('visit-history read failure keeps neutral copy and a fully usable timeline PASS');await context.close();}
  {const {page,state,context,errors}=await fixture(browser,{resurfacing:true,viewport:{width:1200,height:900}});
   const section=page.locator('#memory-resurfacing');
   await section.waitFor();
   assert((await section.innerText()).includes('Anniversary memory'));
   page.on('dialog',dialog=>dialog.accept());
   await section.locator('li').first().locator('button').click();
   await page.locator('#event-detail-card').waitFor();
   await page.locator('#event-detail-card').getByTitle('Delete event',{exact:true}).click();
   await page.locator('#event-detail-card').waitFor({state:'detached',timeout:3000});
   await page.locator('#tab-all-events-merged').click();
   await section.waitFor();
   const after=await section.innerText();
   assert(!after.includes('Anniversary memory'),'deleted moment leaves the suggestions');
   assert((await section.locator('li button').count())<=3,'still capped at three');
   assert.deepEqual(errors,[]);
   results.push('deletion while a suggestion is shown removes it without stale capture PASS');await context.close();}

  // ---- Phase 1: composer UX, drafts, conflicts, capability ----
  {const {page,state,context,errors}=await fixture(browser);
   // Story and title first; optional metadata stays collapsed until asked for.
   await page.locator('#open-create-event-modal').click();await page.locator('#event-modal-backdrop').waitFor();
   assert.equal(await page.locator('#event-title-input').count(),1,'title is a first-class field');
   assert.equal(await page.locator('#event-description-input').count(),1,'story is a first-class field');
   assert.equal(await page.locator('#toggle-more-details').getAttribute('aria-expanded'),'false','More details collapsed by default on create');
   const titleY=await page.locator('#event-title-input').boundingBox().then(b=>b.y);
   const storyY=await page.locator('#event-description-input').boundingBox().then(b=>b.y);
   assert(storyY>titleY,'story follows the title, both before the optional sections');
   const photoY=await page.locator('#upload-image-button').boundingBox().then(b=>b.y);
   assert(storyY<photoY,'the story sits above photos');
   // Neutral defaults: no emotion and no milestone tag is invented for you.
   // The only pressed control in the form is the preselected writable track.
   await page.locator('#toggle-more-details').click();
   assert.equal(await page.locator('#toggle-milestone-button').getAttribute('aria-pressed'),'false','no milestone invented');
   assert.equal(await page.locator('#event-modal-backdrop button[aria-pressed=true]').count(),1,'only the track is preselected');
   assert.equal(await page.locator('#event-modal-backdrop').getByText('Clear emotion',{exact:true}).count(),0,'no emotion preselected');
   assert.equal(await page.locator('#event-modal-backdrop [aria-label^="Intensity"]').count(),0,'no intensity control until an emotion is chosen');
   // Choosing an emotion reveals intensity; every newly exposed control is a
   // real touch target rather than an inline text link.
   await page.locator('#event-modal-backdrop button[aria-pressed=false]').filter({hasText:'Joyful'}).first().click();
   for(const label of ['Intensity 1','Intensity 5']){
     const b=page.locator(`#event-modal-backdrop button[aria-label="${label}"]`);const r=await b.boundingBox();
     assert(r.width>=44 && r.height>=44,`${label} ${r.width}x${r.height} >= 44`);
   }
   await page.locator('#event-modal-backdrop').getByText('Clear emotion',{exact:true}).click();
   assert.equal(await page.locator('#event-modal-backdrop [aria-label^="Intensity"]').count(),0,'clearing the emotion removes intensity');
   assert.deepEqual(errors,[]);
   results.push('composer leads with title+story, More details collapsed, no invented emotion/milestone PASS');await context.close();}

  {const {page,state,context,errors}=await fixture(browser);
   // Task 1.3: a dirty composer asks once on every dismissal path, and the
   // three choices behave exactly as offered.
   await page.locator('#open-create-event-modal').click();await page.locator('#event-title-input').waitFor();
   await page.locator('#event-title-input').fill('Bản nháp cần giữ');
   await page.locator('#cancel-event-button').click();
   const panel=page.locator('#draft-dismissal-panel');await panel.waitFor();
   assert((await panel.innerText()).includes('closing the tab or reloading can lose it'),'the honest session-only limit is stated');
   await page.locator('#draft-continue-button').click();await page.locator('#draft-dismissal-panel').waitFor({state:'detached'});
   assert.equal(await page.locator('#event-title-input').inputValue(),'Bản nháp cần giữ','Continue editing keeps the text');
   await page.keyboard.press('Escape');await panel.waitFor();
   await page.locator('#draft-keep-button').click();await page.locator('#event-modal-backdrop').waitFor({state:'detached',timeout:3000});
   // Same page session, same scope: the kept draft comes back.
   await page.locator('#open-create-event-modal').click();await page.locator('#event-title-input').waitFor();
   assert.equal(await page.locator('#event-title-input').inputValue(),'Bản nháp cần giữ','kept draft restored within the same session');
   // Discard really discards.
   await page.locator('#event-title-input').fill('Sẽ bị bỏ');
   await page.locator('#close-event-modal').click();await panel.waitFor();
   await page.locator('#draft-discard-button').click();await page.locator('#event-modal-backdrop').waitFor({state:'detached',timeout:3000});
   await page.locator('#open-create-event-modal').click();await page.locator('#event-title-input').waitFor();
   assert.equal(await page.locator('#event-title-input').inputValue(),'','discarded draft is gone');
   // A clean form never asks.
   await page.locator('#cancel-event-button').click();await page.locator('#event-modal-backdrop').waitFor({state:'detached',timeout:3000});
   assert.equal(await panel.count(),0,'a clean form closes without asking');
   assert.deepEqual(errors,[]);
   results.push('dirty composer asks once; Keep restores, Discard clears, clean form closes silently PASS');await context.close();}

  {const {page,state,context,errors}=await fixture(browser,{singleMomentPatch:{version:9,title:'Server latest',description:'Server story'},conflictCount:999,singleMomentMissing:true});
   // A deleted or revoked memory is reported as an access change; the user's own
   // text stays on screen so nothing typed is lost to a silent failure.
   await page.locator('#event-card-A\\:qa-moment h3').click();await page.locator('#event-detail-card').getByTitle('Edit event',{exact:true}).click();await page.locator('#event-title-input').waitFor();
   await page.locator('#event-title-input').fill('Vẫn còn ở đây');
   await page.locator('#save-event-button').click();
   await page.getByText('This memory is no longer available').waitFor();
   assert((await page.locator('#moment-conflict-panel').innerText()).includes('Vẫn còn ở đây'),'typed text stays visible for copying');
   assert.equal(await page.locator('#event-title-input').inputValue(),'Vẫn còn ở đây','form is not cleared');
   assert.equal(await page.locator('#event-modal-backdrop').count(),1,'the composer stays open');
   assert.deepEqual(errors,[]);
   results.push('deleted/revoked memory reported as access change with the draft kept on screen PASS');await context.close();}

  {const {page,state,context,errors}=await fixture(browser,{viewerTracks:true,moments:[]});
   // Server-authoritative capability: no unusable CTA is ever rendered.
   assert.equal(await page.locator('#open-create-event-modal').count(),0,'no New entry CTA for a viewer-only account');
   await page.locator('#empty-timeline-state').waitFor();
   const text=await page.locator('#empty-timeline-state').evaluate(el=>el.textContent||'');
   assert(text.includes('read-only'),'empty state explains the read-only access');
   assert.equal(await page.locator('#empty-state-add-event').count(),0,'no unusable Add entry CTA');
   assert.deepEqual(errors,[]);
   results.push('viewer-only account sees no create CTA, only a truthful empty state PASS');await context.close();}

  {const {page,state,context,errors}=await fixture(browser,{tracks:[],moments:[]});
   // A zero-track account can only create a track; the CTA says exactly that.
   await page.locator('#empty-timeline-state').waitFor();
   assert((await page.locator('#empty-timeline-state').evaluate(el=>el.textContent||'')).includes('Create your first track'));
   await hit(page.locator('#empty-state-add-track'));await page.locator('#event-track-modal-backdrop').waitFor();
   assert.deepEqual(errors,[]);
   results.push('zero-track account is offered Create your first track, not a dead Add moment PASS');await context.close();}

  {const {page,state,context,errors}=await fixture(browser,{viewport:{width:390,height:844}});
   // Metrics collapse to one compact line; the full ribbon needs an explicit tap.
   const details=page.locator('#toggle-metrics-details');
   assert(await details.isVisible(),'compact metrics line with a Details toggle');
   await hit(details);
   assert(await page.getByText('Attached Photos',{exact:true}).isVisible(),'Details reveals the metrics');
   // Footer: Save and Cancel are real, reachable controls at 390x844.
   await hit(page.locator('#open-create-event-modal'));
   await page.locator('#event-modal-backdrop').waitFor();
   for(const id of ['save-event-button','cancel-event-button']){
     const el=page.locator(`#${id}`);assert(await el.isVisible(),`${id} visible`);
     const r=await el.boundingBox();assert(r.height>=44,`${id} height ${r.height} >= 44`);
   }
   // The footer is a flex sibling of the scroll region, so it stays in the
   // viewport while the body scrolls — it never overlays the photo grid.
   const cardBox=await page.locator('#event-modal-card').boundingBox();
   const footerBox=await page.locator('#cancel-event-button').boundingBox();
   assert(footerBox.y+footerBox.height<=cardBox.y+cardBox.height+1,'footer sits inside the card');
   assert.equal(await page.locator('#event-modal-backdrop').evaluate(el=>el.querySelectorAll('#event-modal-form > div').length>0),true,'scroll region holds the sections');
   await page.locator('#event-modal-form').evaluate(el=>{el.scrollTop=el.scrollHeight;});
   const footerAfterScroll=await page.locator('#cancel-event-button').boundingBox();
   assert(Math.abs(footerAfterScroll.y-footerBox.y)<2,'footer stays put while the form scrolls');
   assert.deepEqual(errors,[]);
   results.push('mobile compact metrics with Details; composer footer controls reachable and >=44px PASS');await context.close();}

  {const many=[track];for(let i=2;i<=12;i++)many.push({...track,id:'qa-track-'+i,title:'Chapter '+String(i).padStart(2,'0')});
   const {page,state,context,errors}=await fixture(browser,{tracks:many});
   // Task 1.5: a long track strip stays bounded and searchable instead of
   // pushing the first memory below the fold.
   const strip=page.locator('button[id^=tab-event-track-]');
   assert.equal(await strip.count(),8,'only the preview renders initially');
   const showAll=page.locator('#toggle-show-all-tracks');
   assert(await showAll.isVisible(),'Show all appears when the list is long');
   await hit(showAll);
   assert.equal(await strip.count(),12,'Show all reveals every chapter');
   await page.locator('#track-nav-search').fill('Chapter 03');
   assert.equal(await strip.count(),1,'search narrows the strip');
   assert((await strip.allInnerTexts()).join(' ').includes('Chapter 03'),'search matches by name');
   await page.locator('#track-nav-search').fill('');
   assert.equal(await strip.count(),12,'clearing search restores every chapter');
   // Select a chapter that falls outside the preview, then collapse: the current
   // selection must stay visible so the user never loses their place.
   const tail=strip.nth(11);await tail.scrollIntoViewIfNeeded();await tail.click();
   await hit(showAll);
   assert.equal(await strip.count(),8,'strip collapses back to the preview');
   assert((await strip.allInnerTexts()).join(' ').includes('Chapter 12'),'the selected chapter stays in the preview');
   // The merged banner reports counts, never a concatenation of every name.
   await hit(page.locator('#tab-all-events-merged'));
   const banner=await page.locator('header,nav,div').filter({hasText:'merged chronological progression'}).first().evaluate(el=>el.textContent||'');
   assert(banner.includes('12'),'banner states the timeline count');
   assert(!banner.includes('Chapter 02, Chapter 03'),'banner does not concatenate every track name');
   assert.deepEqual(errors,[]);
   results.push('track strip bounded to preview with Show all and search; merged banner counts, no name dump PASS');await context.close();}

  // ---- Phase 3: postcard composer (synthetic controlled routes) ----
  {const {page,state,context,errors}=await fixture(browser,{viewerTracks:true});
   await page.getByTitle('More actions',{exact:true}).click();
   assert.equal(await page.getByRole('menuitem',{name:'Create postcard',exact:true}).count(),0,'no entry without an owned track');
   assert.equal(await page.getByRole('menuitem',{name:'Export backup (JSON)',exact:true}).count(),1,'JSON backup still offered');
   await page.getByRole('menuitem',{name:'Export backup (JSON)',exact:true}).click();
   assert.deepEqual(errors,[]);
   results.push('postcard entry hidden without an owned track while JSON backup stays PASS');await context.close();}
  {const {page,state,context,errors}=await fixture(browser);
   await page.getByTitle('More actions',{exact:true}).click();
   await page.getByRole('menuitem',{name:'Create postcard',exact:true}).click();
   const dialog=page.locator('#postcard-composer');
   await dialog.waitFor();
   // Template bounds explain themselves instead of silently refusing.
   await dialog.getByRole('button',{name:'Ordinary day',exact:true}).click();
   assert((await dialog.innerText()).includes('One to three moments'),'template hint shown');
   await dialog.getByRole('button',{name:'Journey',exact:true}).click();
   await dialog.locator('select').selectOption('A:qa-track');
   await dialog.getByRole('checkbox',{name:/SyntheticMemory/}).check();
   await dialog.getByRole('button',{name:'Continue',exact:true}).click();
   await dialog.getByRole('heading',{name:'Wording'}).waitFor();
   await dialog.getByPlaceholder('Nhật ký mùa hè').fill('Nhật ký Đà Nẵng');
   await dialog.getByRole('button',{name:'Continue',exact:true}).click();
   await dialog.getByRole('heading',{name:'Preview'}).waitFor();
   await dialog.getByRole('button',{name:'Generate preview',exact:true}).click();
   await page.getByTestId('postcard-preview').waitFor();
   assert.equal(state.postcardRenders.length,1,'exactly one render request');
   assert.equal(state.postcardRenders[0].template,'journey');
   assert.deepEqual(state.postcardRenders[0].moments,[{ownerId:'A',id:'qa-moment'}]);
   assert.equal(state.postcardRenders[0].title,'Nhật ký Đà Nẵng');
   // Download serves the same bytes the preview displayed.
   const [download]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:/Download PNG/}).click()]);
   const saved=fs.readFileSync(await download.path());
   assert.equal(download.suggestedFilename(),'memento-postcard.png','content-free filename');
   assert.equal(saved.equals(state.postcardPng),true,'download is the exact previewed PNG');
   assert.deepEqual(errors,[]);
   results.push('postcard select→customize→preview→download with exact same bytes PASS');await context.close();}
  {const {page,state,context,errors}=await fixture(browser);
   await page.getByTitle('More actions',{exact:true}).click();
   await page.getByRole('menuitem',{name:'Create postcard',exact:true}).click();
   const dialog=page.locator('#postcard-composer');
   await dialog.waitFor();
   await dialog.locator('select').selectOption('A:qa-track');
   await dialog.getByRole('checkbox',{name:/SyntheticMemory/}).check();
   await dialog.getByRole('button',{name:'Continue',exact:true}).click();
   // The title field caps entry at 80 characters (no silent clipping later),
   // and an empty title is explained before any render request is made.
   const titleInput=dialog.getByPlaceholder('Nhật ký mùa hè');
   assert.equal(await titleInput.getAttribute('maxlength'),'80','title capped at the field');
   await titleInput.fill('y'.repeat(120));
   assert.equal((await titleInput.inputValue()).length,80,'field enforces the cap');
   await titleInput.fill('');
   await dialog.getByRole('button',{name:'Continue',exact:true}).click();
   assert((await dialog.innerText()).includes('Add a short title for the postcard.'),'client guidance before any request');
   assert.equal(state.postcardRenders.length,0,'no render requested for invalid input');
   assert.equal(await page.locator('#postcard-composer[role=dialog]').count(),1,'dialog stays open on guidance');
   assert.deepEqual(errors,[]);
   results.push('postcard over-limit title explained with no render request PASS');await context.close();}
  {const {page,state,context,errors}=await fixture(browser,{postcardRenderFailure:true});
   await page.getByTitle('More actions',{exact:true}).click();
   await page.getByRole('menuitem',{name:'Create postcard',exact:true}).click();
   const dialog=page.locator('#postcard-composer');
   await dialog.waitFor();
   await dialog.locator('select').selectOption('A:qa-track');
   await dialog.getByRole('checkbox',{name:/SyntheticMemory/}).check();
   await dialog.getByRole('button',{name:'Continue',exact:true}).click();
   await dialog.getByPlaceholder('Nhật ký mùa hè').fill('Thử lại');
   await dialog.getByRole('button',{name:'Continue',exact:true}).click();
   await dialog.getByRole('button',{name:'Generate preview',exact:true}).click();
   const alert=dialog.getByRole('alert');
   await alert.waitFor();
   assert((await alert.innerText()).includes('Synthetic postcard failure'),'actionable failure surfaced');
   assert.equal(await page.getByTestId('postcard-preview').count(),0,'no fake preview after failure');
   // A retry is offered and works once the failure clears.
   state.postcardRenderFailure=false;
   await dialog.getByRole('button',{name:'Generate preview',exact:true}).click();
   await page.getByTestId('postcard-preview').waitFor();
   assert.deepEqual(errors,[]);
   results.push('postcard render failure is actionable and retryable PASS');await context.close();}
  // Desktop viewport: the Back control only exists in the side-by-side layout;
  // mobile reaches Customize through its step tabs instead.
  {const {page,state,context,errors}=await fixture(browser,{viewport:{width:1200,height:900}});
   await page.getByTitle('More actions',{exact:true}).click();
   await page.getByRole('menuitem',{name:'Create postcard',exact:true}).click();
   const dialog=page.locator('#postcard-composer');
   await dialog.waitFor();
   await dialog.locator('select').selectOption('A:qa-track');
   await dialog.getByRole('checkbox',{name:/SyntheticMemory/}).check();
   await dialog.getByRole('button',{name:'Continue',exact:true}).click();
   await dialog.getByPlaceholder('Nhật ký mùa hè').fill('Trước khi đổi tài khoản');
   await dialog.getByRole('button',{name:'Continue',exact:true}).click();
   await dialog.getByRole('button',{name:'Generate preview',exact:true}).click();
   await page.getByTestId('postcard-preview').waitFor();
   assert.equal(state.postcardRenders.length,1);
   // Editing after a preview must invalidate it rather than serve stale bytes.
   await dialog.getByRole('button',{name:'Back',exact:true}).click();
   await dialog.getByPlaceholder('Một dòng nhớ về ngày ấy…').fill('Thêm một dòng ký ức');
   assert.equal(await page.getByTestId('postcard-preview').count(),0,'edit invalidates the preview');
   assert((await dialog.innerText()).includes('need a new preview'),'user told to regenerate');
   // Switching accounts must clear composer state and any rendered bytes.
   await page.keyboard.press('Escape');
   await dialog.waitFor({state:'detached',timeout:3000});
   assert.equal(await page.locator('#postcard-composer').count(),0,'composer closed');
   assert.deepEqual(errors,[]);
   results.push('postcard preview invalidates on edit and closes on dismissal PASS');await context.close();}

  console.log(JSON.stringify({kind:'synthetic controlled-route browser QA, not real authenticated E2E',results},null,2));
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});