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
  const out = path.resolve('.hermes/evidence/feed-reaction-overlap'); fs.mkdirSync(out, { recursive: true });
  const report = { synthetic: false, scope: 'Authenticated Chromium through deployed public DEV nginx/PM2 against DEV PostgreSQL; disposable user/track/moment/perspective/reaction; no R2.', checks: [], requests: [], pageerrors: [], cleanup: false };
  const owner = { id: crypto.randomUUID(), username: `qa_reaction_${crypto.randomBytes(6).toString('hex')}`, token: crypto.randomBytes(32).toString('hex') };
  const track = `qa_track_${crypto.randomBytes(6).toString('hex')}`;
  const moment = `qa_moment_${crypto.randomBytes(6).toString('hex')}`;
  const recentReactors = Array.from({ length: 7 }, (_, index) => ({ id: crypto.randomUUID(), username: `Newest${7 - index}` }));
  let browser;
  const contexts = [];
  try {
    await pool.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,$3)`, [owner.id, owner.username, 'unused-qa-fixture']);
    await pool.query(`INSERT INTO ${qschema}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`, [hashSession(owner.token), owner.id]);
    const trackDoc = { id: track, title: 'Reaction live QA', description: 'Temporary fixture', color: 'indigo', icon: 'Heart', tags: [], createdAt: '2026-10-15', updatedAt: '2026-10-15' };
    await pool.query(`INSERT INTO ${qschema}.tracks(owner_id,id,document) VALUES($1,$2,$3)`, [owner.id, track, trackDoc]);
    const momentDoc = { id: moment, resourceOwnerId: owner.id, eventId: track, title: 'Reaction reflection live QA', date: '2026-10-15', time: null, description: 'Original content remains unchanged.', idea: null, location: null, tags: [], images: [], emotion: 'joy', emotionIntensity: 2, isMilestone: false, version: 1, createdAt: '2026-10-15', updatedAt: '2026-10-15' };
    await pool.query(`INSERT INTO ${qschema}.moments(owner_id,id,event_id,document) VALUES($1,$2,$3,$4)`, [owner.id, moment, track, momentDoc]);
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell', args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }); contexts.push(context);
    await context.addCookies([{ name: 'memento_session', value: owner.token, url: base, httpOnly: true, sameSite: 'Lax', secure: true }]);
    const page = await context.newPage(); page.on('pageerror', error => report.pageerrors.push(error.message));
    page.on('response', response => { const url = new URL(response.url()); if (url.pathname.startsWith('/api/')) report.requests.push({ method: response.request().method(), path: url.pathname, status: response.status() }); });
    await page.goto(base);
    report.entry = await page.locator('script[type="module"][src^="/assets/index-"]').getAttribute('src');
    const localIndex = fs.readFileSync('dist/index.html','utf8');
    assert(localIndex.includes(report.entry), 'public entry matches rebuilt DEV bundle');
    const asset = await context.request.get(base + report.entry);
    assert.equal(asset.status(),200);
    assert.deepEqual(await asset.body(),fs.readFileSync(path.join('dist',report.entry)),'public entry bytes match DEV build');
    const card = page.locator(`[id="event-card-${owner.id}:${moment}"]`); await card.waitFor();
    const controls = card.locator('..').locator('[data-reaction-controls]');
    assert.equal(await controls.locator('button[aria-label^="React "]').count(), 6);
    const visualMatrix = async state => {
      for (const theme of ['light','dark']) for (const width of [320,360,390,414,1440]) {
        await page.setViewportSize({width,height:900});
        await page.emulateMedia({colorScheme:theme});
        await page.evaluate(()=>document.activeElement?.blur());
        await controls.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
        await page.mouse.move(width-1,0);
        await page.waitForTimeout(250);
        const data=await controls.evaluate(el=>{
          const stem=document.querySelector('#timeline-container > [aria-hidden="true"]').getBoundingClientRect();
          const buttons=[...el.querySelectorAll('button[data-reaction-summary]')].map(b=>{
            const r=b.getBoundingClientRect(),v=b.querySelector('.reaction-visual').getBoundingClientRect();
            const cs=getComputedStyle(b);
            return {x:r.x,y:r.y,right:r.right,w:r.width,h:r.height,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),visualX:v.x,visualRight:v.right,border:cs.borderLeftWidth,bg:cs.backgroundColor,selected:b.getAttribute('aria-pressed')};
          });
          return {stem:{x:stem.x,right:stem.right},buttons};
        });
        assert.equal(data.buttons.length,6);
        assert(data.buttons.every(r=>r.w>=44&&r.h>=44&&r.hit&&r.x>=0&&r.right<=width&&Math.abs(r.y-data.buttons[0].y)<1),JSON.stringify(data));
        if(width<640) assert(data.buttons.every(r=>r.visualX>=data.stem.right+2&&r.border==='0px'&&r.bg==='rgba(0, 0, 0, 0)'), 'visible reaction must clear timeline: '+JSON.stringify(data));
        else assert(data.buttons.every(r=>r.border==='1px'),'desktop pills retained');
        report.checks.push({state,theme,width,visualGeometry:data});
        const cdp=await context.newCDPSession(page); const capture=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,`${state}-${theme}-${width}.png`),Buffer.from(capture.data,'base64'));await cdp.detach();
      }
    };
    await visualMatrix('zero-visual');

    const zero = controls.getByRole('button', {name:/React 🎉/});
    assert.equal(await zero.getAttribute('aria-pressed'), 'false');
    await zero.click();
    await page.waitForFunction(() => document.querySelector('[data-reaction-controls] button[aria-label^="React 🎉"]')?.getAttribute('aria-busy') === 'false');
    assert.equal(await zero.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#event-detail-card').count(),0);
    await zero.click();
    await page.waitForFunction(() => document.querySelector('[data-reaction-controls] button[aria-label^="React 🎉"]')?.getAttribute('aria-busy') === 'false');
    assert.equal(await zero.getAttribute('aria-pressed'), 'false');
    for (const width of [1440,414,390,360,320]) {
      await page.setViewportSize({width,height:900});
      await controls.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
      await page.waitForTimeout(200);
      const geometry = await controls.locator('button[aria-label^="React "]').evaluateAll(xs=>xs.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,w:r.width,h:r.height,opacity:getComputedStyle(el).opacity,enabled:!el.disabled,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};}));
      assert(geometry.every(r=>r.w>=44&&r.h>=44&&r.opacity==='1'&&r.enabled&&r.hit), JSON.stringify(geometry));
      assert(geometry.every(r=>Math.abs(r.y-geometry[0].y)<1&&r.x>=0&&r.right<=width), 'zero controls single row and viewport bounded: '+JSON.stringify(geometry));
      report.checks.push({ state:'zero', width, geometry });
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await zero.click();
      await page.waitForFunction(() => document.querySelector('[data-reaction-controls] button[aria-label^="React 🎉"]')?.getAttribute('aria-busy') === 'false');
      assert.equal(await zero.getAttribute('aria-pressed'),'true');
      await zero.click();
      await page.waitForFunction(() => document.querySelector('[data-reaction-controls] button[aria-label^="React 🎉"]')?.getAttribute('aria-busy') === 'false');
      assert.equal(await zero.getAttribute('aria-pressed'),'false');
      report.checks.push(`${width}px: six enabled opaque 44px center-hittable controls, zero add/remove, no horizontal overflow or detail opening`);
      const cdp=await context.newCDPSession(page); const capture=await cdp.send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(path.join(out,`feed-${width}.png`),Buffer.from(capture.data,'base64')); await cdp.detach();
    }
    await page.setViewportSize({width:390,height:844});
    for (let index = 0; index < recentReactors.length; index++) {
      const reactor = recentReactors[index];
      await pool.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,$3)`, [reactor.id, reactor.username, 'unused-qa-reactor']);
      await pool.query(`INSERT INTO ${qschema}.moment_reactions(moment_owner_id,moment_id,user_id,emoji,created_at) VALUES($1,$2,$3,$4,$5)`, [owner.id, moment, reactor.id, '❤️', `2026-10-27T12:00:0${index}Z`]);
    }
    for (const reactor of recentReactors) for (const emoji of ['🥹','😂','✨','🙌','🎉']) {
      await pool.query(`INSERT INTO ${qschema}.moment_reactions(moment_owner_id,moment_id,user_id,emoji) VALUES($1,$2,$3,$4)`, [owner.id,moment,reactor.id,emoji]);
    }
    await page.reload(); await card.waitFor();
    for (const width of [320,360,390,414,1440]) {
      await page.setViewportSize({width,height:900});
      await controls.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
      await page.waitForTimeout(200);
      const geometry=await controls.locator('button[data-reaction-summary]').evaluateAll(xs=>xs.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,w:r.width,h:r.height,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),fits:el.scrollWidth<=el.clientWidth,label:el.getAttribute('aria-label')};}));
      assert.equal(geometry.length,6);
      assert(geometry.every(r=>r.w>=44&&r.h>=44&&r.hit&&r.fits&&Math.abs(r.y-geometry[0].y)<1&&r.x>=0&&r.right<=width),JSON.stringify(geometry));
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      report.checks.push({state:'all-six-populated',width,geometry});
      const cdp=await context.newCDPSession(page); const capture=await cdp.send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(path.join(out,`populated-${width}.png`),Buffer.from(capture.data,'base64')); await cdp.detach();
    }
    await visualMatrix('populated-visual');
    const selectedHeart=controls.getByRole('button',{name:/React ❤️/});
    await selectedHeart.click();
    await page.waitForFunction(()=>document.querySelector('[data-reaction-controls] button[aria-label^="React ❤️"]')?.getAttribute('aria-busy')==='false');
    await visualMatrix('selected-visual');
    await selectedHeart.click();
    await page.waitForFunction(()=>document.querySelector('[data-reaction-controls] button[aria-label^="React ❤️"]')?.getAttribute('aria-busy')==='false');
    await page.setViewportSize({width:390,height:844});
    report.checks.push("all-zero memory rendered all six controls before seeding tooltip fixture");
    const rail = page.locator('[data-reaction-summary="❤️"]'); await rail.waitFor();
    await rail.hover();
    const feedTooltip = rail.locator('[data-reaction-tooltip]'); await feedTooltip.waitFor();
    assert.equal(await feedTooltip.innerText(), 'Newest1, Newest2, Newest3, Newest4, Newest5, and 2 more');
    await rail.focus(); assert.equal(await feedTooltip.innerText(), 'Newest1, Newest2, Newest3, Newest4, Newest5, and 2 more');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, '390px reaction rail has no horizontal overflow');
    const railBox = await rail.boundingBox(), cardBox = await card.boundingBox(); assert(railBox && cardBox && railBox.y >= cardBox.y + cardBox.height, 'reaction rail is below the post card');
    const detail = controls; // Same shared controls, exercised directly from feed.
    const react = controls.getByRole('button', { name: /React ❤️/ });
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    let writes = 0;
    let injectFailure = false;
    await page.route('**/api/moments/*/reactions', async route => {
      writes++;
      if (injectFailure) { injectFailure = false; return route.fulfill({status:503,json:{error:'Controlled transport failure (synthetic fault)'}}); }
      const upstream = await route.fetch();
      if (writes === 1) { entered(); await barrier; }
      await route.fulfill({response:upstream});
    });
    try {
      const beforeFeed = report.requests.filter(r => r.path === '/api/moments/query').length;
      const start = Date.now(); await react.click();
      await page.waitForFunction(() => document.querySelector('[data-reaction-controls] button[aria-label^="React ❤️"]')?.getAttribute('aria-pressed') === 'true');
      const paintMs = Date.now() - start; assert(paintMs < 1000);
      await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(new Error('barrier timeout')),5000))]);
      const buttons=detail.locator('button[aria-label^="React "]');
      assert.equal(await buttons.count(),6);
      assert.deepEqual(await buttons.evaluateAll(xs=>xs.map(el=>({disabled:el.disabled,opacity:getComputedStyle(el).opacity}))),Array.from({length:6},()=>({disabled:false,opacity:'1'})));
      await react.click();
      await detail.getByRole('button',{name:/React 😂/}).click();
      await react.click();
      await page.waitForFunction(()=>document.querySelector('[data-reaction-controls] button[aria-label^="React 😂"]')?.getAttribute('aria-pressed')==='true');
      assert.equal(await react.getAttribute('aria-pressed'),'true'); assert.equal(writes,1,'writes serialize while genuine response held');
      // Playwright screenshot waits forever for a remote font that is unrelated to
      // this interaction. Capture the rendered Chromium surface directly instead.
      const cdp = await context.newCDPSession(page);
      const capture = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(out, 'held-rapid-reactions.png'), Buffer.from(capture.data, 'base64'));
      await cdp.detach();
      release();
      await page.waitForFunction(()=>document.querySelector('[data-reaction-controls] button[aria-label^="React ❤️"]')?.getAttribute('aria-busy')==='false');
      assert.equal(writes,4);
      assert.equal(await react.getAttribute('aria-pressed'),'true');
      const rows=await pool.query(`SELECT emoji FROM ${qschema}.moment_reactions WHERE user_id=$1 AND moment_owner_id=$2 AND moment_id=$3 ORDER BY emoji`,[owner.id,owner.id,moment]);
      assert.deepEqual(rows.rows.map(r=>r.emoji).sort(),['❤️','😂'].sort());
      injectFailure=true;
      await detail.getByRole('button',{name:/React ✨/}).click();
      await detail.getByRole('alert').filter({hasText:'Controlled transport failure'}).waitFor();
      assert.equal(await react.getAttribute('aria-pressed'),'true','failure must not rollback prior success');
      assert.equal(await detail.getByRole('button',{name:/React ✨/}).getAttribute('aria-pressed'),'false');
      await detail.getByRole('button',{name:'Retry reaction',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[data-reaction-controls] button[aria-label^="React ✨"]')?.getAttribute('aria-busy')==='false');
      assert.equal(await detail.getByRole('button',{name:/React ✨/}).getAttribute('aria-pressed'),'true');
      assert.equal(report.requests.filter(r=>r.path==='/api/moments/query').length,beforeFeed,'no feed refresh');
      report.checks.push(`live upstream response held: six enabled opacity=1 controls; rapid on/off/on plus different emoji; ${paintMs}ms paint; 4 serialized real writes; DB exact state; no feed refresh`);
      report.checks.push('synthetic transport 503 against live fixture: rollback preserves prior success; exact desired retry persisted');
    } finally { release(); }
    assert.equal(await page.locator('#event-detail-card').count(),0,'feed reactions never open detail');
    await card.locator('h3').click();
    const modal = page.locator('#event-detail-card'); await modal.waitFor();
    for (const emoji of ['❤️','😂','✨']) assert.equal(await modal.getByRole('button',{name:new RegExp('React '+emoji)}).getAttribute('aria-pressed'),'true');
    assert.equal(await modal.getByRole('button',{name:/React ❤️/}).getAttribute('title'),await react.getAttribute('title'));
    await modal.getByRole('button',{name:/React 😂/}).click();
    await page.waitForFunction(()=>document.querySelector('#event-detail-card button[aria-label^="React 😂"]')?.getAttribute('aria-busy')==='false');
    assert.equal(await controls.getByRole('button',{name:/React 😂/}).getAttribute('aria-pressed'),'false');
    report.checks.push('feed->detail and detail->feed selected/count synchronization; identical recent-reactor wording');
    assert.equal(await controls.getByRole('button',{name:/React 😂/}).getAttribute('aria-label'), await modal.getByRole('button',{name:/React 😂/}).getAttribute('aria-label'));
    await page.keyboard.press('Escape'); await modal.waitFor({state:'detached'});
    await page.setViewportSize({width:1440,height:900});
    await page.getByRole('button',{name:'Compact list view',exact:true}).click();
    const listControls=page.locator('#compact-list-table-wrap [data-reaction-controls]');
    await listControls.waitFor();
    assert.equal(await listControls.locator('button[aria-label^="React "]').count(),6);
    const listZero=listControls.getByRole('button',{name:/React 🎉/}); await listZero.click();
    await page.waitForFunction(()=>document.querySelector('#compact-list-table-wrap button[aria-label^="React 🎉"]')?.getAttribute('aria-busy')==='false');
    assert.equal(await listZero.getAttribute('aria-pressed'),'true'); assert.equal(await page.locator('#event-detail-card').count(),0);
    await listZero.click();
    await page.waitForFunction(()=>document.querySelector('#compact-list-table-wrap button[aria-label^="React 🎉"]')?.getAttribute('aria-busy')==='false');
    assert.equal(await listZero.getAttribute('aria-pressed'),'false');
    report.checks.push('Compact List: six shared controls, persisted add/remove, click propagation does not open detail');
    assert.deepEqual(report.pageerrors, []); report.passed = true;
  } catch (error) { report.passed = false; report.error = error.stack; process.exitCode = 1; }
  finally {
    for (const context of contexts) await context.close().catch(() => {});
    if (browser) await browser.close();
    if (owner.id) await pool.query(`DELETE FROM ${qschema}.users WHERE id=$1`, [owner.id]);
    for (const reactor of recentReactors) await pool.query(`DELETE FROM ${qschema}.users WHERE id=$1`, [reactor.id]).catch(() => {});
    const count = await pool.query(`SELECT count(*)::int AS count FROM ${qschema}.users WHERE id=$1`, [owner.id]); report.cleanup = count.rows[0].count === 0;
    assert.equal(report.cleanup, true, 'temporary user cascades deleted');
    await pool.end(); fs.writeFileSync(path.join(out, 'live-results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
