import { fileURLToPath, URL } from 'node:url';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { CrmApplication } from '../../../api/src/application';
import { createDemoSeed } from '../../../api/src/demo-seed';
import { createApiServer } from '../../../api/src/http';
import { InMemoryCrmRepository } from '../../../api/src/in-memory-repository';
import { HttpClientsAdapter } from './http-clients-adapter';
import { ClientOperationError } from './clients-types';

const SEED_RAW_PANS = [
  'AABCA1234A',
  'AABCB2345B',
  'AABCS3456C',
  'AABCK4567D',
  'AABCN5678E',
  'AABCA6789F',
] as const;

const SEED_RAW_GSTINS = [
  '27AABCA1234A1Z5',
  '27AABCB2345B1Z4',
  '27AABCS3456C1Z3',
  '27AABCK4567D1Z2',
  '27AABCN5678E1Z1',
  '27AABCA6789F1Z0',
] as const;

const ASTER_CLIENT_ID = '10000000-0000-4000-a000-000000000001';
const BLUEPEAK_CLIENT_ID = '10000000-0000-4000-a000-000000000002';

describe('Vite Proxy & Real Clients API Smoke (Role-Scoped Secure Reads)', () => {
  let apiServer: Server;
  let viteServer: ViteDevServer;
  let vitePort: number;
  let previousProxyTarget: string | undefined;

  beforeAll(async () => {
    // 1. Start the actual CRM API server bound to an ephemeral port (port 0)
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const application = new CrmApplication(repository);
    apiServer = createApiServer(application, { allowDevActorHeader: true });

    await new Promise<void>((resolve, reject) => {
      apiServer.listen(0, '127.0.0.1', () => resolve());
      apiServer.once('error', reject);
    });

    const apiAddress = apiServer.address();
    const apiPort =
      typeof apiAddress === 'object' && apiAddress !== null ? apiAddress.port : null;
    if (!apiPort) {
      throw new Error('Failed to determine ephemeral port for CRM API server.');
    }
    const apiTarget = `http://127.0.0.1:${apiPort}`;

    // 2. Set the test proxy target before creating Vite dev server
    previousProxyTarget = process.env['CRM_API_PROXY_TARGET'];
    process.env['CRM_API_PROXY_TARGET'] = apiTarget;

    // 3. Start Vite with the real apps/web/vite.config.ts and ephemeral port 0
    const configPath = fileURLToPath(new URL('../../vite.config.ts', import.meta.url));
    viteServer = await createViteServer({
      configFile: configPath,
      server: {
        port: 0,
      },
    });
    await viteServer.listen();
    const address = viteServer.httpServer?.address();
    vitePort = typeof address === 'object' && address ? address.port : 0;
  });

  afterAll(async () => {
    try {
      if (viteServer) {
        const maybeViteHttpServer = viteServer.httpServer as
          | (Server & { closeAllConnections?: () => void })
          | null;
        if (typeof maybeViteHttpServer?.closeAllConnections === 'function') {
          maybeViteHttpServer.closeAllConnections();
        }
        await viteServer.close();
      }
    } finally {
      try {
        if (apiServer) {
          const maybeApiServer = apiServer as Server & { closeAllConnections?: () => void };
          if (typeof maybeApiServer.closeAllConnections === 'function') {
            maybeApiServer.closeAllConnections();
          }
          await new Promise<void>((resolve) => {
            apiServer.close(() => resolve());
          });
        }
      } finally {
        if (previousProxyTarget !== undefined) {
          process.env['CRM_API_PROXY_TARGET'] = previousProxyTarget;
        } else {
          delete process.env['CRM_API_PROXY_TARGET'];
        }
      }
    }
  });

  it('proxies GET /api/v1/clients and enforces role scoping across all five roles', async () => {
    const adapter = new HttpClientsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    // 1. Founder sees 6
    const founderClients = await adapter.list('founder');
    expect(founderClients).toHaveLength(6);
    expect(founderClients.map((c) => c.code)).toEqual([
      'CL-001001',
      'CL-001002',
      'CL-001003',
      'CL-001004',
      'CL-001005',
      'CL-001006',
    ]);

    // 2. Manager sees 6
    const managerClients = await adapter.list('manager');
    expect(managerClients).toHaveLength(6);
    expect(managerClients.map((c) => c.code)).toEqual(founderClients.map((c) => c.code));

    // 3. Senior staff sees 5 (BluePeak CL-001002 is excluded)
    const seniorClients = await adapter.list('senior_staff');
    expect(seniorClients).toHaveLength(5);
    expect(seniorClients.map((c) => c.code)).toEqual([
      'CL-001001',
      'CL-001003',
      'CL-001004',
      'CL-001005',
      'CL-001006',
    ]);

    // 4. Staff sees exactly codes CL-001002 and CL-001004 (2)
    const staffClients = await adapter.list('staff');
    expect(staffClients).toHaveLength(2);
    expect(staffClients.map((c) => c.code)).toEqual(['CL-001002', 'CL-001004']);

    // 5. Trainee sees exactly code CL-001001 (1)
    const traineeClients = await adapter.list('trainee');
    expect(traineeClients).toHaveLength(1);
    expect(traineeClients.map((c) => c.code)).toEqual(['CL-001001']);
  });

  it('proxies GET /api/v1/clients/:id for Aster, returning the full statutory IDs to the founder and only masked ones to a trainee', async () => {
    const adapter = new HttpClientsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    const aster = await adapter.get('founder', ASTER_CLIENT_ID);
    expect(aster.id).toBe(ASTER_CLIENT_ID);
    expect(aster.code).toBe('CL-001001');
    expect(aster.displayName).toBe('Aster Foods');
    expect(aster.panMasked).toBe('******1234');
    expect(aster.gstinMasked).toBe('27**********1Z5');

    // The founder looks after every client, so the full values are filled
    expect(aster.pan).toBe('AABCA1234A');
    expect(aster.gstin).toBe('27AABCA1234A1Z5');

    // A trainee on the same client gets null full values and the same masked values
    const traineeAster = await adapter.get('trainee', ASTER_CLIENT_ID);
    expect(traineeAster.pan).toBeNull();
    expect(traineeAster.gstin).toBeNull();
    expect(traineeAster.panMasked).toBe('******1234');
    expect(traineeAster.gstinMasked).toBe('27**********1Z5');
  });

  it('trainee GET /api/v1/clients/:id on hidden BluePeak maps to normalized not_found error', async () => {
    const adapter = new HttpClientsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    await expect(adapter.get('trainee', BLUEPEAK_CLIENT_ID)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('not_found');
        expect(opErr.status).toBe(404);
        return true;
      },
    );
  });

  it('trainee list serialized payload contains none of the raw seed PANs or GSTINs, and the founder list carries all six full values', async () => {
    const adapter = new HttpClientsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    const founderClients = await adapter.list('founder');
    expect(founderClients).toHaveLength(6);
    expect(founderClients.map((client) => client.pan)).toEqual([...SEED_RAW_PANS]);
    expect(founderClients.map((client) => client.gstin)).toEqual([...SEED_RAW_GSTINS]);

    const traineeClients = await adapter.list('trainee');
    const serialized = JSON.stringify(traineeClients);

    for (const pan of SEED_RAW_PANS) {
      expect(serialized).not.toContain(pan);
    }
    for (const gstin of SEED_RAW_GSTINS) {
      expect(serialized).not.toContain(gstin);
    }

    for (const client of [...founderClients, ...traineeClients]) {
      expect(client.panMasked).toMatch(/^\*{6}\d{4}$/);
      if (client.gstinMasked !== null) {
        expect(client.gstinMasked).toMatch(/^\d{2}\*{10}\w{3}$/);
      }
    }
  });
});
