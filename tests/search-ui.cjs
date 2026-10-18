// Authenticated live DEV browser QA. Real product endpoints only; metadata fixtures, no R2.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
(async()=>{
require('dotenv').config({path:'.env.local',quiet:true});
const {app}=await import('../server.mjs');const {pool,qschema,hashSession}=await import('../memento-db.mjs');
assert.equal(process.env.DB_SCHEMA,'memento_dev');
const out=path.resolve('.hermes/evidence/search-optimization');fs.mkdirSync(out,{recursive:true});
const report={synthetic:false,scope:'Authenticated Chromium against disposable latest-source Express API and latest dist; temporary real PostgreSQL metadata/users/sessions. No intercepted or synthetic product responses; no R2.',checks:[],requests:[],pageerrors:[],cleanup:false};
const users=['owner','editor','viewer'].map(role=>({role,id:crypto.randomUUID(),username:`qa_${role}_${crypto.randomBytes(6).toString('hex')}`,token:crypto.randomBytes(32).toString('hex')}));
const owner=users[0],track='live-qa-track',N=281;let api,web,browser;let contexts=[];
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
const close=s=>s?new Promise(r=>s.close(r)):Promise.resolve();
try{
for(const u of users){await pool.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,$3)`,[u.id,u.username,'unused-qa-fixture']);await pool.query(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`,[hashSession(u.token),u.id]);}
const td={id:track,title:'Live QA track',description:'Temporary authenticated browser metadata',color:'indigo',icon:'Heart',tags:[],createdAt:'2026-10-15',updatedAt:'2026-10-15'};
await pool.query(`INSERT INTO ${qschema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`,[owner.id,track,td]);
for(let i=0;i<N;i++){const id=`live-${String(i).padStart(4,'0')}`;const d={id,eventId:track,title:`Live memory ${String(i).padStart(4,'0')}`,description:'Exact authenticated detail payload',date:'2026-10-15',tags:['qa-live'],images:[],isMilestone:i%10===0,createdAt:'2026-10-15',updatedAt:'2026-10-15'};await pool.query(`INSERT INTO ${qschema}.moments(owner_id,id,event_id,document) VALUES($1,$2,$3,$4)`,[owner.id,id,track,d]);}
for(const u of users.slice(1))await pool.query(`INSERT INTO ${qschema}.track_collaborators(id,owner_id,track_id,recipient_id,role,expires_at,accepted_at) VALUES($1,$2,$3,$4,$5,now()+interval '7 days',now())`,[crypto.randomUUID(),owner.id,track,u.id,u.role]);
api=http.createServer(app);await listen(api);
web=http.createServer((req,res)=>{if(req.url.startsWith('/api/')||req.url==='/health'){const upstream=http.request({hostname:'127.0.0.1',port:api.address().port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>{res.statusCode=502;res.end();});req.pipe(upstream);return;}let f=path.join(process.cwd(),'dist',decodeURIComponent(req.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(process.cwd(),'dist/index.html');const ext=path.extname(f);res.setHeader('Content-Type',ext==='.js'?'text/javascript':ext==='.css'?'text/css':'text/html');res.end(fs.readFileSync(f));});await listen(web);const base=`http://127.0.0.1:${web.address().port}`;
report.entry=fs.readFileSync('dist/index.html','utf8').match(/src="([^\"]+\.js)"/)[1];report.ports={api:api.address().port,web:web.address().port};
browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell',args:['--no-sandbox']});
for(const u of users){const c=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true,reducedMotion:'reduce'});contexts.push(c);await c.addCookies([{name:'memento_session',value:u.token,url:base,httpOnly:true,sameSite:'Lax'}]);const p=await c.newPage();u.page=p;p.on('pageerror',e=>report.pageerrors.push({role:u.role,message:e.message}));p.on('response',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))report.requests.push({role:u.role,method:r.request().method(),path:new URL(r.url()).pathname,status:r.status()});});await p.goto(base);await p.waitForFunction(()=>document.querySelectorAll('[id^="event-card-"]').length===40);assert.equal(await p.locator('[id^="event-card-"]').count(),40);report.checks.push(`${u.role}: authenticated startup 40 cards`);}
const p=owner.page;
const search=p.locator('#timeline-search-input');
const queryRequests=[];
p.on('request',r=>{if(new URL(r.url()).pathname==='/api/moments/query')queryRequests.push(JSON.parse(r.postData()));});
const waitCount=async(page,n)=>{await page.waitForFunction(n=>document.querySelectorAll('[id^="event-card-"]').length===n,n);await page.locator('[aria-busy="false"]').first().waitFor();};
for(const width of [320,390,1280]){
 await p.setViewportSize({width,height:900});
 await search.fill('Live memory 0001');
 await p.waitForTimeout(50);
 assert.match(await p.locator('#filter-toolbar').innerText(),/Updating memories/);
 assert.equal(await p.locator('#feed-load-more:not([disabled])').count(),0);
 await waitCount(p,1);
 assert.match(await p.locator('#filter-toolbar').innerText(),/Showing 1 of/);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await p.screenshot({path:path.join(out,`search-${width}.png`),fullPage:true});
 await p.getByRole('button',{name:'Clear search',exact:true}).click();await waitCount(p,40);
 report.checks.push(`width ${width}: real text search/count/clear, pending no stale load-more, no overflow`);
}
let before=queryRequests.length;
await search.pressSequentially('Live memory 0002',{delay:15});
await waitCount(p,1);assert.equal(queryRequests.length-before,1);report.checks.push('fast typing collapses to one request');
await search.fill('Live memory 0003');await search.press('Enter');await waitCount(p,1);report.checks.push('Enter flush');
await search.dispatchEvent('compositionstart');await search.fill('Live memory 0004');before=queryRequests.length;await p.waitForTimeout(400);assert.equal(queryRequests.length,before);await search.dispatchEvent('compositionend');await waitCount(p,1);report.checks.push('IME does not dispatch partial composition');
await p.getByRole('button',{name:'Clear search',exact:true}).click();await waitCount(p,40);
await p.locator('#feed-load-more').click();await waitCount(p,80);assert.equal(queryRequests.at(-1).includeTotal,false);assert.equal(queryRequests.at(-2).includeTotal,true);assert.match(await p.locator('#filter-toolbar').innerText(),/Showing 281 of/);report.checks.push('total initial true, load-more false; total retained');
for(const u of users.slice(1)){await u.page.locator('#timeline-search-input').fill('Live memory 0001');await waitCount(u.page,1);assert.match(await u.page.locator('#filter-toolbar').innerText(),/Showing 1 of/);report.checks.push(`${u.role}: genuine accepted shared search`);}
// Exact identity collision on viewer-owned track never hides shared owner's row.
await pool.query(`INSERT INTO ${qschema}.tracks(owner_id,id,document) VALUES($1,'collision',$2)`,[users[2].id,{...td,id:'collision'}]);
await pool.query(`INSERT INTO ${qschema}.moments(owner_id,id,event_id,document) VALUES($1,'live-0001','collision',$2)`,[users[2].id,{id:'live-0001',eventId:'collision',title:'Live memory 0001',date:'2026-10-15',tags:[]}]);
const viewer=users[2].page;
await viewer.reload();await waitCount(viewer,40);await viewer.locator('#timeline-search-input').fill('Live memory 0001');await waitCount(viewer,2);report.checks.push('same-ID owner collision yields both composite identities');
// Real API text mutation triggers corpus maintenance before next search.
await pool.query(`UPDATE ${qschema}.moments SET document=jsonb_set(document,'{title}','"Changed search marker"'),version=version+1 WHERE owner_id=$1 AND id='live-0001'`,[owner.id]);
await p.locator('#timeline-search-input').fill('Changed search marker');await waitCount(p,1);report.checks.push('transactional text update immediately searchable');
const revoked=await p.evaluate(async ({uid})=>{const r=await fetch('/api/tracks/live-qa-track/collaborators/'+uid,{method:'DELETE'});return r.status;},{uid:users[2].id});assert.equal(revoked,200);
await viewer.locator('#timeline-search-input').fill('Changed search marker');await waitCount(viewer,0);assert.match(await viewer.locator('#filter-toolbar').innerText(),/Showing 0 of/);report.checks.push('revoke: subsequent viewer search and total exclude shared content');
// Authenticated HTTP warm measurements, isolated latest-source API; no query contents logged.
report.http=[];
for(const includeTotal of [false,true]){
 const times=[];let first;
 for(let i=0;i<21;i++){const start=performance.now();const r=await fetch(base+'/api/moments/query',{method:'POST',headers:{Cookie:'memento_session='+owner.token,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({search:'Live memory',includeTotal})});assert.equal(r.status,200);const data=await r.json();assert.equal(data.moments.length,40);const ms=performance.now()-start;if(!i)first=ms;else times.push(ms);}
 const sorted=[...times].sort((a,b)=>a-b);report.http.push({includeTotal,samples:20,firstMs:first,p50Ms:sorted[9],p95Ms:sorted[18]});
}
// Five cold-context + five warm-context timings. Debounce 275ms included and separately recorded.
report.browserTimings=[];
for(const cold of [true,false])for(let i=0;i<5;i++){
 let context,page;
 if(cold){context=await browser.newContext({viewport:{width:1280,height:900}});contexts.push(context);await context.addCookies([{name:'memento_session',value:owner.token,url:base,httpOnly:true,sameSite:'Lax'}]);page=await context.newPage();await page.goto(base);await waitCount(page,40);}else{page=p;await search.fill('');await waitCount(p,40);}
 const start=performance.now();await page.locator('#timeline-search-input').fill('Live memory 0002');await waitCount(page,1);report.browserTimings.push({coldContext:cold,typingToResultsMs:performance.now()-start,debounceMs:275});
 if(context)await context.close();
}
assert.deepEqual(report.pageerrors,[]);report.passed=true;
}catch(e){report.passed=false;report.error=e.stack;process.exitCode=1;}finally{for(const c of contexts)await c.close().catch(()=>{});if(browser)await browser.close();await close(web);await close(api);await pool.query(`DELETE FROM ${qschema}.users WHERE id=ANY($1::uuid[])`,[users.map(u=>u.id)]);const left=await pool.query(`SELECT count(*)::int n FROM ${qschema}.users WHERE id=ANY($1::uuid[])`,[users.map(u=>u.id)]);report.cleanup=left.rows[0].n===0;report.ownedServersStopped=(!web||!web.listening)&&(!api||!api.listening);await pool.end();fs.writeFileSync(path.join(out,'search-ui-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
