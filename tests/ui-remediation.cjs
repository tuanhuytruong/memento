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
 const state={account:'A',requests:[],puts:[],uploadIds:[],deletes:0,moments:[structuredClone(moment)],failImages:false,perspectiveExportGate:null,perspectiveExportStarted:null,...options};
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
  else if(url.pathname==='/api/tracks')body={tracks:[track]};
  else if(url.pathname==='/api/tags')body={tags:[]};
  else if(url.pathname==='/api/moments' && req.method()==='GET') {
    if(state.refreshFailure){state.refreshFailure=false;return route.fulfill({status:503,json:{error:'synthetic refresh failure'}});}
    body={moments:state.moments};
  }
  else if(url.pathname==='/api/moments/qa-moment/perspectives')body={perspectives:[],nextCursor:null,capabilities:{canCreate:true,canModerate:true}};
  else if(url.pathname==='/api/moments/qa-moment' && req.method()==='DELETE') {state.deletes++;body={};}
  else if(url.pathname==='/api/moments' && req.method()==='POST') {
    state.created=deferred(); if(state.createGate){state.createStarted?.resolve();await state.createGate.promise;}
    if(state.createFailure)return route.fulfill({status:503,json:{error:'Synthetic moment save failure'}});
    body={moment:{...moment,...req.postDataJSON(),id:'created-A',version:1}};
  }
  else if(url.pathname==='/api/moments/qa-moment' && req.method()==='PUT') {
    state.puts.push(req.postDataJSON());
    return route.fulfill({status:409,json:{error:'Synthetic conflict'}});
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
  else if(url.pathname==='/api/perspectives/export') {
    if(state.perspectiveExportStarted)state.perspectiveExportStarted.resolve();
    if(state.perspectiveExportGate)await state.perspectiveExportGate.promise;
    return route.fulfill({status:503,json:{error:'Synthetic export failure'}});
  }
  else if(url.pathname==='/api/collaboration-invitations')body={invitations:[]};
  return route.fulfill({json:body});
 });
 await page.goto(base,{waitUntil:'networkidle'});await page.locator('#event-card-A\\:qa-moment').waitFor();
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
  {const {page,state,context}=await fixture(browser);await page.locator('#event-card-A\\:qa-moment h3').click();await page.locator('#event-detail-card').getByTitle('Edit event',{exact:true}).click();await page.locator('#event-modal-backdrop input').first().waitFor();
   // Title is a required text input; avoid relying on decorative label association.
   const inputs=await page.locator('#event-modal-backdrop input').evaluateAll(xs=>xs.map(x=>({type:x.type,value:x.value,required:x.required})));
   const target=page.locator('#event-modal-backdrop input').nth(inputs.findIndex(x=>x.value===moment.title));await target.fill('Retained synthetic local draft');
   await page.locator('#save-event-button').click();await page.getByText(/Your draft is preserved here/).waitFor();assert.equal(await target.inputValue(),'Retained synthetic local draft');assert.equal(state.puts[0].expectedVersion,3);assert.equal(await page.locator('#event-modal-backdrop').count(),1);results.push('409 retains local form and loaded expectedVersion PASS');await context.close();}
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
  console.log(JSON.stringify({kind:'synthetic controlled-route browser QA, not real authenticated E2E',results},null,2));
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
