import 'dotenv/config';
import { createInvite, pool } from '../memento-db.mjs';

try {
  const days = Number(process.argv[2] || 30);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Usage: npm run invite:create -- [1..365 days]');
  const code = await createInvite(days);
  process.stdout.write(`${code}\n`);
} finally {
  await pool.end();
}
