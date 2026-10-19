// Shared browser measurements for synthetic fixtures and authenticated deployed DEV.
const assert=require('node:assert/strict');
module.exports=async function dateGeometry(page, editor){
 await editor.getByRole('spinbutton',{name:'Calendar year'}).fill('2026');
 await editor.getByRole('combobox',{name:'Calendar month'}).selectOption('7'); // August starts Saturday: six rows.
 await page.waitForTimeout(100);
 const geometry=await editor.evaluate(el=>{
  const p=el.getBoundingClientRect(),grid=el.querySelector('[aria-label="Calendar days"]');
  const boxes=[...grid.children].slice(7).map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,visible:r.top>=p.top&&r.bottom<=p.bottom};});
  const footer=[...el.querySelectorAll('button')].filter(e=>['Clear','Cancel','Apply'].includes(e.textContent)).map(e=>{const r=e.getBoundingClientRect();return {label:e.textContent,x:r.x,y:r.y,w:r.width,h:r.height,visible:r.top>=p.top&&r.bottom<=p.bottom&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});
  return {viewport:{w:innerWidth,h:innerHeight},panel:{x:p.x,y:p.y,w:p.width,h:p.height},scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,cells:boxes,footer,documentWidth:document.documentElement.scrollWidth};
 });
 assert.equal(geometry.cells.length,42);
 assert.equal(new Set(geometry.cells.map(c=>c.y)).size,6);
 assert(geometry.documentWidth<=geometry.viewport.w);
 const short=geometry.viewport.h<500;
 if(!short){
  assert(geometry.scrollHeight<=geometry.clientHeight,JSON.stringify(geometry));
  assert(geometry.cells.every(c=>c.visible),'all 42 date cells simultaneously visible');
  assert(geometry.footer.every(c=>c.visible),'all footer controls simultaneously visible');
 }
 assert(geometry.cells.every(c=>c.h>=44 && c.w>=40),'day hit targets >=40x44');
 if(short){
  await editor.getByRole('button',{name:'Apply',exact:true}).scrollIntoViewIfNeeded();
  assert(await editor.getByRole('button',{name:'Apply',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'fallback footer reachable');
  await editor.evaluate(el=>el.scrollTop=0);
 }
 // Actual keyboard endpoint selection, not just field styling.
 const from=editor.locator('#filter-date-from'),to=editor.locator('#filter-date-to');
 await from.focus();await from.press('Tab');assert(await to.evaluate(el=>document.activeElement===el));
 await editor.getByRole('button',{name:'2026-08-15',exact:true}).focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
 assert.equal(await to.inputValue(),'2026-08-16');
 await from.focus();await editor.getByRole('button',{name:'2026-08-01',exact:true}).focus();await page.keyboard.press('Enter');
 assert.equal(await from.inputValue(),'2026-08-01');
 await from.fill('');await to.fill('');
 return geometry;
};
