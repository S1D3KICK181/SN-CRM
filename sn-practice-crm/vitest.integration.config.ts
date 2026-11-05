import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@sn/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)),
      '@sn/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['apps/**/*.integration.test.ts'],
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 20000,
  },
});
