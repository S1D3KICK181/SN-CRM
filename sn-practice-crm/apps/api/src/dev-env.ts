import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isProductionEnvironment } from './http';

export interface DevEnvOptions {
  env?: NodeJS.ProcessEnv;
  envPath?: string;
  loadEnvFn?: (path: string) => void;
  existsFn?: (path: string) => boolean;
}

function assertNotProduction(env: NodeJS.ProcessEnv): void {
  if (isProductionEnvironment(env['NODE_ENV']) || isProductionEnvironment(env['ENVIRONMENT'])) {
    throw new Error('FATAL CONFIGURATION ERROR: Cannot run dev entrypoint when NODE_ENV or ENVIRONMENT is production.');
  }
}

export function configureDevEnvironment(options: DevEnvOptions = {}): void {
  const env = options.env ?? process.env;
  const loadEnv = options.loadEnvFn ?? ((p: string) => process.loadEnvFile(p));
  const exists = options.existsFn ?? existsSync;

  // 1. Fail-closed pre-load gate: block immediately if environment is already production
  assertNotProduction(env);

  // 2. Resolve default .env file relative to apps/api root if not specified
  const targetPath = options.envPath ?? resolve(fileURLToPath(new URL('..', import.meta.url)), '.env');

  // 3. Load file if present (Node's process.loadEnvFile naturally preserves existing env vars)
  if (exists(targetPath)) {
    loadEnv(targetPath);
  }

  // 4. Fail-closed post-load gate: block if .env file defined production mode
  assertNotProduction(env);

  // 5. Apply local development configuration
  env['ALLOW_DEV_ACTOR_HEADER'] = 'true';

  // 6. Only provide loopback Postgres defaults if explicitly requested and missing
  const storage = env['CRM_STORAGE']?.trim().toLowerCase();
  const dbUrl = env['DATABASE_URL']?.trim();
  if (storage === 'postgres' && (!dbUrl || dbUrl === '')) {
    env['DATABASE_URL'] = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  }
}
