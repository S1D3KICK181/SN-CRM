import { fileURLToPath, URL } from 'node:url';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { CrmApplication } from '../../../api/src/application';
import { createDemoSeed } from '../../../api/src/demo-seed';
import { createApiServer } from '../../../api/src/http';
import { InMemoryCrmRepository } from '../../../api/src/in-memory-repository';
import { HttpAssignmentsAdapter } from './http-adapter';

describe('Vite Proxy & Live API Smoke', () => {
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

  it('proxies /api/v1/assignments through Vite to the API server and returns live data', async () => {
    const adapter = new HttpAssignmentsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    const rows = await adapter.list('founder');
    expect(rows).toBeInstanceOf(Array);
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const first = rows[0]!;
    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(first.client).toBeTruthy();
    expect(first.due).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it('authoritatively creates and transitions an assignment across the proxy', async () => {
    const adapter = new HttpAssignmentsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    // 1. Create assignment as founder
    const created = await adapter.create('founder', {
      clientId: 'CLI-0001',
      clientName: 'Aster Foods Private Limited',
      title: 'Smoke Test Filing',
      service: 'GST Compliance',
      ownerNameOrId: 'Ananya Rao',
      reviewerNameOrId: 'Priya Desai',
      dueDate: '15/11/2026',
    });

    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(created.title).toBe('Smoke Test Filing');
    expect(created.status).toBe('Awaiting documents');

    // 2. Start assignment as senior staff (Ananya Rao owns it)
    const started = await adapter.transition('senior_staff', created.id, 'start', {
      expectedUpdatedAt: created.expectedUpdatedAt,
    });
    expect(started.status).toBe('In progress');

    // 3. Submit assignment for review as senior staff
    const submitted = await adapter.transition('senior_staff', created.id, 'submit', {
      expectedUpdatedAt: started.expectedUpdatedAt,
    });
    expect(submitted.status).toBe('Pending review');

    // 4. Complete assignment as founder
    const completed = await adapter.transition('founder', created.id, 'complete', {
      expectedUpdatedAt: submitted.expectedUpdatedAt,
    });
    expect(completed.status).toBe('Approved');
    expect(completed.progress).toBe(100);
  });

  it('authoritatively creates assignment using representative real UI composer seed values', async () => {
    const adapter = new HttpAssignmentsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    // Real UI composer defaults as produced by ComposerDialog:
    // client: "Aster Foods Private Limited" (CLIENTS[0])
    // title: "Statutory Compliance Engagement"
    // service: "GST Compliance"
    // owner: "Priya Desai"
    // reviewer: "Ananya Rao"
    // due: "15/11/2026"
    // fee: 35000, scope: "Standard audit and compliance fieldwork."
    const uiComposerCommand = {
      title: 'Statutory Compliance Engagement',
      client: 'Aster Foods Private Limited',
      clientId: 'CLI-0001',
      service: 'GST Compliance',
      owner: 'Priya Desai',
      reviewer: 'Ananya Rao',
      due: '15/11/2026',
      fee: 35000,
      scope: 'Standard audit and compliance fieldwork.',
    };

    const created = await adapter.create('founder', uiComposerCommand);

    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(created.title).toBe('Statutory Compliance Engagement');
    expect(created.client).toBe('Aster Foods');
    expect(created.owner).toBe('Priya Desai');
    expect(created.reviewer).toBe('Ananya Rao');
    expect(created.status).toBe('Awaiting documents');
    expect(created.due).toBe('15/11/2026');
  });
});
