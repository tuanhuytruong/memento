import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import { build } from 'esbuild';
const require = createRequire('/home/ubuntu/.cache/memento-ui-playwright/package.json');
const {chromium}=require('playwright');
test('mounted hook: debounce, clear, Enter, composition, generation switch and unmount timer fences', {timeout:30000},async()=>{
 const bundled=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {useDebouncedSearch} from './src/lib/useDebouncedSearch';let root=createRoot(document.getElementById('root'));function App({raw,generation}){const s=useDebouncedSearch(raw,generation);window.s=s;return <div id="value">{JSON.stringify({value:s.value,pending:s.pending})}</div>;}window.render=(raw,generation)=>root.render(<App raw={raw} generation={generation}/>);window.unmount=()=>root.unmount();window.render('',1);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife'});
 const server=http.createServer((req,res)=>{res.end('<div id="root"></div><script>'+bundled.outputFiles[0].text+'</script>');});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell',args:['--no-sandbox']});
 try{const p=await browser.newPage();await p.goto('http://127.0.0.1:'+(server.address() as any).port);await p.waitForFunction(()=>!!(window as any).s);
 const render=async(raw:string,generation=1)=>{await p.evaluate(({raw,generation})=>(window as any).render(raw,generation),{raw,generation});await p.waitForTimeout(20);};
 const state=()=>p.evaluate(()=>({value:(window as any).s.value,pending:(window as any).s.pending}));
 await render('abc');assert.deepEqual(await state(),{value:'',pending:true});await p.waitForTimeout(300);assert.deepEqual(await state(),{value:'abc',pending:false});
 await render('next');await render('');assert.deepEqual(await state(),{value:'',pending:false});await p.waitForTimeout(300);assert.equal((await state()).value,'');
 await render('enter');await p.evaluate(()=>(window as any).s.flush());await p.waitForTimeout(20);assert.equal((await state()).value,'enter');
 await p.evaluate(()=>(window as any).s.compositionStart());await render('ime');await p.waitForTimeout(350);assert.equal((await state()).value,'enter');await p.evaluate(()=>(window as any).s.compositionEnd());await p.waitForTimeout(300);assert.equal((await state()).value,'ime');
 await render('old account');await render('',2);await p.waitForTimeout(350);assert.deepEqual(await state(),{value:'',pending:false});
 await render('unmount',2);await p.evaluate(()=>(window as any).unmount());await p.waitForTimeout(350);assert.equal(await p.locator('#value').count(),0);
 }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
});
