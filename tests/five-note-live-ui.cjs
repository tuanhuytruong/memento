// Authenticated deployed DEV browser QA. Real endpoints through nginx3091 -> PM2 API3092; disposable metadata, no R2.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
(async()=>{
require('dotenv').config({path:'.env.local',quiet:true});
/* Target deployed nginx -> PM2; do not start API. */const {pool,qschema,hashSession}=await import('../memento-db.mjs');
assert.equal(process.env.DB_SCHEMA,'memento_dev');
const out=path.resolve('.hermes/evidence/search-optimization');fs.mkdirSync(out,{recursive:true});
const report={synthetic:false,scope:'Authenticated Chromium through disposable forwarding proxy -> deployed nginx3091 -> PM2 API3092; real temporary DEV PostgreSQL users/sessions/metadata; no fabricated product responses or R2.',checks:[],requests:[],pageerrors:[],cleanup:false};
report.checks.push=(...items)=>{for(const item of items)console.log('CHECK',item);return Array.prototype.push.apply(report.checks,items);};
const activeGates=[];
const users=['owner','editor','viewer'].map(role=>({role,id:crypto.randomUUID(),username:`qa_${role}_${crypto.randomBytes(6).toString('hex')}`,token:crypto.randomBytes(32).toString('hex')}));
const password=crypto.randomBytes(18).toString('hex');
const passwordHash=await require('bcryptjs').hash(password,12);
let barrier=null;
const owner=users[0],track='live-qa-track',N=281;let api,web,browser;let contexts=[];
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
const close=s=>s?new Promise(r=>s.close(r)):Promise.resolve();
try{
for(const u of users){await pool.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,$3)`,[u.id,u.username,passwordHash]);await pool.query(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`,[hashSession(u.token),u.id]);}
const td={id:track,title:'Live QA track',description:'Temporary authenticated browser metadata',color:'indigo',icon:'Heart',tags:[],createdAt:'2026-10-15',updatedAt:'2026-10-15'};
await pool.query(`INSERT INTO ${qschema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`,[owner.id,track,td]);
for(let i=0;i<N;i++){const id=`live-${String(i).padStart(4,'0')}`;const d={id,eventId:track,title:`Live memory ${String(i).padStart(4,'0')}`,description:'Exact authenticated detail payload',date:'2026-10-15',tags:['qa-live'],images:[],isMilestone:i%10===0,createdAt:'2026-10-15',updatedAt:'2026-10-15'};await pool.query(`INSERT INTO ${qschema}.moments(owner_id,id,event_id,document) VALUES($1,$2,$3,$4)`,[owner.id,id,track,d]);}
for(const u of users.slice(1))await pool.query(`INSERT INTO ${qschema}.track_collaborators(id,owner_id,track_id,recipient_id,role,expires_at,accepted_at) VALUES($1,$2,$3,$4,$5,now()+interval '7 days',now())`,[crypto.randomUUID(),owner.id,track,u.id,u.role]);
api={address:()=>({port:3091})};
web=http.createServer(async(req,res)=>{if(req.url.startsWith('/api/')||req.url==='/health'){let gate=null;if(req.url==='/api/moments/query'&&barrier){gate=barrier;barrier=null;gate.enter();if(gate.before)await gate.wait;}const upstream=http.request({hostname:'127.0.0.1',port:api.address().port,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1',origin:'https://127.0.0.1'}},async r=>{if(gate&&!gate.before){const chunks=[];for await(const chunk of r)chunks.push(chunk);gate.enter();await gate.wait;if(!res.destroyed){res.writeHead(r.statusCode,r.headers);res.end(Buffer.concat(chunks));}}else{res.writeHead(r.statusCode,r.headers);r.pipe(res);}});upstream.on('error',()=>{res.statusCode=502;res.end();});req.pipe(upstream);return;}const upstream=http.request({hostname:'127.0.0.1',port:3091,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1'}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>{res.statusCode=502;res.end();});req.pipe(upstream);});await listen(web);const base=`http://127.0.0.1:${web.address().port}`;
const hold=(before=false)=>{let enter,release;const entered=Promise.race([new Promise(r=>enter=r),new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('Barrier entry timeout')),15000);t.unref();})]),wait=new Promise(r=>release=r);const gate={before,enter,wait,entered,release};activeGates.push(gate);barrier=gate;return gate;};
report.entry=fs.readFileSync('dist/index.html','utf8').match(/src="([^\"]+\.js)"/)[1];report.ports={api:api.address().port,web:web.address().port};
browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell',args:['--no-sandbox']});
for(const u of users){const c=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true,reducedMotion:'reduce'});contexts.push(c);await c.addCookies([{name:'memento_session',value:u.token,url:base,httpOnly:true,sameSite:'Lax'}]);const p=await c.newPage();u.page=p;p.on('pageerror',e=>report.pageerrors.push({role:u.role,message:e.message}));p.on('response',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))report.requests.push({role:u.role,method:r.request().method(),path:new URL(r.url()).pathname,status:r.status()});});await p.goto(base);await p.waitForFunction(()=>document.querySelectorAll('[id^="event-card-"]').length===40);assert.equal(await p.locator('[id^="event-card-"]').count(),40);report.checks.push(`${u.role}: authenticated startup 40 cards`);}
const p=owner.page;
const waitCount=async(page,n)=>{await page.waitForFunction(n=>document.querySelectorAll('[id^="event-card-"]').length===n,n);};
const actions=async page=>{await page.locator('#floating-memory-actions').click();};
const discover=async page=>{await actions(page);await page.getByRole('button',{name:'Open a random memory',exact:true}).click();await page.getByRole('button',{name:'Customize',exact:true}).waitFor();};
for(const u of users){
 const page=u.page; await actions(page);
 assert.equal(await page.locator('#memory-actions').getByRole('button',{name:'New entry',exact:true}).count(),u.role==='viewer'?0:1);
 if(u.role!=='viewer'){
   await page.locator('#memory-actions').getByRole('button',{name:'New entry',exact:true}).click();
   await page.getByRole('dialog',{name:'New memory',exact:true}).waitFor();
   await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
 } else await page.keyboard.press('Escape');
 await discover(page);assert.match(await page.getByRole('dialog',{name:'Blindbox memory',exact:true}).innerText(),/Live memory/);
 await page.getByRole('button',{name:'Customize',exact:true}).click();
 await page.getByRole('textbox',{name:'What are you looking for?'}).fill('Live memory');
 await page.getByRole('button',{name:'Cancel customization',exact:true}).click();
 await page.getByRole('button',{name:'Customize',exact:true}).waitFor();
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
 report.checks.push(`${u.role}: actual floating permissions, composer where allowed, automatic authorized reveal and cancel customization`);
}
for(const size of [{width:320,height:900},{width:390,height:844},{width:667,height:375},{width:1280,height:900}]){
 await p.setViewportSize(size);
 await p.evaluate(()=>scrollTo(0,document.body.scrollHeight));
 await p.evaluate(async()=>{await document.fonts.ready; let last=-1, stable=0; while(stable<5){await new Promise(requestAnimationFrame); const height=document.body.scrollHeight; stable=height===last?stable+1:0; last=height;}}); const y=await p.evaluate(()=>scrollY);
 await p.locator('#floating-memory-actions').focus();await p.keyboard.press('Enter');
 assert.equal(await p.evaluate(()=>document.activeElement?.textContent),'New entry');
 await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Open a random memory');
 await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>document.activeElement?.id),'floating-memory-actions');
 await actions(p);await p.locator('#memory-actions').getByRole('button',{name:'New entry',exact:true}).click();
 await p.getByRole('dialog',{name:'New memory',exact:true}).waitFor();await p.keyboard.press('Escape');await p.getByRole('dialog').waitFor({state:'detached'});
 await p.waitForFunction(y=>Math.abs(scrollY-y)<3,y);
 let count=report.requests.filter(r=>r.role==='owner'&&r.path==='/api/moments/query').length;
 await p.locator('#date-range-trigger').click();await p.locator('#filter-date-from').fill('2026-10-15');await p.locator('#filter-date-to').fill('2026-10-15');
 await p.waitForTimeout(350);assert.equal(report.requests.filter(r=>r.role==='owner'&&r.path==='/api/moments/query').length,count);
 await p.getByRole('button',{name:'Cancel',exact:true}).click();
 await p.locator('#date-range-trigger').click();assert.equal(await p.locator('#filter-date-from').inputValue(),'');
 await p.locator('#filter-date-from').fill('2026-10-15');await p.locator('#filter-date-to').fill('2026-10-15');
 let response=p.waitForResponse(r=>r.url().endsWith('/api/moments/query')&&r.request().postDataJSON().dateFrom==='2026-10-15');
 await p.getByRole('button',{name:'Apply',exact:true}).click();await response;await waitCount(p,40);assert.equal(report.requests.filter(r=>r.role==='owner'&&r.path==='/api/moments/query').length,count+1);
 await p.locator('#date-range-trigger').click();await p.getByRole('button',{name:'Apply',exact:true}).click();await p.waitForTimeout(350);assert.equal(report.requests.filter(r=>r.role==='owner'&&r.path==='/api/moments/query').length,count+1);
 await p.locator('#date-range-trigger').click();await p.locator('#filter-date-from').fill('2026-10-16');await p.locator('#filter-date-to').fill('');
 response=p.waitForResponse(r=>r.url().endsWith('/api/moments/query')&&r.request().postDataJSON().dateFrom==='2026-10-16');await p.getByRole('button',{name:'Apply',exact:true}).click();await response;await waitCount(p,0);
 await p.locator('#date-range-trigger').click();response=p.waitForResponse(r=>r.url().endsWith('/api/moments/query'));await p.getByRole('button',{name:'Clear date filter',exact:true}).click();await response;await waitCount(p,40);
 assert.match(await p.locator('[data-summary]').innerText(),/281 memories/);
 await p.locator('#filter-toolbar').scrollIntoViewIfNeeded();
 for(const selector of ['#timeline-search-input','#date-range-trigger','#toggle-advanced-filters','#floating-memory-actions','#feed-load-more']){
   const control=p.locator(selector);await control.scrollIntoViewIfNeeded();
   assert(await control.evaluate(el=>{const r=el.getBoundingClientRect();return [.2,.5,.8].every(x=>[.2,.5,.8].every(y=>{const hit=document.elementFromPoint(r.x+r.width*x,r.y+r.height*y);return hit===el||el.contains(hit);}));}),selector+' obstructed');
 }
 await p.screenshot({path:path.join(out,`live-five-${size.width}.png`),fullPage:true});
 report.checks.push(`${size.width}x${size.height}: actual keyboard floating menu/focus, scroll-preserving composer, no draft requests, one atomic Apply, noop Apply, inclusive/open range result and clear, global summary and nine-point control checks`);
}
assert.deepEqual(report.pageerrors,[]);report.passed=true;
}catch(e){report.passed=false;report.error=e.stack;process.exitCode=1;}finally{for(const gate of activeGates)gate.release();for(const c of contexts)await c.close().catch(()=>{});if(browser)await browser.close();await close(web);await pool.query(`DELETE FROM ${qschema}.users WHERE id=ANY($1::uuid[])`,[users.map(u=>u.id)]);const left=await pool.query(`SELECT count(*)::int n FROM ${qschema}.users WHERE id=ANY($1::uuid[])`,[users.map(u=>u.id)]);report.cleanup=left.rows[0].n===0;report.ownedServersStopped=(!web||!web.listening);await pool.end();fs.writeFileSync(path.join(out,'five-note-live-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
