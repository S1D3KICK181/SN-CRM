import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, '..');
const projectRefPath = resolve(appDir, 'supabase', '.temp', 'project-ref');
const seedSqlPath = resolve(appDir, 'supabase', 'seed.sql');
const containerName = 'supabase_db_sn-practice-crm';
const expectedHostPort = '54322';

// 1. Fail-closed: Never target remote / cloud projects
if (existsSync(projectRefPath)) {
  console.error(`[seed:local] ERROR: Linked project reference found at ${projectRefPath}.`);
  console.error('[seed:local] seed:local is strictly restricted to local Docker environments.');
  process.exit(1);
}

// 2. Verify local Docker container is running and port 54322 is bound
let inspectData;
try {
  const inspectOutput = execSync(`docker inspect ${containerName}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  inspectData = JSON.parse(inspectOutput)[0];
} catch (err) {
  console.error(`[seed:local] ERROR: Could not inspect container "${containerName}". Is Docker Desktop running?`);
  console.error(err.stderr || err.message);
  process.exit(1);
}

if (!inspectData?.State?.Running) {
  console.error(`[seed:local] ERROR: Container "${containerName}" is not running.`);
  process.exit(1);
}

const hostPortBindings = inspectData?.NetworkSettings?.Ports?.['5432/tcp'] || [];
const isPortBound = hostPortBindings.some((b) => b.HostPort === expectedHostPort);
if (!isPortBound) {
  console.error(`[seed:local] ERROR: Container "${containerName}" is not bound to expected host port ${expectedHostPort}.`);
  console.error(`Found bindings: ${JSON.stringify(hostPortBindings)}`);
  process.exit(1);
}

// 3. Read seed SQL
if (!existsSync(seedSqlPath)) {
  console.error(`[seed:local] ERROR: seed.sql not found at ${seedSqlPath}`);
  process.exit(1);
}
const seedSql = readFileSync(seedSqlPath, 'utf8');

// 4. Wrap with same-connection authorization handshake and transaction boundary
const payload = [
  'BEGIN;',
  "SET LOCAL sn.seed_authorized = 'sn_practice_crm_local_dev_only';",
  '\\set ON_ERROR_STOP on',
  seedSql,
  'COMMIT;',
].join('\n');

console.log(`[seed:local] Streaming seed payload into ${containerName} (port ${expectedHostPort})...`);

const psqlProcess = spawn(
  'docker',
  ['exec', '-i', containerName, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);

psqlProcess.stdin.write(payload);
psqlProcess.stdin.end();

psqlProcess.on('close', (code) => {
  if (code === 0) {
    console.log('[seed:local] Database seeded successfully.');
    process.exit(0);
  } else {
    console.error(`[seed:local] ERROR: psql exited with code ${code}`);
    process.exit(code ?? 1);
  }
});
