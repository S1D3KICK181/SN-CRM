import { isProductionEnvironment } from './http';

if (isProductionEnvironment(process.env['NODE_ENV'])) {
  console.error('FATAL CONFIGURATION ERROR: Cannot run dev entrypoint when NODE_ENV is production.');
  process.exit(1);
}

process.env['ALLOW_DEV_ACTOR_HEADER'] = 'true';
await import('./index');

export {};
