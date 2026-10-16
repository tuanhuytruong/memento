// Operational bounded retry: ENV_FILE=.env.local node cleanup-objects.mjs [--retry] [--limit=20]
import { cleanup } from './server.mjs';
import { pool } from './memento-db.mjs';
try {
  const target=await pool.query('SELECT current_database() AS db');
  if(target.rows[0].db!=='dwh'||(process.env.R2_PREFIX||`${process.env.DB_SCHEMA}/`)!==`${process.env.DB_SCHEMA}/`)throw new Error('Cleanup database/schema/prefix preflight failed');
  const limit=Number(process.argv.find(x=>x.startsWith('--limit='))?.split('=')[1]||20);
  const result=await cleanup.drain({limit,retry:process.argv.includes('--retry')});
  console.log(JSON.stringify({schema:process.env.DB_SCHEMA,...result}));
  if(result.failed)process.exitCode=1;
} finally {await pool.end();}
