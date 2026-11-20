// Route-intercepted browser smoke; use separately built parity output and local browser.
const {chromium} = require(process.env.INSIGHTS_PLAYWRIGHT || 'playwright');
const {readFile} = require('node:fs/promises');
const {createServer} = require('node:http');
const {join, extname} = require('node:path');
const assert = require('node:assert/strict');
const mime = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.woff2':'font/woff2'};
const track = {id:'track',resourceOwnerId:'owner',accessRole:'owner',title:'Quiet archive',tags:[],status:'active',color:'indigo',icon:'Heart'};
const moment = {id:'same',resourceOwnerId:'owner',eventId:'track',title:'Cedar footpath',description:'The actual authorized detail response.',date:'2026-11-20',emotion:'joyful',images:[],tags:[],reactions:[],version:1};
const mood = {mood:'joyful',average:4.1,count:78};
const overview = {total:86,photos:0,milestones:1,places:1,earliest:'2026-11-20',latest:'2026-11-20',tracks:[],years:['2026'],tags:[]};
const archive = {health:{total:86,dated:81,withMood:78,withPlace:2,photos:0,milestones:1,activeTracks:1,totalTracks:1,tagCount:0,topTag:null,earliest:'2026-11-20',latest:'2026-11-20'},mood:{logged:78,average:4.1},moods:[mood],daily:[]};
const atlas = {mood:archive.mood,moods:[{...mood,examples:[{ownerId:'owner',id:'same',date:moment.date,title:moment.title}]}],months:[{...mood,month:'2026-11'}],peak:null,seals:{joyPeaks:1,reflectiveDays:0,peakEntries:1,distinctMoods:1,monthsInYear:1,gratefulPeaks:0,longestStreak:1,spanMonths:0},geography:{places:1,countries:1,moments:2},places:[{city:'Kyoto',country:'Japan',count:2,earliest:moment.date,latest:moment.date,mood:'joyful',imageId:null,examples:[]}],associations:[]};
(async () => {
  let browser, server;
  const calls = [], unknown = [], errors = [], checks = [];
  try {
    server = createServer(async (req,res) => {
      try {
        const p = new URL(req.url,'http://localhost').pathname;
        const file = join(process.env.INSIGHTS_BUILD || 'dist',p==='/'?'index.html':p);
        res.setHeader('Content-Type',mime[extname(file)] || 'application/octet-stream');
        res.end(await readFile(file));
      } catch { res.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({executablePath:process.env.INSIGHTS_CHROME,args:['--no-sandbox']});
    const page = await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'});
    page.setDefaultTimeout(6000);
    page.on('pageerror',e=>errors.push(e.message));
    let failAtlas = true;
    await page.route('**/*', async route => {
      const r = route.request(), url = new URL(r.url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const p = url.pathname;
      const body = r.postData() && JSON.parse(r.postData());
      calls.push({p,q:url.searchParams.toString(),body});
      let json;
      switch(p) {
        case '/api/auth/me': json={user:{id:'owner',username:'qa'}}; break;
        case '/api/tracks': json={tracks:[track]}; break;
        case '/api/tags': json={tags:[]}; break;
        case '/api/saved': json={saved:[],count:0}; break;
        case '/api/collaboration-invitations': json={invitations:[]}; break;
        case '/api/track-visits': json={visits:[]}; break;
        case '/api/moments/overview': json={overview}; break;
        case '/api/moments/resurfacing': json={moments:[]}; break;
        case '/api/moments/browse/months': json={scope:'fixture',years:[],months:[],undatedCount:0}; break;
        case '/api/moments/browse/preview': json={scope:'fixture',month:body.month,total:0,items:[]}; break;
        case '/api/future-letters/summary': json={readyCount:0,serverNow:new Date().toISOString(),nextReleaseAt:null}; break;
        case '/api/moments/query': json={moments:[moment],total:86,nextCursor:null,previousCursor:null}; break;
        case '/api/moments/same': assert.equal(url.searchParams.get('ownerId'),'owner'); json={moment}; break;
        case '/api/archive-insights': {
          if (url.searchParams.get('view') === 'archive') {
            const today = url.searchParams.get('today');
            assert.match(today,/^\d{4}-\d{2}-\d{2}$/);
            json={insights:{...archive,today,daily:[{...mood,day:today,count:3}]}};
          } else if (failAtlas) { failAtlas=false; return route.fulfill({status:503,json:{error:'Controlled failure'}}); }
          else json={insights:atlas};
          break;
        }
        default: unknown.push(p); return route.fulfill({status:500,json:{error:'Unexpected request'}});
      }
      return route.fulfill({json});
    });
    await page.goto(base);
    await page.locator('#memory-summary strong').getByText('86',{exact:true}).waitFor();
    assert.equal(await page.locator('.archival-card').count(),1);
    const rhythm=page.getByRole('region',{name:'Mood rhythm',exact:true});
    await rhythm.getByRole('combobox',{name:'Recorded day'}).selectOption({index:1});
    await rhythm.getByRole('status').getByText('Joyful · 4.1/5 average · 3 logged').waitFor();
    checks.push('authoritative health and 30-day rhythm while only one card is loaded');
    await rhythm.getByRole('button',{name:'Mood Atlas'}).click();
    await page.getByRole('button',{name:'Retry Atlas'}).click();
    await page.getByRole('heading',{name:'Mood Pulse Constellation'}).waitFor();
    checks.push('archive to lazy Atlas with explicit failure and retry');
    const achievements=page.getByRole('button',{name:/Achievements 1\/8/});
    await achievements.click();
    await page.getByRole('dialog',{name:'Mood Achievements'}).getByText('Monthly Joy Peak').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({state:'detached'});
    await page.getByRole('button',{name:/Cedar footpath/}).click();
    await page.getByRole('dialog',{name:'Cedar footpath'}).getByText(moment.description).waitFor();
    await page.getByRole('dialog').getByRole('button',{name:'Close'}).click();
    checks.push('seals drawer and exact composite memory drill-down');
    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:844});
      await page.getByRole('button',{name:'Places Atlas',exact:true}).click();
      await page.getByRole('heading',{name:'Kyoto'}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
      await page.getByRole('button',{name:'Mood Atlas',exact:true}).click();
      await page.getByRole('heading',{name:'Mood Pulse Constellation'}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    }
    await page.getByRole('button',{name:'Places Atlas',exact:true}).click();
    const searched = page.waitForResponse(response=>response.url().endsWith('/api/moments/query') && response.request().postDataJSON().search==='Kyoto');
    await page.getByRole('button',{name:'Search archive for Kyoto'}).click();
    await searched;
    await page.waitForFunction(()=>document.querySelector('input[placeholder="Search memories…"]')?.value==='Kyoto' || [...document.querySelectorAll('input')].some(i=>i.value==='Kyoto'));
    await page.waitForFunction(()=>!document.querySelector('.insight-atlas'));
    checks.push('place to archive search and no overflow at 1440/390/320');
    assert.deepEqual(unknown,[]); assert.deepEqual(errors,[]);
    assert.equal(calls.filter(c=>c.p==='/api/archive-insights' && c.q==='view=atlas').length,2);
    assert.equal(calls.filter(c=>c.p==='/api/moments/same').length,1);
    assert.ok(!calls.some(c=>c.p==='/api/moments'));
    process.stdout.write(JSON.stringify({passed:true,checks})+'\n');
  } finally {
    try { await browser?.close(); } finally { if (server) await new Promise(resolve=>server.close(resolve)); }
  }
})().catch(error=>{ console.error(error); process.exitCode=1; });
