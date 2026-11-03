import { CrmApplication } from './application';
import { createDemoSeed } from './demo-seed';
import { createApiServer, localOriginsFromEnvironment, resolveAuthConfig } from './http';
import { InMemoryCrmRepository } from './in-memory-repository';
import { createShutdownHandler } from './shutdown';

const authConfig = resolveAuthConfig(process.env);

const port = Number.parseInt(process.env['PORT'] ?? '8788', 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const host = process.env['HOST'] ?? '127.0.0.1';
const repository = new InMemoryCrmRepository(createDemoSeed());
const application = new CrmApplication(repository);
const server = createApiServer(application, {
  allowedOrigins: localOriginsFromEnvironment(process.env['LOCAL_WEB_ORIGINS']),
  allowDevActorHeader: authConfig.allowDevActorHeader,
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
