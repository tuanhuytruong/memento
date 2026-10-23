// Real Chromium geometry/click regression with synthetic intercepted API fixtures.
// Not authenticated live-account E2E. No real account data is mutated.
// NODE_PATH=.hermes/browser-deps/node_modules node tests/action-icon-centering.cjs
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const out=process.env.MEMENTO_UI_ARTIFACTS||'.hermes/evidence/icon-centering';
fs.mkdirSync(out,{recursive:true});
const moment={id:'qa-moment',resourceOwnerId:'A',eventId:'qa-track',version:1,title:'Icon alignment fixture',date:'2026-10-15',emotion:'inspired',emotionIntensity:4,description:'Synthetic layout fixture',images:['/api/images/qa-photo'],tags:[],reactions:[]};
const report={synthetic:true,geometry:[],checks:[]};
(async()=>{
 const server=http.createServer((req,res)=>{let file=path.join(process.cwd(),'dist',decodeURIComponent(req.url.split('?')[0]));if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file='dist/index.html';res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell',args:['--no-sandbox']});
 try{
 for(const width of [320,390,1280])for(const role of ['owner','editor','viewer']){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let deletes=0;
  const track={id:'qa-track',resourceOwnerId:'A',title:'QA timeline',description:'',color:'indigo',icon:'Heart',tags:[],accessRole:role};
  await page.route('**/api/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname;let body={};
   if(p.startsWith('/api/images/')) return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="orange"/></svg>'});
   if(req.method()==='DELETE'){deletes++;return route.fulfill({status:500,json:{error:'Deletion must be cancelled'}});}
   if(p==='/api/auth/me')body={user:{id:role==='owner'?'A':'B',username:'synthetic'}};
   else if(p==='/api/tracks')body={tracks:[track]};
   else if(p==='/api/moments/query')body={moments:[moment],nextCursor:null,total:1};
   else if(p==='/api/moments/resurfacing')body={moments:[]};
   else if(p==='/api/moments/overview')body={overview:{total:1,milestones:0,places:0,photos:0,earliest:moment.date,latest:moment.date,tracks:[],tags:[],years:['2026']}};
   else if(p.endsWith('/perspectives'))body={perspectives:[],nextCursor:null,capabilities:{canRead:true,canCreate:false,canModerate:false}};
   else if(p==='/api/tags')body={tags:[]};
   else if(p==='/api/saved')body={saved:[],count:0};
   else if(p==='/api/track-visits')body={visits:[]};
   else if(p==='/api/collaboration-invitations')body={invitations:[]};
   else if(p==='/api/moments/qa-moment')body={moment};
   await route.fulfill({json:body});
  });
  await page.goto(process.env.MEMENTO_UI_URL||`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
  await page.locator('#view-timeline-btn').click();
  const card=page.locator('[id="event-card-A:qa-moment"]');await card.waitFor();await page.evaluate(()=>document.fonts.ready);
  for(const surface of ['card','detail']){
   if(surface==='detail'){await card.locator('h3').click();await page.getByRole('dialog',{name:'Memory details',exact:true}).waitFor();}
   const scope=surface==='card'?card:page.getByRole('dialog',{name:'Memory details',exact:true});
   for(const action of (surface==='detail'?['Edit event','Delete event','Enlarge photo','Close memory details']:['Edit event','Delete event'])){
    const button=action==='Close memory details'?scope.getByRole('button',{name:action,exact:true}):scope.getByTitle(action,{exact:true});
    const editable=['Edit event','Delete event'].includes(action);
    assert.equal(await button.count(),role==='viewer'&&editable?0:1);
    if(role==='viewer'&&editable)continue;
    await button.scrollIntoViewIfNeeded();
    const g=await button.evaluate(el=>{const b=el.getBoundingClientRect(),s=el.querySelector('svg').getBoundingClientRect();return {button:{x:b.x,y:b.y,width:b.width,height:b.height},svg:{x:s.x,y:s.y,width:s.width,height:s.height},dx:s.x+s.width/2-b.x-b.width/2,dy:s.y+s.height/2-b.y-b.height/2,hit:el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))};});
    report.geometry.push({width,role,surface,action,...g});if(!process.env.MEMENTO_GEOMETRY_BASELINE)assert(Math.abs(g.dx)<=1&&Math.abs(g.dy)<=1,JSON.stringify(report.geometry.at(-1)));assert(g.button.width>=44&&g.button.height>=44);assert(g.hit);
   }
   if(surface==='detail'){
    await scope.getByTitle('Enlarge photo',{exact:true}).click();
    await page.getByRole('dialog',{name:'Photo preview',exact:true}).waitFor();
    await page.getByRole('button',{name:'Close photo preview',exact:true}).click();
    await page.getByRole('dialog',{name:'Photo preview',exact:true}).waitFor({state:'detached'});
    await scope.getByRole('button',{name:'Close memory details',exact:true}).click();
    await scope.waitFor({state:'detached'});
    await card.locator('h3').click();await scope.waitFor();
   }
   await page.screenshot({path:path.join(out,`${width}-${role}-${surface}.png`)});
   if(role!=='viewer'){
    let confirmed=false;page.once('dialog',async dialog=>{confirmed=true;await dialog.dismiss();});await scope.getByTitle('Delete event',{exact:true}).click();assert(confirmed);assert.equal(deletes,0);
    await scope.getByTitle('Edit event',{exact:true}).click();
    await page.locator('#event-modal-backdrop').waitFor();
    await page.keyboard.press('Escape');await page.locator('#event-modal-backdrop').waitFor({state:'detached'});
    if(surface==='card'){await card.waitFor();} // detail edit closes detail by design
   }else if(surface==='detail'){await scope.getByRole('button',{name:'Close memory details'}).click();}
   report.checks.push(`${width}/${role}/${surface}: permissions, centering, hit and edit/delete-cancel`);
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 report.passed=true;
 }catch(e){report.passed=false;report.error=e.stack;process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
