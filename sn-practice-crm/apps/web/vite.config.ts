import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiProxy = {
  '/api': {
    target: process.env['CRM_API_PROXY_TARGET'] || process.env['API_PROXY_TARGET'] || 'http://127.0.0.1:8788',
    changeOrigin: true,
  },
};

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
    proxy: apiProxy,
  },
  preview: {
    host: '127.0.0.1',
    port: 4311,
    proxy: apiProxy,
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
});
