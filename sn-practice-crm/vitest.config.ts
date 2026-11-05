import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@sn/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)),
      '@sn/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
      '@web': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'apps/**/*.test.tsx'],
    exclude: ['**/*.integration.test.ts', 'node_modules', 'dist'],
  },
});
