// Authenticated DEV PostgreSQL browser journey for reaction/reflection UX. No synthetic API responses or R2.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
(async () => {
  require('dotenv').config({ path: '.env.local', quiet: true });
  assert.equal(process.env.DB_SCHEMA, 'memento_dev');
  const { pool, qschema, hashSession } = await import('../memento-db.mjs');
const base = 'https://memento-dev.srv.io.vn';
  const out = path.resolve('.hermes/evidence/quiet-journal-phase1/final'); fs.mkdirSync(out, { recursive: true });
  const report = { synthetic: false, scope: 'Authenticated Chromium through deployed public DEV nginx/PM2 against DEV PostgreSQL; disposable user/track/moment/perspective/reaction; no R2.', checks: [], requests: [], pageerrors: [], cleanup: false };
  const owner = { id: crypto.randomUUID(), username: `qa_reaction_${crypto.randomBytes(6).toString('hex')}`, token: crypto.randomBytes(32).toString('hex') };
  const track = `qa_track_${crypto.randomBytes(6).toString('hex')}`;
  const moment = `qa_moment_${crypto.randomBytes(6).toString('hex')}`;
  const recentReactors = Array.from({ length: 7 }, (_, index) => ({ id: crypto.randomUUID(), username: `Newest${7 - index}` }));
  const extraUsers=[];
  let browser, context, imageId;
  const uploadedIds=[];
  report.screenshots=[];
  report.scope='Authenticated public DEV PostgreSQL plus real authenticated R2 upload/deletion; generated landscape illustration as disposable photo fixture, not a real user photograph.';
  const contexts = [];
  try {
    await pool.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,$3)`, [owner.id, owner.username, 'unused-qa-fixture']);
    await pool.query(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`, [hashSession(owner.token), owner.id]);
    const trackDoc = { id: track, title: 'Everyday notes', description: 'Temporary fixture', color: 'indigo', icon: 'Heart', tags: [], createdAt: '2026-10-15', updatedAt: '2026-10-15' };
    await pool.query(`INSERT INTO ${qschema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`, [owner.id, track, trackDoc]);
    const momentDoc = { id: moment, resourceOwnerId: owner.id, eventId: track, title: 'A quiet afternoon by the river', date: '2026-10-15', time: null, description: 'A walk, a warm cup of coffee, and time to notice the small things. Disposable visual QA fixture.', idea: null, location: null, tags: [], images: [], emotion: 'joy', emotionIntensity: 2, isMilestone: false, version: 1, createdAt: '2026-10-15', updatedAt: '2026-10-15' };
    await pool.query(`INSERT INTO ${qschema}.moments(owner_id,id,event_id,document) VALUES($1,$2,$3,$4)`, [owner.id, moment, track, momentDoc]);
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell', args: ['--no-sandbox'] });
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }); contexts.push(context);
    await context.addCookies([{ name: 'memento_session', value: owner.token, url: base, httpOnly: true, sameSite: 'Lax', secure: true }]);
    const page = await context.newPage(); page.on('pageerror', error => report.pageerrors.push(error.message));
    page.on('response', response => { const url = new URL(response.url()); if (url.pathname.startsWith('/api/')) report.requests.push({ method: response.request().method(), path: url.pathname, status: response.status() }); });
    const sharp=require('sharp');
    const illustration=Buffer.from(`<svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="800" fill="#a8c8cc"/><circle cx="920" cy="170" r="85" fill="#f3cb78"/><path d="M0 440L300 210L630 500L970 280L1200 460V800H0" fill="#517c64"/><path d="M500 480Q1100 500 750 800H200Q800 580 500 480" fill="#669ead"/><path d="M0 650Q200 530 420 580L200 800H0" fill="#bc965d"/><text x="60" y="735" font-size="28" fill="white">Disposable Quiet Journal photo fixture</text></svg>`);
    const photo=await sharp(illustration).jpeg({quality:90}).toBuffer();
    const upload=await context.request.post(base+'/api/images',{headers:{Origin:base,'Idempotency-Key':crypto.randomUUID()},multipart:{momentId:moment,ownerId:owner.id,file:{name:'quiet-landscape.jpg',mimeType:'image/jpeg',buffer:photo}}});
    assert.equal(upload.status(),201,await upload.text());imageId=(await upload.json()).image.id;uploadedIds.push(imageId);
    report.photo={imageId,uploadStatus:201,sourceWidth:1200,sourceHeight:800,bytes:photo.length};
    // Enough genuine metadata cards to exercise document scroll and final-card clearance.
    for(let i=1;i<=5;i++) {const id=moment+'_'+i;const doc={...momentDoc,id,title:`Small ordinary moment ${i}`,date:`2026-10-${String(15-i).padStart(2,'0')}`,description:'Disposable text-only memory. '+('A quiet note about everyday life. '.repeat(4))};await pool.query(`INSERT INTO ${qschema}.moments(owner_id,id,event_id,document) VALUES($1,$2,$3,$4)`,[owner.id,id,track,doc]);}
    await page.goto(base);
    report.entry = await page.locator('script[type="module"][src^="/assets/index-"]').getAttribute('src');
    const localIndex = fs.readFileSync('dist/index.html','utf8');
    assert(localIndex.includes(report.entry), 'public entry matches rebuilt DEV bundle');
    const asset = await context.request.get(base + report.entry);
    assert.equal(asset.status(),200);
    assert.deepEqual(await asset.body(),fs.readFileSync(path.join('dist',report.entry)),'public entry bytes match DEV build');
    const card = page.locator(`[id="event-card-${owner.id}:${moment}"]`); await card.waitFor();

    await card.locator('img').first().waitFor();
    await page.waitForFunction(()=>{const im=document.querySelector('[id^="event-card-"] img');return im?.complete&&im.naturalWidth>0;});
    const shot=async name=>{const file=path.join(out,name+'.png');await page.screenshot({path:file});report.screenshots.push(file);};
    const visibility=async()=>page.evaluate(()=>{const inView=e=>{if(!e||!e.getClientRects().length)return false;const r=e.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;};return {primary:inView(document.querySelector('#open-create-event-modal')),floating:inView(document.querySelector('#floating-memory-actions'))};});
    for(const [width,height] of [[1440,900],[390,844],[320,740]]) {
      await page.setViewportSize({width,height}); await page.evaluate(()=>window.scrollTo(0,0));
      await page.evaluate(()=>document.fonts.ready); await page.waitForTimeout(600);
      await shot(`${width}x${height}`);
      const top=await visibility();assert.deepEqual(top,{primary:true,floating:false});
      await card.scrollIntoViewIfNeeded();await page.waitForTimeout(250);await shot(`photo-card-${width}x${height}`);
      await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(350);
      const scrolled=await visibility();assert.deepEqual(scrolled,{primary:false,floating:true});
      const bottom=await page.evaluate(()=>{const nav=document.querySelector('.journal-navigation').getBoundingClientRect();const cards=[...document.querySelectorAll('[id^="event-card-"]')];const last=cards.at(-1);const buttons=[...last.querySelectorAll('button'),...last.parentElement.querySelectorAll('[data-reaction-controls] button')];return {navTop:nav.top,buttons:buttons.map(el=>{const r=el.getBoundingClientRect();return {name:el.getAttribute('aria-label')||el.textContent,bottom:r.bottom,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})};});
      if(width<640)assert(bottom.buttons.every(b=>b.bottom<=bottom.navTop&&b.hit),'final card controls clear mobile nav and hit');
      await shot(`bottom-${width}x${height}`);report.checks.push({width,create:{top,scrolled},finalCard:bottom});
      await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(300);
      assert.equal(await page.locator('[data-summary-metric]').count(),5);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      report.checks.push({width,height,metrics:5,overflow:false});
    }
    for(const [width,height] of [[1440,900],[390,844],[320,740]]) {
      await page.setViewportSize({width,height}); await page.emulateMedia({colorScheme:'dark'});
      await page.evaluate(()=>window.scrollTo(0,0)); await page.waitForTimeout(300);
      await page.screenshot({path:path.join(out,`dark-${width}x${height}.png`)});
    }
    await page.emulateMedia({colorScheme:'light'});
    await page.setViewportSize({width:1440,height:900});
    await page.evaluate(()=>window.scrollTo(0,0));
    const rail=page.locator('[data-testid="month-edge-rail"]');
    if(await rail.count()){await rail.hover();await rail.locator('[data-rail-slot]').first().waitFor();await rail.locator('[data-rail-slot]').first().hover();await page.locator('[data-testid="edge-film-preview"]').waitFor();await page.waitForTimeout(600);await shot('desktop-month-rail-expanded');report.checks.push('Desktop month rail expanded screenshot');await page.mouse.move(10,10);}
    await page.locator('#track-picker-trigger').click();
    await page.locator('#track-nav-search').fill('Everyday');
    assert.equal(await page.locator('#track-picker').getByRole('button',{name:/Everyday notes/}).count(),1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#track-picker').count(),0);
    const before=report.requests.filter(r=>r.path==='/api/moments/query').length;
    await page.locator('#toggle-advanced-filters').click();
    await page.waitForTimeout(300);
    assert.equal(report.requests.filter(r=>r.path==='/api/moments/query').length,before,'opening filters performs no feed query');
    const queryCount=()=>report.requests.filter(r=>r.path==='/api/moments/query').length;
    const date=page.getByRole('dialog',{name:'Date range editor'});
    const openDate=async()=>{await page.locator('#date-range-trigger').click();await date.waitFor();};
    const q0=queryCount();await openDate();await page.locator('#filter-date-from').fill('2026-10-01');await page.locator('#filter-date-to').fill('2026-10-31');await date.getByRole('button',{name:'Next month',exact:true}).click();await page.waitForTimeout(250);assert.equal(queryCount(),q0);await date.getByRole('button',{name:'Cancel',exact:true}).click();await page.waitForTimeout(250);assert.equal(queryCount(),q0);
    await openDate();assert.equal(await page.locator('#filter-date-from').inputValue(),'');await page.locator('#filter-date-from').fill('2026-10-01');await page.locator('#filter-date-to').fill('2026-10-31');
    const applied=page.waitForResponse(r=>r.url().endsWith('/api/moments/query')&&r.request().postDataJSON().dateFrom==='2026-10-01');await date.getByRole('button',{name:'Apply',exact:true}).click();await applied;await card.waitFor();await page.waitForTimeout(250);assert.equal(queryCount(),q0+1);
    await openDate();assert.equal(await page.locator('#filter-date-to').inputValue(),'2026-10-31');await date.getByRole('button',{name:'Apply',exact:true}).click();await page.waitForTimeout(250);assert.equal(queryCount(),q0+1);
    await openDate();const cleared=page.waitForResponse(r=>r.url().endsWith('/api/moments/query'));await date.getByRole('button',{name:'Clear date filter',exact:true}).click();await cleared;await card.waitFor();
    report.checks.push('Date: draft/calendar navigation/Cancel zero requests; changed Apply one atomic query; reopen unchanged Apply zero; Clear applies');
    await page.locator('#toggle-advanced-filters').click();
    await page.locator('#timeline-search-input').fill('NO_MATCH_DISPOSABLE');await page.locator('#empty-timeline-state').waitFor();await page.waitForTimeout(300);assert.deepEqual(await visibility(),{primary:true,floating:false});assert.equal(await page.locator('#empty-state-add-event').count(),0);report.checks.push('Filtered empty retains exclusive page create and Reset, no onboarding CTA');
    await page.getByRole('button',{name:'Reset Filters',exact:true}).click();await card.waitFor();
    await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(600);

    await rail.hover();await rail.locator('[data-rail-slot]').first().waitFor();await rail.locator('[data-rail-slot]').first().hover();await page.locator('[data-testid="edge-film-preview"]').waitFor();report.checks.push('Rail preview recovers after filter roundtrip to previously warmed scope');await page.mouse.move(10,10);
    await page.getByRole('button',{name:'Rediscover',exact:true}).click();
    await page.getByRole('region',{name:'Rediscover memories'}).waitFor();
    await page.getByRole('button',{name:'Back to memories'}).click();
    await page.getByRole('button',{name:'Library',exact:true}).click();
    await page.getByRole('menuitem',{name:'Stories',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    report.checks.push('Grouped picker search/Escape; filters open without query; Rediscover routes existing resurfacing; Library opens existing Stories dialog');
    assert.equal(report.pageerrors.length,0);
    for(const role of ['viewer','editor']) {
      const u={id:crypto.randomUUID(),username:`qa_quiet_${crypto.randomBytes(5).toString('hex')}`,token:crypto.randomBytes(32).toString('hex')}; extraUsers.push(u);
      await pool.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,$3)`,[u.id,u.username,'unused-qa-fixture']);
      await pool.query(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`,[hashSession(u.token),u.id]);
      await pool.query(`INSERT INTO ${qschema}.track_collaborators(id,owner_id,track_id,recipient_id,role,expires_at,accepted_at) VALUES($1,$2,$3,$4,$5,now()+interval '7 days',now())`,[crypto.randomUUID(),owner.id,track,u.id,role]);
      if(role==='viewer') await pool.query(`INSERT INTO ${qschema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`,[u.id,'own-track',{id:'own-track',title:'My own empty track',color:'indigo',icon:'Heart',tags:[]}]);
      const c=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
      await c.addCookies([{name:'memento_session',value:u.token,url:base,httpOnly:true,sameSite:'Lax',secure:true}]);
      const pg=await c.newPage();await pg.goto(base);await pg.locator('[id^="event-card-"]').first().waitFor();
      await pg.locator('#track-picker-trigger').click();await pg.locator('#track-picker').getByRole('button',{name:/Everyday notes/}).click();
      await pg.waitForTimeout(300);
      assert.equal(await pg.locator('#open-create-event-modal').count(),role==='editor'?1:0);
      assert.equal(await pg.getByRole('button',{name:'Edit track',exact:true}).count(),0);
      assert.equal(await pg.getByRole('button',{name:'Share',exact:true}).count(),0);
      await pg.getByText('Track info',{exact:true}).click();assert((await pg.locator('.journal-track-context details').innerText()).includes('6 memories · 1 photos · 0 milestones'));assert((await pg.locator('.journal-track-context details').innerText()).includes('Status: active'));
      if(role==='viewer') {await pg.locator('#track-picker-trigger').click();await pg.locator('#track-picker').getByRole('button',{name:/My own empty track/}).click();await pg.locator('#empty-state-add-event').waitFor();await pg.waitForTimeout(250);assert.equal(await pg.locator('#open-create-event-modal').count(),0);assert.equal(await pg.locator('#floating-memory-actions').isVisible(),false);for(const [width,height] of [[1440,900],[390,844],[320,740]]) {await pg.setViewportSize({width,height});await pg.evaluate(()=>window.scrollTo(0,0));await pg.waitForTimeout(250);assert.equal(await pg.locator('#empty-state-add-event').isVisible(),true);assert.equal(await pg.locator('#open-create-event-modal').count(),0);assert.equal(await pg.locator('#floating-memory-actions').isVisible(),false);const file=path.join(out,`empty-${width}x${height}.png`);await pg.screenshot({path:file});report.screenshots.push(file);report.checks.push({width,height,empty:{onboarding:1,primary:0,floating:0}});}report.checks.push('Mixed owner/viewer: selected viewer hides create despite own writable track; own empty track has exclusive onboarding CTA');}
      report.checks.push(`${role}: shared track selectable, create role correct, owner-only management absent; Track info full counts/status`);await c.close();
    }
    report.passed=true;
  }catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;}
  finally {
    try {
      if(imageId){const deleted=await context.request.delete(base+`/api/images/${imageId}`,{headers:{Origin:base}});assert.equal(deleted.status(),200);report.photo.deleteStatus=200;imageId=null;}
      let remaining=1;for(let i=0;i<90&&remaining;i++){remaining=Number((await pool.query(`SELECT count(*) FROM ${qschema}.object_cleanup_jobs WHERE object_keys::text LIKE $1`,[`%${uploadedIds[0]||'no-upload'}%`])).rows[0].count);if(remaining)await new Promise(r=>setTimeout(r,1000));}assert.equal(remaining,0);report.r2Cleanup={imageId:uploadedIds[0],remaining};
    } catch(e){report.cleanupError=String(e);report.passed=false;process.exitCode=1;}
    await browser?.close();
    await pool.query(`DELETE FROM ${qschema}.users WHERE id=$1`,[owner.id]);
    for(const u of extraUsers) await pool.query(`DELETE FROM ${qschema}.users WHERE id=$1`,[u.id]);
    report.cleanup=true; await pool.end(); fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,cleanup:report.cleanup,error:report.error}));
  }
})();
