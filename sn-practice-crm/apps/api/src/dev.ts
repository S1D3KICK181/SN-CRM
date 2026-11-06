import { configureDevEnvironment } from './dev-env';

try {
  configureDevEnvironment();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}

await import('./index');

export {};
