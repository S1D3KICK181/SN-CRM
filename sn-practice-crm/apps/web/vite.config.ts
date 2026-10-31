import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      '@sn/domain': fileURLToPath(new URL('../../packages/domain/src/index.ts', import.meta.url)),
      '@sn/contracts': fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)),
      '@web': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4310,
  },
  preview: {
    host: '127.0.0.1',
    port: 4311,
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
});
