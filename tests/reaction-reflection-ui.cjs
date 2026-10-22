// Named synthetic browser entry point; controlled routes are not live persistence evidence.
const { spawnSync } = require('node:child_process');
const env = { ...process.env, MEMENTO_REACTION_REFLECTION_ONLY: '1' };
const result = spawnSync(process.execPath, ['tests/ui-remediation.cjs'], { env, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
if (result.stdout) process.stdout.write(result.stdout);
if (result.status !== 0) process.exit(result.status || 1);
const marker = result.stdout.lastIndexOf('{');
const reportText = result.stdout.slice(marker);
try { const report = JSON.parse(reportText); if (!report.results?.length || !report.results.every(line => line.includes('PASS'))) throw new Error('No complete QA results'); }
catch (error) { console.error(`Invalid browser QA report: ${error.message}`); process.exit(1); }
