// Explicit operator-local snapshot; no endpoint and no automatic data deletion.
// node scripts/operational-status.mjs
import { pool, qschema } from '../memento-db.mjs';
import { sampleOperationalState } from '../operational-metrics.mjs';
try { console.log(JSON.stringify(await sampleOperationalState({pool,qschema}),null,2)); }
finally { await pool.end(); }
