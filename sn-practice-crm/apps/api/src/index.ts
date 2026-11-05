import { CrmApplication } from './application';
import { createDatabaseClient, probeDatabase } from './db';
import { createDemoSeed } from './demo-seed';
import { createApiServer, isProductionEnvironment, resolveAllowedOrigins, resolveAuthConfig } from './http';
import { InMemoryCrmRepository } from './in-memory-repository';
import { PostgresCrmRepository } from './postgres-repository';
import { createShutdownHandler } from './shutdown';

const authConfig = resolveAuthConfig(process.env);
const isProduction = isProductionEnvironment(process.env['NODE_ENV']);
const rawStorage = process.env['CRM_STORAGE']?.trim().toLowerCase();

if (isProduction) {
  if (rawStorage !== 'postgres') {
    console.error("FATAL CONFIGURATION ERROR: CRM_STORAGE must be explicitly set to 'postgres' in production mode.");
    process.exit(1);
  }
} else if (rawStorage && rawStorage !== 'memory' && rawStorage !== 'postgres') {
  console.error(`FATAL CONFIGURATION ERROR: Invalid CRM_STORAGE value: "${rawStorage}". Must be 'memory' or 'postgres'.`);
  process.exit(1);
}

const usePostgres = rawStorage === 'postgres';

let repository: InMemoryCrmRepository | PostgresCrmRepository;
let sql: ReturnType<typeof createDatabaseClient> | undefined;

if (usePostgres) {
  const databaseUrl = process.env['DATABASE_URL']?.trim();
  if (!databaseUrl) {
    console.error('FATAL CONFIGURATION ERROR: DATABASE_URL must be set when CRM_STORAGE is postgres.');
    process.exit(1);
  }

  sql = createDatabaseClient(databaseUrl);
  try {
    const probe = await probeDatabase(sql);
    console.log(`Database connected: ${probe.database} as ${probe.user}`);
  } catch (err) {
    console.error('FATAL DATABASE ERROR: Preflight database probe failed:', (err as Error).message);
    process.exit(1);
  }

  repository = new PostgresCrmRepository(sql);
} else {
  repository = new InMemoryCrmRepository(createDemoSeed());
}

const application = new CrmApplication(repository);

const port = Number.parseInt(process.env['PORT'] ?? '8788', 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const host = process.env['HOST'] ?? '127.0.0.1';
const server = createApiServer(application, {
  allowedOrigins: resolveAllowedOrigins(process.env),
  allowDevActorHeader: authConfig.allowDevActorHeader,
  jwksUrl: authConfig.jwksUrl,
  jwtSecret: authConfig.jwtSecret,
  jwtIssuer: authConfig.jwtIssuer,
  sql,
});

server.listen(port, host, () => {
  console.log(`SN Practice CRM API listening at http://${host}:${port}`);
});

const handleShutdown = createShutdownHandler({
  server,
  repository,
  timeoutMs: 10_000,
});

process.once('SIGINT', () => {
  void handleShutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void handleShutdown('SIGTERM');
});
