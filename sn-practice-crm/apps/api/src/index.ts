import { CrmApplication } from './application';
import { createDemoSeed } from './demo-seed';
import { createApiServer, localOriginsFromEnvironment } from './http';
import { InMemoryCrmRepository } from './in-memory-repository';

const port = Number.parseInt(process.env['PORT'] ?? '8788', 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const host = process.env['HOST'] ?? '127.0.0.1';
const repository = new InMemoryCrmRepository(createDemoSeed());
const application = new CrmApplication(repository);
const server = createApiServer(application, {
  allowedOrigins: localOriginsFromEnvironment(process.env['LOCAL_WEB_ORIGINS']),
});

server.listen(port, host, () => {
  console.log(`SN Practice CRM API listening at http://${host}:${port}`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received; closing the API server.`);
  server.close((error) => {
    if (error) {
      console.error('API shutdown failed.', error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
