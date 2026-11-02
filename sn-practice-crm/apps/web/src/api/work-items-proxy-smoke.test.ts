import { fileURLToPath, URL } from 'node:url';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { CrmApplication } from '../../../api/src/application';
import { createDemoSeed, DEMO_ACTOR_IDS } from '../../../api/src/demo-seed';
import { createApiServer } from '../../../api/src/http';
import { InMemoryCrmRepository } from '../../../api/src/in-memory-repository';
import { HttpWorkItemsAdapter } from './http-work-items-adapter';
import { WorkItemOperationError } from './work-items-types';

describe('Vite Proxy & Real Work Items API Smoke (Authentic Authority)', () => {
  let apiServer: Server;
  let viteServer: ViteDevServer;
  let vitePort: number;
  let previousProxyTarget: string | undefined;

  beforeAll(async () => {
    // 1. Start the actual CRM API server bound to an ephemeral port (port 0)
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const application = new CrmApplication(repository);
    apiServer = createApiServer(application);

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

  it('1. Senior delegates a real API-seeded assignment to Trainee with due <= parent due -> 201', async () => {
    const adapter = new HttpWorkItemsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    // asg_gst_october is owned by Priya Desai (DEMO_ACTOR_IDS.senior), due at 2026-11-11T12:30:00.000Z
    const created = await adapter.create('senior_staff', {
      kind: 'delegated',
      title: 'Audit sales registers vs GSTR-1',
      assignmentId: 'asg_gst_october',
      assigneeId: DEMO_ACTOR_IDS.trainee,
      dueAt: '2026-11-05T12:30:00.000Z',
      notes: 'Check 2 debit notes mentioned in delivery notes',
    });

    expect(created.id).toMatch(/^wrk_/);
    expect(created.title).toBe('Audit sales registers vs GSTR-1');
    expect(created.status).toBe('todo');
    expect(created.assigneeId).toBe(DEMO_ACTOR_IDS.trainee);
    expect(created.createdById).toBe(DEMO_ACTOR_IDS.senior);
  });

  it('2. Trainee list sees delegated item, starts it, and submits it', async () => {
    const adapter = new HttpWorkItemsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    // Create item to transition
    const created = await adapter.create('senior_staff', {
      kind: 'delegated',
      title: 'Verify e-way bills for October',
      assignmentId: 'asg_gst_october',
      assigneeId: DEMO_ACTOR_IDS.trainee,
      dueAt: '2026-11-06T12:30:00.000Z',
    });

    // Trainee lists items and sees it
    const traineeItems = await adapter.list('trainee');
    const target = traineeItems.find((i) => i.id === created.id);
    expect(target).toBeDefined();
    expect(target?.status).toBe('todo');

    // Trainee starts it
    const started = await adapter.transition('trainee', created.id, 'start');
    expect(started.status).toBe('in_progress');

    // Trainee submits it
    const submitted = await adapter.transition('trainee', created.id, 'submit');
    expect(submitted.status).toBe('ready_for_review');
  });

  it('3. Senior list sees ready item and approves -> done', async () => {
    const adapter = new HttpWorkItemsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    const item = await adapter.create('senior_staff', {
      kind: 'delegated',
      title: 'Prepare HSN summary table',
      assignmentId: 'asg_gst_october',
      assigneeId: DEMO_ACTOR_IDS.trainee,
      dueAt: '2026-11-07T12:30:00.000Z',
    });

    await adapter.transition('trainee', item.id, 'start');
    await adapter.transition('trainee', item.id, 'submit');

    // Senior lists items and verifies ready_for_review status
    const seniorItems = await adapter.list('senior_staff');
    const found = seniorItems.find((i) => i.id === item.id);
    expect(found?.status).toBe('ready_for_review');

    // Senior approves it (transition 'complete')
    const completed = await adapter.transition('senior_staff', item.id, 'complete');
    expect(completed.status).toBe('done');
  });

  it('4. Staff -> Senior delegation -> 403 forbidden', async () => {
    const adapter = new HttpWorkItemsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    // asg_tds_q2 is owned by Staff (DEMO_ACTOR_IDS.staff)
    // Staff attempts to delegate to Senior (violates delegation hierarchy!)
    await expect(
      adapter.create('staff', {
        kind: 'delegated',
        title: 'Unauthorized upward delegation',
        assignmentId: 'asg_tds_q2',
        assigneeId: DEMO_ACTOR_IDS.senior,
        dueAt: '2026-11-03T12:30:00.000Z',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(WorkItemOperationError);
      const opErr = err as WorkItemOperationError;
      expect(opErr.code).toBe('forbidden');
      expect(opErr.status).toBe(403);
      expect(opErr.serverCode).toBe('invalid_delegate_role');
      return true;
    });
  });

  it('5. Trainee delegation -> 403 forbidden', async () => {
    const adapter = new HttpWorkItemsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    await expect(
      adapter.create('trainee', {
        kind: 'delegated',
        title: 'Trainee attempt to delegate',
        assignmentId: 'asg_gst_october',
        assigneeId: DEMO_ACTOR_IDS.staff,
        dueAt: '2026-11-03T12:30:00.000Z',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(WorkItemOperationError);
      const opErr = err as WorkItemOperationError;
      expect(opErr.code).toBe('forbidden');
      expect(opErr.status).toBe(403);
      return true;
    });
  });

  it('6. Due after parent assignment -> 422 validation error', async () => {
    const adapter = new HttpWorkItemsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    // asg_gst_october is due at 2026-11-11T12:30:00.000Z
    // Attempting due at 2026-11-15 (after parent) must fail with 422 task_due_after_assignment
    await expect(
      adapter.create('senior_staff', {
        kind: 'delegated',
        title: 'Late subtask',
        assignmentId: 'asg_gst_october',
        assigneeId: DEMO_ACTOR_IDS.trainee,
        dueAt: '2026-11-15T12:30:00.000Z',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(WorkItemOperationError);
      const opErr = err as WorkItemOperationError;
      expect(opErr.code).toBe('validation');
      expect(opErr.status).toBe(422);
      expect(opErr.serverCode).toBe('task_due_after_assignment');
      return true;
    });
  });

  it('7. Premature approval before submit -> 409 conflict', async () => {
    const adapter = new HttpWorkItemsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    const item = await adapter.create('senior_staff', {
      kind: 'delegated',
      title: 'Premature approval check',
      assignmentId: 'asg_gst_october',
      assigneeId: DEMO_ACTOR_IDS.trainee,
      dueAt: '2026-11-08T12:30:00.000Z',
    });

    // In 'todo' status: senior attempts premature 'complete'
    await expect(
      adapter.transition('senior_staff', item.id, 'complete'),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(WorkItemOperationError);
      const opErr = err as WorkItemOperationError;
      expect(opErr.code).toBe('conflict');
      expect(opErr.status).toBe(409);
      expect(opErr.message).toMatch(/must be submitted before it is completed/i);
      return true;
    });
  });

  it('8. Personal privacy: a Staff personal task never appears in Founder/Manager/Trainee lists', async () => {
    const adapter = new HttpWorkItemsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    const staffPersonal = await adapter.create('staff', {
      kind: 'personal',
      title: 'Staff highly confidential private reminder',
      dueAt: '2026-11-04T10:00:00.000Z',
    });

    expect(staffPersonal.id).toMatch(/^wrk_/);
    expect(staffPersonal.kind).toBe('personal');
    expect(staffPersonal.assigneeId).toBe(DEMO_ACTOR_IDS.staff);

    // Verify Staff sees it
    const staffItems = await adapter.list('staff');
    expect(staffItems.some((i) => i.id === staffPersonal.id)).toBe(true);

    // Verify Founder DOES NOT see it
    const founderItems = await adapter.list('founder');
    expect(founderItems.some((i) => i.id === staffPersonal.id)).toBe(false);

    // Verify Manager DOES NOT see it
    const managerItems = await adapter.list('manager');
    expect(managerItems.some((i) => i.id === staffPersonal.id)).toBe(false);

    // Verify Trainee DOES NOT see it
    const traineeItems = await adapter.list('trainee');
    expect(traineeItems.some((i) => i.id === staffPersonal.id)).toBe(false);
  });
});
