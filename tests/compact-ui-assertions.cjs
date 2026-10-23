// Shared real-browser assertions; responses are synthetic or live according to caller.
const assert = require('node:assert/strict');
module.exports = async function compactChecks(page) {
 await page.evaluate(async()=>{await document.fonts.ready;scrollTo(0,0);});
 const summary=page.locator('[data-summary]');
 assert.equal(await summary.locator('[data-summary-metric]').count(),5);
 assert.equal(await page.locator('#toggle-metrics-details').count(),0);
 const metrics=await summary.locator('[data-summary-metric]').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,x:r.x,y:r.y,w:r.width,h:r.height};}));
 const rows=new Set(metrics.map(r=>Math.round(r.y))).size;
 assert(rows<=(page.viewportSize().width<640?2:1),JSON.stringify(metrics));
 const action=page.locator('#floating-memory-actions');
 const fab=await action.boundingBox();assert.equal(fab.width,48);assert.equal(fab.height,48);
 assert.equal(await action.locator('svg').getAttribute('width'),'20');
 const trigger=page.locator('#date-range-trigger'),chip=page.locator('#filter-saved-only');
 const style=loc=>loc.evaluate(el=>{const s=getComputedStyle(el);return Object.fromEntries(['height','fontSize','fontWeight','backgroundColor','borderRadius','borderTopWidth'].map(k=>[k,s[k]]));});
 await page.mouse.move(0,0); // Neutralize retained hover after viewport resize.
 await page.waitForTimeout(200); // Let the CSS color transition settle before comparing computed values.
 const inactive=await style(trigger);assert.deepEqual(inactive,await style(chip));
 await trigger.click();const editor=page.getByRole('dialog',{name:'Date range editor',exact:true});
 assert.equal(await trigger.getAttribute('aria-pressed'),'true');assert.notEqual((await style(trigger)).backgroundColor,inactive.backgroundColor);
 assert.equal(await editor.getByRole('button',{name:/Choose (From|To)/}).count(),0);
 const dateGeometry=await require('./compact-date-assertions.cjs')(page,editor);
 if(process.env.MEMENTO_UI_ARTIFACTS) await page.screenshot({path:require('node:path').join(process.env.MEMENTO_UI_ARTIFACTS,`date-${page.viewportSize().width}.png`)});
 const from=editor.locator('#filter-date-from'),to=editor.locator('#filter-date-to');
 await editor.getByRole('spinbutton',{name:'Calendar year'}).fill('2026');await editor.getByRole('combobox',{name:'Calendar month'}).selectOption('9');
 await from.focus();assert.equal(await from.evaluate(el=>document.activeElement===el),true);
 assert.match(await from.getAttribute('class'),/ring-1/);
 await editor.getByRole('button',{name:'2026-10-12',exact:true}).click();assert.equal(await from.inputValue(),'2026-10-12');
 assert.match(await to.getAttribute('class'),/ring-1/);
 // Already-focused input click must select endpoint after the calendar auto-advance.
 await from.click();await editor.getByRole('button',{name:'2026-10-13',exact:true}).click();assert.equal(await from.inputValue(),'2026-10-13');assert.equal(await to.inputValue(),'');
 await to.focus();await editor.getByRole('button',{name:'2026-10-15',exact:true}).click();assert.equal(await to.inputValue(),'2026-10-15');assert.equal(await from.inputValue(),'2026-10-13');
 await from.focus();await from.fill('2026-10-11');await from.press('Tab');assert.equal(await to.evaluate(el=>document.activeElement===el),true);
 await editor.getByRole('button',{name:'Cancel',exact:true}).click();
 await editor.waitFor({state:'detached'}); // Focus restores after the retained exit, not on close intent.
 assert.equal(await trigger.getAttribute('aria-pressed'),'false');assert.equal(await page.evaluate(()=>document.activeElement.id),'date-range-trigger');
 return {viewport:page.viewportSize(),rows,metrics,fab,pill:inactive,dateGeometry};
};
