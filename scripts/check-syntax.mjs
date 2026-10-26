import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
async function walk(dir) { const out=[]; for (const e of await readdir(dir,{withFileTypes:true})) { const f=path.join(dir,e.name); if(e.isDirectory()&&!['node_modules','dist','.git'].includes(e.name)) out.push(...await walk(f)); else if(e.isFile()&&/\.(mjs|cjs)$/.test(e.name)) out.push(f); } return out; }
const files=await walk('.'); for(const file of files){const r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status)process.exit(r.status||1)} console.log(`syntax: ${files.length} JS modules checked`);
