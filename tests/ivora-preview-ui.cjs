const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const out = path.resolve('.hermes/ivora-evidence');
const base = process.env.PREVIEW_BASE || 'https://memento-dev.srv.io.vn';
const report = {passed:false, scope:'Public DEV fictional preview + unauthenticated normal-entry smoke', checks:[], screenshots:[], previewRequests:[], errors:[]};
function check(name, value) { assert.ok(value,name); report.checks.push(name); }
(async()=>{
 fs.mkdirSync(out,{recursive:true}); let browser;
 try {
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || '/snap/bin/chromium',args:['--no-sandbox']});
  const context=await browser.newContext(); const page=await context.newPage();
  const requests=[]; page.on('request',r=>requests.push(r.url())); page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(base+'/?uiPreview=ivora'); await page.locator('.ivora-card').first().waitFor();
  await page.evaluate(()=>document.fonts.ready);
  check('three fictional cards',await page.locator('.ivora-card').count()===3);
  for(const width of [1440,390,320]) {
   await page.setViewportSize({width,height:1000}); await page.waitForTimeout(400);
   check(`${width}: no document or descendant horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll('.ivora-shell *')].every(e=>{const r=e.getBoundingClientRect(); return r.width===0||(r.left>=-1&&r.right<=innerWidth+1)})));
   for(const b of await page.locator('.ivora button, .ivora a, .ivora input').all()) {
    if(!await b.isVisible())continue; await b.scrollIntoViewIfNeeded();
    const g=await b.evaluate(e=>{const r=e.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {w:r.width,h:r.height,hit:e===h||e.contains(h)}});
    check(`${width}: target ${await b.getAttribute('aria-label')||await b.innerText()}`,g.w>=44&&g.h>=44&&g.hit);
   }
   await page.getByRole('button',{name:'Wander',exact:true}).click(); check(`${width}: track filter`,await page.locator('.ivora-card').count()===1);
   await page.getByRole('button',{name:'All memories',exact:true}).click();
   await page.getByRole('textbox',{name:'Search fictional memories'}).fill('Sunday'); check(`${width}: search`,await page.locator('.ivora-card').count()===1);
   await page.getByRole('textbox').fill('absent word'); check(`${width}: empty state`,await page.getByRole('button',{name:'Clear filters'}).isVisible()); await page.getByRole('button',{name:'Clear filters'}).click();
   const love=page.getByRole('button',{name:'Love The long way home',exact:true}); await love.click(); check(`${width}: reaction on`,await love.getAttribute('aria-pressed')==='true');
   const open=page.getByRole('button',{name:'Open The long way home',exact:true}); await open.click(); await page.locator('dialog[open]').waitFor();
   check(`${width}: native dialog modal`,await page.locator('dialog').evaluate(e=>e.matches(':modal')));
   await page.waitForTimeout(250); const detailShot=path.join(out,`detail-${width}.png`); await page.screenshot({path:detailShot,fullPage:true}); report.screenshots.push(detailShot);
   check(`${width}: dialog viewport bounded`,await page.locator('dialog').evaluate(e=>{const r=e.getBoundingClientRect(); return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}));
   await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); check(`${width}: native dialog retains keyboard focus`,await page.locator('dialog').evaluate(e=>e.contains(document.activeElement)));
   const dlove=page.locator('dialog').getByRole('button',{name:'Love The long way home',exact:true}); check(`${width}: detail reaction synchronized`,await dlove.getAttribute('aria-pressed')==='true'); await dlove.click();
   await page.keyboard.press('Escape'); await page.locator('dialog').waitFor({state:'hidden'}); check(`${width}: Escape focus restoration`,await open.evaluate(e=>document.activeElement===e)); check(`${width}: feed reaction synchronized`,await love.getAttribute('aria-pressed')==='false');
   await open.click(); await page.locator('dialog[open]').waitFor(); await page.waitForTimeout(250); await page.mouse.click(2,2); await page.locator('dialog').waitFor({state:'hidden'}); check(`${width}: backdrop focus restoration`,await open.evaluate(e=>document.activeElement===e));
   await open.click(); await page.locator('dialog[open]').waitFor(); await page.getByRole('button',{name:'Close memory'}).click(); await page.locator('dialog').waitFor({state:'hidden'}); check(`${width}: close-button focus restoration`,await open.evaluate(e=>document.activeElement===e));
   await page.evaluate(()=>scrollTo(0,0)); await page.waitForTimeout(250);
   let shot=path.join(out,`preview-${width}-light.png`); await page.screenshot({path:shot,fullPage:true});report.screenshots.push(shot);
   await page.getByRole('button',{name:'Switch to dark theme'}).click(); check(`${width}: dark theme`,await page.locator('.ivora').getAttribute('data-theme')==='dark');
   shot=path.join(out,`preview-${width}-dark.png`); await page.screenshot({path:shot,fullPage:true});report.screenshots.push(shot); await page.getByRole('button',{name:'Switch to light theme'}).click();
  }
  await page.emulateMedia({reducedMotion:'reduce'}); check('reduced motion disables animation',await page.locator('.ivora-card').first().evaluate(e=>getComputedStyle(e).animationName==='none')); await page.getByRole('button',{name:'Open The long way home'}).click(); await page.getByRole('button',{name:'Close memory'}).click(); await page.locator('dialog').waitFor({state:'hidden'}); check('reduced-motion close',true);
  await page.reload(); await page.locator('.ivora-card').first().waitFor();check('reload resets local state',await page.getByRole('button',{name:'Love The long way home',exact:true}).getAttribute('aria-pressed')==='false');
  report.previewRequests=[...new Set(requests)]; check('zero preview API/private-image requests',!requests.some(u=>/\/api\//.test(u)));check('preview never loads account-aware App chunk',!requests.some(u=>/\/App-/.test(u))); check('zero preview browser errors',report.errors.length===0);
  const normal=await context.newPage();const normalRequests=[];normal.on('request',r=>normalRequests.push(r.url()));await normal.goto(base+'/');await normal.getByRole('button',{name:/sign in/i}).first().waitFor({timeout:20000}); await normal.waitForTimeout(800); check('normal unauthenticated sign-in renders',true);check('normal entry loads no preview module or stylesheet',!normalRequests.some(u=>u.includes('IvoraPreview')||u.includes('memento-ivora')));report.normalRequests=normalRequests;
  const entry=await normal.locator('script[type="module"][src^="/assets/index-"]').getAttribute('src');report.servedEntry=entry;const served=await context.request.get(base+entry);check('served entry equals local dist bytes',Buffer.compare(await served.body(),fs.readFileSync(path.join('dist',entry)))===0);
  const previewModule=requests.find(u=>/IvoraPreview-.*\.js/.test(u));check('served preview module equals dist bytes',Buffer.compare(await(await context.request.get(previewModule)).body(),fs.readFileSync(path.join('dist',new URL(previewModule).pathname)))===0);
  await normal.screenshot({path:path.join(out,'normal-sign-in.png'),fullPage:true});report.screenshots.push(path.join(out,'normal-sign-in.png'));
  await context.close();report.passed=true;
 } catch(e) {report.error=e.stack;process.exitCode=1;} finally {if(browser)await browser.close();report.totalChecks=report.checks.length;fs.writeFileSync(path.join(out,'qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})();
