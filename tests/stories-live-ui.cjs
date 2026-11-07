// Real public DEV journey. Never starts/stops deployed services; disposable PostgreSQL fixtures only.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
(async()=>{
 require('dotenv').config({path:'.env.local',quiet:true});assert.equal(process.env.DB_SCHEMA,'memento_dev');
 const {pool,qschema,hashSession}=await import('../memento-db.mjs');
 const base='https://memento-dev.srv.io.vn',out=path.resolve('.hermes/evidence/stories-live-ui');fs.mkdirSync(out,{recursive:true});
 const report={passed:false,synthetic:false,scope:'Authenticated public DEV; disposable owner, track and 45 memories; no R2',checks:[],cleanup:false};
 const owner={id:crypto.randomUUID(),username:`qa_story_${crypto.randomBytes(6).toString('hex')}`,token:crypto.randomBytes(32).toString('hex')},track=`qa_story_${crypto.randomBytes(6).toString('hex')}`;
 const members=['editor','viewer'].map(role=>({role,id:crypto.randomUUID(),username:`qa_story_${crypto.randomBytes(6).toString('hex')}`,token:crypto.randomBytes(32).toString('hex')}));
 const gates=[];
 let browser,context;
 try{
  await pool.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,$3)`,[owner.id,owner.username,'unused-fixture']);
  await pool.query(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`,[hashSession(owner.token),owner.id]);
  const doc={id:track,title:'Disposable story track',description:'QA',color:'indigo',icon:'Heart',tags:[],createdAt:'2026-01-01',updatedAt:'2026-01-01'};
  await pool.query(`INSERT INTO ${qschema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`,[owner.id,track,doc]);
  for(let i=0;i<45;i++){const id=`${track}_m_${String(i).padStart(2,'0')}`,date=`2026-01-${String(1+Math.floor(i/2)).padStart(2,'0')}`;const m={id,eventId:track,resourceOwnerId:owner.id,title:`Story memory ${String(i).padStart(2,'0')}`,description:`Live source ${i}`,date,tags:[],images:[],createdAt:date,updatedAt:date,version:1};await pool.query(`INSERT INTO ${qschema}.moments(owner_id,id,event_id,document) VALUES($1,$2,$3,$4)`,[owner.id,id,track,m]);}
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell',args:['--no-sandbox']});
  context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});await context.addCookies([{name:'memento_session',value:owner.token,url:base,httpOnly:true,secure:true,sameSite:'Lax'}]);const page=await context.newPage();const queries=[];
  page.on('request',r=>{if(r.url().endsWith('/api/moments/query'))queries.push(r.postDataJSON());});
  await page.goto(base);const entry=await page.locator('script[type="module"][src^="/assets/index-"]').getAttribute('src');report.entry=entry;assert(fs.readFileSync('dist/index.html','utf8').includes(entry),'public DEV must serve rebuilt bundle; parent deploy required');assert.deepEqual(await (await context.request.get(base+entry)).body(),fs.readFileSync(path.join('dist',entry)));
  await page.getByTitle('More actions',{exact:true}).click();await page.getByRole('menuitem',{name:'Stories',exact:true}).click();const dialog=page.locator('[role="dialog"][aria-labelledby="story-library-heading"]');await dialog.waitFor();await dialog.getByRole('combobox',{name:'Story track'}).selectOption(`${owner.id}:${track}`);await dialog.getByRole('button',{name:'New story',exact:true}).click();
  await dialog.getByLabel('Story title',{exact:true}).fill('A living story');await dialog.getByLabel('Opening note',{exact:true}).fill('Opening words');await dialog.getByRole('button',{name:'Continue',exact:true}).click();
  await dialog.getByRole('button',{name:/Story memory 00/}).click();await dialog.getByRole('button',{name:'Next memories',exact:true}).click();await dialog.getByRole('button',{name:/Story memory 44/}).click();assert(queries.some(q=>q.trackKey===`${owner.id}:${track}`&&q.cursor&&q.limit===40&&q.sortDirection==='oldest'),'bounded explicit owner track picker reaches second page');
  await dialog.getByRole('button',{name:'Continue',exact:true}).click();await dialog.getByRole('button',{name:'Move memory 2 up',exact:true}).focus();await page.keyboard.press('Enter');await dialog.getByLabel('Bridge note for memory 1',{exact:true}).fill('Bridge retained');
  page.once('dialog',d=>d.dismiss());await page.keyboard.press('Escape');assert.equal(await dialog.locator('[data-story-composer]').count(),1,'cancel discard retains draft');
  for(const width of [360,390,768,1440]){await page.setViewportSize({width,height:900});await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const targets=await dialog.locator('button:visible').evaluateAll(xs=>xs.map(el=>{const r=el.getBoundingClientRect();return {w:r.width,h:r.height};}));assert(targets.every(r=>r.w>=44&&r.h>=44),`44px story targets at ${width}`);await page.screenshot({path:path.join(out,`composer-${width}.png`)});report.checks.push(`${width}px no overflow and 44px buttons`);}
  for(const viewport of [{width:360,height:480},{width:768,height:400},{width:1440,height:600}]){
   await page.setViewportSize(viewport);
   const geometry=await dialog.evaluate(el=>{const footer=el.querySelector('[data-story-composer-footer]'),body=el.querySelector('[data-story-composer-body]'),panel=el.querySelector('section');const f=footer.getBoundingClientRect(),b=body.getBoundingClientRect();body.scrollTop=0;return {width:panel.getBoundingClientRect().width,footerTop:f.top,footerBottom:f.bottom,bodyBottom:b.bottom,h:innerHeight};});
   assert(geometry.width<=960&&geometry.footerTop>=0&&geometry.footerBottom<=geometry.h&&geometry.bodyBottom<=geometry.footerTop);
   for(const target of await dialog.locator('[data-story-composer-footer] button').all()){
    assert(await target.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'footer center hit test');
   }
   await page.screenshot({path:path.join(out,`short-${viewport.width}-${viewport.height}.png`)});report.checks.push(`${viewport.width}x${viewport.height} independent footer, max960, center hit testing`);
  }
  await page.setViewportSize({width:1440,height:900});
  await dialog.getByRole('button',{name:'Save story',exact:true}).click();try{await dialog.getByRole('button',{name:/A living story/}).waitFor();}catch(error){report.saveError=await dialog.innerText();throw error;}await page.reload();await page.getByTitle('More actions',{exact:true}).click();await page.getByRole('menuitem',{name:'Stories',exact:true}).click();await dialog.getByRole('combobox',{name:'Story track'}).selectOption(`${owner.id}:${track}`);await dialog.getByRole('button',{name:/A living story/}).click();await dialog.locator('[data-story-reader]').waitFor();assert((await dialog.locator('[data-story-reader]').innerText()).includes('Bridge retained'));report.checks.push('persisted create, second picker page, keyboard reorder, bridge note and dirty-close cancellation');
  assert(await dialog.getByLabel('Story reader',{exact:true}).evaluate(el=>el===document.activeElement),'reader transition focus handoff');
  assert.equal(await dialog.getByRole('button',{name:'Edit story',exact:true}).count(),1);
  assert.equal(await dialog.getByRole('button',{name:'Delete story',exact:true}).count(),1);
  report.checks.push('owner edit/delete controls and reader focus handoff');
  await dialog.getByRole('button',{name:'Back to stories',exact:true}).click();
  let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);gates.push(release);
  await page.route('**/api/stories/*',async route=>{if(route.request().method()!=='GET')return route.continue();const response=await route.fetch();entered();await gate;await route.fulfill({response}).catch(()=>{});});
  await dialog.getByRole('button',{name:/A living story/}).click();await Promise.race([ready,new Promise((_,rej)=>setTimeout(()=>rej(new Error('buffer barrier timeout')),10000))]);
  await dialog.getByRole('combobox',{name:'Story track'}).selectOption('');release();await page.waitForTimeout(400);assert.equal(await dialog.locator('[data-story-reader]').count(),0,'buffered detail cannot cross track scope');await page.unroute('**/api/stories/*');
  report.checks.push('genuine upstream buffered response discarded on track switch (transport timing injection)');
  for(const member of members){
   await pool.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,'unused-fixture')`,[member.id,member.username]);
   await pool.query(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`,[hashSession(member.token),member.id]);
   await pool.query(`INSERT INTO ${qschema}.track_collaborators(id,owner_id,track_id,recipient_id,role,invited_at,accepted_at,expires_at) VALUES($1,$2,$3,$4,$5,now()-interval '10 days',now()-interval '9 days',now()-interval '2 days')`,[crypto.randomUUID(),owner.id,track,member.id,member.role]);
   const ctx=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
   try{
    await ctx.addCookies([{name:'memento_session',value:member.token,url:base,httpOnly:true,secure:true,sameSite:'Lax'}]);const p=await ctx.newPage();await p.goto(base);await p.getByTitle('More actions',{exact:true}).click();await p.getByRole('menuitem',{name:'Stories',exact:true}).click();const d=p.locator('[aria-labelledby="story-library-heading"]');await d.getByRole('combobox').selectOption(`${owner.id}:${track}`);await d.getByRole('button',{name:/A living story/}).waitFor();assert.equal(await d.getByRole('button',{name:'New story',exact:true}).count(),0);await d.getByRole('button',{name:/A living story/}).click();await d.locator('[data-story-reader]').waitFor();assert.equal(await d.getByRole('button',{name:/^(Edit story|Delete story)$/}).count(),0);assert(await d.getByLabel('Story reader',{exact:true}).evaluate(el=>el===document.activeElement));report.checks.push(`${member.role} live shared reader; no story mutation controls; focus`);
    if(member.role==='viewer'){
     await d.getByRole('button',{name:'Back to stories',exact:true}).click();let releaseMember,enterMember;const held=new Promise(r=>releaseMember=r),seen=new Promise(r=>enterMember=r);gates.push(releaseMember);
     await p.route('**/api/stories/*',async route=>{if(route.request().method()!=='GET')return route.continue();const response=await route.fetch();enterMember();await held;await route.fulfill({response}).catch(()=>{});});await d.getByRole('button',{name:/A living story/}).click();await Promise.race([seen,new Promise((_,rej)=>setTimeout(()=>rej(new Error('member buffer timeout')),10000))]);
     await pool.query(`UPDATE ${qschema}.track_collaborators SET revoked_at=now() WHERE owner_id=$1 AND recipient_id=$2`,[owner.id,member.id]);
     await d.getByRole('button',{name:'Close stories',exact:true}).click();await p.locator('[data-account-menu] > button').click();await p.getByRole('menuitem',{name:'Sign out',exact:true}).click();await ctx.clearCookies();await ctx.addCookies([{name:'memento_session',value:members[0].token,url:base,httpOnly:true,secure:true,sameSite:'Lax'}]);await p.reload();releaseMember();await p.waitForTimeout(400);assert.equal(await p.locator('[data-story-reader]').count(),0);const revokedToken=crypto.randomBytes(32).toString('hex');await pool.query(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`,[hashSession(revokedToken),member.id]);assert.equal((await ctx.request.get(base+`/api/stories/${(await pool.query(`SELECT id FROM ${qschema}.stories WHERE owner_id=$1`,[owner.id])).rows[0].id}`,{headers:{Cookie:`memento_session=${revokedToken}`}})).status(),404);report.checks.push('revoked viewer real buffered bytes cannot cross sign-out/account switch; fresh revoked GET404');
    }
   }finally{await ctx.close();}
  }
  await dialog.getByRole('combobox',{name:'Story track'}).selectOption(`${owner.id}:${track}`);await dialog.getByRole('button',{name:/A living story/}).click();await dialog.locator('[data-story-reader]').waitFor();
  const reader=dialog.locator('[data-story-reader]');assert((await reader.innerText()).indexOf('Story memory 44')<(await reader.innerText()).indexOf('Story memory 00'));
  await pool.query(`DELETE FROM ${qschema}.moments WHERE owner_id=$1 AND id=$2`,[owner.id,`${track}_m_44`]);await dialog.getByRole('button',{name:'Back to stories',exact:true}).click();await dialog.getByRole('button',{name:/A living story/}).click();await dialog.getByText('Memory no longer available',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Edit / repair story',exact:true}).click();await dialog.getByRole('button',{name:'3. Arrange & preview',exact:true}).click();await dialog.getByRole('button',{name:'Remove memory 1',exact:true}).click();await dialog.getByRole('button',{name:'Save story',exact:true}).click();await dialog.getByRole('button',{name:/A living story/}).click();page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Delete story',exact:true}).click();await dialog.getByText(/No stories in this track yet/).waitFor();report.checks.push('live source deletion placeholder, owner repair, update, delete preserves source');
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${qschema}.moments WHERE owner_id=$1`,[owner.id])).rows[0].count),44);report.passed=true;
 }catch(error){report.error=error.stack;process.exitCode=1;}
 finally{for(const release of gates)release();for(const resource of [context,browser])try{await resource?.close();}catch(error){report.cleanupError=String(error);report.passed=false;process.exitCode=1;}try{await pool.query(`DELETE FROM ${qschema}.users WHERE id=ANY($1::uuid[])`,[[owner.id,...members.map(m=>m.id)]]);report.cleanup=Number((await pool.query(`SELECT count(*) FROM ${qschema}.users WHERE id=ANY($1::uuid[])`,[[owner.id,...members.map(m=>m.id)]])).rows[0].count)===0;}catch(error){report.cleanupError=String(error);report.passed=false;process.exitCode=1;}await pool.end();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})();
